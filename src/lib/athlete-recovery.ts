import type { RecoveryMetrics } from './athlete';
import { recognitionReferenceDate, recognizeScreenshot, type ScreenshotReading } from './athlete-recognition';
import { routeVoiceAthleteRecord, type DistanceUnit } from './athlete';

export const recoveryFields = [
  ['hrv', 'HRV (ms)', 1, 500], ['restingHeartRate', 'Resting heart rate (bpm)', 20, 260],
  ['sleepMinutes', 'Sleep duration (minutes)', 0, 1440], ['sleepPerformance', 'Sleep performance (%)', 0, 100],
  ['respiratoryRate', 'Respiratory rate (breaths/min)', 1, 100], ['strain', 'Previous-day strain', 0, 21],
  ['energy', 'Energy', 1, 10], ['fatigue', 'Fatigue', 1, 10], ['soreness', 'Muscle soreness', 1, 10],
  ['sleepQuality', 'Sleep quality', 1, 10], ['mood', 'Mood', 1, 10], ['wellness', 'General wellness', 1, 10], ['discomfort', 'Discomfort', 1, 10],
] as const;

export function whoopTone(score: number) {
  return score >= 67 ? 'good' : score >= 34 ? 'mid' : 'low';
}

export function recognizeWhoopRecovery(readings: ScreenshotReading[], unit: DistanceUnit, timezone: string) {
  const evidence = readings.filter((reading) => reading.confidence >= 45).map((reading) => reading.text);
  const combined = evidence.join('\n');
  if (!/\b(?:whoop|HRV|heart rate variability)\b/i.test(combined) || !/\brecovery\b/i.test(combined)) return null;
  const recovered = recognizeScreenshot(readings, unit, recognitionReferenceDate(timezone));
  const route = recovered ?? routeVoiceAthleteRecord('', unit, recognitionReferenceDate(timezone), { source: 'image' });
  const warnings: string[] = [];
  const read = (label: string, regex: RegExp, minimum: number, maximum: number, convert: (value: string) => number = Number) => {
    const values = [...new Set(evidence.flatMap((text) => [...text.matchAll(regex)]).map((match) => convert(match[1] ?? match[2])).filter((value) => value >= minimum && value <= maximum))];
    if (values.length > 1) warnings.push(label + ' differs across readings. Enter it from the screenshot.');
    return values.length === 1 ? values[0] : undefined;
  };
  const score = read('Recovery score', /\bRecovery\s*[:\n ]*\s*(\d{1,3})\s*%|(\d{1,3})\s*%\s*\n\s*Recovery\b/gi, 0, 100);
  const metrics: RecoveryMetrics = {
    hrv: read('HRV', /(?:HRV|heart rate variability)[ \t:\n]*(\d{1,3})\s*(?:ms\b)?/gi, 1, 500),
    restingHeartRate: read('Resting heart rate', /(?:RHR|resting heart rate)[ \t:\n]*(\d{2,3})\s*(?:bpm\b)?/gi, 20, 260),
    sleepPerformance: read('Sleep performance', /Sleep performance[ \t:\n]*(\d{1,3})\s*%/gi, 0, 100),
    sleepMinutes: read('Sleep duration', /(?:Sleep duration|Hours of sleep)[ \t:\n]*(\d{1,2}:\d{2})/gi, 0, 1440, (text) => {
      const [hours, minutes] = text.split(':').map(Number);
      return minutes < 60 ? hours * 60 + minutes : NaN;
    }),
    respiratoryRate: read('Respiratory rate', /Respiratory rate[ \t:\n]*(\d{1,2}(?:\.\d+)?)/gi, 1, 100),
    strain: read('Previous-day strain', /(?:yesterday['’]s strain|previous.day strain)[ \t:\n]*(\d{1,2}(?:\.\d+)?)/gi, 0, 21),
  };
  if (score === undefined && !Object.values(metrics).some((value) => value !== undefined) && !warnings.length) return null;
  route.destination = 'recovery';
  route.recovery = { recoveryDate: recovered?.date ?? '', score, source: 'whoop', metrics, notes: '' };
  route.warnings = warnings;
  return route;
}
