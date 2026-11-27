import './athlete-workout-details.css';
import { type DistanceUnit, formatDistance, formatDuration } from '@/lib/athlete';
import { activitySummaryMetrics, editableWorkoutMetrics, type WorkoutDetails } from '@/lib/athlete-workout';

const format = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const recorded = (value: number | undefined, suffix = '') => value === undefined ? '—' : format.format(value) + suffix;

export function WorkoutSummary({ details, distanceUnit = 'km', includeAdvancedMetrics = false }: {
  details: WorkoutDetails; distanceUnit?: DistanceUnit; includeAdvancedMetrics?: boolean;
}) {
  const pace = (seconds: number) => formatDuration(Math.round(seconds * (distanceUnit === 'mi' ? 1.609344 : 1))) + ' /' + distanceUnit;
  const metrics = (includeAdvancedMetrics ? editableWorkoutMetrics : activitySummaryMetrics).flatMap(([key, label, unit]) => {
    const value = details.metrics[key];
    return value == null ? [] : [[label, unit === 's' ? formatDuration(value) : unit === 's/km' ? pace(value) : recorded(value, unit ? ' ' + unit : '')]];
  });
  return <>
    {details.source ? <p className="form-hint">Source · {details.source}</p> : null}
    {metrics.length || (includeAdvancedMetrics && details.asymmetry) ? <dl className="workout-summary">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      {includeAdvancedMetrics && details.asymmetry ? <div><dt>Asymmetry rating</dt><dd>{details.asymmetry}</dd></div> : null}
    </dl> : null}
    {details.zones?.length ? <section className="workout-zones" aria-label="Heart rate zones"><h3>Heart rate zones</h3>
      <ul className="workout-zone-list">
        {[...details.zones].sort((first, second) => first.zone - second.zone).map((zone) => (
          <li className="workout-zone" data-zone={zone.zone} key={zone.zone}>
            <div className="workout-zone-label"><strong>Zone {zone.zone}</strong><span>{zone.minimum}–{zone.maximum} bpm</span></div>
            <div className="workout-zone-track" aria-hidden="true">
              <span style={{ width: Math.max(0, Math.min(100, zone.percent)) + '%' }} />
            </div>
            <div className="workout-zone-value">
              <span>{zone.seconds === 0 ? '0:00' : formatDuration(zone.seconds)}</span>
              <strong>{recorded(zone.percent, '%')}</strong>
            </div>
          </li>
        ))}
      </ul>
    </section> : null}
    {details.laps?.length ? <section><h3>Laps</h3><div className="workout-table"><table>
      <thead><tr><th>Lap</th><th>Time</th><th>Distance</th><th>Heart rate</th><th>Zone (avg. HR)</th><th>Pace</th></tr></thead>
      <tbody>{details.laps.map((lap) => {
        const average = lap.heartRate;
        const zone = average == null ? undefined : details.zones?.find(({ minimum, maximum }) => average >= minimum && average <= maximum);
        return <tr key={lap.number}>
          <th scope="row">{lap.number}</th>
          <td>{formatDuration(lap.seconds ?? null)}</td>
          <td>{formatDistance(lap.meters ?? null, distanceUnit)}</td>
          <td>{recorded(lap.heartRate, ' bpm')}</td>
          <td>{zone ? <span className="workout-lap-zone" data-zone={zone.zone} title={`${zone.minimum}–${zone.maximum} bpm`}>Zone {zone.zone}</span> : '—'}</td>
          <td>{lap.pace === undefined ? '—' : pace(lap.pace)}</td>
        </tr>;
      })}</tbody>
    </table></div></section> : null}
  </>;
}

export function WorkoutDetailsFields({ details, onChange }: { details: WorkoutDetails; onChange: (details: WorkoutDetails) => void }) {
  return <details className="full-field workout-edit">
    <summary>Advanced metrics and laps</summary>
    <div className="form-grid athlete-form-grid">
      {editableWorkoutMetrics.map(([key, label, unit]) => <label key={key}>{label}{unit ? ' (' + unit + ')' : ''}<input type="number" step="any" value={details.metrics[key] ?? ''} onChange={(event) => {
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
