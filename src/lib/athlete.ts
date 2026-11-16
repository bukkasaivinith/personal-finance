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
  warnings?: string[];
  missingFields?: string[];
  transcript?: string;
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

const spokenNumbers: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function normalizeAthleteInput(text: string): string {
  let normalized = text.normalize('NFKC').toLowerCase().replace(/\u00a0/g, ' ').replace(/[–—]/g, '-');
  for (const digits of ['०१२३४५६७८९', '౦౧౨౩౪౫౬౭౮౯', '٠١٢٣٤٥٦٧٨٩']) normalized = normalized.replace(new RegExp(`[${digits}]`, 'g'), (digit) => String(digits.indexOf(digit)));
  const word = '(?:' + Object.keys(spokenNumbers).join('|') + '|hundred|thousand)';
  normalized = normalized.replace(new RegExp('\\b' + word + '(?:[ -]+(?:and[ -]+)?' + word + ')*(?:[ -]+point(?:[ -]+' + word + ')+)?\\b', 'g'), (phrase) => {
    const [integerWords, decimalWords] = phrase.split(/\s+point\s+/);
    let total = 0; let current = 0;
    for (const part of integerWords.split(/[ -]+/)) {
      if (part === 'hundred') current = Math.max(current, 1) * 100;
      else if (part === 'thousand') { total += Math.max(current, 1) * 1000; current = 0; }
      else if (part !== 'and') current += spokenNumbers[part] ?? 0;
    }
    const decimal = decimalWords?.split(/[ -]+/).map((part) => spokenNumbers[part]);
    if (decimal?.some((value) => value === undefined || value > 9)) return phrase;
    return `${total + current}${decimal ? '.' + decimal.join('') : ''}`;
  });
  const localNumbers: Record<string, number> = { 'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'बीस': 20, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'సున్నా': 0, 'ఒకటి': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10, 'ఇరవై': 20, 'ముప్పై': 30 };
  normalized = normalized.replace(/[^\s\d.,:;!?/()-]+/gu, (part) => part in localNumbers ? String(localNumbers[part]) : part);
  // Preserve rows so a value cannot silently be taken from the next screenshot metric.
  return normalized.replace(/\bk\s*m\b|\bkms\b/g, 'km').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

const numberPattern = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
const metricJoin = '[ \\t]*(?:(?:was|is|of|at|equals?|about)\\s+)?[:=\\-]?[ \\t]*';
const distanceUnitPattern = '(?:kilomet(?:er|re)s?|km|miles?|mi|met(?:er|re)s?|m|కి\\.?మీ|కిమీ|కిలోమీటర్లు|కిలోమీటర్|మీటర్లు|किलोमीटर|कि\\.?मी|किमी|मीटर|मील|మైలు)';
const timeUnitPattern = '(?:hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s|గంటలు|గంట|నిమిషాలు|నిమిషాల|సెకన్లు|घंटे|घंटा|मिनट|सेकंड)';

function numericValue(value: string): number | null {
  const result = Number(/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value) ? value.replace(/,/g, '') : value.replace(',', '.'));
  return Number.isFinite(result) ? result : null;
}
function uniqueMetric(values: number[]): number | null { const unique = [...new Set(values)]; return unique.length === 1 ? unique[0] : null; }
function validNumber(minimum: number, maximum: number) { return (text: string): number | null => { const value = numericValue(text); return value !== null && value >= minimum && value <= maximum ? value : null; }; }

/** Read adjacent label/value pairs, including values displayed above screenshot labels. */
function labelledMetric(text: string, label: string, parse: (value: string) => number | null, valuePattern = numberPattern, unitPattern = ''): number | null {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const values: number[] = [];
  const token = `(${valuePattern})${unitPattern ? `(?:[ \\t]*(?:${unitPattern}))?` : ''}`;
  const after = new RegExp(`(?<![\\p{L}])(?:${label})${metricJoin}${token}(?![\\d.,])`, 'gu');
  const before = new RegExp(`(?:^|[^\\d.,])${token}[ \\t]*(?:${label})(?![\\p{L}])`, 'u');
  const onlyLabel = new RegExp(`^(?:${label})[ \\t]*(?:\\([^)]{0,12}\\))?[:=]?\\s*$`, 'u');
  const onlyValue = new RegExp(`^${token}$`, 'u');
  for (let index = 0; index < lines.length; index += 1) {
    const afterMatches = [...lines[index].matchAll(after)];
    const direct = afterMatches.length ? afterMatches : [before.exec(lines[index])].filter((match): match is RegExpExecArray => match !== null);
    for (const match of direct) { const value = parse(match[1]); if (value !== null) values.push(value); }
    if (!onlyLabel.test(lines[index])) continue;
    const neighbours = [lines[index - 1], lines[index + 1]].flatMap((line) => { const match = line?.match(onlyValue); const value = match ? parse(match[1]) : null; return value === null ? [] : [value]; });
    const value = uniqueMetric(neighbours);
    if (value !== null) values.push(value);
  }
  return uniqueMetric(values);
}
function clockSeconds(value: string): number | null {
  const parts = value.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0) || parts[parts.length - 1] >= 60 || (parts.length === 3 && parts[1] >= 60)) return null;
  const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  return seconds > 0 && seconds <= 7 * 86400 ? seconds : null;
}
function durationFromUnits(value: string): number | null {
  let total = 0;
  for (const token of value.matchAll(new RegExp(`(${numberPattern})\\s*(${timeUnitPattern})(?![\\p{L}])`, 'gu'))) {
    const amount = numericValue(token[1]);
    if (amount !== null) total += amount * (/^(?:h|గంట|घंट)/.test(token[2]) ? 3600 : /^(?:m|నిమిష|मिनट)/.test(token[2]) ? 60 : 1);
  }
  return total > 0 && total <= 7 * 86400 ? Math.round(total) : null;
}
function readDuration(text: string): number | null {
  const label = '(?:moving time|running time|workout time|exercise time|duration|elapsed time|total time|समय|अवधि|సమయం|వ్యవధి)';
  const clock = '\\d{1,3}:\\d{2}(?::\\d{2})?';
  const compound = `${numberPattern}\\s*${timeUnitPattern}(?![\\p{L}])(?:[ \\t]*(?:,|and)?[ \\t]*${numberPattern}\\s*${timeUnitPattern}(?![\\p{L}]))*`;
  const labelledClock = labelledMetric(text, label, clockSeconds, clock);
  if (labelledClock !== null) return labelledClock;
  const labelledUnits = labelledMetric(text, label, durationFromUnits, compound);
  if (labelledUnits !== null) return labelledUnits;
  const basicTime = labelledMetric(text.replace(/(?:start|end|bed|wake|pace) time/gi, 'clock'), 'time', clockSeconds, clock);
  if (basicTime !== null) return basicTime;
  const values: number[] = [];
  for (const match of text.matchAll(new RegExp(compound, 'gu'))) {
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 20), match.index);
    const suffix = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 18);
    if (/pace\s*[:=]?\s*$/.test(prefix) || /^\s*(?:\/|per\s+)(?:km|mi|mile|kilomet)/.test(suffix)) continue;
    if (new RegExp(`^${numberPattern}\\s*m$`).test(match[0]) && !/(?:in|for|time|duration)\s*[:=]?\s*$/.test(prefix)) continue;
    const seconds = durationFromUnits(match[0]); if (seconds !== null) values.push(seconds);
  }
  return uniqueMetric(values);
}
function distanceInMeters(value: string, unit: string): number | null {
  const amount = numericValue(value);
  if (amount === null || amount < 0) return null;
  const multiplier = /^(?:mi(?:le)?s?|मील|మైలు)$/.test(unit) ? 1609.344 : /^(?:m|met(?:er|re)s?|మీటర్లు|मीटर)$/.test(unit) ? 1 : 1000;
  return Math.round(amount * multiplier);
}
function readDistance(text: string, preferredUnit: DistanceUnit): number | null {
  const values: number[] = [];
  for (const match of text.matchAll(new RegExp(`(^|[^\\d.,])(${numberPattern})\\s*(${distanceUnitPattern})(?![\\p{L}])`, 'gu'))) {
    const start = (match.index ?? 0) + match[1].length;
    const before = text.slice(Math.max(0, start - 38), start);
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 15);
    if (/(?:pace|elevation|gain|altitude|height|ascent|descent|stride|lap|split)\s*[:=]?\s*$/.test(before) || /(?:\d:|\/)\s*$/.test(before) || /^\s*\//.test(after)) continue;
    if (match[3] === 'm' && (/(?:in|for|time|duration)\s*[:=]?\s*$/.test(before) || /\d\s*(?:h|hr|hrs|hours?)\s*$/.test(before) || /^\s*\d+\s*s\b/.test(after))) continue;
    const meters = distanceInMeters(match[2], match[3]); if (meters !== null) values.push(meters);
  }
  if (values.length) return uniqueMetric(values);
  const labelled = labelledMetric(text, '(?:total distance|distance|దూరం|दूरी)', validNumber(0, 100000));
  return labelled === null ? null : metersFromDistance(labelled, preferredUnit);
}

export function parseActivityText(text: string, unit: DistanceUnit): Partial<AthleteActivityDraft> {
  const normalized = normalizeAthleteInput(text);
  const kind: AthleteActivityKind = /\b(?:race|marathon|half marathon)\b|రేసు|మ్యారథాన్|रेस|मैराथन/.test(normalized) ? 'race' : /\btreadmill\b|ట్రెడ్‌మిల్|ट्रेडमिल/.test(normalized) ? 'treadmill' : /\b(?:cycle|cycling|bike|biking)\b|సైకిల్|साइकिल/.test(normalized) ? 'cycle' : /\b(?:walk|walking|walked)\b|నడక|चलना|वॉक/.test(normalized) ? 'walk' : 'run';
  const heartParser = validNumber(25, 250);
  const withoutMax = normalized.replace(/(?:max(?:imum)?|peak|resting)\s*(?:heart\s*rate|hr)\s*[:=]?\s*\d+(?:\s*bpm)?/g, '');
  const averageHeartRate = labelledMetric(normalized, '(?:(?:avg\\.?|average|mean)\\s*(?:heart\\s*rate|hr)|औसत हृदय गति)', heartParser, numberPattern, 'bpm') ?? labelledMetric(withoutMax, '(?:heart\\s*rate|hr|bpm|హార్ట్ రేట్|हृदय गति)', heartParser, numberPattern, 'bpm');
  const calories = labelledMetric(normalized, '(?:active calories|calories burned|total calories|calories|energy|kcal|cal|కేలరీలు|कैलोरी)', validNumber(0, 100000), numberPattern, 'kcal|calories|cal');
  const elevationLabel = '(?:elevation gain|elevation|elev\\.?|gain|altitude|ascent)';
  const elevationMeters = labelledMetric(normalized, elevationLabel, validNumber(0, 20000), numberPattern, 'm|met(?:er|re)s?');
  const elevationFeet = labelledMetric(normalized, elevationLabel, (value) => { const match = value.match(new RegExp(`^(${numberPattern})\\s*(?:ft|feet)$`)); const amount = match ? numericValue(match[1]) : null; return amount !== null && amount >= 0 && amount <= 65000 ? Math.round(amount * .3048) : null; }, `${numberPattern}\\s*(?:ft|feet)`);
  const cadence = labelledMetric(normalized, '(?:(?:avg\\.?|average)\\s*)?(?:cadence|spm|steps?\\s*(?:per|/)\\s*min(?:ute)?)', validNumber(20, 300), numberPattern, 'spm');
  const effort = labelledMetric(normalized, '(?:effort|rpe|perceived exertion)', validNumber(1, 10));
  return { kind, distanceMeters: readDistance(normalized, unit) ?? undefined, durationSeconds: readDuration(normalized), averageHeartRate, calories, elevationMeters: elevationFeet ?? elevationMeters, cadence, effort, notes: '' };
}

function offsetDate(referenceDate: Date, days: number): string { return localDateKey(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() + days, 12)); }
function dateKeyFromParts(year: number, month: number, day: number): string | null { const date = new Date(year, month, day, 12); return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? localDateKey(date) : null; }
function includesFutureCue(text: string): boolean { return /\b(?:tomorrow|next|plan(?:ned|ning)?|schedule(?:d)?|will|going to|intend to)\b|రేపు|ఎల్లుండి|చేస్తాను|ప్లాన్|करूंगा|करूँगा|करेंगे/.test(text); }
function includesPastCue(text: string): boolean { return /\b(?:yesterday|ago|last|previous|ran|walked|cycled|completed|finished|did)\b|నిన్న|మొన్న|చేశాను|పూర్తి|बीते|पहले|किया|दौड़ा|दौड़ी|दौड़ी/.test(text); }

/** Unknown dates stay empty, requiring a date in review rather than inventing one. */
export function parseSpokenDate(text: string, referenceDate = new Date()): string {
  const normalized = normalizeAthleteInput(text);
  const futureCue = includesFutureCue(normalized), pastCue = includesPastCue(normalized), today = localDateKey(referenceDate);
  const resolve = (day: number, month: number, suppliedYear?: string): string => {
    const numericYear = suppliedYear ? Number(suppliedYear) : referenceDate.getFullYear(); let year = numericYear < 100 ? 2000 + numericYear : numericYear;
    let result = dateKeyFromParts(year, month, day);
    if (!suppliedYear && result) { if (result < today && futureCue && !pastCue) year += 1; else if (result > today && pastCue && !futureCue) year -= 1; result = dateKeyFromParts(year, month, day); }
    return result ?? '';
  };
  const iso = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return dateKeyFromParts(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) ?? '';
  for (const numeric of normalized.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?\b/g)) {
    const start = numeric.index ?? 0;
    const before = normalized.slice(Math.max(0, start - 28), start);
    const lineStart = normalized.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = normalized.indexOf('\n', start);
    const line = normalized.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
    // Scores such as 8/10 and 80/100 are never dates. A partial date needs context.
    if (/(?:score|effort|rpe|recovery|readiness)\s*[:=]?\s*$/.test(before)) continue;
    if (!numeric[3] && !/(?:\bon|\bdate|\bdated)\s*[:=]?\s*$/.test(before) && line !== numeric[0]) continue;
    return resolve(Number(numeric[1]), Number(numeric[2]) - 1, numeric[3]);
  }
  const months = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'jun(?:e)?', 'jul(?:y)?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];
  const pattern = `(${months.join('|')})`;
  const dayFirst = normalized.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[ -]+${pattern}(?:[ ,]+(\\d{4}|\\d{2}))?\\b`));
  const monthFirst = normalized.match(new RegExp(`\\b${pattern}[ -]+(\\d{1,2})(?:st|nd|rd|th)?(?:[ ,]+(\\d{4}|\\d{2}))?\\b`));
  if (dayFirst || monthFirst) { const found = (dayFirst ?? monthFirst)!; const monthName = dayFirst ? found[2] : found[1]; return resolve(Number(dayFirst ? found[1] : found[2]), months.findIndex((candidate) => new RegExp(`^${candidate}$`).test(monthName)), found[3]); }
  if (/\bday before yesterday\b|మొన్న/.test(normalized)) return offsetDate(referenceDate, -2);
  if (/\bday after tomorrow\b|ఎల్లుండి/.test(normalized)) return offsetDate(referenceDate, 2);
  if (/परसों/.test(normalized)) return pastCue && !futureCue ? offsetDate(referenceDate, -2) : futureCue && !pastCue ? offsetDate(referenceDate, 2) : '';
  if (/\byesterday\b|నిన్న/.test(normalized)) return offsetDate(referenceDate, -1);
  if (/\btomorrow\b|రేపు/.test(normalized)) return offsetDate(referenceDate, 1);
  if (/कल/.test(normalized)) return pastCue && !futureCue ? offsetDate(referenceDate, -1) : futureCue && !pastCue ? offsetDate(referenceDate, 1) : '';
  if (/\btoday\b|నేడు|ఈరోజు|आज/.test(normalized)) return today;
  const inDays = normalized.match(/\b(?:in|after)\s+(\d+)\s+(days?|weeks?)\b/);
  if (inDays) return offsetDate(referenceDate, Number(inDays[1]) * (inDays[2].startsWith('week') ? 7 : 1));
  const daysAgo = normalized.match(/\b(\d+)\s+(days?|weeks?)\s+(?:ago|before)\b/);
  if (daysAgo) return offsetDate(referenceDate, -Number(daysAgo[1]) * (daysAgo[2].startsWith('week') ? 7 : 1));
  const weekdays: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
  const weekday = normalized.match(/\b(last|previous|next|this)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
  if (weekday) {
    if (!weekday[1] && !pastCue && !futureCue) return '';
    const backwards = /^(?:last|previous)$/.test(weekday[1] ?? '') || (!weekday[1] && pastCue && !futureCue);
    let days = backwards ? -((referenceDate.getDay() - weekdays[weekday[2]] + 7) % 7) : (weekdays[weekday[2]] - referenceDate.getDay() + 7) % 7;
    if (!days && weekday[1] !== 'this') days = backwards ? -7 : 7;
    return offsetDate(referenceDate, days);
  }
  return '';
}
function lastDayOfMonth(referenceDate: Date, monthOffset = 0): string { return localDateKey(new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthOffset + 1, 0, 12)); }
function detectedRecoveryScore(text: string): number | undefined { return labelledMetric(text, '(?:recovery(?: score)?|readiness(?: score)?|रिकवरी|రికవరీ)', validNumber(1, 100), numberPattern, '%') ?? undefined; }
function detectedGymExercises(text: string): GymExercise[] {
  const names = [['squat', 'Squat'], ['deadlift', 'Deadlift'], ['lunge', 'Lunge'], ['bench', 'Bench press'], ['push-?ups?', 'Push-up'], ['plank', 'Plank'], ['calf raises?', 'Calf raise']] as const;
  return names.flatMap(([pattern, exercise]) => { const match = new RegExp(`\\b${pattern}\\b([^.;\\n]*)`).exec(text); return match ? [{ exercise, sets: Number(match[1].match(/\b(\d+)\s*sets?\b/)?.[1] ?? 0), reps: Number(match[1].match(/\b(\d+)\s*reps?\b/)?.[1] ?? 0), weight: null }] : []; }).slice(0, 10);
}

export function routeVoiceAthleteRecord(text: string, unit: DistanceUnit, referenceDate = new Date(), options: { source?: 'voice' | 'image' } = {}): VoiceAthleteRoute {
  const normalized = normalizeAthleteInput(text), parsed = parseActivityText(text, unit), date = parseSpokenDate(text, referenceDate), today = localDateKey(referenceDate);
  const score = detectedRecoveryScore(normalized), kind = parsed.kind ?? 'run';
  const isFuture = date > today || (includesFutureCue(normalized) && !includesPastCue(normalized));
  const isRecovery = /\b(?:recovery|readiness)\b|రికవరీ|रिकवरी/.test(normalized) && (score !== undefined || !/\b(?:run|ran|running|walk|cycling|workout)\b/.test(normalized));
  const isGym = /\b(?:gym|squats?|deadlift|lunge|bench|push-?ups?|plank|weights?|strength session)\b|జిమ్|जिम/.test(normalized);
  const isGoal = /\b(?:goal|aim|challenge)\b|లక్ష్యం|लक्ष्य/.test(normalized) || /\btarget\s+\d/.test(normalized);
  const exercises = detectedGymExercises(normalized);
  let destination: VoiceAthleteRoute['destination'] = isFuture ? 'plan' : 'activity';
  if (isRecovery) destination = 'recovery'; else if (isGym) destination = 'gym'; else if (isGoal) destination = 'goal'; else if (isFuture && kind === 'race') destination = 'race';
  const monthOffset = /\bnext month\b/.test(normalized) ? 1 : /\bthis month\b/.test(normalized) ? 0 : null;
  const goalStartsOn = monthOffset === null ? date : localDateKey(new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthOffset, 1, 12));
  const goalEndsOn = monthOffset === null ? date : lastDayOfMonth(referenceDate, monthOffset);
  const missingFields: string[] = [];
  if (!date && destination !== 'goal') missingFields.push('Date');
  if (destination === 'goal') { if (!goalStartsOn) missingFields.push('Start date'); if (!goalEndsOn) missingFields.push('End date'); if (!parsed.distanceMeters) missingFields.push('Target distance'); }
  if (destination === 'recovery' && score === undefined) missingFields.push('Recovery score');
  if (destination === 'activity' && parsed.distanceMeters === undefined && !parsed.durationSeconds) missingFields.push('Distance or duration');
  const warnings: string[] = [];
  if (missingFields.length) warnings.push(`Not detected: ${missingFields.join(', ')}. Choose these in the review form.`);
  if (options.source === 'image') warnings.push('Screenshot text can contain unrelated dashboard values. Check each detected measurement.');
  if (/\byesterday\b|నిన్న/.test(normalized) && /\btomorrow\b|రేపు/.test(normalized)) warnings.push('This describes more than one date. Review one event at a time.');
  for (const [label, value, name] of [[/(?:heart rate|\bbpm\b)/, parsed.averageHeartRate, 'Average heart rate'], [/(?:calories|\bkcal\b)/, parsed.calories, 'Calories'], [/cadence|\bspm\b/, parsed.cadence, 'Cadence'], [/\bdistance\b|\b\d+(?:[.,]\d+)?\s*(?:km|miles?)\b/, parsed.distanceMeters, 'Distance'], [/\bduration\b|\b(?:moving|elapsed|running) time\b/, parsed.durationSeconds, 'Duration']] as const) if (label.test(normalized) && value == null) warnings.push(`${name} was unclear or conflicting and has been left empty.`);
  const distanceLabel = parsed.distanceMeters ? `${formatDistance(parsed.distanceMeters, unit)} ` : '';
  return {
    destination, date, warnings, missingFields, transcript: text.trim(),
    activity: { ...parsed, activityDate: date, source: options.source ?? 'voice', notes: '' },
    plan: { title: `Planned ${distanceLabel}${kind === 'treadmill' ? 'treadmill run' : kind}`, workoutDate: date, kind, targetDistanceMeters: parsed.distanceMeters ?? null, notes: '' },
    recovery: { recoveryDate: date, score, notes: '', source: 'manual' },
    race: { name: distanceLabel ? `${distanceLabel}race` : 'Upcoming race', raceDate: date, distanceMeters: parsed.distanceMeters ?? null, location: '', finishSeconds: parsed.durationSeconds ?? null, notes: '' },
    gym: { sessionDate: date, title: exercises[0]?.exercise ? `${exercises[0].exercise} strength` : 'Strength session', durationMinutes: parsed.durationSeconds ? Math.round(parsed.durationSeconds / 60) : null, exercises, notes: '' },
    goal: { title: distanceLabel ? `Run ${distanceLabel}goal` : 'Running goal', targetDistanceMeters: parsed.distanceMeters ?? undefined, startsOn: goalStartsOn, endsOn: goalEndsOn },
  };
}
