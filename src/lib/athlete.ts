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

export type VoiceAthleteRoute = {
  destination: 'activity' | 'plan' | 'recovery' | 'race' | 'gym' | 'goal';
  date: string;
  activity: Partial<AthleteActivityDraft>;
  plan: Partial<PlannedWorkoutDraft>;
  recovery: Partial<Omit<RecoveryScore, 'id'>>;
  race: Partial<Omit<Race, 'id'>>;
  gym: Partial<GymSessionDraft>;
  goal: Partial<AthleteGoalDraft>;
};

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

function normalizeAthleteInput(text: string): string {
  const unicodeDigits: Array<[string, string]> = [
    ['०१२३४५६७८९', '0123456789'],
    ['౦౧౨౩౪౫౬౭౮౯', '0123456789'],
  ];
  let normalized = text.replace(/\u00a0/g, ' ').replace(/[–—]/g, '-');
  for (const [source, replacement] of unicodeDigits) {
    normalized = normalized.replace(new RegExp(`[${source}]`, 'g'), (digit) => replacement[source.indexOf(digit)]);
  }
  const units: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
  normalized = normalized.replace(/\b(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s]+(?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred)\b/gi, (words) => {
    const parts = words.toLowerCase().split(/[\s-]+/);
    if (!parts.every((part) => part in units)) return words;
    let result = 0;
    for (const part of parts) result = part === 'hundred' ? Math.max(1, result) * 100 : result + units[part];
    return String(result);
  });
  return normalized.toLowerCase().replace(/\bk\s*[mnr]\b/g, 'km').replace(/\bkms\b/g, 'km').replace(/\s+/g, ' ').trim();
}

function clockSeconds(value: string): number | null {
  const parts = value.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

export function parseActivityText(text: string, unit: DistanceUnit): Partial<AthleteActivityDraft> {
  const normalized = normalizeAthleteInput(text);
  const hasWalk = /\bwalk|walking\b|నడక|चलना|वॉक/.test(normalized);
  const hasCycle = /\bcycle|cycling|bike|biking\b|సైకిల్|साइकिल/.test(normalized);
  const hasTreadmill = /\btreadmill\b|ట్రెడ్‌మిల్|ट्रेडमिल/.test(normalized);
  const hasRace = /\brace|marathon|half marathon\b|రేసు|మ్యారథాన్|रेस|मैराथन/.test(normalized);
  const kind: AthleteActivityKind = hasRace ? 'race' : hasTreadmill ? 'treadmill' : hasCycle ? 'cycle' : hasWalk ? 'walk' : 'run';
  const distanceValue = numberFrom(normalized, /(\d+(?:[.,]\d+)?)\s*(?:k\.?m\.?|kilomet(?:er|re)s?|mi|miles?|కి\.?మీ|కిమీ|కిలోమీట(?:ర్|ర్లు)?|कि\.?मी|किमी|किलोमीटर)/);
  const usesMiles = /\bmi(?:les)?\b|मील|మైలు/.test(normalized);
  const time = normalized.match(/(?:in|time|duration|moving time|elapsed time|running time|समय|अवधि|సమయం|వ్యవధి)\D{0,18}(\d{1,2})\s*(?:h|hr|hours?)\s*(?:(\d{1,2})\s*(?:m|min|minutes?))?/)
    ?? normalized.match(/(?:in|time|duration|moving time|elapsed time|running time|समय|अवधि|సమయం|వ్యవధి)\D{0,18}(\d{1,3})\s*(?:m|min|minutes?)\b/);
  let durationSeconds: number | null = null;
  if (time) {
    const first = Number(time[1]);
    const second = time[2] ? Number(time[2]) : 0;
    durationSeconds = time[2] ? first * 3600 + second * 60 : normalized.includes('hour') || /\bhr\b|\bh\b/.test(time[0]) ? first * 3600 : first * 60;
  } else {
    const labelledClock = normalized.match(/(?:time|duration|moving time|elapsed time|running time|समय|अवधि|సమయం|వ్యవధి)\D{0,22}(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1];
    const clocks = Array.from(normalized.matchAll(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g)).map((match) => match[1]);
    const clock = labelledClock ?? clocks.find((value) => value.split(':').length === 3) ?? clocks[clocks.length - 1] ?? null;
    if (clock) durationSeconds = clockSeconds(clock);
  }
  const averageHeartRate = numberFrom(normalized, /(?:avg(?:erage)?\s*)?(?:heart\s*rate|hr|bpm)\D{0,24}(\d{2,3})\s*(?:bpm)?/)
    ?? numberFrom(normalized, /(\d{2,3})\s*(?:bpm)\b/);
  const calories = numberFrom(normalized, /(?:active\s*)?(?:calories|energy|kcal|cal)\D{0,18}(\d{2,5})\b/)
    ?? numberFrom(normalized, /(\d{2,5})\s*(?:kcal|calories|cal)\b/);
  const elevationMeters = numberFrom(normalized, /(?:elevation|elev|gain|altitude)\D{0,24}(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?)/);
  const cadence = numberFrom(normalized, /(?:cadence|spm|steps?\s*(?:per|\/)\s*min(?:ute)?)\D{0,24}(\d{2,3})/)
    ?? numberFrom(normalized, /(\d{2,3})\s*(?:spm)\b/);
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

function offsetDate(referenceDate: Date, days: number): string {
  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() + days, 12);
  return localDateKey(date);
}

function monthOffset(referenceDate: Date, months: number): string {
  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + months, referenceDate.getDate(), 12);
  return localDateKey(date);
}

function dateKeyFromParts(year: number, monthIndex: number, day: number): string | null {
  const date = new Date(year, monthIndex, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  return localDateKey(date);
}

function includesFutureCue(text: string): boolean {
  return /\b(?:tomorrow|next|plan(?:ned)?|schedule(?:d)?|will|going to|intend to)\b|రేపు|ఎల్లుండి|చేస్తాను|ప్లాన్|कल\s*(?:दौड|रन|करूंगा)|करूंगा|करूँगा/.test(text);
}

function includesPastCue(text: string): boolean {
  return /\b(?:yesterday|ago|ran|run was|completed|finished|did)\b|నిన్న|మొన్న|చేశాను|పూర్తి చేశాను|बीते कल|पहले|किया|दौड़ा/.test(text);
}

/**
 * Resolves the useful date phrases that people commonly speak while logging a run.
 * If speech recognition cannot confidently find a date, it keeps today so the
 * confirmation form can ask the athlete to choose the exact day before saving.
 */
export function parseSpokenDate(text: string, referenceDate = new Date()): string {
  const normalized = text.toLowerCase().replace(/[–—]/g, '-');
  const futureCue = includesFutureCue(normalized);
  const pastCue = includesPastCue(normalized);

  if (/\b(?:day after tomorrow)\b|ఎల్లుండి|परसों/.test(normalized)) return offsetDate(referenceDate, 2);
  if (/\b(?:tomorrow)\b|రేపు|कल/.test(normalized)) return offsetDate(referenceDate, 1);
  if (/\b(?:yesterday)\b|నిన్న/.test(normalized)) return offsetDate(referenceDate, -1);
  if (/\b(?:two days ago)\b|మొన్న/.test(normalized)) return offsetDate(referenceDate, -2);
  if (/\b(?:today)\b|నేడు|ఈరోజు|आज/.test(normalized)) return localDateKey(referenceDate);

  const inDays = normalized.match(/\b(?:in|after)\s+(\d+)\s+days?\b/);
  if (inDays) return offsetDate(referenceDate, Number(inDays[1]));
  const daysAgo = normalized.match(/\b(\d+)\s+days?\s+(?:ago|before)\b/);
  if (daysAgo) return offsetDate(referenceDate, -Number(daysAgo[1]));
  if (/\bnext week\b/.test(normalized)) return offsetDate(referenceDate, 7);
  if (/\bnext month\b/.test(normalized)) return monthOffset(referenceDate, 1);

  const numeric = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const suppliedYear = numeric[3] ? Number(numeric[3]) : null;
    const year = suppliedYear === null ? referenceDate.getFullYear() : suppliedYear < 100 ? 2000 + suppliedYear : suppliedYear;
    const result = dateKeyFromParts(year, month, day);
    if (result) return result;
  }

  const monthNames: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8,
    sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const namedDate = normalized.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(\d{2,4}))?\b/);
  if (namedDate) {
    const day = Number(namedDate[1]);
    const month = monthNames[namedDate[2]];
    const suppliedYear = namedDate[3] ? Number(namedDate[3]) : null;
    let year = suppliedYear === null ? referenceDate.getFullYear() : suppliedYear < 100 ? 2000 + suppliedYear : suppliedYear;
    let result = dateKeyFromParts(year, month, day);
    if (result && suppliedYear === null && result < localDateKey(referenceDate) && futureCue && !pastCue) {
      year += 1;
      result = dateKeyFromParts(year, month, day);
    }
    if (result) return result;
  }

  const weekDays: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
  const weekday = normalized.match(/\b(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
  if (weekday) {
    const target = weekDays[weekday[2]];
    let days = (target - referenceDate.getDay() + 7) % 7;
    if (weekday[1] && days === 0) days = 7;
    return offsetDate(referenceDate, days);
  }

  return futureCue && !pastCue ? offsetDate(referenceDate, 1) : localDateKey(referenceDate);
}

function lastDayOfMonth(referenceDate: Date, monthOffsetValue = 0): string {
  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthOffsetValue + 1, 0, 12);
  return localDateKey(date);
}

function detectedRecoveryScore(text: string): number | undefined {
  const matched = text.match(/(?:recovery|readiness|score|रिकवरी|రికవరీ)\D{0,12}(\d{1,3})/)
    ?? text.match(/\b(\d{1,3})\s*(?:\/|out of)\s*100\b/);
  const score = matched?.[1] ? Number(matched[1]) : Number.NaN;
  return Number.isInteger(score) && score >= 1 && score <= 100 ? score : undefined;
}

function detectedGymExercises(text: string): GymExercise[] {
  const exerciseNames = [
    ['squat', 'Squat'], ['deadlift', 'Deadlift'], ['lunge', 'Lunge'], ['bench', 'Bench press'],
    ['pushup', 'Push-up'], ['push-up', 'Push-up'], ['plank', 'Plank'], ['calf raise', 'Calf raise'],
  ] as const;
  const sets = Number(text.match(/(\d+)\s*sets?/)?.[1] ?? 0);
  const reps = Number(text.match(/(\d+)\s*reps?/)?.[1] ?? 0);
  return exerciseNames.filter(([needle]) => text.includes(needle)).slice(0, 3).map(([, exercise]) => ({ exercise, sets, reps, weight: null }));
}

function voicePlanTitle(kind: AthleteActivityKind, distanceMeters: number | null | undefined, unit: DistanceUnit): string {
  const distance = distanceMeters ? ` ${formatDistance(distanceMeters, unit)}` : '';
  const label = kind === 'treadmill' ? 'treadmill run' : kind;
  return `Planned${distance} ${label}`.replace(/\s+/g, ' ').trim();
}

export function routeVoiceAthleteRecord(text: string, unit: DistanceUnit, referenceDate = new Date()): VoiceAthleteRoute {
  const parsed = parseActivityText(text, unit);
  const date = parseSpokenDate(text, referenceDate);
  const normalized = text.toLowerCase();
  const kind = parsed.kind ?? 'run';
  const today = localDateKey(referenceDate);
  const isFuture = date > today;
  const isRecovery = /\b(?:recovery|readiness)\b|రికవరీ|रिकवरी/.test(normalized);
  const isGym = /\b(?:gym|strength|squat|deadlift|lunge|bench|push-?up|plank|weights?)\b|జిమ్|जिम/.test(normalized);
  const isGoal = /\b(?:goal|target|aim|challenge)\b|లక్ష్యం|लक्ष्य/.test(normalized);
  const isRace = kind === 'race';
  const goalEndsOn = /\bthis month\b/.test(normalized) ? lastDayOfMonth(referenceDate) : /\bnext month\b/.test(normalized) ? lastDayOfMonth(referenceDate, 1) : date > today ? date : offsetDate(referenceDate, 30);
  const score = detectedRecoveryScore(normalized);
  const exercises = detectedGymExercises(normalized);
  const title = voicePlanTitle(kind, parsed.distanceMeters, unit);
  let destination: VoiceAthleteRoute['destination'] = isFuture ? 'plan' : 'activity';
  if (isRecovery) destination = 'recovery';
  else if (isGym) destination = 'gym';
  else if (isGoal) destination = 'goal';
  else if (isFuture && isRace) destination = 'race';

  return {
    destination,
    date,
    activity: { ...parsed, activityDate: date, source: 'voice', notes: text.trim() },
    plan: {
      title,
      workoutDate: date,
      kind,
      targetDistanceMeters: parsed.distanceMeters ?? null,
      notes: text.trim(),
    },
    recovery: { recoveryDate: date, score, notes: text.trim(), source: 'manual' },
    race: {
      name: parsed.distanceMeters ? `${formatDistance(parsed.distanceMeters, unit)} race` : 'Upcoming race',
      raceDate: date,
      distanceMeters: parsed.distanceMeters ?? null,
      location: '',
      finishSeconds: parsed.durationSeconds ?? null,
      notes: text.trim(),
    },
    gym: {
      sessionDate: date,
      title: exercises[0]?.exercise ? `${exercises[0].exercise} strength` : 'Strength session',
      durationMinutes: parsed.durationSeconds ? Math.round(parsed.durationSeconds / 60) : null,
      exercises,
      notes: text.trim(),
    },
    goal: {
      title: parsed.distanceMeters ? `Run ${formatDistance(parsed.distanceMeters, unit)} goal` : 'Running goal',
      targetDistanceMeters: parsed.distanceMeters ?? undefined,
      startsOn: today,
      endsOn: goalEndsOn,
    },
  };
}
