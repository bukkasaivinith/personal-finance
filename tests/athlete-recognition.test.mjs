import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/lib/athlete-recognition.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { recognizeScreenshot, recognitionReferenceDate, similarActivity, missingRecognitionFields } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const reference = new Date(2026, 10, 16, 12);
const reading = (text, extras = {}) => ({ text, layoutText: '', confidence: 90, pass: 'original', ...extras });

test('unrelated text and phone status clocks do not become activity drafts', () => {
  assert.equal(recognizeScreenshot([reading('12:32\nSettings\nWi-Fi\nBattery 80%')], 'km', reference), null);
});
test('conflicting OCR amounts stay empty and request review', () => {
  const route = recognizeScreenshot([reading('Run\nDistance: 5 km\nDuration: 30:00'), reading('Run\nDistance: 8 km\nDuration: 30:00')], 'km', reference);
  assert.equal(route.activity.distanceMeters, null);
  assert.equal(route.activity.durationSeconds, 1800);
  assert(route.warnings.some((warning) => warning.includes('Distance differs')));
});
test('layout evidence repairs flattened metric columns', () => {
  const route = recognizeScreenshot([reading('Run\nDistance Duration\n5.00 km 00:30:00\nAverage HR Calories\n148 320', { layoutText: 'Distance: 5.00 km\nDuration: 00:30:00\nAverage heart rate: 148 bpm\nCalories: 320' })], 'mi', reference);
  assert.equal(route.activity.distanceMeters, 5000);
  assert.equal(route.activity.durationSeconds, 1800);
  assert.equal(route.activity.averageHeartRate, 148);
  assert.equal(route.activity.calories, 320);
});
test('image without a date leaves every draft date empty, never today', () => {
  const route = recognizeScreenshot([reading('Run\nDistance: 5 km\nDuration: 30:00')], 'km', reference);
  assert.equal(route.date, '');
  assert.equal(route.activity.activityDate, '');
  assert.equal(route.plan.workoutDate, '');
  assert(missingRecognitionFields(route).includes('What date is this for?'));
});

test('spatial evidence clears a resolved flattened-text warning', () => {
  const route = recognizeScreenshot([reading('Distance: 5 km Distance: 8 km\nDuration: 30:00', { layoutText: 'Distance: 5 km\nDuration: 30:00' })], 'km', reference);
  assert.equal(route.activity.distanceMeters, 5000);
  assert(!route.warnings.some((warning) => warning.startsWith('Distance was unclear')));
});
test('raw OCR is not copied into any saved notes', () => {
  const route = recognizeScreenshot([reading('Run\nDistance: 5 km\nDuration: 30:00\nSamsung Health')], 'km', reference);
  assert(route.transcript.includes('Samsung Health'));
  for (const type of ['activity', 'plan', 'recovery', 'race', 'gym']) assert.equal(route[type].notes, '');
});
test('conflicting dates require user selection', () => {
  const route = recognizeScreenshot([reading('Run 2026-11-10\nDistance: 5 km'), reading('Run 2026-11-11\nDistance: 5 km')], 'km', reference);
  assert.equal(route.date, '');
  assert(route.warnings.some((warning) => warning.includes('conflicting dates')));
});
test('low-confidence noise does not override a confident pass', () => {
  const route = recognizeScreenshot([reading('Run\nDistance: 5 km'), reading('Run\nDistance: 8 km', {confidence:20})], 'km', reference);
  assert.equal(route.activity.distanceMeters, 5000);
});
test('possible duplicates require all key fields, not just a matching amount', () => {
  const route = recognizeScreenshot([reading('Run 2026-11-10\nDistance: 5 km\nDuration: 30:00')], 'km', reference);
  const activity = {id:'run-one',kind:'run',activityDate:'2026-11-10',distanceMeters:5000,durationSeconds:1800};
  assert.equal(similarActivity(route,[activity])?.id,'run-one');
  assert.equal(similarActivity(route,[{...activity,activityDate:'2026-11-11'}]),undefined);
  assert.equal(similarActivity({...route,activity:{...route.activity,durationSeconds:null}},[activity]),undefined);
});
test('relative dates use the athlete timezone across UTC midnight', () => {
  const date = recognitionReferenceDate('Asia/Kolkata',new Date('2026-11-15T20:00:00Z'));
  assert.equal(date.getDate(),16);
  assert.equal(date.getMonth(),10);
});
