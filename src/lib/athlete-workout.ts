import type { AthleteActivity, AthleteActivityDraft } from './athlete';

export const workoutMetrics = [
  ['elapsedSeconds', 'Total duration', 's'], ['totalCalories', 'Total calories', 'kcal'],
  ['steps', 'Steps', ''], ['averagePace', 'Reported average pace', 's/km'], ['bestPace', 'Best pace', 's/km'],
  ['averageSpeed', 'Average speed', 'km/h'], ['maximumSpeed', 'Maximum speed', 'km/h'],
  ['maxHeartRate', 'Maximum heart rate', 'bpm'], ['maxCadence', 'Maximum cadence', 'spm'],
  ['lowestElevation', 'Lowest elevation', 'm'], ['highestElevation', 'Highest elevation', 'm'],
  ['totalAscent', 'Total ascent', 'm'], ['totalDescent', 'Total descent', 'm'],
  ['vo2Max', 'VO₂ max', ''], ['sweatLoss', 'Estimated sweat loss', 'mL'],
  ['temperature', 'Temperature', '°C'], ['humidity', 'Humidity', '%'], ['windSpeed', 'Wind speed', 'km/h'],
  ['verticalOscillation', 'Vertical oscillation', 'cm'], ['stiffness', 'Stiffness', 'kNm'],
  ['flightTime', 'Flight time', 'ms'], ['groundContact', 'Ground contact', 'ms'], ['regularity', 'Regularity', ''],
] as const;

export type WorkoutMetric = typeof workoutMetrics[number][0];
export type WorkoutLap = { number: number; seconds?: number; elapsedSeconds?: number; meters?: number; heartRate?: number; pace?: number };
export type WorkoutZone = { zone: number; minimum: number; maximum: number; seconds: number; percent: number };
export type WorkoutSample = { seconds: number; heartRate?: number; cadence?: number; elevation?: number; speed?: number; latitude?: number; longitude?: number; segment?: number };
export type WorkoutDetails = {
  metrics: Partial<Record<WorkoutMetric, number | null>>;
  laps?: WorkoutLap[];
  zones?: WorkoutZone[];
  samples?: WorkoutSample[];
  route?: Array<{ latitude: number; longitude: number; segment?: number }>;
  asymmetry?: string;
  source?: 'Samsung Health' | 'WHOOP' | 'GPX' | 'TCX' | 'FIT';
  fingerprints?: string[];
};

export const runningKinds = new Set<AthleteActivityDraft['kind']>(['run', 'treadmill', 'race']);

export function bestAtDistance(activities: AthleteActivity[], target: number) {
  return activities.filter((activity) => runningKinds.has(activity.kind)
    && activity.distanceMeters !== null && activity.distanceMeters >= target && activity.distanceMeters <= target * 1.02
    && (activity.durationSeconds ?? 0) > 0)
    .sort((a, b) => a.durationSeconds! - b.durationSeconds! || a.activityDate.localeCompare(b.activityDate))[0];
}

export function personalBests(activities: AthleteActivity[]) {
  const distances = [[1000, '1K'], [3000, '3K'], [5000, '5K'], [10000, '10K'], [15000, '15K'], [21097.5, 'Half marathon'], [42195, 'Marathon']] as const;
  return distances.map(([target, label]) => ({
    label,
    activity: bestAtDistance(activities, target),
  }));
}
