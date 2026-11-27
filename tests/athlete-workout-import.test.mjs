import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Encoder, Profile } from '@garmin/fitsdk';

const bundle = await build({
  stdin: { contents: "export * from './src/lib/athlete-samsung'; export * from './src/lib/athlete-recognition'; export * from './src/lib/athlete-workout'; export * from './src/lib/athlete-fit'; export * from './src/lib/athlete-recovery'; export * from './src/lib/athlete-route-map';", resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { readSamsungWorkout, recognizeSamsungScreenshots, matchingWorkout, personalBests, parseFitWorkout, recognizeWhoopRecovery, workoutChartSamples, fitWorkoutRoute } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const reading = (text) => ({ text, layoutText: '', confidence: 90, pass: 'original' });

test('satellite tiles and GPS markers align across the antimeridian', () => {
  const route = fitWorkoutRoute([
    { latitude: 0, longitude: 180, segment: 0 },
    { latitude: .001, longitude: -179.999, segment: 0 },
    { latitude: .002, longitude: 179.999, segment: 1 },
  ]);
  assert.ok(route.last.y < route.first.y);
  assert.equal(route.path.match(/M/g).length, 2);
  // The equator and antimeridian intersect at the top left of this wrapped tile.
  const tile = route.tiles.find(({ zoom, x, y }) => x === 0 && y === 2 ** (zoom - 1));
  assert.ok(tile);
  assert.ok(Math.abs(tile.left - route.first.x) < 1e-6);
  assert.ok(Math.abs(tile.top - route.first.y) < 1e-6);
  assert.ok(route.tiles.some(({ zoom, x }) => x === 2 ** zoom - 1));
});

test('workout file and screenshot summaries can suggest the same saved run', () => {
  const screenshot = { id: 'screenshot', kind: 'run', activityDate: '2026-11-14', distanceMeters: 6240, durationSeconds: 3011 };
  const file = { id: 'file', kind: 'run', activityDate: '2026-11-14', distanceMeters: 6310, durationSeconds: 3024 };
  assert.equal(matchingWorkout([screenshot], file), screenshot);
  assert.equal(matchingWorkout([file], screenshot), file);
  assert.equal(matchingWorkout([screenshot, { ...screenshot, id: 'other' }], file), undefined);
  assert.equal(matchingWorkout([screenshot], { ...file, activityDate: '2026-11-20' }), undefined);
  assert.equal(matchingWorkout([screenshot], { ...file, kind: 'walk' }), undefined);
  assert.equal(matchingWorkout([screenshot], { ...file, durationSeconds: null }), undefined);
  assert.equal(matchingWorkout([screenshot], { ...file, distanceMeters: 5000 }), undefined);
});

test('timed GPS yields speed and pace without crossing stops or track segments', () => {
  const points = workoutChartSamples([
    { seconds: 0, latitude: 0, longitude: 0, segment: 0 },
    { seconds: 10, latitude: .00027, longitude: 0, segment: 0 },
    { seconds: 20, latitude: .00054, longitude: 0, segment: 0, speed: 12 },
    { seconds: 90, latitude: .00081, longitude: 0, segment: 0 },
    { seconds: 100, latitude: .00108, longitude: 0, segment: 1 },
    { seconds: 110, latitude: .00108, longitude: 0, segment: 1 },
  ]);
  assert.ok(Math.abs(points[1].speed - 10.8) < .02);
  assert.ok(Math.abs(points[1].pace - 333.3) < 1);
  assert.equal(points[1].estimatedSpeed, true);
  assert.equal(points[2].pace, 300);
  assert.equal(points[2].estimatedSpeed, false);
  assert.deepEqual(points.map(({ speed }) => speed).slice(3), [undefined, undefined, 0]);
  assert.equal(points[5].pace, undefined);
  assert.ok(points.every(({ heartRate, cadence }) => heartRate === undefined && cadence === undefined));
});

test('Samsung workout bundle keeps workout duration, elapsed time, zones and conflicts distinct', () => {
  const screens = [
    { readings: [reading("15:58\nWorkout duration\n50:11\nTotal duration\n52:52\n6.24 km\nWorkout calories\n507 kcal\nTotal calories\n511 kcal")] },
    { readings: [reading("Avg. heart rate\nMax. heart rate\n169 bpm\n182 bpm\nZone 5: Maximum 182-202 bpm\n00:25 0.8%")] },
    { readings: [reading("Zone 5: Maximum 182-202 bpm\n00:25 8%")] },
    { readings: [{ ...reading('Laps'), laps: [{ number: 1, seconds: 461, meters: 1000, heartRate: 156 }] }] },
    { readings: [{ ...reading('Laps'), laps: [{ number: 1, seconds: 461, meters: 1000, heartRate: 157 }] }] },
  ];
  const { route, details } = recognizeSamsungScreenshots(screens, 'km', new Date('2026-11-23T12:00:00'));
  assert.equal(route.date, '');
  assert.equal(route.activity.durationSeconds, 3011);
  assert.equal(route.activity.averageHeartRate, 169);
  assert.equal(details.metrics.maxHeartRate, 182);
  assert.equal(details.metrics.elapsedSeconds, 3172);
  assert.equal(details.metrics.totalCalories, 511);
  assert.equal(details.zones[0].percent, 0.8);
  assert.equal(details.laps[0].heartRate, undefined);
  assert.ok(route.warnings.some((warning) => warning.includes('Lap 1 heart rate')));
  assert.equal(readSamsungWorkout([{ readings: [reading('Heart rate recovery chart 00:56 142 161')] }]), null);
});

test('WHOOP supports a zero score without replacing it with a missing value', () => {
  const result = recognizeWhoopRecovery([reading("WHOOP\nRecovery\n0%\nHRV\n56 ms\nResting heart rate\n48 bpm\nSleep duration\n7:15")], 'km', 'Asia/Kolkata');
  assert.equal(result.recovery.score, 0);
  assert.equal(result.recovery.metrics.hrv, 56);
  assert.equal(result.recovery.metrics.sleepMinutes, 435);
  assert.equal(result.recovery.recoveryDate, '');
});

test('personal bests use real standalone finish times and restrict distance', () => {
  const on = (id, distanceMeters, durationSeconds, kind = 'run') => ({ id, distanceMeters, durationSeconds, kind, activityDate: '2026-11-23' });
  const result = personalBests([on('short', 4999, 1450), on('long', 6000, 1300), on('valid', 5030, 1530), on('cycle', 5010, 1200, 'cycle')]);
  assert.equal(result.find((entry) => entry.label === '5K').activity.id, 'valid');
  assert.equal(result.find((entry) => entry.label === '1K').activity, undefined);
});

test('checks a real encoded FIT session, splits and timestamped measurements', () => {
  const start = new Date('2026-11-23T20:00:00Z');
  const end = new Date('2026-11-23T20:07:00Z');
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: start, type: 'activity' });
  encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: start, heartRate: 152, speed: 2.5, positionLat: 100, positionLong: 200 });
  encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: end, heartRate: 156, speed: 3, positionLat: 180, positionLong: 280 });
  encoder.onMesg(Profile.MesgNum.LAP, { timestamp: end, startTime: start, totalTimerTime: 410, totalElapsedTime: 420, totalDistance: 1000, avgHeartRate: 154 });
  encoder.onMesg(Profile.MesgNum.SESSION, { timestamp: end, startTime: start, sport: 'running', totalTimerTime: 410, totalElapsedTime: 420, totalDistance: 1000, avgHeartRate: 154 });
  const bytes = Uint8Array.from(encoder.close());
  const result = parseFitWorkout(bytes.buffer, 'Asia/Kolkata');
  assert.equal(result.draft.activityDate, '2026-11-24');
  assert.equal(result.draft.durationSeconds, 410);
  assert.equal(result.details.laps[0].elapsedSeconds, 420);
  assert.equal(result.details.samples[1].seconds, 420);
  assert.equal(result.details.samples[1].heartRate, 156);
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => parseFitWorkout(bytes.buffer, 'Asia/Kolkata'), /integrity/);
});
