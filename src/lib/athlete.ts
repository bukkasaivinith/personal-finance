export type DistanceUnit = 'km' | 'mi';
export type WeightUnit = 'kg' | 'lb';
export type AthleteActivityKind = 'run' | 'walk' | 'cycle' | 'treadmill' | 'race';
export type AthleteActivitySource = 'manual' | 'voice' | 'image' | 'samsung_health' | 'whoop';
export type PlannedWorkoutStatus = 'planned' | 'completed' | 'skipped';

export type AthleteSettings = {
  distanceUnit: DistanceUnit;
  weightUnit: WeightUnit;
  timezone: string;
};

export type AthleteActivity = {
  id: string;
  kind: AthleteActivityKind;
  activityDate: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  averageHeartRate: number | null;
  calories: number | null;
  elevationMeters: number | null;
  cadence: number | null;
  effort: number | null;
  notes: string;
  source: AthleteActivitySource;
  createdAt: string;
};

export type AthleteActivityDraft = Omit<AthleteActivity, 'id' | 'createdAt'>;

export type PlannedWorkout = {
  id: string;
  title: string;
  workoutDate: string;
  kind: AthleteActivityKind;
  targetDistanceMeters: number | null;
  notes: string;
  status: PlannedWorkoutStatus;
};

export type PlannedWorkoutDraft = Omit<PlannedWorkout, 'id' | 'status'>;

export type RecoveryScore = {
  id: string;
  recoveryDate: string;
  score: number;
  notes: string;
  source: 'manual' | 'whoop';
};

export type Race = {
  id: string;
  name: string;
  raceDate: string;
  distanceMeters: number | null;
  location: string;
  finishSeconds: number | null;
  notes: string;
};

export type GymExercise = { exercise: string; sets: number; reps: number; weight: number | null };

export type GymSession = {
  id: string;
  sessionDate: string;
  title: string;
  durationMinutes: number | null;
  exercises: GymExercise[];
  notes: string;
};

export type GymSessionDraft = Omit<GymSession, 'id'>;

export type AthleteGoal = {
  id: string;
  title: string;
  targetDistanceMeters: number;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
};

export type AthleteGoalDraft = Omit<AthleteGoal, 'id' | 'isActive'>;

export type AthleteHubData = {
  settings: AthleteSettings;
  activities: AthleteActivity[];
  plannedWorkouts: PlannedWorkout[];
  recoveryScores: RecoveryScore[];
  races: Race[];
  gymSessions: GymSession[];
  goals: AthleteGoal[];
};

export const emptyAthleteData: AthleteHubData = {
  settings: { distanceUnit: 'km', weightUnit: 'kg', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' },
  activities: [],
  plannedWorkouts: [],
  recoveryScores: [],
  races: [],
  gymSessions: [],
  goals: [],
};

export function metersFromDistance(value: number, unit: DistanceUnit): number {
  return Math.round(value * (unit === 'mi' ? 1609.344 : 1000));
}

export function distanceFromMeters(value: number | null, unit: DistanceUnit): number | null {
  if (value === null) return null;
  return value / (unit === 'mi' ? 1609.344 : 1000);
}

export function formatDistance(value: number | null, unit: DistanceUnit, digits = 2): string {
  const converted = distanceFromMeters(value, unit);
  if (converted === null) return '—';
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(converted)} ${unit}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainingSeconds = whole % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

export function formatPace(distanceMeters: number | null, durationSeconds: number | null, unit: DistanceUnit): string {
  if (!distanceMeters || !durationSeconds || distanceMeters <= 0 || durationSeconds <= 0) return '—';
  const unitDistance = unit === 'mi' ? distanceMeters / 1609.344 : distanceMeters / 1000;
  const seconds = Math.round(durationSeconds / unitDistance);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} /${unit}`;
}

export function localDateKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function formatAthleteDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(dateFromKey(value));
}

export function recoveryTone(score: number): 'low' | 'mid' | 'good' | 'great' {
  if (score < 34) return 'low';
  if (score < 67) return 'mid';
  if (score < 85) return 'good';
  return 'great';
}

function numberFrom(text: string, expression: RegExp): number | null {
  const match = text.match(expression);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function parseActivityText(text: string, unit: DistanceUnit): Partial<AthleteActivityDraft> {
  const normalized = text.toLowerCase().replace(/[–—]/g, '-');
  const hasWalk = /\bwalk|walking\b|నడక|चलना|वॉक/.test(normalized);
  const hasCycle = /\bcycle|cycling|bike|biking\b|సైకిల్|साइकिल/.test(normalized);
  const hasTreadmill = /\btreadmill\b|ట్రెడ్‌మిల్|ट्रेडमिल/.test(normalized);
  const hasRace = /\brace|marathon|half marathon\b|రేసు|మ్యారథాన్|रेस|मैराथन/.test(normalized);
  const kind: AthleteActivityKind = hasRace ? 'race' : hasTreadmill ? 'treadmill' : hasCycle ? 'cycle' : hasWalk ? 'walk' : 'run';
  const distanceValue = numberFrom(normalized, /(\d+(?:[.,]\d+)?)\s*(?:km|kilomet(?:er|re)s?|mi|miles?|కి\.?మీ|కిలోమీట(?:ర్|ర్లు)?|किमी|किलोमीटर)/);
  const usesMiles = /\bmi(?:les)?\b|मील|మైలు/.test(normalized);
  const time = normalized.match(/(?:in|time|duration)?\s*(\d{1,2})\s*(?:h|hr|hours?)\s*(?:(\d{1,2})\s*(?:m|min|minutes?))?/)
    ?? normalized.match(/(?:in|time|duration)?\s*(\d{1,3})\s*(?:m|min|minutes?)\b/);
  let durationSeconds: number | null = null;
  if (time) {
    const first = Number(time[1]);
    const second = time[2] ? Number(time[2]) : 0;
    durationSeconds = time[2] ? first * 3600 + second * 60 : normalized.includes('hour') || /\bhr\b|\bh\b/.test(time[0]) ? first * 3600 : first * 60;
  } else {
    const clock = normalized.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
    if (clock) durationSeconds = clock[3] ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : Number(clock[1]) * 60 + Number(clock[2]);
  }
  const averageHeartRate = numberFrom(normalized, /(?:avg(?:erage)?\s*)?(?:heart\s*rate|hr)\D{0,12}(\d{2,3})\s*(?:bpm)?/);
  const calories = numberFrom(normalized, /(\d{2,5})\s*(?:kcal|calories|cal)\b/);
  const elevationMeters = numberFrom(normalized, /(?:elevation|elev|gain)\D{0,12}(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?)/);
  const cadence = numberFrom(normalized, /(?:cadence|spm)\D{0,12}(\d{2,3})/);
  return {
    kind,
    distanceMeters: distanceValue === null ? undefined : metersFromDistance(distanceValue, usesMiles ? 'mi' : unit),
    durationSeconds,
    averageHeartRate,
    calories,
    elevationMeters,
    cadence,
    notes: text.trim(),
  };
}
