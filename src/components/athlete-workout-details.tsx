import { useEffect, useId, useState } from 'react';
import './athlete-workout-details.css';
import { ModalShell } from '@/components/ui';
import { Select } from '@/components/select';
import { loadWorkoutDetails } from '@/lib/athlete-api';
import { type AthleteActivity, type AthleteSettings, formatAthleteDate, formatDistance, formatDuration, formatPace } from '@/lib/athlete';
import { type WorkoutDetails, type WorkoutSample, workoutMetrics } from '@/lib/athlete-workout';

const format = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const recorded = (value: number | undefined, suffix = '') => value === undefined ? '—' : format.format(value) + suffix;

export function WorkoutSummary({ details }: { details: WorkoutDetails }) {
  const metrics = workoutMetrics.flatMap(([key, label, unit]) => {
    const value = details.metrics[key];
    return value == null ? [] : [[label, unit === 's' ? formatDuration(value) : unit === 's/km' ? formatDuration(value) + ' /km' : recorded(value, unit ? ' ' + unit : '')]];
  });
  return <>
    {details.source ? <p className="form-hint">Source · {details.source}</p> : null}
    {metrics.length || details.asymmetry ? <dl className="workout-summary">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      {details.asymmetry ? <div><dt>Asymmetry rating</dt><dd>{details.asymmetry}</dd></div> : null}
    </dl> : null}
    {details.zones?.length ? <section><h3>Heart rate zones</h3>
      {details.zones.map((zone) => <div className="workout-zone" key={zone.zone}><span>Zone {zone.zone} · {zone.minimum}–{zone.maximum} bpm</span><progress value={zone.percent} max={100} aria-label={'Zone ' + zone.zone + ' percentage'} /><span>{zone.seconds === 0 ? '0:00' : formatDuration(zone.seconds)} · {zone.percent}%</span></div>)}
    </section> : null}
    {details.laps?.length ? <section><h3>Laps</h3><div className="workout-table"><table>
      <thead><tr><th>Lap</th><th>Time</th><th>Distance</th><th>Heart rate</th><th>Pace</th></tr></thead>
      <tbody>{details.laps.map((lap) => <tr key={lap.number}><th scope="row">{lap.number}</th><td>{formatDuration(lap.seconds ?? null)}</td><td>{formatDistance(lap.meters ?? null, 'km')}</td><td>{recorded(lap.heartRate, ' bpm')}</td><td>{lap.pace === undefined ? '—' : formatDuration(lap.pace) + ' /km'}</td></tr>)}</tbody>
    </table></div></section> : null}
  </>;
}

export function WorkoutDetailsFields({ details, onChange }: { details: WorkoutDetails; onChange: (details: WorkoutDetails) => void }) {
  return <details className="full-field workout-edit">
    <summary>Advanced metrics and laps</summary>
    <div className="form-grid athlete-form-grid">
      {workoutMetrics.map(([key, label, unit]) => <label key={key}>{label}{unit ? ' (' + unit + ')' : ''}<input type="number" step="any" value={details.metrics[key] ?? ''} onChange={(event) => {
        const metrics = { ...details.metrics };
        if (event.target.value === '') metrics[key] = null;
        else metrics[key] = event.target.valueAsNumber;
        onChange({ ...details, metrics });
      }} /></label>)}
    </div>
    {details.laps?.map((lap, index) => <fieldset key={lap.number}><legend>Lap {lap.number}</legend><div className="form-grid athlete-form-grid">
      {([['seconds', 'Time (seconds)'], ['meters', 'Distance (m)'], ['heartRate', 'Heart rate (bpm)'], ['pace', 'Pace (seconds/km)']] as const).map(([key, label]) =>
        <label key={key}>{label}<input type="number" min="0" step="any" value={lap[key] ?? ''} onChange={(event) => {
          const value = event.target.value === '' ? undefined : event.target.valueAsNumber;
          onChange({ ...details, laps: details.laps?.map((entry, i) => i === index ? { ...entry, [key]: value } : entry) });
        }} /></label>)}
    </div><button className="text-button danger" type="button" onClick={() => onChange({ ...details, laps: details.laps?.filter((entry) => entry.number !== lap.number) })}>Remove lap</button></fieldset>)}
    <button className="text-button" type="button" onClick={() => onChange({ ...details, laps: [...(details.laps ?? []), { number: Math.max(0, ...(details.laps ?? []).map((lap) => lap.number)) + 1 }] })}>Add lap</button>
    {details.zones?.length ? <fieldset><legend>Heart rate zones</legend>
      {details.zones.map((zone, index) => <div className="form-grid athlete-form-grid" key={zone.zone}>
        {([['minimum', 'Min bpm'], ['maximum', 'Max bpm'], ['seconds', 'Seconds'], ['percent', 'Percent']] as const).map(([key, label]) =>
          <label key={key}>Zone {zone.zone} {label}<input type="number" min="0" step="any" max={key === 'percent' ? 100 : undefined} value={zone[key]} onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) onChange({ ...details, zones: details.zones?.map((entry, i) => i === index ? { ...entry, [key]: value } : entry) });
          }} /></label>)}
      </div>)}
    </fieldset> : null}
  </details>;
}

const chartMetrics = [['heartRate', 'Heart rate', 'bpm'], ['cadence', 'Cadence', 'spm'], ['elevation', 'Elevation', 'm'], ['speed', 'Speed', 'km/h']] as const;

function ActivityTrace({ samples, details }: { samples: WorkoutSample[]; details: WorkoutDetails }) {
  const metrics = chartMetrics.filter(([key]) => samples.some((sample) => sample[key] !== undefined));
  const [choice, setChoice] = useState('');
  const [lap, setLap] = useState('');
  const [zoomStart, setZoomStart] = useState('');
  const [zoomEnd, setZoomEnd] = useState('');
  const chartId = useId();
  const [selectedSecond, setSelectedSecond] = useState(0);
  const [preference, setPreference] = useState<'chart' | 'route'>('chart');
  const [metric, label, unit] = metrics.find(([key]) => key === choice) ?? metrics[0] ?? chartMetrics[0];
  const route = details.route?.map((coordinate, index) => ({ ...coordinate, seconds: index })) ?? samples.filter((sample) => sample.latitude !== undefined && sample.longitude !== undefined);
  const chart = samples.filter((sample) => sample[metric] !== undefined);
  const lastSecond = samples[samples.length - 1]?.seconds ?? 0;
  let elapsed = 0;
  const intervals = details.laps?.flatMap((entry) => {
    const seconds = entry.elapsedSeconds ?? entry.seconds;
    if (!seconds) return [];
    const begin = elapsed;
    elapsed += seconds;
    return [{ number: entry.number, begin, end: elapsed }];
  });
  const interval = intervals?.find((entry) => String(entry.number) === lap);
  const firstSecond = interval?.begin ?? 0;
  const finalSecond = interval?.end ?? lastSecond;
  const candidateFrom = zoomStart === '' ? firstSecond : Math.max(firstSecond, Number(zoomStart));
  const candidateEnd = zoomEnd === '' ? finalSecond : Math.min(finalSecond, Number(zoomEnd));
  const zoomInvalid = candidateFrom >= candidateEnd && Boolean(zoomStart || zoomEnd);
  const from = zoomInvalid ? firstSecond : candidateFrom;
  const through = zoomInvalid ? finalSecond : candidateEnd;
  const visible = chart.filter((point) => point.seconds >= from && point.seconds <= through);
  const filteredRoute = details.route ? route : route.filter((point) => point.seconds >= from && point.seconds <= through);
  const focus = visible.reduce<WorkoutSample | undefined>((nearest, sample) => !nearest || Math.abs(sample.seconds - selectedSecond) < Math.abs(nearest.seconds - selectedSecond) ? sample : nearest, undefined);
  const heights = visible.map((sample) => sample[metric]!);
  const min = heights.reduce((current, value) => Math.min(current, value), Infinity);
  const max = heights.reduce((current, value) => Math.max(current, value), -Infinity);
  const x = (seconds: number) => 15 + (seconds - from) / Math.max(1, through - from) * 570;
  const y = (value: number) => 120 - (value - min) / Math.max(1, max - min) * 100;
  const buildPath = (points: WorkoutSample[], project: (point: WorkoutSample) => string) =>
    points.map((point, index) => {
      const previous = points[index - 1];
      return (previous && previous.segment === point.segment && point.seconds - previous.seconds <= 60 ? 'L' : 'M') + project(point);
    }).join(' ');
  const lines = buildPath(visible, (point) => x(point.seconds) + ',' + y(point[metric]!));
  const coordinates = (key: 'latitude' | 'longitude') => filteredRoute.map((point) => point[key]!);
  const lat = coordinates('latitude');
  const lon = coordinates('longitude');
  const latMax = lat.reduce((current, value) => Math.max(current, value), -Infinity);
  const lonMin = lon.reduce((current, value) => Math.min(current, value), Infinity);
  const longitudeScale = Math.cos(latMax * Math.PI / 180);
  const span = Math.max(lon.reduce((current, value) => Math.max(current, value), -Infinity) * longitudeScale - lonMin * longitudeScale, latMax - lat.reduce((current, value) => Math.min(current, value), Infinity), .00001);
  const routePath = buildPath(filteredRoute, (point) => (16 + (point.longitude! - lonMin) * longitudeScale / span * 260) + ',' + (16 + (latMax - point.latitude!) / span * 260));
  const showRoute = route.length > 1 && (preference === 'route' || !metrics.length);

  return <section className="workout-trace">
    <h3>Recorded data</h3>
    <div className="workout-controls">
      {route.length > 1 && metrics.length ? <label>View<Select value={preference} onChange={(event) => setPreference(event.target.value as 'chart' | 'route')}><option value="chart">Chart</option><option value="route">Route</option></Select></label> : null}
      {!showRoute && metrics.length ? <label>Metric<Select value={metric} onChange={(event) => setChoice(event.target.value)}>{metrics.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</Select></label> : null}
      {intervals?.length ? <label>Lap<Select value={lap} onChange={(event) => { setLap(event.target.value); setSelectedSecond(0); setZoomStart(''); setZoomEnd(''); }}><option value="">Whole activity</option>{intervals.map((entry) => <option key={entry.number} value={entry.number}>Lap {entry.number}</option>)}</Select></label> : null}
    </div>
    {!showRoute && finalSecond > firstSecond ? <details className="workout-edit"><summary>Zoom to time range</summary>
      <div className="workout-controls"><label>Start (seconds)<input type="number" min={Math.ceil(firstSecond)} max={Math.floor(finalSecond)} value={zoomStart} onChange={(event) => setZoomStart(event.target.value)} /></label>
        <label>End (seconds)<input type="number" min={Math.ceil(firstSecond)} max={Math.floor(finalSecond)} value={zoomEnd} onChange={(event) => setZoomEnd(event.target.value)} /></label>
        <button className="text-button" type="button" onClick={() => { setZoomStart(''); setZoomEnd(''); }}>Reset zoom</button>
      </div>{zoomInvalid ? <p className="form-hint">Choose a start and end within this activity or lap.</p> : null}
    </details> : null}
    {showRoute && filteredRoute.length > 1 ? <svg className="workout-route" viewBox="0 0 292 292" role="img" aria-label="Workout route"><path d={routePath} /></svg> : null}
    {!showRoute && focus ? <><svg className="workout-chart" viewBox="0 0 600 140" role="img" aria-labelledby={chartId}><title id={chartId}>{label} over recorded time</title><path d={lines} /><circle cx={x(focus.seconds)} cy={y(focus[metric]!)} r={4} /></svg>
      <label>Scrub the chart<input type="range" min={from} max={Math.max(from + 1, through)} step="1" value={Math.max(from, Math.min(through, selectedSecond))} onChange={(event) => setSelectedSecond(event.target.valueAsNumber)} /></label>
      <output>{formatDuration(Math.round(focus.seconds))} · {recorded(focus[metric], ' ' + unit)}</output></> : null}
    {showRoute ? filteredRoute.length < 2 && <p className="form-hint">No route points for this lap.</p> : !focus && <p className="form-hint">No measurements for this selection.</p>}
  </section>;
}

export function WorkoutDetailsModal({ activity, settings, onClose, onEdit }: { activity: AthleteActivity; settings: AthleteSettings; onClose: () => void; onEdit: (details?: WorkoutDetails) => void }) {
  const [loaded, setLoaded] = useState<{ details: WorkoutDetails | null; error?: string }>();
  useEffect(() => {
    let current = true;
    void loadWorkoutDetails(activity.id).then((details) => { if (current) setLoaded({ details }); }, (error: unknown) => {
      if (current) setLoaded({ details: null, error: error instanceof Error ? error.message : 'Could not load the workout details.' });
    });
    return () => { current = false; };
  }, [activity.id]);
  const details = loaded?.details;
  return <ModalShell eyebrow="Athlete Hub" title="Activity details" labelId="athlete-workout-details" onClose={onClose}>
    <div className="modal-form workout-details">
      <p>{formatAthleteDate(activity.activityDate)} · {activity.kind} · {formatDistance(activity.distanceMeters, settings.distanceUnit)} · {formatDuration(activity.durationSeconds)} · {formatPace(activity.distanceMeters, activity.durationSeconds, settings.distanceUnit)}</p>
      {activity.averageHeartRate ? <p>Average heart rate · {activity.averageHeartRate} bpm</p> : null}
      {activity.notes ? <p>{activity.notes}</p> : null}
      {!loaded ? <p role="status">Loading workout details…</p> : null}
      {loaded?.error ? <p className="form-error" role="alert">{loaded.error}</p> : null}
      {details ? <WorkoutSummary details={details} /> : null}
      {details && (details.samples?.length || details.route?.length) ? <ActivityTrace samples={details.samples ?? []} details={details} /> : loaded && !loaded.error ? <p className="form-hint">No timestamped samples are available for this workout.</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="primary-button" type="button" disabled={!loaded || Boolean(loaded.error)} onClick={() => onEdit(details ?? undefined)}>Edit activity</button></div>
    </div>
  </ModalShell>;
}
