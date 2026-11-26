import type { Page, Worker } from 'tesseract.js';
import { samsungLapsFromWords } from './athlete-samsung';
import type { WorkoutLap } from './athlete-workout';

export type ScreenshotReading = {
  text: string;
  layoutText: string;
  confidence: number;
  pass: 'original' | 'enhanced' | 'sparse';
  fields: OcrMetricEvidence[];
  laps?: WorkoutLap[];
};
export type ScreenshotReadResult = {
  fileName: string;
  fingerprint: string;
  readings: ScreenshotReading[];
  error?: string;
  duplicateOf?: string;
};
export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrFragment = { text: string; confidence: number; bbox: OcrBox };
export type OcrMetricEvidence = { label: string; value: string; text: string; confidence: number };

export const screenshotLimits = { files: 16, bytes: 10 * 1024 * 1024, pixels: 24_000_000, side: 10_000 } as const;
const metricLabels = [
  /^(?:total\s+)?distance(?:\s*\((?:km|mi|miles?|meters?|metres?)\))?$/i,
  /^(?:(?:total|moving|elapsed|exercise|workout|running)\s+)?(?:duration|time)$/i,
  /^(?:(?:average|avg\.?)\s+)?pace(?:\s*\((?:min\/km|min\/mi)\))?$/i,
  /^(?:(?:average|avg\.?)\s+)?(?:heart\s*rate|hr)(?:\s*\(bpm\))?$/i,
  /^(?:(?:active|total|exercise)\s+)?(?:calories|energy)(?:\s*\(kcal\))?$/i,
  /^(?:elevation(?:\s+gain)?|elev\.?|total\s+ascent|ascent|gain)(?:\s*\((?:m|ft)\))?$/i,
  /^(?:(?:average|avg\.?)\s+)?cadence(?:\s*\(spm\))?$/i,
  /^(?:recovery(?:\s+score)?|readiness(?:\s+score)?|effort(?:\s+score)?)$/i,
];
const numberValue = /^(?:\d{1,3}(?:[,:.'’′]\d{1,3}){0,3}|\d+(?:[.,]\d+)?)(?:\s*(?:km|mi|miles?|m|ft|meters?|metres?|bpm|kcal|cal|spm|%|h(?:rs?)?|min(?:utes?)?|s(?:ec)?|\/\s*(?:km|mi|100|10)))?(?:\s+\d+\s*(?:min|m|s))?$/i;
const centerX = (box: OcrBox) => (box.x0 + box.x1) / 2;
const centerY = (box: OcrBox) => (box.y0 + box.y1) / 2;
const height = (box: OcrBox) => Math.max(1, box.y1 - box.y0);
const width = (box: OcrBox) => Math.max(1, box.x1 - box.x0);
const clean = (text: string) => text.replace(/\s+/g, ' ').replace(/^[|:;]+|[:;|]+$/g, '').trim();

/** Split a Tesseract line at wide column gaps, instead of flattening a metric grid. */
export function fragmentsFromPage(page: Pick<Page, 'blocks'>): OcrFragment[] {
  const fragments: OcrFragment[] = [];
  for (const block of page.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) {
    if (!line.words?.length) {
      if (clean(line.text)) fragments.push({ text: clean(line.text), confidence: line.confidence, bbox: line.bbox });
      continue;
    }
    let group: typeof line.words = [];
    const flush = () => {
      if (!group.length) return;
      const text = clean(group.map((word) => word.text).join(' '));
      if (text) fragments.push({ text, confidence: Math.min(...group.map((word) => word.confidence)), bbox: {
        x0: Math.min(...group.map((word) => word.bbox.x0)), y0: Math.min(...group.map((word) => word.bbox.y0)),
        x1: Math.max(...group.map((word) => word.bbox.x1)), y1: Math.max(...group.map((word) => word.bbox.y1)),
      } });
      group = [];
    };
    for (const word of [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
      const previous = group[group.length - 1];
      if (previous && word.bbox.x0 - previous.bbox.x1 > Math.max(24, Math.max(height(word.bbox), height(previous.bbox)) * 1.8)) flush();
      group.push(word);
    }
    flush();
  }
  return fragments.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

function proximity(label: OcrFragment, value: OcrFragment): number | null {
  const h = Math.max(height(label.bbox), height(value.bbox));
  const dx = Math.abs(centerX(label.bbox) - centerX(value.bbox));
  const dy = Math.abs(centerY(label.bbox) - centerY(value.bbox));
  const overlap = Math.min(label.bbox.x1, value.bbox.x1) - Math.max(label.bbox.x0, value.bbox.x0);
  const verticalGap = Math.max(0, label.bbox.y0 - value.bbox.y1, value.bbox.y0 - label.bbox.y1);
  if (overlap >= Math.min(width(label.bbox), width(value.bbox)) * .45 && dx <= Math.max(30, width(label.bbox) * .7, width(value.bbox) * .7) && verticalGap <= Math.max(72, h * 2.5)) {
    return verticalGap / h + dx / Math.max(width(label.bbox), width(value.bbox)) + .3;
  }
  const horizontalGap = Math.max(0, label.bbox.x0 - value.bbox.x1, value.bbox.x0 - label.bbox.x1);
  if (dy <= h * .55 && horizontalGap <= Math.max(90, h * 4)) return horizontalGap / h + dy / h + .4;
  return null;
}

/** Only emit a pair when one value is clearly adjacent to its label. Keep ambiguity out. */
export function metricEvidenceFromFragments(input: OcrFragment[]): OcrMetricEvidence[] {
  const fragments = input.filter((part) => part.confidence >= 35 && clean(part.text));
  const candidates: Array<{ label: OcrFragment; value: OcrFragment; score: number }> = [];
  const inline: OcrMetricEvidence[] = [];
  for (const part of fragments) {
    const text = clean(part.text);
    const inlineMatch = text.match(/^(.+?)\s*[:：]?\s+(\d.*)$/);
    if (inlineMatch && metricLabels.some((pattern) => pattern.test(clean(inlineMatch[1]))) && numberValue.test(clean(inlineMatch[2]))) {
      inline.push({ label: clean(inlineMatch[1]), value: clean(inlineMatch[2]), text: `${clean(inlineMatch[1])}: ${clean(inlineMatch[2])}`, confidence: part.confidence });
      continue;
    }
    if (!metricLabels.some((pattern) => pattern.test(text))) continue;
    // A maximum/lowest value cannot silently become an average value when a label wraps.
    const qualifier = fragments.find((other) => other !== part && /^(?:max(?:imum)?|min(?:imum)?|lowest|highest)$/i.test(clean(other.text))
      && other.bbox.y1 <= part.bbox.y0 && part.bbox.y0 - other.bbox.y1 < height(part.bbox) * 1.3
      && Math.abs(centerX(other.bbox) - centerX(part.bbox)) < Math.max(width(part.bbox) / 2, 20));
    if (qualifier) continue;
    const nearby = fragments.flatMap((value) => {
      if (value === part || !numberValue.test(clean(value.text))) return [];
      const score = proximity(part, value);
      return score === null ? [] : [{ label: part, value, score }];
    }).sort((a, b) => a.score - b.score);
    if (!nearby[0] || (nearby[1] && nearby[1].score - nearby[0].score < .45)) continue;
    candidates.push(nearby[0]);
  }
  const used = new Set<OcrFragment>();
  const result = [...inline];
  for (const candidate of candidates.sort((a, b) => a.score - b.score)) {
    if (used.has(candidate.value)) continue;
    // Competing labels equally close to one number are not reliable evidence.
    if (candidates.some((other) => other !== candidate && other.value === candidate.value && Math.abs(other.score - candidate.score) < .45)) continue;
    used.add(candidate.value);
    const label = clean(candidate.label.text);
    let value = clean(candidate.value.text);
    const explicitUnit = label.match(/\((km|mi|miles?|meters?|metres?|m|ft|bpm|kcal|spm)\)/i)?.[1];
    if (explicitUnit && /^\d+(?:[.,]\d+)?$/.test(value)) value += ` ${explicitUnit}`;
    result.push({ label, value, text: `${label}: ${value}`, confidence: Math.min(candidate.label.confidence, candidate.value.confidence) });
  }
  return result;
}

function aborted(): DOMException { return new DOMException('Screenshot reading cancelled.', 'AbortError'); }
function ensureActive(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }

function bounded<T>(operation: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => finish(() => reject(aborted()));
    const timer = setTimeout(() => finish(() => reject(new Error('The image reader took too long. Try a smaller crop of the metrics.'))), milliseconds);
    const finish = (complete: () => void) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); complete(); };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    operation.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}

/** Inspect common screenshot headers before decoding an unusually large image. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      offset += length + 2;
    }
  }
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const chunk = view.getUint32(12);
    if (chunk === 0x56503858) return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (chunk === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 0x5650384c && bytes[20] === 0x2f) return { width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)), height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0xf) << 10)) };
  }
  return null;
}

export function checkDimensions(size: { width: number; height: number }) {
  if (size.width < 20 || size.height < 20) throw new Error('This image is too small to read. Choose the original screenshot.');
  if (Math.max(size.width, size.height) > screenshotLimits.side || size.width * size.height > screenshotLimits.pixels) throw new Error('This image is too large to process safely. Crop it to the activity metrics first.');
}

async function prepareImage(file: File, signal?: AbortSignal): Promise<{ original: HTMLCanvasElement; enhanced: HTMLCanvasElement }> {
  const decoding = createImageBitmap(file);
  let abandoned = false;
  decoding.then((bitmap) => { if (abandoned || signal?.aborted) bitmap.close(); }).catch(() => undefined);
  let image: ImageBitmap;
  try { image = await bounded(decoding, 20_000, signal); }
  catch (error) { abandoned = true; throw error; }
  try {
    ensureActive(signal);
    checkDimensions(image);
    const makeCanvas = (scale: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Your browser could not prepare this screenshot. Try another browser.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { canvas, context };
    };
    const maxScale = Math.min(3200 / Math.max(image.width, image.height), Math.sqrt(5_000_000 / (image.width * image.height)));
    const original = makeCanvas(Math.min(1, maxScale)).canvas;
    const { canvas: enhanced, context } = makeCanvas(Math.min(2, maxScale));
    const pixels = context.getImageData(0, 0, enhanced.width, enhanced.height);
    let darkSamples = 0;
    let samples = 0;
    for (let index = 0; index < pixels.data.length; index += 4 * 47) {
      const light = .299 * pixels.data[index] + .587 * pixels.data[index + 1] + .114 * pixels.data[index + 2];
      if (light < 100) darkSamples++;
      samples++;
    }
    const invert = darkSamples / samples > .6;
    for (let index = 0; index < pixels.data.length; index += 4) {
      let light = .299 * pixels.data[index] + .587 * pixels.data[index + 1] + .114 * pixels.data[index + 2];
      if (invert) light = 255 - light;
      light = Math.max(0, Math.min(255, (light - 128) * 1.3 + 128));
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = light;
    }
    context.putImageData(pixels, 0, 0);
    return { original, enhanced };
  } finally { image.close(); }
}

export async function readAthleteScreenshots(files: File[], options: { onProgress?: (message: string) => void; signal?: AbortSignal } = {}): Promise<ScreenshotReadResult[]> {
  const { signal, onProgress } = options;
  ensureActive(signal);
  if (files.length > screenshotLimits.files) throw new Error(`Choose up to ${screenshotLimits.files} screenshots at a time.`);
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  let worker: Worker | null = null;
  let contextLabel = 'Preparing the local screenshot reader';
  const stopWorker = async () => { const current = worker; worker = null; if (current) await current.terminate().catch(() => undefined); };
  const cancel = () => { void stopWorker(); };
  signal?.addEventListener('abort', cancel, { once: true });
  const fingerprints = new Map<string, string>();
  const results: ScreenshotReadResult[] = [];
  const getWorker = async () => {
    if (worker) return worker;
    const assetRoot = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}athlete-ocr/`;
    const creation = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${assetRoot}worker.min.js`, corePath: `${assetRoot}tesseract-core-lstm.wasm.js`, langPath: assetRoot, workerBlobURL: false,
      logger: (message) => { if (!signal?.aborted) onProgress?.(`${contextLabel} · ${message.status}${message.progress > 0 ? ` ${Math.round(message.progress * 100)}%` : ''}`); },
    });
    let abandoned = false;
    creation.then((created) => { if (abandoned || signal?.aborted) void created.terminate().catch(() => undefined); }).catch(() => undefined);
    try { worker = await bounded(creation, 60_000, signal); } catch (error) { abandoned = true; throw error; }
    return worker;
  };
  try {
    for (let index = 0; index < files.length; index++) {
      ensureActive(signal);
      const file = files[index];
      const result: ScreenshotReadResult = { fileName: file.name, fingerprint: '', readings: [] };
      results.push(result);
      let images: Awaited<ReturnType<typeof prepareImage>> | undefined;
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > screenshotLimits.bytes) throw new Error('Choose a PNG, JPG or WebP screenshot under 10 MB.');
        const buffer = await file.arrayBuffer();
        const size = imageDimensions(new Uint8Array(buffer));
        if (size) checkDimensions(size);
        else throw new Error('This file does not contain a supported screenshot. Export it as PNG or JPG.');
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        result.fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const duplicate = fingerprints.get(result.fingerprint);
        if (duplicate) { result.duplicateOf = duplicate; continue; }
        fingerprints.set(result.fingerprint, file.name);
        contextLabel = `Screenshot ${index + 1} of ${files.length}`;
        onProgress?.(`${contextLabel} · preparing image`);
        images = await prepareImage(file, signal);
        const current = await getWorker();
        const passes = [
          { name: 'original' as const, canvas: images.original, psm: PSM.AUTO },
          { name: 'enhanced' as const, canvas: images.enhanced, psm: PSM.AUTO },
          { name: 'sparse' as const, canvas: images.enhanced, psm: PSM.SPARSE_TEXT },
        ];
        for (const pass of passes) {
          ensureActive(signal);
          contextLabel = `Screenshot ${index + 1} of ${files.length} · ${pass.name}`;
          await bounded(current.setParameters({ tessedit_pageseg_mode: pass.psm, preserve_interword_spaces: '1', user_defined_dpi: '300' }), 10_000, signal);
          const { data } = await bounded(current.recognize(pass.canvas, { rotateAuto: true }, { text: true, blocks: true }), 60_000, signal);
          const fields = metricEvidenceFromFragments(fragmentsFromPage(data));
          if (data.text.trim() || fields.length) result.readings.push({ text: data.text.trim(), layoutText: fields.map((field) => field.text).join('\n'), confidence: data.confidence, fields, pass: pass.name, laps: samsungLapsFromWords((data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)))) });
        }
        if (!result.readings.length) result.error = 'No readable text was found. Try a closer, clearer crop of the metrics.';
      } catch (error) {
        ensureActive(signal);
        result.error = error instanceof Error ? error.message : 'This screenshot could not be read. Try another image.';
        await stopWorker();
      } finally {
        if (images) { images.original.width = images.original.height = 0; images.enhanced.width = images.enhanced.height = 0; }
      }
    }
    return results;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await stopWorker();
  }
}
