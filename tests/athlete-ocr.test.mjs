import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/lib/athlete-ocr.ts'], bundle: true, write: false, format: 'esm', platform: 'node', external: ['tesseract.js'] });
const { fragmentsFromPage, metricEvidenceFromFragments, imageDimensions, readAthleteScreenshots, screenshotLimits } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const fragment = (text, x, y, w = 100, h = 20, confidence = 95) => ({ text, confidence, bbox: { x0: x, y0: y, x1: x + w, y1: y + h } });
const values = (fragments) => Object.fromEntries(metricEvidenceFromFragments(fragments).map((entry) => [entry.label, entry.value]));

test('wide gaps divide two-column OCR lines without splitting natural label spaces', () => {
  const words = [fragment('Average', 20, 100, 60), fragment('heart', 86, 100, 40), fragment('rate', 132, 100, 32), fragment('Calories', 310, 100, 70)];
  const parts = fragmentsFromPage({ blocks: [{ paragraphs: [{ lines: [{ words, text: 'Average heart rate Calories', confidence: 95, bbox: { x0: 20, y0: 100, x1: 380, y1: 120 } }] }] }] });
  assert.deepEqual(parts.map((part) => part.text), ['Average heart rate', 'Calories']);
});

test('pairs two-column cards with numbers above their labels', () => {
  const parts = [
    fragment('5.00 km', 40, 80), fragment('00:30:00', 300, 80),
    fragment('Distance', 40, 116), fragment('Duration', 300, 116),
    fragment('148 bpm', 40, 200), fragment('320 kcal', 300, 200),
    fragment('Average heart rate', 40, 236, 150), fragment('Calories', 300, 236),
  ];
  assert.deepEqual(values(parts), { Distance: '5.00 km', Duration: '00:30:00', 'Average heart rate': '148 bpm', Calories: '320 kcal' });
});

test('pairs metric labels above the matching values', () => {
  assert.deepEqual(values([fragment('Distance', 40, 100), fragment('5.00 km', 40, 135)]), { Distance: '5.00 km' });
});

test('reads a compact horizontal label/value row', () => {
  assert.deepEqual(values([fragment('Calories', 30, 100, 70), fragment('450 kcal', 125, 100, 70)]), { Calories: '450 kcal' });
});

test('preserves an explicit unit displayed in a label', () => {
  assert.deepEqual(values([fragment('Distance (mi)', 30, 100, 110), fragment('3.1', 40, 133, 60)]), { 'Distance (mi)': '3.1 mi' });
});

test('does not invent a unit absent from screenshot evidence', () => {
  assert.deepEqual(values([fragment('Distance', 30, 100), fragment('5.00', 30, 135)]), { Distance: '5.00' });
});

test('keeps inline metric labels and values together', () => {
  assert.deepEqual(values([fragment('Average heart rate: 148 bpm', 30, 100, 230)]), { 'Average heart rate': '148 bpm' });
});

test('does not choose between equally close values', () => {
  const entries = [fragment('148 bpm', 30, 70), fragment('Heart rate', 30, 100), fragment('160 bpm', 30, 130)];
  assert.deepEqual(metricEvidenceFromFragments(entries), []);
});

test('does not relabel a wrapped maximum heart rate as the average', () => {
  assert.deepEqual(metricEvidenceFromFragments([fragment('Maximum', 30, 80), fragment('Heart rate', 30, 105), fragment('185 bpm', 30, 140)]), []);
});

test('ignores low-confidence values and unrelated status-bar numbers', () => {
  assert.deepEqual(metricEvidenceFromFragments([fragment('12:32', 0, 0), fragment('Distance', 30, 100), fragment('8.99 km', 30, 135, 100, 20, 15)]), []);
});

test('a distant neighboring calories card is not reused for missing heart rate', () => {
  assert.deepEqual(values([fragment('Average heart rate', 30, 100, 150), fragment('Calories', 320, 100), fragment('320 kcal', 320, 135)]), { Calories: '320 kcal' });
});

test('competing labels cannot both claim the same number', () => {
  assert.deepEqual(metricEvidenceFromFragments([fragment('Distance', 30, 70), fragment('5.00', 30, 100), fragment('Calories', 30, 130)]), []);
});

test('reads PNG dimensions before image decode', () => {
  const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(16, 1080); view.setUint32(20, 2400);
  assert.deepEqual(imageDimensions(bytes), { width: 1080, height: 2400 });
});

test('reads JPEG dimensions before image decode', () => {
  const bytes = new Uint8Array(22); const view = new DataView(bytes.buffer);
  bytes.set([255, 216, 255, 192, 0, 17, 8]); view.setUint16(7, 2400); view.setUint16(9, 1080);
  assert.deepEqual(imageDimensions(bytes), { width: 1080, height: 2400 });
});

test('reads WebP extended dimensions before image decode', () => {
  const bytes = new Uint8Array(30); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x52494646); view.setUint32(8, 0x57454250); view.setUint32(12, 0x56503858);
  bytes[24] = 1079 & 255; bytes[25] = 1079 >> 8; bytes[27] = 2399 & 255; bytes[28] = 2399 >> 8;
  assert.deepEqual(imageDimensions(bytes), { width: 1080, height: 2400 });
});

test('unknown image headers and truncated files are rejected', () => {
  assert.equal(imageDimensions(new Uint8Array(8)), null);
  assert.equal(imageDimensions(new TextEncoder().encode('this is text, not a screenshot')), null);
});

test('too many uploads are rejected before loading OCR worker', async () => {
  await assert.rejects(readAthleteScreenshots(Array.from({ length: screenshotLimits.files + 1 }, () => ({}))), /up to 16/);
});

test('already-cancelled recognition does not initialize a worker', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readAthleteScreenshots([], { signal: controller.signal }), { name: 'AbortError' });
});
