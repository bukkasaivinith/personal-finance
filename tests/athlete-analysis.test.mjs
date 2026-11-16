import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/athlete-analysis.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { analysisRange, buildAthleteAnalysis } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const activity = (id, kind, activityDate, distanceMeters, durationSeconds, averageHeartRate = null) => ({ id, kind, activityDate, distanceMeters, durationSeconds, averageHeartRate });
const data = {
  activities: [
    activity('a', 'run', '2026-11-02', 5000, 1800, 140),
    activity('b', 'treadmill', '2026-11-08', 10000, 3600, 160),
    activity('c', 'walk', '2026-11-08', 2000, 2400, null),
    activity('d', 'run', '2026-11-09', 20000, null, null),
    activity('e', 'run', '2026-12-01', 5000, 1700, 145),
  ],
  recoveryScores: [
    { id: 'r1', recoveryDate: '2026-11-08', score: 80 },
    { id: 'r2', recoveryDate: '2026-11-09', score: 40 },
  ],
};

test('weekly range starts on Monday and includes the current week', () => {
  assert.deepEqual(analysisRange('weeks', '2026-11-16', '', ''), { start: '2026-08-31', end: '2026-11-16', unit: 'week' });
  assert.equal(analysisRange('weeks', '2026-11-15', '', '').start, '2026-08-24');
});

test('custom ranges choose readable daily, weekly or monthly buckets', () => {
  assert.equal(analysisRange('custom', '2026-11-16', '2026-11-01', '2026-11-16').unit, 'day');
  assert.equal(analysisRange('custom', '2026-11-16', '2026-08-01', '2026-11-16').unit, 'week');
  assert.equal(analysisRange('custom', '2026-11-16', '2026-01-01', '2026-11-16').unit, 'month');
});

test('running totals exclude walking, out-of-range dates and missing pace data', () => {
  const result = buildAthleteAnalysis(data, '2026-11-01', '2026-11-16', 'week');
  assert.equal(result.runs.length, 3);
  assert.equal(result.activities.length, 4);
  assert.equal(result.totalDistanceMeters, 35000);
  assert.equal(result.movingSeconds, 5400);
  assert.equal(result.paceDistanceMeters, 15000);
  assert.equal(result.paceSeconds, 5400);
  assert.equal(result.averageHeartRate, 150);
  assert.equal(result.activeDays, 3);
  assert.equal(result.longestRun.id, 'd');
  assert.equal(result.averageRecovery, 60);
  assert.equal(result.buckets.find((bucket) => bucket.key === '2026-11-02').distanceMeters, 15000);
  assert.equal(result.buckets.find((bucket) => bucket.key === '2026-11-09').averageRecovery, 40);
});

test('empty periods retain chart buckets without inventing statistics', () => {
  const result = buildAthleteAnalysis(data, '2026-10-01', '2026-10-31', 'day');
  assert.equal(result.buckets.length, 31);
  assert.equal(result.averageRecovery, null);
  assert.equal(result.averageHeartRate, null);
  assert.equal(result.longestRun, null);
  assert(result.buckets.every((bucket) => bucket.distanceMeters === 0));
});
