import { formatAthleteDate, formatDistance, formatDuration, type AthleteActivity, type AthleteActivityDraft, type DistanceUnit } from './athlete';

export const workoutFileAccept = '.gpx,.gtx,.tcx,.fit';

export function matchingWorkout(
  activities: AthleteActivity[],
  { activityDate, kind, distanceMeters, durationSeconds }: Partial<AthleteActivityDraft>,
) {
  if (!activityDate || !kind || !distanceMeters || !durationSeconds) return;
  // A route export can include pauses and use a slightly different GPS distance than the screenshots.
  const matches = activities.filter((activity) => activity.activityDate === activityDate && activity.kind === kind
    && activity.distanceMeters !== null && activity.durationSeconds !== null
    && Math.abs(activity.distanceMeters - distanceMeters) <= Math.max(50, distanceMeters * .02)
    && Math.abs(activity.durationSeconds - durationSeconds) <= Math.max(30, durationSeconds * .03));
  return matches.length === 1 ? matches[0] : undefined;
}

export function workoutOptionLabel(activity: AthleteActivity, distanceUnit: DistanceUnit) {
  const kind = activity.kind === 'treadmill' ? 'Treadmill run' : activity.kind[0].toUpperCase() + activity.kind.slice(1);
  return [
    formatAthleteDate(activity.activityDate), kind, formatDistance(activity.distanceMeters, distanceUnit),
    formatDuration(activity.durationSeconds), activity.notes.trim().slice(0, 40),
  ].filter(Boolean).join(' · ');
}

export const workoutMetrics = [
  ['elapsedSeconds', 'Total duration', 's'], ['steps', 'Steps', ''], ['totalCalories', 'Total calories', 'kcal'],
  ['averagePace', 'Reported average pace', 's/km'], ['bestPace', 'Best pace', 's/km'], ['maxCadence', 'Maximum cadence', 'spm'],
  ['averageSpeed', 'Average speed', 'km/h'], ['maximumSpeed', 'Maximum speed', 'km/h'],
  ['maxHeartRate', 'Maximum heart rate', 'bpm'], ['vo2Max', 'VO₂ max', ''],
  ['lowestElevation', 'Lowest elevation', 'm'], ['highestElevation', 'Highest elevation', 'm'],
  ['totalAscent', 'Total ascent', 'm'], ['totalDescent', 'Total descent', 'm'],
  ['sweatLoss', 'Estimated sweat loss', 'mL'],
  ['temperature', 'Temperature', '°C'], ['humidity', 'Humidity', '%'], ['windSpeed', 'Wind speed', 'km/h'],
  ['verticalOscillation', 'Vertical oscillation', 'cm'], ['stiffness', 'Stiffness', 'kNm'],
  ['flightTime', 'Flight time', 'ms'], ['groundContact', 'Ground contact', 'ms'], ['regularity', 'Regularity', ''],
] as const;

export type WorkoutMetric = typeof workoutMetrics[number][0];
export const editableWorkoutMetrics = workoutMetrics.filter(([key]) => key !== 'averageSpeed' && key !== 'maximumSpeed');
const advancedMetrics = new Set<WorkoutMetric>([
  'temperature', 'humidity', 'windSpeed', 'verticalOscillation', 'stiffness', 'flightTime', 'groundContact', 'regularity',
]);
export const activitySummaryMetrics = editableWorkoutMetrics.filter(([key]) => !advancedMetrics.has(key));
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

type WorkoutCoordinate = NonNullable<WorkoutDetails['route']>[number];

export function isWorkoutCoordinate<Point extends Pick<WorkoutSample, 'latitude' | 'longitude'>>(point: Point): point is Point & WorkoutCoordinate {
  const { latitude, longitude } = point;
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== undefined && longitude !== undefined
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export function workoutDistanceBetween(a: WorkoutCoordinate, b: WorkoutCoordinate) {
  const radians = Math.PI / 180;
  const ratio = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, ratio)));
}

export function workoutChartSamples(source: WorkoutSample[]) {
  const ordered = source.filter(({ seconds }) => Number.isFinite(seconds) && seconds >= 0)
    .sort((a, b) => a.seconds - b.seconds);
  return ordered.map((point, index) => {
    const previous = ordered[index - 1];
    const interval = previous ? point.seconds - previous.seconds : 0;
    let speed = Number.isFinite(point.speed) ? point.speed : undefined;
    let estimatedSpeed = false;
    if (speed === undefined && previous && interval > 0 && interval <= 60
      && point.segment === previous.segment && isWorkoutCoordinate(previous) && isWorkoutCoordinate(point)) {
      const estimate = workoutDistanceBetween(previous, point) / interval * 3.6;
      if (estimate <= 360) {
        speed = estimate;
        estimatedSpeed = true;
      }
    }
    // GPS jitter near a stop can yield very large, uninformative pace values.
    const pace = speed !== undefined && speed >= 1 && Number.isFinite(speed) ? 3600 / speed : undefined;
    return { ...point, speed, pace, estimatedSpeed };
  });
}

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
