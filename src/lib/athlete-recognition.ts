import { routeVoiceAthleteRecord, type AthleteActivity, type DistanceUnit, type VoiceAthleteRoute } from './athlete';

export type ScreenshotReading = { text: string; layoutText: string; confidence: number; pass: string };
export const recognitionDestinations: Array<{ value: VoiceAthleteRoute['destination']; label: string }> = [
  { value: 'activity', label: 'Completed activity' }, { value: 'plan', label: 'Planned workout' },
  { value: 'recovery', label: 'Recovery score' }, { value: 'race', label: 'Race event' },
  { value: 'gym', label: 'Strength session' }, { value: 'goal', label: 'Distance goal' },
];

/** Use the athlete's selected timezone for today/yesterday, not the server clock. */
export function recognitionReferenceDate(timezone: string, now = new Date()): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (name: string) => Number(parts.find((item) => item.type === name)?.value);
    return new Date(part('year'), part('month') - 1, part('day'), 12);
  } catch { return now; }
}

const metrics = [
  ['distanceMeters', 'Distance'], ['durationSeconds', 'Duration'], ['averageHeartRate', 'Average heart rate'],
  ['calories', 'Calories'], ['elevationMeters', 'Elevation'], ['cadence', 'Cadence'], ['effort', 'Effort'],
] as const;

function metricCount(route: VoiceAthleteRoute): number {
  return metrics.filter(([key]) => typeof route.activity[key] === 'number').length;
}

function hasUsefulDetails(route: VoiceAthleteRoute): boolean {
  if (metricCount(route)) return true;
  if (route.destination === 'recovery') return typeof route.recovery.score === 'number';
  if (route.destination === 'gym') return Boolean(route.gym.exercises?.length || route.gym.durationMinutes);
  return false;
}

/** Keep OCR disagreements visible; never create a composite from conflicting readings. */
export function recognizeScreenshot(readings: ScreenshotReading[], unit: DistanceUnit, referenceDate = new Date()): VoiceAthleteRoute | null {
  const candidates = readings.filter((reading) => reading.text.trim() || reading.layoutText.trim()).map((reading) => {
    const raw = routeVoiceAthleteRecord(reading.text, unit, referenceDate, { source: 'image' });
    const layout = reading.layoutText.trim() ? routeVoiceAthleteRecord(reading.layoutText, unit, referenceDate, { source: 'image' }) : null;
    // Layout labels are paired spatially; use those metrics instead of flattening columns.
    const route = layout && hasUsefulDetails(layout) ? {
      ...raw,
      activity: { ...raw.activity, ...Object.fromEntries(metrics.filter(([key]) => typeof layout.activity[key] === 'number').map(([key]) => [key, layout.activity[key]])) },
    } : raw;
    return { reading, route };
  }).filter(({ route }) => hasUsefulDetails(route));
  if (!candidates.length) return null;
  const confident = candidates.filter(({ reading }) => reading.confidence >= 45);
  const usable = confident.length ? confident : candidates;
  usable.sort((a, b) => metricCount(b.route) - metricCount(a.route) || b.reading.confidence - a.reading.confidence);
  const route: VoiceAthleteRoute = structuredClone(usable[0].route);
  const warnings = new Set(route.warnings ?? []);
  if (!confident.length) warnings.add('The image text was difficult to read. Check every value against the screenshot.');
  for (const [key, label] of metrics) {
    const values = [...new Set(usable.map(({ route: candidate }) => candidate.activity[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))];
    if (values.length > 1) {
      route.activity[key] = null;
      warnings.add(`${label} differs between readings and has been left empty. Check the screenshot.`);
    } else if (values.length === 1) {
      route.activity[key] = values[0];
      // A spatially paired value can resolve an ambiguity in flattened OCR text.
      warnings.delete(`${label} was unclear or conflicting and has been left empty.`);
    }
  }
  const dates = [...new Set(usable.map(({ route: candidate }) => candidate.date).filter(Boolean))];
  route.date = dates.length === 1 ? dates[0] : '';
  if (dates.length > 1) warnings.add('The screenshot contains conflicting dates. Choose the correct date.');
  const scores = [...new Set(usable.map(({ route: candidate }) => candidate.recovery.score).filter((score): score is number => typeof score === 'number'))];
  route.recovery.score = scores.length === 1 ? scores[0] : undefined;
  if (scores.length > 1) warnings.add('Recovery score differs between readings. Enter the correct score.');
  if (new Set(usable.map(({ route: candidate }) => candidate.destination)).size > 1) warnings.add('The record type is unclear. Choose where this information belongs.');
  route.activity.activityDate = route.date;
  route.activity.source = 'image';
  route.plan.workoutDate = route.date;
  route.plan.targetDistanceMeters = route.activity.distanceMeters ?? null;
  route.race.raceDate = route.date;
  route.race.distanceMeters = route.activity.distanceMeters ?? null;
  route.race.finishSeconds = route.activity.durationSeconds ?? null;
  route.recovery.recoveryDate = route.date;
  route.gym.sessionDate = route.date;
  route.gym.durationMinutes = route.activity.durationSeconds ? route.activity.durationSeconds / 60 : null;
  route.goal.targetDistanceMeters = route.activity.distanceMeters ?? undefined;
  for (const record of [route.activity, route.plan, route.race, route.gym, route.recovery]) record.notes = '';
  route.transcript = usable[0].reading.text.trim();
  route.warnings = [...warnings];
  route.missingFields = missingRecognitionFields(route);
  return route;
}

export function missingRecognitionFields(route: VoiceAthleteRoute): string[] {
  const missing: string[] = [];
  if (!route.date && route.destination !== 'goal') missing.push('What date is this for?');
  if (route.destination === 'activity') {
    if (!route.activity.distanceMeters) missing.push('What distance did you cover?');
    if (!route.activity.durationSeconds) missing.push('What was the total activity duration?');
  } else if (route.destination === 'plan' && !route.plan.targetDistanceMeters) missing.push('What is your planned distance?');
  else if (route.destination === 'recovery' && !route.recovery.score) missing.push('What is your recovery score (1–100)?');
  else if (route.destination === 'goal') {
    if (!route.goal.targetDistanceMeters) missing.push('What distance are you aiming for?');
    if (!route.goal.startsOn || !route.goal.endsOn) missing.push('When does the goal start and end?');
  }
  return missing;
}

export function similarActivity(route: VoiceAthleteRoute, activities: AthleteActivity[]): AthleteActivity | undefined {
  if (route.destination !== 'activity' || !route.date || !route.activity.distanceMeters || !route.activity.durationSeconds) return;
  return activities.find((activity) => activity.activityDate === route.date && activity.kind === route.activity.kind
    && activity.distanceMeters === route.activity.distanceMeters && activity.durationSeconds === route.activity.durationSeconds);
}
