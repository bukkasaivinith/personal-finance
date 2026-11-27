import { useId, useMemo, useState } from 'react';
import { Select } from '@/components/select';
import { distanceFromMeters, formatDistance, type DistanceUnit } from '@/lib/athlete';
import { isWorkoutCoordinate, workoutChartSamples, type WorkoutDetails } from '@/lib/athlete-workout';

const chartMetrics = [['heartRate', 'Heart rate', 'bpm', 5], ['cadence', 'Cadence', 'spm', 5],
  ['pace', 'Pace', '', 30], ['speed', 'Speed', '', 1], ['elevation', 'Elevation', 'm', 5]] as const;
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const ticks = [0, 0.25, 0.5, 0.75, 1];

function elapsedTime(seconds: number) {
  const value = Math.round(seconds);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, '0')}`;
}

type ChartSample = ReturnType<typeof workoutChartSamples>[number];

function WorkoutTimeline({ details, samples, distanceUnit }: { details: WorkoutDetails; samples: ChartSample[]; distanceUnit: DistanceUnit }) {
  const metrics = useMemo(() => chartMetrics.filter(([key]) => samples.some((sample) => Number.isFinite(sample[key]))), [samples]);
  const [choice, setChoice] = useState('');
  const [lap, setLap] = useState('');
  const [zoomFrom, setZoomFrom] = useState('');
  const [zoomTo, setZoomTo] = useState('');
  const [selectedSecond, setSelectedSecond] = useState(0);
  const chartId = useId();
  const [metric, label, defaultUnit, minimumStep] = metrics.find(([key]) => key === choice) ?? metrics[0] ?? chartMetrics[0];
  const unit = metric === 'pace' ? `min/${distanceUnit}` : metric === 'speed' ? `${distanceUnit}/h` : defaultUnit;
  const distanceFactor = distanceFromMeters(1000, distanceUnit)!;
  const formatValue = (value: number) => metric === 'pace' ? elapsedTime(value / distanceFactor)
    : number.format(metric === 'speed' ? value * distanceFactor : value);
  const hasHeartRate = metrics.some(([key]) => key === 'heartRate');
  const last = samples[samples.length - 1]?.seconds ?? 0;
  let elapsed = 0;
  const laps = [];
  for (const entry of details.laps ?? []) {
    const length = entry.elapsedSeconds ?? entry.seconds;
    if (!length || length < 0 || !Number.isFinite(length)) break;
    laps.push({ number: entry.number, from: elapsed, to: elapsed + length });
    elapsed += length;
  }
  const interval = laps.find(({ number }) => String(number) === lap);
  const start = interval?.from ?? 0;
  const end = interval?.to ?? last;
  const requestedFrom = zoomFrom === '' ? start : Math.max(start, Number(zoomFrom));
  const requestedTo = zoomTo === '' ? end : Math.min(end, Number(zoomTo));
  const invalid = (zoomFrom !== '' || zoomTo !== '') && requestedFrom >= requestedTo;
  const from = invalid ? start : requestedFrom;
  const to = invalid ? end : requestedTo;
  const visible = useMemo(() => samples.filter((sample) =>
    sample.seconds >= from && sample.seconds <= to && Number.isFinite(sample[metric])), [samples, metric, from, to]);
  const focus = visible.reduce<ChartSample | undefined>((nearest, sample) =>
    !nearest || Math.abs(sample.seconds - selectedSecond) < Math.abs(nearest.seconds - selectedSecond) ? sample : nearest, undefined);

  const left = 50, top = 15, width = 557, height = 170, right = left + width, bottom = top + height;
  const rawMin = visible.reduce((min, point) => Math.min(min, point[metric]!), Infinity);
  const rawMax = visible.reduce((max, point) => Math.max(max, point[metric]!), -Infinity);
  const step = Math.max(minimumStep, Math.ceil((rawMax - rawMin) / (minimumStep * 16)) * minimumStep);
  const lowerBound = Math.floor((rawMin - step) / step) * step;
  const minimum = metric === 'elevation' ? lowerBound : Math.max(0, lowerBound);
  const maximum = Math.ceil((rawMax + step) / step) * step;
  const duration = Math.max(1, to - from);
  const x = (second: number) => left + (second - from) / duration * width;
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * height;
  const path = useMemo(() => visible.map((point, index) => {
    const previous = visible[index - 1];
    const join = previous && previous.segment === point.segment && point.seconds - previous.seconds <= 60;
    return (join ? 'L' : 'M') + (left + (point.seconds - from) / duration * width).toFixed(2) + ','
      + (bottom - (point[metric]! - minimum) / (maximum - minimum) * height).toFixed(2);
  }).join(' '), [visible, metric, from, duration, minimum, maximum, bottom]);

  return <section className="surface-card activity-detail-section activity-timeline" aria-labelledby={chartId}>
    <div className="card-title-row">
      <div><h3 id={chartId}>Workout charts</h3>{metrics.length ? <p>{label} ({unit}) over elapsed time</p> : null}</div>
    </div>
    {metrics.length > 1 ? <div className="activity-metric-picker" role="group" aria-label="Chart metric">
      {metrics.map(([key, name]) => <button className="secondary-button" type="button" key={key} aria-pressed={key === metric}
        onClick={() => setChoice(key)}>{name}</button>)}
    </div> : null}
    {!metrics.length ? <p className="card-note">The charts need timed GPS points or timestamped measurements. Recorded averages and heart-rate zones appear in the workout details.</p> : <>
      {laps.length ? <div className="workout-controls"><label>Time range
        <Select aria-label="Timeline lap" value={lap} onChange={(event) => { setLap(event.target.value); setSelectedSecond(0); setZoomFrom(''); setZoomTo(''); }}>
          <option value="">Whole activity</option>{laps.map((entry) => <option key={entry.number} value={entry.number}>Lap {entry.number}</option>)}
        </Select></label></div> : null}
      {focus ? <>
        <svg className="activity-chart" viewBox="0 0 625 224" role="img" aria-label={`${label} chart in ${unit}`}
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const position = (event.clientX - bounds.left) * 625 / bounds.width;
            setSelectedSecond(from + Math.max(0, Math.min(1, (position - left) / width)) * duration);
          }}>
          {metric === 'heartRate' ? details.zones?.map((zone) => {
            const minimumBpm = Math.max(minimum, zone.minimum);
            const maximumBpm = Math.min(maximum, zone.maximum);
            return maximumBpm > minimumBpm ? <rect className={`activity-chart-zone zone-${zone.zone}`} key={zone.zone}
              x={left} y={y(maximumBpm)} width={width} height={y(minimumBpm) - y(maximumBpm)} /> : null;
          }) : null}
          {ticks.map((fraction) => <g key={fraction}>
            <line className="activity-chart-gridline" x1={left} y1={bottom - fraction * height} x2={right} y2={bottom - fraction * height} />
            <text className="activity-chart-axis" textAnchor="end" x={left - 7} y={bottom - fraction * height + 4}>{formatValue(minimum + fraction * (maximum - minimum))}</text>
            <text className="activity-chart-axis" textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
              x={left + fraction * width} y={bottom + 22}>{elapsedTime(from + fraction * (to - from))}</text>
          </g>)}
          <line className="activity-chart-cursor" x1={x(focus.seconds)} y1={top} x2={x(focus.seconds)} y2={bottom} />
          <path className="activity-chart-line" d={path} />
          <circle className="activity-chart-point" cx={x(focus.seconds)} cy={y(focus[metric]!)} r={4} />
        </svg>
        <div className="activity-chart-readout">
          <label>Elapsed time
            <input type="range" min={from} max={Math.max(from + 1, to)} step="any" value={Math.max(from, Math.min(to, selectedSecond))}
              onChange={(event) => setSelectedSecond(event.target.valueAsNumber)} aria-label="Explore workout timeline" />
          </label>
          <output><span>{elapsedTime(focus.seconds)}</span><strong>{formatValue(focus[metric]!)} {unit}</strong></output>
        </div>
      </> : <p className="card-note">No {label.toLowerCase()} samples in this time range.</p>}
      {(metric === 'speed' || metric === 'pace') && visible.some((point) => point.estimatedSpeed)
        ? <p className="card-note">Estimated from GPS where the file has no speed reading.</p> : null}
      {!hasHeartRate ? <p className="card-note">This activity has no timestamped heart-rate readings.</p> : null}
      {end > start ? <details className="workout-edit activity-chart-zoom"><summary>Zoom to a time range</summary>
        <div className="workout-controls">
          <label>Start (seconds)<input type="number" min={start} max={end} value={zoomFrom} onChange={(event) => setZoomFrom(event.target.value)} /></label>
          <label>End (seconds)<input type="number" min={start} max={end} value={zoomTo} onChange={(event) => setZoomTo(event.target.value)} /></label>
          <button className="text-button" type="button" onClick={() => { setZoomFrom(''); setZoomTo(''); }}>Reset zoom</button>
        </div>
        {invalid ? <p className="form-hint">Choose a start and end within the selected activity or lap.</p> : null}
      </details> : null}
    </>}
  </section>;
}

type Coordinate = NonNullable<WorkoutDetails['route']>[number];

function RouteMap({ coordinates, distanceUnit }: { coordinates: Coordinate[]; distanceUnit: DistanceUnit }) {
  const map = useMemo(() => {
    if (coordinates.length < 2) return;
    const origin = coordinates[0];
    const adjustLongitude = Math.cos(origin.latitude * Math.PI / 180);
    const surface = coordinates.map((point) => ({
      x: ((point.longitude - origin.longitude + 540) % 360 - 180) * 111.32 * adjustLongitude,
      y: (point.latitude - origin.latitude) * 111.32,
      segment: point.segment,
    }));
    const bounds = surface.reduce((current, point) => ({
      left: Math.min(current.left, point.x), right: Math.max(current.right, point.x),
      low: Math.min(current.low, point.y), high: Math.max(current.high, point.y),
    }), { left: 0, right: 0, low: 0, high: 0 });
    const scale = Math.min(490 / Math.max(.001, bounds.right - bounds.left), 174 / Math.max(.001, bounds.high - bounds.low));
    const midX = (bounds.left + bounds.right) / 2;
    const midY = (bounds.low + bounds.high) / 2;
    const points = surface.map((point) => ({ x: 300 + (point.x - midX) * scale, y: 125 + (midY - point.y) * scale, segment: point.segment }));
    const path = points.map((point, index) => (index && points[index - 1].segment === point.segment ? 'L' : 'M')
      + point.x.toFixed(2) + ',' + point.y.toFixed(2)).join(' ');
    const approxMeters = 86 / scale * 1000;
    const magnitude = 10 ** Math.floor(Math.log10(approxMeters));
    const scaleMeters = Math.floor(approxMeters / magnitude) * magnitude;
    return { path, first: points[0], last: points[points.length - 1], scaleMeters, scaleWidth: scaleMeters / 1000 * scale };
  }, [coordinates]);

  return <section className="surface-card activity-detail-section activity-route">
    <div className="card-title-row"><div><h3>Route map</h3><p>GPS track from this workout</p></div></div>
    {map ? <>
      <svg className="activity-route-map" viewBox="0 0 600 250" role="img" aria-label="GPS route with start and finish">
        {Array.from({ length: 9 }, (_, index) => <line className="activity-route-grid" key={'v' + index} x1={index * 75} y1={0} x2={index * 75} y2={250} />)}
        {Array.from({ length: 6 }, (_, index) => <line className="activity-route-grid" key={'h' + index} x1={0} y1={index * 50} x2={600} y2={index * 50} />)}
        <text className="activity-route-caption" x={555} y={29}>↑ N</text>
        <path className="activity-route-path" d={map.path} />
        <circle className="activity-route-finish" cx={map.last.x} cy={map.last.y} r={7} />
        <circle className="activity-route-start" cx={map.first.x} cy={map.first.y} r={5} />
        <line className="activity-route-scale" x1={20} y1={221} x2={20 + map.scaleWidth} y2={221} />
        <text className="activity-route-caption" x={20} y={239}>{map.scaleMeters < 100 && distanceUnit === 'km' ? `${map.scaleMeters} m` : formatDistance(map.scaleMeters, distanceUnit)}</text>
      </svg>
      <div className="activity-route-legend"><span><i /> Start</span><span><i /> Finish</span></div>
    </> : <p className="card-note">This activity has no saved GPS points. Import a workout file with location data to draw the route.</p>}
  </section>;
}

const emptyDetails: WorkoutDetails = { metrics: {} };

export function WorkoutTrace({ details: loaded, distanceUnit }: { details: WorkoutDetails | null; distanceUnit: DistanceUnit }) {
  const details = loaded ?? emptyDetails;
  const samples = useMemo(() => workoutChartSamples(details.samples ?? []), [details.samples]);
  const coordinates = useMemo(() => {
    const route = details.route?.filter(isWorkoutCoordinate);
    if (route && route.length > 1) return route;
    let segment = 0;
    return samples.filter(isWorkoutCoordinate).map((point, index, points) => {
      const previous = points[index - 1];
      if (previous && (previous.segment !== point.segment || point.seconds - previous.seconds > 60)) segment += 1;
      return { latitude: point.latitude, longitude: point.longitude, segment };
    });
  }, [details.route, samples]);
  return <div className="activity-visuals">
    <WorkoutTimeline details={details} samples={samples} distanceUnit={distanceUnit} />
    <RouteMap coordinates={coordinates} distanceUnit={distanceUnit} />
  </div>;
}
