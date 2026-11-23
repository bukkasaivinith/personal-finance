import type { AthleteActivityDraft } from './athlete';
import { workoutMetrics, type WorkoutDetails, type WorkoutLap, type WorkoutMetric, type WorkoutZone } from './athlete-workout';
import type { ScreenshotReading } from './athlete-recognition';

type Core = Pick<AthleteActivityDraft, 'distanceMeters' | 'durationSeconds' | 'averageHeartRate' | 'calories' | 'elevationMeters' | 'cadence'>;
type Field = keyof Core | WorkoutMetric;
const coreLabels = { distanceMeters: 'Distance', durationSeconds: 'Workout duration', averageHeartRate: 'Average heart rate', calories: 'Workout calories', elevationMeters: 'Elevation gain', cadence: 'Average cadence' };
const labels = [...Object.entries(coreLabels), ...workoutMetrics.map(([key, label]) => [key, label])];

function duration(value: string) {
  const parts = value.split(':').map(Number);
  if (parts.slice(1).some((part) => part >= 60)) return undefined;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function pace(minutes: string, seconds: string) {
  return Number(seconds) < 60 ? Number(minutes) * 60 + Number(seconds) : undefined;
}

function parseReading(input: string) {
  const text = input.replace(/\r/g, '').replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  const values: Partial<Record<Field, number>> = {};
  const read = (label: RegExp, value: RegExp) => text.match(new RegExp(label.source + /[ \t:]*(?:\n[ \t]*){0,2}/.source + value.source, 'im'));
  const put = (field: Field, value: number | undefined, min = 0, max = Infinity) => {
    if (value !== undefined && Number.isFinite(value) && value >= min && value <= max) values[field] = value;
  };
  const number = (field: Field, label: RegExp, value: RegExp, min = 0, max = Infinity) =>
    put(field, Number(read(label, value)?.[1]), min, max);
  const timeValue = /(\d{1,3}:\d{2}(?::\d{2})?)(?![\d:])/;
  const paceValue = /(\d{1,2})[':]?(\d{2})["']?\s*\/\s*km\b/;
  const distance = text.match(/^\s*(\d+(?:\.\d+)?)\s*(km|mi)\s*$/im) ?? read(/\bDistance\b/, /(\d+(?:\.\d+)?)\s*(km|mi)\b/);
  const isSummary = /workout (?:duration|calories|details)|max\.? pace/i.test(text);
  if (isSummary && distance) put('distanceMeters', Number(distance[1]) * (distance[2].toLowerCase() === 'km' ? 1000 : 1609.344), 1, 500000);
  for (const [field, label] of [['durationSeconds', /Workout duration/], ['elapsedSeconds', /Total duration/]] as const) {
    const value = read(label, timeValue)?.[1];
    if (value) put(field, duration(value), 1, 172800);
  }
  for (const [field, label] of [['averagePace', /Avg\.? pace/], ['bestPace', /Max\.? pace/]] as const) {
    const value = read(label, paceValue);
    if (value) put(field, pace(value[1], value[2]), 60, 7200);
  }
  number('calories', /Workout calories/, /(\d+)\s*kcal\b/, 0, 15000);
  number('totalCalories', /Total calories/, /(\d+)\s*kcal\b/, 0, 15000);
  const steps = read(/\bSteps\b/, /([\d,]+)\s*$/)?.[1] ?? (isSummary ? /^\s*(\d{1,3}(?:,\d{3})+)\s*$/m.exec(text)?.[1] : undefined);
  if (steps) put('steps', Number(steps.replace(/,/g, '')), 0, 250000);
  number('averageHeartRate', /Avg\.? heart rate/, /(\d+)\s*bpm\b/, 20, 260);
  number('maxHeartRate', /Max\.? heart rate/, /(\d+)\s*bpm\b/, 20, 260);
  const hrPair = /avg\.? heart rate\s+max\.? heart rate\s+(\d{2,3})\s*bpm\s+(\d{2,3})\s*bpm/im.exec(text);
  if (hrPair) { put('averageHeartRate', Number(hrPair[1]), 20, 260); put('maxHeartRate', Number(hrPair[2]), 20, 260); }
  number('cadence', /Avg\.? cadence/, /(\d+)\s*spm\b/, 1, 400);
  number('maxCadence', /Max\.? cadence/, /(\d+)\s*spm\b/, 1, 400);
  number('elevationMeters', /Elevation gain/, /(\d+(?:\.\d+)?)\s*m\b/);
  number('lowestElevation', /Lowest elevation/, /(-?\d+(?:\.\d+)?)\s*m\b/, -500);
  number('highestElevation', /Highest elevation/, /(-?\d+(?:\.\d+)?)\s*m\b/, -500);
  for (const [field, label] of [['totalAscent', /Total ascent/], ['totalDescent', /Total descent/]] as const) {
    const value = read(label, /(\d+(?:\.\d+)?)\s*(km|m)\b/);
    if (value) put(field, Number(value[1]) * (value[2].toLowerCase() === 'km' ? 1000 : 1), 0, 20000);
  }
  number('averageSpeed', /Avg\.? speed/, /(\d+(?:\.\d+)?)\s*km\/h\b/, 0, 100);
  number('maximumSpeed', /Max\.? speed/, /(\d+(?:\.\d+)?)\s*km\/h\b/, 0, 100);
  if (/estimated sweat loss/i.test(text)) {
    put('vo2Max', Number(/\b(?:fair|poor|good|excellent|superior)\b[^\n]*\n(?:[ \t]*[^\d\n]{1,15}\n)?[ \t]*(\d{2}\.\d)\b/i.exec(text)?.[1]), 10, 100);
    put('sweatLoss', Number(/estimated sweat loss[^\n]*\n\s*([\d,]+)\s*ml\b/i.exec(text)?.[1]?.replace(/,/g, '')), 0, 10000);
  }
  const weather = text.split(/^\s*Weather\b[^\n]*$/im)[1]?.split(/\b(?:Notes|this data is from)\b/i)[0];
  if (weather) {
    put('temperature', Number(/(-?\d+(?:\.\d+)?)\s*°\s*C\b/i.exec(weather)?.[1]), -80, 65);
    put('humidity', Number(/(\d{1,3})\s*%/.exec(weather)?.[1]), 0, 100);
    put('windSpeed', Number(/(\d+(?:\.\d+)?)\s*km\/h\b/i.exec(weather)?.[1]), 0, 150);
  }
  const dynamics = [
    ['vertical', 'verticalOscillation', 1, 40], ['stiffness', 'stiffness', 1, 200],
    ['flight time', 'flightTime', 1, 1000], ['contact time', 'groundContact', 1, 1000], ['regularity', 'regularity', 0, 1],
  ] as const;
  const sections = text.split(/^\s*(Vertical|Stiffness|Flight time|Contact time|Regularity|Asymmetry)\s*$/im);
  let asymmetry: string | undefined;
  for (let i = 1; i < sections.length; i += 2) {
    const heading = sections[i].toLowerCase();
    const section = sections[i + 1];
    const found = dynamics.find(([label]) => label === heading);
    if (found) put(found[1], Number(/^\s*Avg\.?\s+(\d+(?:\.\d+)?)\s*$/im.exec(section)?.[1]), found[2], found[3]);
    if (heading === 'asymmetry') asymmetry = /\bOverall[^\n]*\n\s*(Great|Good|Improve)\b/i.exec(section)?.[1];
  }
  const zones: WorkoutZone[] = [];
  for (const match of text.matchAll(/\bZone\s+([1-5]):[^\n]*?\b(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm[^\n]*\n\s*(\d{1,3}:\d{2})[ \t|]+(\d{1,3}(?:\.\d+)?)\s*%/gi)) {
    const seconds = duration(match[4]);
    const [, zone, min, max, , percent] = match.map(Number);
    if (seconds !== undefined && min >= 20 && min <= max && max <= 260 && percent <= 100) zones.push({ zone, minimum: min, maximum: max, seconds, percent });
  }
  const laps: WorkoutLap[] = [];
  const table = text.match(/\bLaps\b[\s\S]{0,150}?\bTime\b([\s\S]*?)\bDistance\b([\s\S]*?)^\s*HR\s*$([\s\S]*?)^\s*Pace\s*$([\s\S]*)/im);
  if (table) {
    const times = [...table[1].matchAll(/^\s*(?:(\d{1,2})[ \t]+)?(\d{1,3}:\d{2})\s*$/gm)];
    const distances = [...table[2].matchAll(/^\s*(\d{1,2}\.\d{2})\s*$/gm)];
    const heartRates = [...table[3].matchAll(/^\s*(\d{2,3})\s*$/gm)];
    const paces = [...table[4].matchAll(/^\s*(\d{1,2})[':]?(\d{2})["']?\s*$/gm)];
    if (times.length >= 2 && distances.length === times.length) times.forEach((entry, index) => {
      if (entry[1] && Number(entry[1]) !== index + 1) return;
      const heartRate = heartRates.length === times.length ? Number(heartRates[index][1]) : 0;
      laps.push({ number: index + 1, seconds: duration(entry[2]), meters: Number(distances[index][1]) * 1000,
        heartRate: heartRate >= 20 && heartRate <= 260 ? heartRate : undefined,
        pace: paces.length === times.length ? pace(paces[index][1], paces[index][2]) : undefined });
    });
  }
  return { values, laps, zones, asymmetry };
}

type PositionedWord = { text: string; confidence: number; bbox: { x0: number; x1: number; y0: number; y1: number } };

export function samsungLapsFromWords(words: PositionedWord[]): WorkoutLap[] {
  const centerX = (word: PositionedWord) => (word.bbox.x0 + word.bbox.x1) / 2;
  const centerY = (word: PositionedWord) => (word.bbox.y0 + word.bbox.y1) / 2;
  const nearby = (word: PositionedWord, row: PositionedWord) => Math.abs(centerY(word) - centerY(row)) <= Math.max(4, (row.bbox.y1 - row.bbox.y0) * 0.6);
  const reliable = words.filter((word) => word.confidence >= 45);
  const headings = ['time', 'distance', 'hr', 'pace'];
  for (const time of reliable.filter((word) => word.text.toLowerCase() === 'time')) {
    const columns = headings.map((name) => reliable.find((word) => word.text.toLowerCase() === name && nearby(word, time)));
    if (columns.some((column) => !column) || !reliable.some((word) => word.text.toLowerCase() === 'laps' && centerY(word) < centerY(time))) continue;
    const [timeX, distanceX, hrX, paceX] = columns.map((column) => centerX(column!));
    if (!(timeX < distanceX && distanceX < hrX && hrX < paceX)) continue;
    const tolerance = Math.min(distanceX - timeX, hrX - distanceX, paceX - hrX) * 0.42;
    const below = reliable.filter((word) => centerY(word) > time.bbox.y1);
    const reading = (x: number, row: PositionedWord, pattern: RegExp) => below.find((word) => nearby(word, row) && Math.abs(centerX(word) - x) <= tolerance && pattern.test(word.text))?.text;
    return below.filter((word) => Math.abs(centerX(word) - timeX) <= tolerance && /^\d{1,3}:\d{2}$/.test(word.text)).sort((a, b) => centerY(a) - centerY(b)).flatMap((row, index) => {
      const distance = reading(distanceX, row, /^\d{1,2}\.\d{2}$/);
      if (!distance) return [];
      const heartRate = Number(reading(hrX, row, /^\d{2,3}$/));
      const splitPace = reading(paceX, row, /^\d{1,2}['′:]?\d{2}["″']?$/)?.match(/^(\d{1,2})['′:]?(\d{2})/);
      return [{ number: index + 1, seconds: duration(row.text), meters: Number(distance) * 1000,
        heartRate: heartRate >= 20 && heartRate <= 260 ? heartRate : undefined, pace: splitPace ? pace(splitPace[1], splitPace[2]) : undefined }];
    });
  }
  return [];
}

function consensus<T>(values: T[], warning: string, warnings: Set<string>): T | undefined {
  const unique = new Map(values.map((value) => [JSON.stringify(value), value]));
  if (unique.size > 1) { warnings.add(warning); return undefined; }
  return unique.values().next().value;
}

export function readSamsungWorkout(images: Array<{ readings: ScreenshotReading[]; fingerprint?: string }>) {
  const warnings = new Set<string>();
  const all = images.flatMap(({ readings }) => readings.filter((reading) => reading.confidence >= 45).flatMap((reading) =>
    [reading.text || reading.layoutText].filter(Boolean).map((text) => {
      const parsed = parseReading(text);
      return { ...parsed, laps: reading.laps?.length ? reading.laps : parsed.laps };
    })));
  if (!all.some(({ values, laps, zones, asymmetry }) => Object.keys(values).length || laps.length || zones.length || asymmetry)) return null;
  const activity: Partial<Core> = {};
  const details: WorkoutDetails = { source: 'Samsung Health', metrics: {}, fingerprints: images.flatMap(({ fingerprint }) => fingerprint ? [fingerprint] : []) };
  for (const [field, label] of labels) {
    const candidates = all.flatMap(({ values }) => {
      const value = values[field as Field];
      return value === undefined ? [] : [Number(value.toFixed(2))];
    });
    const value = consensus(candidates, label + ' differs across readings. Enter the correct value.', warnings);
    if (Object.prototype.hasOwnProperty.call(coreLabels, field)) {
      if (candidates.length) activity[field as keyof Core] = value ?? null;
    } else if (value !== undefined) details.metrics[field as WorkoutMetric] = value;
  }
  details.zones = [1, 2, 3, 4, 5].flatMap((zone) => {
    const candidates = all.flatMap((page) => page.zones.filter((entry) => entry.zone === zone));
    const workoutSeconds = activity.durationSeconds;
    const consistent = workoutSeconds ? candidates.filter((entry) => Math.abs(entry.seconds * 100 / workoutSeconds - entry.percent) <= 0.25) : [];
    const record = consensus(consistent.length ? consistent : candidates, 'Heart rate zone ' + zone + ' differs across readings.', warnings);
    return record ? [record] : [];
  });
  const lapNumbers = [...new Set(all.flatMap(({ laps }) => laps.map((lap) => lap.number)))].sort((a, b) => a - b);
  details.laps = lapNumbers.map((number) => {
    const candidates = all.flatMap(({ laps }) => laps.filter((lap) => lap.number === number));
    const lap: WorkoutLap = { number };
    for (const field of ['seconds', 'meters', 'heartRate', 'pace'] as const) {
      const label = { seconds: 'time', meters: 'distance', heartRate: 'heart rate', pace: 'pace' }[field];
      lap[field] = consensus(candidates.flatMap((candidate) => candidate[field] === undefined ? [] : [candidate[field]]), 'Lap ' + number + ' ' + label + ' differs across readings.', warnings);
    }
    return lap;
  });
  if (details.laps.length && activity.distanceMeters && Math.abs(details.laps.reduce((sum, lap) => sum + (lap.meters ?? 0), 0) - activity.distanceMeters) > 25) warnings.add('The detected lap distances do not add up to the workout distance. Check for missing laps.');
  if (details.laps.length && details.laps.every((lap) => lap.seconds !== undefined) && activity.durationSeconds && Math.abs(details.laps.reduce((sum, lap) => sum + (lap.seconds ?? 0), 0) - activity.durationSeconds) > 1) warnings.add('Lap times and workout duration differ slightly. Check both before saving.');
  if (!details.laps.length) delete details.laps;
  if (!details.zones.length) delete details.zones;
  details.asymmetry = consensus(all.flatMap(({ asymmetry }) => asymmetry ? [asymmetry] : []), 'Asymmetry rating differs across readings.', warnings);
  return { activity, details, warnings: [...warnings] };
}
