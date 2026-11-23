import type { AthleteActivity, AthleteHubData, RecoveryScore } from './athlete';
import { runningKinds } from './athlete-workout';

export type AnalysisBucket = { key: string; label: string; start: string; end: string; distanceMeters: number; activities: AthleteActivity[]; recovery: RecoveryScore[]; averageRecovery: number | null };
export type AnalysisPeriod = 'weeks' | 'months' | 'custom';
export type BucketUnit = 'day' | 'week' | 'month';

const pad = (value: number) => String(value).padStart(2, '0');
const keyOf = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const utcDate = (key: string) => { const [year, month, day] = key.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)); };
const shiftDays = (key: string, days: number) => { const date = utcDate(key); date.setUTCDate(date.getUTCDate() + days); return keyOf(date); };
const shiftMonths = (key: string, months: number) => { const date = utcDate(key); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months); return keyOf(date); };
const weekStart = (key: string) => shiftDays(key, -(utcDate(key).getUTCDay() + 6) % 7);
const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function analysisRange(period: AnalysisPeriod, today: string, customStart: string, customEnd: string): { start: string; end: string; unit: BucketUnit } {
  if (period === 'weeks') return { start: shiftDays(weekStart(today), -77), end: today, unit: 'week' };
  if (period === 'months') return { start: shiftMonths(monthStart(today), -11), end: today, unit: 'month' };
  const start = customStart || today;
  const end = customEnd || today;
  const span = Math.max(0, Math.round((utcDate(end).getTime() - utcDate(start).getTime()) / 86_400_000));
  return { start, end, unit: span <= 45 ? 'day' : span <= 180 ? 'week' : 'month' };
}

export function buildAthleteAnalysis(data: AthleteHubData, start: string, end: string, unit: BucketUnit) {
  const activities = data.activities.filter((item) => item.activityDate >= start && item.activityDate <= end);
  const runs = activities.filter((item) => runningKinds.has(item.kind));
  const recovery = data.recoveryScores.filter((item) => item.recoveryDate >= start && item.recoveryDate <= end);
  const buckets: AnalysisBucket[] = [];
  let cursor = unit === 'week' ? weekStart(start) : unit === 'month' ? monthStart(start) : start;
  for (let guard = 0; cursor <= end && guard < 1500; guard++) {
    const next = unit === 'day' ? shiftDays(cursor, 1) : unit === 'week' ? shiftDays(cursor, 7) : shiftMonths(cursor, 1);
    const first = cursor < start ? start : cursor;
    const last = shiftDays(next, -1) > end ? end : shiftDays(next, -1);
    const inBucket = runs.filter((item) => item.activityDate >= first && item.activityDate <= last);
    const scores = recovery.filter((item) => item.recoveryDate >= first && item.recoveryDate <= last);
    const date = utcDate(cursor);
    const label = unit === 'month' ? new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date)
      : unit === 'week' ? `${date.getUTCDate()} ${new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(date)}`
        : `${date.getUTCDate()} ${new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(date)}`;
    buckets.push({ key: cursor, label, start: first, end: last, distanceMeters: inBucket.reduce((sum, item) => sum + (item.distanceMeters ?? 0), 0), activities: inBucket, recovery: scores, averageRecovery: average(scores.map((item) => item.score)) });
    cursor = next;
  }
  const timedRuns = runs.filter((item) => (item.distanceMeters ?? 0) > 0 && (item.durationSeconds ?? 0) > 0);
  const distanceWithTime = timedRuns.reduce((sum, item) => sum + (item.distanceMeters ?? 0), 0);
  const secondsWithDistance = timedRuns.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
  const rollingDistance = (days: number) => data.activities.filter((item) => runningKinds.has(item.kind) && item.activityDate >= shiftDays(end, 1 - days) && item.activityDate <= end)
    .reduce((sum, item) => sum + (item.distanceMeters ?? 0), 0);
  return {
    activities, runs, recovery, buckets,
    rolling7Meters: rollingDistance(7),
    rolling28Meters: rollingDistance(28),
    averageCadence: average(runs.flatMap((item) => typeof item.cadence === 'number' ? [item.cadence] : [])),
    totalElevation: runs.reduce((sum, item) => sum + (item.elevationMeters ?? 0), 0),
    totalDistanceMeters: runs.reduce((sum, item) => sum + (item.distanceMeters ?? 0), 0),
    movingSeconds: runs.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0),
    paceDistanceMeters: distanceWithTime,
    paceSeconds: secondsWithDistance,
    averageHeartRate: average(runs.flatMap((item) => item.averageHeartRate === null ? [] : [item.averageHeartRate])),
    averageRecovery: average(recovery.map((item) => item.score)),
    longestRun: runs.reduce<AthleteActivity | null>((best, item) => (item.distanceMeters ?? 0) > (best?.distanceMeters ?? 0) ? item : best, null),
    activeDays: new Set(runs.map((item) => item.activityDate)).size,
  };
}
