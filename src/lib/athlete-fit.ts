import { Decoder, Stream } from '@garmin/fitsdk';
import type { AthleteActivityDraft } from './athlete';
import type { WorkoutDetails, WorkoutSample } from './athlete-workout';

function bounded(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}
const semicirclesToDegrees = 180 / 2 ** 31;

export function parseFitWorkout(bytes: ArrayBuffer, timezone: string): { draft: Partial<AthleteActivityDraft>; details: WorkoutDetails } {
  const decoder = new Decoder(Stream.fromArrayBuffer(bytes));
  if (!decoder.isFIT() || !decoder.checkIntegrity()) throw new Error('The FIT file failed its integrity check.');
  const { messages, errors } = decoder.read({ mergeHeartRates: true });
  if (errors.length || messages.sessionMesgs?.length !== 1) throw new Error('Choose a valid FIT file containing exactly one workout.');
  const session = messages.sessionMesgs[0];
  const records = messages.recordMesgs ?? [];
  if (records.length > 40_000) throw new Error('Choose a FIT file with at most 40,000 workout points.');
  const firstTime = session.startTime ?? records.find((record) => record.timestamp)?.timestamp;
  const start = firstTime instanceof Date ? firstTime.getTime() : undefined;
  const runningCadence = session.sport === 'running';
  const sampleCadenceMultiplier = runningCadence ? 2 : 1;
  const speed = (value: number | undefined) => value === undefined ? undefined : value * 3.6;
  const samples: WorkoutSample[] = records.flatMap((record) => {
    if (start === undefined || !(record.timestamp instanceof Date)) return [];
    const seconds = (record.timestamp.getTime() - start) / 1000;
    if (!Number.isFinite(seconds) || seconds < 0) return [];
    const cadence = bounded(record.cadence, 1, 200);
    const lat = bounded(record.positionLat, -(2 ** 30), 2 ** 30);
    const lon = bounded(record.positionLong, -(2 ** 31), 2 ** 31);
    return [{ seconds, heartRate: bounded(record.heartRate, 20, 260), cadence: cadence === undefined ? undefined : cadence * sampleCadenceMultiplier,
      elevation: bounded(record.enhancedAltitude ?? record.altitude, -12_000, 12_000), speed: speed(bounded(record.enhancedSpeed ?? record.speed, 0, 100)),
      latitude: lat === undefined ? undefined : lat * semicirclesToDegrees, longitude: lon === undefined ? undefined : lon * semicirclesToDegrees }];
  }).sort((a, b) => a.seconds - b.seconds);
  const laps = messages.lapMesgs?.map((lap, index) => ({
    number: index + 1, seconds: bounded(lap.totalTimerTime, 0.01, 172800), elapsedSeconds: bounded(lap.totalElapsedTime, 0.01, 172800),
    meters: bounded(lap.totalDistance, 0, 500000), heartRate: bounded(lap.avgHeartRate, 20, 260),
    pace: lap.totalTimerTime && lap.totalDistance ? lap.totalTimerTime * 1000 / lap.totalDistance : undefined,
  }));
  const parts = start !== undefined && Number.isFinite(start)
    ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(start) : null;
  return {
    draft: {
      kind: session.sport === 'cycling' ? 'cycle' : session.sport === 'walking' || session.sport === 'hiking' ? 'walk' : session.subSport === 'treadmill' ? 'treadmill' : 'run',
      activityDate: parts ? ['year', 'month', 'day'].map((name) => parts.find((part) => part.type === name)?.value).join('-') : undefined,
      durationSeconds: Math.round(bounded(session.totalTimerTime, 0, 172800) ?? 0) || null,
      distanceMeters: bounded(session.totalDistance, 0, 500000),
      averageHeartRate: bounded(session.avgHeartRate, 20, 260),
      calories: bounded(session.totalCalories, 0, 15000),
      elevationMeters: bounded(session.totalAscent, 0, 20000),
      cadence: runningCadence && session.avgRunningCadence ? session.avgRunningCadence * 2 : undefined,
    },
    details: { source: 'FIT', metrics: {
      elapsedSeconds: bounded(session.totalElapsedTime, 0, 172800), maxHeartRate: bounded(session.maxHeartRate, 20, 260),
      averageSpeed: speed(bounded(session.avgSpeed, 0, 100)), maximumSpeed: speed(bounded(session.maxSpeed, 0, 100)),
      totalDescent: bounded(session.totalDescent, 0, 20000),
    }, ...(samples.length ? { samples } : {}), ...(laps?.length ? { laps } : {}) },
  };
}
