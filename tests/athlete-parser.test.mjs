import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/lib/athlete.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { parseActivityText, parseSpokenDate, routeVoiceAthleteRecord } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const reference = new Date(2026, 10, 16, 12);

const metrics = [
  ['explicit km overrides miles preference', 'Distance: 5.00 km\nDuration: 00:30:00', 'mi', { distanceMeters: 5000, durationSeconds: 1800 }],
  ['explicit miles override km preference', 'Ran 3 miles in 30 minutes', 'km', { distanceMeters: 4828, durationSeconds: 1800 }],
  ['minutes are never miles', 'Ran for 30 minutes today', 'km', { distanceMeters: undefined, durationSeconds: 1800 }],
  ['compound hours and minutes', 'Ran 12 km in 1 hour 30 minutes', 'km', { distanceMeters: 12000, durationSeconds: 5400 }],
  ['compact duration is not metres', 'Running duration 1h 30m', 'km', { distanceMeters: undefined, durationSeconds: 5400 }],
  ['minutes plus seconds', 'Ran 5 km in 30 minutes 25 seconds', 'km', { durationSeconds: 1825 }],
  ['status time and pace cannot become duration', '12:18\nRunning 5 km\nAverage pace 6:12 /km', 'km', { distanceMeters: 5000, durationSeconds: null }],
  ['explicit duration wins over pace', 'Running 5 km\nDuration 30:00\nAverage pace 6:00 /km', 'km', { durationSeconds: 1800 }],
  ['start time is not duration', 'Start time 06:30\nRunning 5 km', 'km', { durationSeconds: null }],
  ['invalid clock left blank', 'Duration 1:78:10', 'km', { durationSeconds: null }],
  ['decimal commas', 'Ran 5,25 km in 30 minutes', 'km', { distanceMeters: 5250 }],
  ['grouped calorie count', 'Calories: 1,200 kcal', 'km', { calories: 1200 }],
  ['metres supported', 'Distance: 1,234 m', 'km', { distanceMeters: 1234 }],
  ['average heart rate preferred', 'Max heart rate 185 Average heart rate 150', 'km', { averageHeartRate: 150 }],
  ['maximum not used as average', 'Max heart rate 185 bpm', 'km', { averageHeartRate: null }],
  ['impossible heart rate rejected', 'Average heart rate 850 bpm', 'km', { averageHeartRate: null }],
  ['value above label', '5.00 km\n30:00\nDuration\n150\nAverage heart rate\n320\nCalories', 'km', { durationSeconds: 1800, averageHeartRate: 150, calories: 320 }],
  ['value below label', 'Average heart rate\n148 bpm\nCalories\n320 kcal', 'km', { averageHeartRate: 148, calories: 320 }],
  ['cadence and elevation', 'Distance 5 km\nElevation gain 40 m\nCadence 172 spm', 'km', { distanceMeters: 5000, elevationMeters: 40, cadence: 172 }],
  ['feet converted to metres', 'Elevation gain 100 ft', 'km', { elevationMeters: 30 }],
  ['English decimal words', 'Ran five point five km in thirty minutes', 'km', { distanceMeters: 5500, durationSeconds: 1800 }],
  ['English hundreds', 'Heart rate was one hundred fifty bpm', 'km', { averageHeartRate: 150 }],
  ['English hundreds with and', 'Calories one hundred and twenty five', 'km', { calories: 125 }],
  ['Hindi digits and units', 'आज ५ किलोमीटर ३० मिनट', 'km', { distanceMeters: 5000, durationSeconds: 1800 }],
  ['Telugu digits and units', 'నిన్న ౫ కిమీ ౩౦ నిమిషాలు', 'km', { distanceMeters: 5000, durationSeconds: 1800 }],
  ['Hindi words', 'पांच किलोमीटर तीस मिनट', 'km', { distanceMeters: 5000, durationSeconds: 1800 }],
  ['Telugu words', 'ఐదు కిమీ ముప్పై నిమిషాలు', 'km', { distanceMeters: 5000, durationSeconds: 1800 }],
  ['conflicting distances remain blank', 'Distance 5 km\nDistance 8 km', 'km', { distanceMeters: undefined }],
  ['conflicting heart rates remain blank', 'Average heart rate 150\nAverage heart rate 170', 'km', { averageHeartRate: null }],
  ['same-line conflicts remain blank', 'Average heart rate 150 Average heart rate 170', 'km', { averageHeartRate: null }],
  ['effort parsed without becoming date', 'Effort 8/10', 'km', { effort: 8 }],
];

for (const [name, text, unit, expected] of metrics) test(name, () => {
  const parsed = parseActivityText(text, unit);
  for (const [field, value] of Object.entries(expected)) assert.equal(parsed[field], value, field);
  assert.equal(parsed.notes, '');
});

const dates = [
  ['ISO date', 'Run on 2026-11-10', '2026-11-10'],
  ['Indian slash date', 'Run on 10/11/2026', '2026-11-10'],
  ['partial date with cue', 'Run on 10/11', '2026-11-10'],
  ['standalone screenshot date', 'Running\n10/11\n5 km', '2026-11-10'],
  ['named day first', 'Run on 10 November 2026', '2026-11-10'],
  ['named month first', 'Run on November 10, 2026', '2026-11-10'],
  ['past weekday', 'Ran 5 km last Friday', '2026-11-13'],
  ['future weekday', 'I will run next Friday', '2026-11-20'],
  ['past cue with weekday', 'I ran 5 km Friday', '2026-11-13'],
  ['today', 'I ran today', '2026-11-16'],
  ['yesterday', 'I ran yesterday', '2026-11-15'],
  ['two days ago spoken', 'I ran two days ago', '2026-11-14'],
  ['future spoken offset', 'I will run in five days', '2026-11-21'],
  ['Hindi past context', 'कल मैंने 5 km दौड़ा', '2026-11-15'],
  ['Hindi future context', 'कल 5 km करूंगा', '2026-11-17'],
  ['ambiguous Hindi date', 'कल 5 km', ''],
  ['Telugu past', 'నిన్న 5 కిమీ చేశాను', '2026-11-15'],
  ['Telugu future', 'రేపు 5 కిమీ చేస్తాను', '2026-11-17'],
  ['unknown date', 'Ran 5 km', ''],
  ['vague future date', 'I plan a run', ''],
  ['vague next week', 'I plan a run next week', ''],
  ['invalid calendar date', '2026-02-30', ''],
  ['recovery score not date', 'Recovery score 80/100', ''],
  ['effort not date', 'Effort 8/10', ''],
  ['pace not date', 'Pace 6:12 /km', ''],
];
for (const [name, text, expected] of dates) test(name, () => assert.equal(parseSpokenDate(text, reference), expected));

test('same-day future intention opens planned workout', () => assert.equal(routeVoiceAthleteRecord('I will run 5 km today', 'km', reference).destination, 'plan'));
test('completed recovery run stays an activity', () => assert.equal(routeVoiceAthleteRecord('Recovery run 5 km yesterday', 'km', reference).destination, 'activity'));
test('recovery score uses spoken words', () => {
  const route = routeVoiceAthleteRecord('Recovery score eighty five today', 'km', reference);
  assert.equal(route.destination, 'recovery'); assert.equal(route.recovery.score, 85);
});
test('future race uses race draft', () => assert.equal(routeVoiceAthleteRecord('I will run a marathon next Sunday', 'km', reference).destination, 'race'));
test('gym and monthly goal remain supported', () => {
  assert.equal(routeVoiceAthleteRecord('Gym bench 3 sets 10 reps yesterday', 'km', reference).destination, 'gym');
  const goal = routeVoiceAthleteRecord('My goal is 100 km next month', 'km', reference);
  assert.equal(goal.destination, 'goal'); assert.equal(goal.goal.startsOn, '2026-12-01'); assert.equal(goal.goal.endsOn, '2026-12-31');
});
test('missing and conflicting fields are reported, not invented', () => {
  const route = routeVoiceAthleteRecord('Distance 5 km\nDistance 8 km', 'km', reference, { source: 'image' });
  assert.equal(route.date, ''); assert.equal(route.activity.activityDate, ''); assert.equal(route.activity.source, 'image');
  assert(route.missingFields.includes('Date')); assert(route.warnings.some((warning) => warning.includes('Distance was unclear or conflicting')));
});
test('source text is separate from every notes field', () => {
  const route = routeVoiceAthleteRecord('Ran 5 km yesterday and felt good', 'km', reference);
  assert.equal(route.transcript, 'Ran 5 km yesterday and felt good');
  for (const key of ['activity', 'plan', 'recovery', 'race', 'gym']) assert.equal(route[key].notes, '');
});
