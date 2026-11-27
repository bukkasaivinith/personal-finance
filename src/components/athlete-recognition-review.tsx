import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { ModalShell } from '@/components/ui';
import { Select } from '@/components/select';
import { formatAthleteDate, formatDistance, formatDuration, formatPace, routeAthleteText, type AthleteSettings, type AthleteTextDraft } from '@/lib/athlete';
import { missingRecognitionFields, recognitionDestinations, recognitionReferenceDate } from '@/lib/athlete-recognition';
import { WorkoutSummary } from '@/components/athlete-workout-details';
import { recoveryFields } from '@/lib/athlete-recovery';
import type { WorkoutDetails } from '@/lib/athlete-workout';
import './athlete-recognition-review.css';

export type PendingRecognition = { route: AthleteTextDraft; files: File[]; details: WorkoutDetails };

function shownDate(date?: string) { return date ? formatAthleteDate(date) : 'Not detected'; }
function shownNumber(value: number | null | undefined, suffix = '') { return typeof value === 'number' ? `${value}${suffix}` : 'Not detected'; }

export function RecognitionConfirmationModal({ pending, settings, onClose, onAddInfo }: {
  pending: PendingRecognition; settings: AthleteSettings;
  onClose: () => void; onAddInfo: (route: AthleteTextDraft) => void;
}) {
  const [route, setRoute] = useState(pending.route);
  const [text, setText] = useState(pending.route.transcript ?? '');
  const [previews, setPreviews] = useState<Array<{ src: string; filename: string }>>([]);
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    const sources = pending.files.map((file) => ({ src: URL.createObjectURL(file), filename: file.name }));
    setPreviews(sources);
    return () => sources.forEach((entry) => URL.revokeObjectURL(entry.src));
  }, [pending.files]);
  const missing = missingRecognitionFields(route);
  const details: Array<[string, string]> = route.destination === 'activity' ? [
    ['Date', shownDate(route.date)], ['Activity', route.activity.kind ?? 'Not detected'],
    ['Distance', formatDistance(route.activity.distanceMeters ?? null, settings.distanceUnit)],
    ['Duration', formatDuration(route.activity.durationSeconds ?? null)],
    ['Pace (calculated)', formatPace(route.activity.distanceMeters ?? null, route.activity.durationSeconds ?? null, settings.distanceUnit)],
    ['Average heart rate', shownNumber(route.activity.averageHeartRate, ' bpm')], ['Calories', shownNumber(route.activity.calories, ' kcal')],
    ['Elevation', shownNumber(route.activity.elevationMeters, ' m')], ['Cadence', shownNumber(route.activity.cadence, ' spm')], ['Effort', shownNumber(route.activity.effort, ' / 10')],
  ] : route.destination === 'plan' ? [
    ['Date', shownDate(route.plan.workoutDate)], ['Title', route.plan.title ?? 'Not detected'], ['Activity', route.plan.kind ?? 'Not detected'], ['Target distance', formatDistance(route.plan.targetDistanceMeters ?? null, settings.distanceUnit)],
  ] : route.destination === 'recovery' ? [
    ['Date', shownDate(route.recovery.recoveryDate)], ['Recovery', shownNumber(route.recovery.score, ' / 100')],
    ...recoveryFields.flatMap(([key, label]): Array<[string, string]> => route.recovery.metrics?.[key] === undefined ? [] : [[label, shownNumber(route.recovery.metrics[key])]]),
  ] : route.destination === 'race' ? [
    ['Date', shownDate(route.race.raceDate)], ['Name', route.race.name ?? 'Not detected'], ['Distance', formatDistance(route.race.distanceMeters ?? null, settings.distanceUnit)], ['Location', route.race.location || 'Not detected'], ['Finish time', formatDuration(route.race.finishSeconds ?? null)],
  ] : route.destination === 'gym' ? [
    ['Date', shownDate(route.gym.sessionDate)], ['Title', route.gym.title ?? 'Not detected'], ['Duration', shownNumber(route.gym.durationMinutes, ' min')],
    ['Exercises', route.gym.exercises?.map((exercise) => `${exercise.exercise}: ${exercise.sets || '—'} sets × ${exercise.reps || '—'} reps`).join('; ') || 'Not detected'],
  ] : [
    ['Title', route.goal.title ?? 'Not detected'], ['Target', formatDistance(route.goal.targetDistanceMeters ?? null, settings.distanceUnit)], ['From', shownDate(route.goal.startsOn)], ['Until', shownDate(route.goal.endsOn)],
  ];
  return <ModalShell eyebrow="Screenshot review" title="Confirm understood details" labelId="athlete-recognition-title" onClose={onClose}>
    <div className="recognition-confirmation">
      <p className="modal-description">Nothing has been saved. Check the details, fill any gaps, and choose Add info to open the final form.</p>
      {previews.length ? <details className="recognition-source-image"><summary>Compare with the uploaded screenshots ({previews.length})</summary><div className="workout-preview-grid">{previews.map(({ src, filename }) => <figure key={src}><img src={src} loading="lazy" alt={filename} /><figcaption>{filename}</figcaption></figure>)}</div></details> : null}
      <label className="recognition-destination">This information belongs in<Select value={route.destination} onChange={(event) => { setRoute({ ...route, destination: event.target.value as AthleteTextDraft['destination'] }); setReviewed(false); }}>
        {recognitionDestinations.map((destination) => <option key={destination.value} value={destination.value}>{destination.label}</option>)}
      </Select></label>
      <div className="recognition-summary">{details.map(([label, value]) => <div key={label}><span>{label}</span><b>{value === '—' ? 'Not detected' : value}</b></div>)}</div>
      {pending.details && route.destination === 'activity' ? <WorkoutSummary details={pending.details} includeAdvancedMetrics /> : null}
      {route.warnings?.length ? <div className="recognition-questions" role="status"><strong>Please check</strong><ul>{route.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      {missing.length ? <div className="recognition-questions"><strong>Missing details</strong><ul>{missing.map((question) => <li key={question}>{question}</li>)}</ul><p>You can add these to the text below or fill them in the next form.</p></div> : null}
      <details className="recognition-source-text">
        <summary>Check or correct the extracted text</summary>
        <label>Correct misread words or add missing details<textarea value={text} maxLength={12000} onChange={(event) => setText(event.target.value)} rows={6} placeholder="For example: Yesterday I ran 5 km in 30 minutes. Average heart rate 148 bpm." /></label>
        <button className="secondary-button" type="button" disabled={!text.trim()} onClick={() => { setRoute(routeAthleteText(text, settings.distanceUnit, recognitionReferenceDate(settings.timezone))); setReviewed(false); }}>Read corrected text</button>
        <p className="form-hint">Source text is used for extraction only. It will not be added to your notes.</p>
      </details>
      <label className="recognition-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I have checked the detected details. I will fill any missing information before saving.</label>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Discard</button><button type="button" className="primary-button" disabled={!reviewed} onClick={() => onAddInfo(route)}><Plus size={15} /> Add info</button></div>
    </div>
  </ModalShell>;
}
