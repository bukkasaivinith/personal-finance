import { useId, useMemo, useState, type PointerEvent } from 'react';
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

function closestSampleIndex(samples: ChartSample[], second: number) {
  if (!samples.length) return -1;
  let first = 0;
  let last = samples.length - 1;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (samples[middle].seconds < second) first = middle + 1;
    else last = middle;
  }
  const current = samples[first];
  const previous = samples[first - 1];
  return previous && second - previous.seconds <= current.seconds - second ? first - 1 : first;
}

function WorkoutTimeline({ details, samples, distanceUnit }: { details: WorkoutDetails; samples: ChartSample[]; distanceUnit: DistanceUnit }) {
  const metrics = useMemo(() => chartMetrics.filter(([key]) => samples.some((sample) => Number.isFinite(sample[key]))), [samples]);
  const [choice, setChoice] = useState('');
  const [lap, setLap] = useState('');
  const [selectedSecond, setSelectedSecond] = useState<number>();
  const [hoveredSecond, setHoveredSecond] = useState<number>();
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
  const from = interval?.from ?? 0;
  const to = interval?.to ?? last;
  const visible = useMemo(() => samples.filter((sample) =>
    sample.seconds >= from && sample.seconds <= to && Number.isFinite(sample[metric])), [samples, metric, from, to]);
  const selected = selectedSecond === undefined ? undefined : visible[closestSampleIndex(visible, selectedSecond)];
  const focus = hoveredSecond === undefined ? selected : visible[closestSampleIndex(visible, hoveredSecond)];

  const chartWidth = 625, chartHeight = 224;
  const left = 50, top = 15, width = 557, height = 170, right = left + width, bottom = top + height;
  const { rawMin, rawMax, hasEstimatedSpeed } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let estimated = false;
    for (const point of visible) {
      min = Math.min(min, point[metric]!);
      max = Math.max(max, point[metric]!);
      estimated ||= point.estimatedSpeed;
    }
    return { rawMin: min, rawMax: max, hasEstimatedSpeed: estimated };
  }, [visible, metric]);
  const step = Math.max(minimumStep, Math.ceil((rawMax - rawMin) / (minimumStep * 16)) * minimumStep);
  const lowerBound = Math.floor((rawMin - step) / step) * step;
  const minimum = metric === 'elevation' ? lowerBound : Math.max(0, lowerBound);
  const maximum = Math.ceil((rawMax + step) / step) * step;
  const duration = Math.max(1, to - from);
  const x = (second: number) => left + (second - from) / duration * width;
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * height;
  const pointerFraction = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return ((event.clientX - bounds.left) * chartWidth / bounds.width - left) / width;
  };
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
        <Select aria-label="Timeline lap" value={lap} onChange={(event) => { setLap(event.target.value); setSelectedSecond(undefined); }}>
          <option value="">Whole activity</option>{laps.map((entry) => <option key={entry.number} value={entry.number}>Lap {entry.number}</option>)}
        </Select></label></div> : null}
      {visible.length ? <>
        <span className="sr-only" id={chartId + '-keys'}>Use the arrow keys to explore readings, or Escape to clear the selection.</span>
        <div className="activity-chart-frame">
          <svg className="activity-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${label} chart in ${unit}`}
            tabIndex={0} aria-describedby={chartId + '-keys'}
            onPointerMove={(event) => {
              if (event.pointerType === 'touch') return;
              const fraction = pointerFraction(event);
              setHoveredSecond(fraction >= 0 && fraction <= 1 ? visible[closestSampleIndex(visible, from + fraction * duration)].seconds : undefined);
            }}
            onPointerLeave={() => setHoveredSecond(undefined)}
            onPointerCancel={() => setHoveredSecond(undefined)}
            onPointerDown={(event) => {
              const fraction = pointerFraction(event);
              if (fraction < 0 || fraction > 1) return;
              setSelectedSecond(visible[closestSampleIndex(visible, from + fraction * duration)].seconds);
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
              event.preventDefault();
              setHoveredSecond(undefined);
              if (event.key === 'Escape') {
                setSelectedSecond(undefined);
                return;
              }
              const current = selected ? closestSampleIndex(visible, selected.seconds) : undefined;
              const lastIndex = visible.length - 1;
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex
                : event.key === 'ArrowLeft' ? Math.max(0, (current ?? visible.length) - 1)
                  : Math.min(lastIndex, (current ?? -1) + 1);
              setSelectedSecond(visible[next].seconds);
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
            <path className="activity-chart-line" d={path} />
            {focus ? <>
              <line className="activity-chart-cursor" x1={x(focus.seconds)} y1={top} x2={x(focus.seconds)} y2={bottom} />
              <circle className="activity-chart-point" cx={x(focus.seconds)} cy={y(focus[metric]!)} r={4} />
            </> : visible.length === 1 ? <circle className="activity-chart-point" cx={x(visible[0].seconds)} cy={y(visible[0][metric]!)} r={4} /> : null}
          </svg>
          {focus ? <div className="activity-chart-tooltip" role="tooltip"
            data-below={y(focus[metric]!) < (top + bottom) / 2}
            style={{ left: `clamp(5.75rem, ${x(focus.seconds) / chartWidth * 100}%, calc(100% - 5.75rem))`, top: `${y(focus[metric]!) / chartHeight * 100}%` }}>
            <span>{elapsedTime(focus.seconds)} elapsed</span>
            <strong>{label} {formatValue(focus[metric]!)} {unit}</strong>
          </div> : null}
        </div>
        <span className="sr-only" role="status">{selected ? elapsedTime(selected.seconds) + ' elapsed, ' + label + ' ' + formatValue(selected[metric]!) + ' ' + unit : ''}</span>
      </> : <p className="card-note">No {label.toLowerCase()} samples in this time range.</p>}
      {(metric === 'speed' || metric === 'pace') && hasEstimatedSpeed
        ? <p className="card-note">Estimated from GPS where the file has no speed reading.</p> : null}
      {!hasHeartRate ? <p className="card-note">This activity has no timestamped heart-rate readings.</p> : null}
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
    const scale = Math.min(350 / Math.max(.001, bounds.right - bounds.left), 222 / Math.max(.001, bounds.high - bounds.low));
    const midX = (bounds.left + bounds.right) / 2;
    const midY = (bounds.low + bounds.high) / 2;
    const points = surface.map((point) => ({ x: 210 + (point.x - midX) * scale, y: 146 + (midY - point.y) * scale, segment: point.segment }));
    const path = points.map((point, index) => (index && points[index - 1].segment === point.segment ? 'L' : 'M')
      + point.x.toFixed(2) + ',' + point.y.toFixed(2)).join(' ');
    const approxMeters = 86 / scale * 1000;
    const magnitude = 10 ** Math.floor(Math.log10(approxMeters));
    const scaleMeters = (approxMeters / magnitude >= 5 ? 5 : approxMeters / magnitude >= 2 ? 2 : 1) * magnitude;
    return { path, first: points[0], last: points[points.length - 1], scaleMeters, scaleWidth: scaleMeters / 1000 * scale };
  }, [coordinates]);

  return <section className="surface-card activity-detail-section activity-route">
    <div className="card-title-row"><div><h3>Route map</h3><p>GPS track from this workout</p></div></div>
    {map ? <>
      <svg className="activity-route-map" viewBox="0 0 420 310" role="img" aria-label="GPS route with start and finish">
        {Array.from({ length: 11 }, (_, index) => <line className="activity-route-grid" key={'v' + index} x1={index * 42} y1={0} x2={index * 42} y2={310} />)}
        {Array.from({ length: 8 }, (_, index) => <line className="activity-route-grid" key={'h' + index} x1={0} y1={index * 42} x2={420} y2={index * 42} />)}
        <path className="activity-route-path activity-route-halo" d={map.path} />
        <path className="activity-route-path" d={map.path} />
        <circle className="activity-route-start" cx={map.first.x} cy={map.first.y} r={8} />
        <rect className="activity-route-finish" x={map.last.x - 4.5} y={map.last.y - 4.5} width={9} height={9} rx={2} />
        <g aria-hidden="true">
          <circle className="activity-route-key" cx={385} cy={34} r={20} />
          <text className="activity-route-caption" x={385} y={31} textAnchor="middle">N</text>
          <path className="activity-route-scale" d="M380 41 L385 36 L390 41 M385 36 V46" />
          <rect className="activity-route-key" x={12} y={264} width={111} height={33} rx={7} />
          <path className="activity-route-scale" d={`M22 272 v4 h${map.scaleWidth} v-4`} />
          <text className="activity-route-caption" x={22} y={289}>{map.scaleMeters < 1000 && distanceUnit === 'km'
            ? `${number.format(map.scaleMeters)} m` : formatDistance(map.scaleMeters, distanceUnit, 3)}</text>
        </g>
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
