import type { AthleteActivityDraft } from './athlete';
import { isWorkoutCoordinate, workoutDistanceBetween, type WorkoutDetails, type WorkoutLap, type WorkoutSample } from './athlete-workout';

type Point = Omit<WorkoutSample, 'seconds'> & { time: number | null; distance?: number };

const maxBytes = 10 * 1024 * 1024;
const maxPoints = 40_000;
const children = (node: Element | Document, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
const first = (node: Element | Document, name: string) => node.getElementsByTagNameNS('*', name)[0];
const value = (node: Element | Document, name: string) => first(node, name)?.textContent?.trim();
function number(input: string | null | undefined, minimum: number, maximum: number) {
  if (!input?.trim()) return undefined;
  const parsed = Number(input);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}
function time(input: string | undefined) {
  if (!input || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(input)) return null;
  const result = Date.parse(input);
  return Number.isFinite(result) ? result : null;
}
function parsePoint(element: Element, gpx: boolean, segment: number): Point {
  return {
    time: time(value(element, gpx ? 'time' : 'Time')),
    latitude: number(gpx ? element.getAttribute('lat') : value(element, 'LatitudeDegrees'), -90, 90),
    longitude: number(gpx ? element.getAttribute('lon') : value(element, 'LongitudeDegrees'), -180, 180),
    elevation: number(value(element, gpx ? 'ele' : 'AltitudeMeters'), -12000, 12000),
    heartRate: number(value(element, 'hr') ?? value(element, 'HeartRateBpm') ?? value(element, 'heartRate'), 20, 260),
    cadence: number(value(element, 'cad') ?? value(element, 'RunCadence') ?? value(element, 'Cadence') ?? value(element, 'cadence'), 1, 400),
    speed: number(value(element, 'speed') ?? value(element, 'Speed'), 0, 100),
    distance: number(value(element, 'DistanceMeters'), 0, 5_000_000),
    segment,
  };
}
function dateInTimezone(stamp: number, timezone: string) {
  const pieces = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(stamp);
  return ['year', 'month', 'day'].map((name) => pieces.find((piece) => piece.type === name)?.value).join('-');
}

export function parseWorkoutXml(xml: string, extension: 'gpx' | 'gtx' | 'tcx', timezone: string): { draft: Partial<AthleteActivityDraft>; details: WorkoutDetails } {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Workout XML with external definitions is unsupported.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const rootName = document.documentElement.localName;
  const gpx = rootName === 'gpx' && extension !== 'tcx';
  const tcx = rootName === 'TrainingCenterDatabase' && extension !== 'gpx';
  if (first(document, 'parsererror') || (!gpx && !tcx)) {
    const expected = extension === 'gtx' ? 'GPX or TCX' : extension.toUpperCase();
    throw new Error('The file does not contain valid ' + expected + ' workout data.');
  }
  const roots = gpx ? children(document, 'trk') : children(document, 'Activity');
  if (roots.length !== 1) throw new Error('Choose a file containing exactly one workout.');
  const root = roots[0];
  const tracks = children(root, gpx ? 'trkseg' : 'Track');
  const points: Point[] = [];
  for (const [segment, track] of tracks.entries()) {
    for (const node of children(track, gpx ? 'trkpt' : 'Trackpoint')) {
      if (points.length >= maxPoints) throw new Error('Choose a file with at most 40,000 workout points.');
      points.push(parsePoint(node, gpx, segment));
    }
  }
  const laps: WorkoutLap[] = gpx ? [] : children(root, 'Lap').map((entry, index) => ({
    number: index + 1, seconds: number(value(entry, 'TotalTimeSeconds'), 0.01, 172800),
    meters: number(value(entry, 'DistanceMeters'), 0, 500000),
    heartRate: number(first(entry, 'AverageHeartRateBpm')?.textContent, 20, 260),
  }));
  if (!points.length && !laps.length) throw new Error('The file does not contain a route, samples or lap summaries.');
  const start = points.find((point) => point.time !== null)?.time ?? time(value(root, 'Id'));
  const end = [...points].reverse().find((point) => point.time !== null)?.time;
  const timed = start === null ? [] : points.filter((point) => point.time !== null && point.time >= start);
  const ordered = timed.every((point, index) => !index || point.time! >= timed[index - 1].time!);
  if (!ordered) throw new Error('Workout timestamps are out of order.');
  const samples: WorkoutSample[] = timed.map((point) => ({
    seconds: (point.time! - start!) / 1000, speed: point.speed === undefined ? undefined : point.speed * 3.6,
    heartRate: point.heartRate, cadence: point.cadence, elevation: point.elevation, latitude: point.latitude, longitude: point.longitude, segment: point.segment,
  }));
  const elapsedSeconds = start !== null && end != null ? Math.round((end - start) / 1000) : 0;
  const sumOfLaps = (field: 'seconds' | 'meters') => laps.length && laps.every((lap) => lap[field] !== undefined)
    ? laps.reduce((sum, lap) => sum + lap[field]!, 0) : undefined;
  const positioned = points.filter(isWorkoutCoordinate);
  // An untimed route is drawable, but it must never be plotted as a time series.
  const route = samples.length !== points.length && positioned.length > 1
    ? positioned.map(({ latitude, longitude, segment }) => ({ latitude, longitude, segment })) : undefined;
  const routeDistance = positioned.reduce((sum, point, index) => {
    const previous = positioned[index - 1];
    return previous && previous.segment === point.segment ? sum + workoutDistanceBetween(previous, point) : sum;
  }, 0);
  const lastDistance = [...points].reverse().find((point) => point.distance !== undefined)?.distance;
  const sport = (root.getAttribute('Sport') ?? value(root, 'type') ?? '').toLowerCase();
  return {
    draft: {
      kind: /cycl|bik/.test(sport) ? 'cycle' : /walk|hik/.test(sport) ? 'walk' : /treadmill/.test(sport) ? 'treadmill' : 'run',
      ...(start !== null ? { activityDate: dateInTimezone(start, timezone) } : {}),
      durationSeconds: Math.round(sumOfLaps('seconds') ?? elapsedSeconds) || null,
      distanceMeters: Number((sumOfLaps('meters') ?? lastDistance ?? routeDistance).toFixed(2)) || null,
    },
    details: { metrics: elapsedSeconds > 0 ? { elapsedSeconds } : {}, source: gpx ? 'GPX' : 'TCX', ...(samples.length ? { samples } : {}), ...(route ? { route } : {}), ...(laps.length ? { laps } : {}) },
  };
}

export async function readWorkoutFile(file: File, timezone: string) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'gpx' && extension !== 'gtx' && extension !== 'tcx' && extension !== 'fit') throw new Error('Choose a GPX, TCX or FIT file.');
  if (!file.size || file.size > maxBytes) throw new Error('Choose a workout file under 10 MB.');
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = Array.from(new Uint8Array(hash), (part) => part.toString(16).padStart(2, '0')).join('');
  const record = extension === 'fit'
    ? (await import('./athlete-fit')).parseFitWorkout(bytes, timezone)
    : parseWorkoutXml(new TextDecoder('utf-8', { fatal: true }).decode(bytes), extension, timezone);
  return { ...record, details: { ...record.details, fingerprints: [fingerprint] } };
}
