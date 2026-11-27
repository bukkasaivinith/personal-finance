import { Select } from '@/components/select';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  FileImage,
  Flag,
  Footprints,
  HeartPulse,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Target,
  Trash2,
  Trophy,
} from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { EmptyPanel, Metric, ModalShell, ProgressRow, SectionHeading } from '@/components/ui';
import {
  deleteAllAthleteData,
  deleteAthleteActivity,
  deleteAthleteRecord,
  deleteRecoveryScore,
  loadAthleteHubData,
  saveAthleteActivity,
  saveAthleteGoal,
  saveAthleteSettings,
  saveGymSession,
  savePlannedWorkout,
  saveRace,
  saveRecoveryScore,
} from '@/lib/athlete-api';
import {
  dateFromKey,
  formatAthleteDate,
  formatDistance,
  formatDuration,
  formatPace,
  localDateKey,
  metersFromDistance,
  recoveryTone,
  type AthleteActivity,
  type AthleteActivityDraft,
  type AthleteActivityKind,
  type AthleteActivitySource,
  type AthleteGoalDraft,
  type AthleteHubData,
  type AthleteSettings,
  type DistanceUnit,
  type GymSessionDraft,
  type PlannedWorkoutDraft,
  type Race,
  type RecoveryScore,
  type AthleteTextDraft,
} from '@/lib/athlete';
import { useAthleteData } from '@/lib/use-athlete-data';
import { RecognitionConfirmationModal, type PendingRecognition } from '@/components/athlete-recognition-review';
import { recognitionReferenceDate, recognizeSamsungScreenshots, recognizeScreenshot } from '@/lib/athlete-recognition';
import { WorkoutDetailsFields } from '@/components/athlete-workout-details';
import type { ActivityMediaBatch } from '@/lib/athlete-media';
import { athleteActivityPath } from '@/lib/navigation';
import { bestAtDistance, matchingWorkout, personalBests, runningKinds, workoutFileAccept, workoutOptionLabel, type WorkoutDetails } from '@/lib/athlete-workout';
import { AthleteAnalysis } from '@/components/athlete-analysis';
import { RecoveryEditor, RecoveryHistory } from '@/components/athlete-recovery';
import { recognizeWhoopRecovery, whoopTone } from '@/lib/athlete-recovery';
import { downloadReport } from '@/lib/report-export';

type Period = 'week' | 'month' | 'year' | 'all' | 'custom';
const athleteTabs = [['dashboard', 'Overview'], ['calendar', 'Calendar'], ['timeline', 'Activities'],
  ['records', 'Personal Bests'], ['recovery', 'Recovery'], ['analysis', 'Analysis']] as const;
type ActivityEditor = { entry?: AthleteActivity; draft?: Partial<AthleteActivityDraft>; details?: WorkoutDetails; imported?: boolean; screenshots?: File[] };
type ScreenshotDraft = { fileName: string; route: AthleteTextDraft; file?: File; files?: File[]; fingerprint: string; details?: WorkoutDetails };

const activityKinds: Array<{ value: AthleteActivityKind; label: string }> = [
  { value: 'run', label: 'Run' },
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'walk', label: 'Walk' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'race', label: 'Race' },
];
const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const emptyActivities: AthleteActivity[] = [];


function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function dayKey(date: Date): string {
  return localDateKey(date);
}

function addDays(key: string, amount: number): string {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + amount);
  return dayKey(date);
}

function daysBetween(first: string, second: string): number {
  return Math.round((dateFromKey(second).getTime() - dateFromKey(first).getTime()) / 86_400_000);
}


function periodBounds(period: Period, customStart: string, customEnd: string): { start: string; end: string } {
  const today = localDateKey();
  if (period === 'all') return { start: '2000-01-01', end: '2999-12-31' };
  if (period === 'custom') return { start: customStart || today, end: customEnd || today };
  if (period === 'week') return { start: addDays(today, -6), end: today };
  if (period === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: today };
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

function inRange(value: string, start: string, end: string): boolean {
  return value >= start && value <= end;
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function IconForActivity({ kind }: { kind: AthleteActivityKind }) {
  if (kind === 'cycle') return <Activity size={16} />;
  if (kind === 'walk') return <Footprints size={16} />;
  if (kind === 'race') return <Trophy size={16} />;
  return <Activity size={16} />;
}

export function ActivityModal({
  settings,
  editor,
  matchingActivities,
  onClose,
  onSave,
}: {
  settings: AthleteSettings;
  editor: ActivityEditor;
  matchingActivities: AthleteActivity[];
  onClose: () => void;
  onSave: (draft: AthleteActivityDraft, id?: string, details?: WorkoutDetails, batch?: ActivityMediaBatch) => Promise<void>;
}) {
  const entry = editor.entry;
  const draft = editor.draft;
  const source: AthleteActivitySource = entry?.source ?? draft?.source ?? 'manual';
  const distance = entry?.distanceMeters ? String(Number((entry.distanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(6))) : draft?.distanceMeters ? String(Number((draft.distanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(6))) : '';
  const [kind, setKind] = useState<AthleteActivityKind>(entry?.kind ?? draft?.kind ?? 'run');
  const [activityDate, setActivityDate] = useState(entry?.activityDate ?? (editor.imported ? draft?.activityDate ?? '' : draft?.activityDate || localDateKey()));
  const [details, setDetails] = useState(editor.details);
  const [keepScreenshots, setKeepScreenshots] = useState(true);
  const [mediaBatchId] = useState(() => crypto.randomUUID());
  const [matchChoice, setMatchChoice] = useState<string>();
  const [distanceValue, setDistanceValue] = useState(distance);
  const [hours, setHours] = useState(entry?.durationSeconds || draft?.durationSeconds ? String(Math.floor((entry?.durationSeconds ?? draft?.durationSeconds ?? 0) / 3600)) : '');
  const [minutes, setMinutes] = useState(entry?.durationSeconds || draft?.durationSeconds ? String(Math.floor(((entry?.durationSeconds ?? draft?.durationSeconds ?? 0) % 3600) / 60)) : '');
  const [seconds, setSeconds] = useState(entry?.durationSeconds || draft?.durationSeconds ? String((entry?.durationSeconds ?? draft?.durationSeconds ?? 0) % 60) : '');
  const [heartRate, setHeartRate] = useState(entry?.averageHeartRate?.toString() ?? draft?.averageHeartRate?.toString() ?? '');
  const [calories, setCalories] = useState(entry?.calories?.toString() ?? draft?.calories?.toString() ?? '');
  const [elevation, setElevation] = useState(entry?.elevationMeters?.toString() ?? draft?.elevationMeters?.toString() ?? '');
  const [cadence, setCadence] = useState(entry?.cadence?.toString() ?? draft?.cadence?.toString() ?? '');
  const [effort, setEffort] = useState(entry?.effort?.toString() ?? draft?.effort?.toString() ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? draft?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const savingRequest = useRef(false);
  const [error, setError] = useState('');
  const distanceMeters = parseOptionalNumber(distanceValue);
  const durationSeconds = (parseOptionalNumber(hours) ?? 0) * 3600 + (parseOptionalNumber(minutes) ?? 0) * 60 + (parseOptionalNumber(seconds) ?? 0);
  const normalizedDistance = distanceMeters === null ? null : metersFromDistance(distanceMeters, settings.distanceUnit);
  const pace = formatPace(normalizedDistance, durationSeconds || null, settings.distanceUnit);
  const canLink = !entry && Boolean(editor.imported) && matchingActivities.length > 0;
  const suggested = canLink
    ? matchingWorkout(matchingActivities, { activityDate, kind, distanceMeters: normalizedDistance, durationSeconds })
    : undefined;
  const saveTo = matchChoice ?? suggested?.id ?? '';
  const merge = matchingActivities.find((activity) => activity.id === saveTo);
  const screenshotImport = Boolean(editor.screenshots?.length);
  const recordedDuration = durationSeconds || null;
  const savedDistance = screenshotImport ? normalizedDistance ?? merge?.distanceMeters : merge?.distanceMeters ?? normalizedDistance;
  const savedDuration = screenshotImport ? recordedDuration ?? merge?.durationSeconds : merge?.durationSeconds ?? recordedDuration;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRequest.current) return;
    if (canLink && !saveTo) { setError('Choose an existing activity or save a new one.'); return; }
    const savedDate = merge?.activityDate ?? activityDate;
    if (!savedDate) { setError('Choose the activity date.'); return; }
    if (distanceMeters !== null && distanceMeters < 0) { setError('Distance cannot be negative.'); return; }
    if (durationSeconds < 0) { setError('Duration cannot be negative.'); return; }
    savingRequest.current = true;
    setSaving(true); setError('');
    try {
      await onSave({
        kind: merge?.kind ?? kind,
        activityDate: savedDate,
        distanceMeters: savedDistance ?? null,
        durationSeconds: savedDuration ?? null,
        averageHeartRate: parseOptionalNumber(heartRate) ?? merge?.averageHeartRate ?? null,
        calories: parseOptionalNumber(calories) ?? merge?.calories ?? null,
        elevationMeters: parseOptionalNumber(elevation) ?? merge?.elevationMeters ?? null,
        cadence: parseOptionalNumber(cadence) ?? merge?.cadence ?? null,
        effort: parseOptionalNumber(effort) ?? merge?.effort ?? null,
        notes: notes.trim() || merge?.notes || '',
        source: merge?.source ?? source,
      }, entry?.id ?? merge?.id, details,
      keepScreenshots && editor.screenshots?.length ? { id: mediaBatchId, files: editor.screenshots } : undefined);
    } catch (caught) { savingRequest.current = false; setError(errorMessage(caught)); setSaving(false); }
  };

  const attachingFile = entry && editor.imported;
  return <ModalShell eyebrow={editor.screenshots?.length ? 'Screenshot draft' : 'Athlete Hub'} title={attachingFile ? 'Attach workout data' : entry ? 'Edit activity' : 'Log an activity'} labelId="athlete-activity-title" onClose={() => { if (!savingRequest.current) onClose(); }}>
    <form className="modal-form" onSubmit={submit}>
      {attachingFile ? <p className="form-hint">Save to attach the workout file to this activity.</p>
        : editor.imported || source !== 'manual' ? <p className="form-hint">Review the prefilled values and confirm the activity date before saving.</p>
          : <p className="modal-description">Capture the essentials first. Pace is calculated automatically when distance and duration are present.</p>}
      <div className="form-grid athlete-form-grid">
        <label>Activity type<Select value={kind} onChange={(event) => setKind(event.target.value as AthleteActivityKind)}>{activityKinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
        <div><DatePicker label="Activity date" value={activityDate} onChange={setActivityDate} /></div>
        <label>Distance ({settings.distanceUnit})<input value={distanceValue} type="number" min="0" step="any" inputMode="decimal" onChange={(event) => setDistanceValue(event.target.value)} placeholder="e.g. 10" /></label>
        <label>Auto pace<input value={pace} disabled aria-label="Calculated pace" /></label>
        <div className="full-field athlete-duration"><span>Duration</span><div><label>Hours<input type="number" min="0" value={hours} onChange={(event) => setHours(event.target.value)} placeholder="0" /></label><label>Minutes<input type="number" min="0" max="59" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="0" /></label><label>Seconds<input type="number" min="0" max="59" value={seconds} onChange={(event) => setSeconds(event.target.value)} placeholder="0" /></label></div></div>
        <label>Average HR (bpm)<input type="number" min="20" max="260" value={heartRate} onChange={(event) => setHeartRate(event.target.value)} placeholder="Optional" /></label>
        <label>Calories<input type="number" min="0" value={calories} onChange={(event) => setCalories(event.target.value)} placeholder="Optional" /></label>
        <label>Elevation (m)<input type="number" min="0" value={elevation} onChange={(event) => setElevation(event.target.value)} placeholder="Optional" /></label>
        <label>Cadence (spm)<input type="number" min="1" max="400" value={cadence} onChange={(event) => setCadence(event.target.value)} placeholder="Optional" /></label>
        <label>Effort · 1–10<input type="number" min="1" max="10" value={effort} onChange={(event) => setEffort(event.target.value)} placeholder="Optional" /></label>
        {details ? <WorkoutDetailsFields details={details} onChange={setDetails} /> : null}
        <label className="full-field screenshot-note-field">Notes (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1500} placeholder="Route, intervals, how it felt…" /></label>
      </div>
      {canLink ? <><label>Save to<Select value={saveTo} onChange={(event) => { setMatchChoice(event.target.value); setError(''); }}>
        <option value="">Choose where to save this import</option>
        {matchingActivities.map((activity) => <option key={activity.id} value={activity.id}>
          {workoutOptionLabel(activity, settings.distanceUnit)}{activity.id === suggested?.id ? ' (suggested match)' : ''}
        </option>)}
        <option value="new">New activity</option>
      </Select></label>
        {merge ? <p className="form-hint">This import uses the date and activity type of the selected workout.</p> : null}
      </> : null}
      {editor.screenshots?.length ? <label className="recognition-check"><input type="checkbox" checked={keepScreenshots} disabled={saving}
        onChange={(event) => setKeepScreenshots(event.target.checked)} /> Save screenshots privately with this activity</label> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : attachingFile ? 'Attach file' : merge ? 'Update existing activity' : 'Save activity'}</button></div>
    </form>
  </ModalShell>;
}

function ScreenshotUploadModal({
  reading,
  progress,
  error,
  onClose,
  onFiles,
}: {
  reading: boolean;
  progress: string;
  error: string;
  onClose: () => void;
  onFiles: (files: File[], combine: boolean) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [combine, setCombine] = useState(false);
  const selectFiles = (files: FileList | File[]) => {
    if (reading) return;
    const next = Array.from(files);
    if (next.length) void onFiles(next, combine);
  };
  return <ModalShell eyebrow="Athlete Hub" title="Read fitness screenshots" labelId="athlete-screenshot-import" onClose={onClose}>
    <div className="screenshot-import">
      <p className="modal-description">Add up to 16 fitness screenshots. The reader checks their text and layout on your device, then shows the detected details for review. Screenshots are never uploaded.</p>
      <label className="recognition-check"><input type="checkbox" checked={combine} disabled={reading} onChange={(event) => setCombine(event.target.checked)} /> These screenshots are from one Samsung Health workout</label>
      <button
        className={`screenshot-dropzone ${dragging ? 'dragging' : ''}`}
        type="button"
        disabled={reading}
        onClick={() => input.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); selectFiles(event.dataTransfer.files); }}
      >
        <span><FileImage size={22} /></span>
        <b>{reading ? 'Reading screenshots…' : 'Drop screenshots here'}</b>
        <small>{reading ? 'This may take a moment for each image.' : 'or click to choose multiple images · PNG, JPG, or WebP · 10 MB each'}</small>
      </button>
      <input ref={input} className="sr-only" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => { const files = event.target.files; if (files) selectFiles(files); event.currentTarget.value = ''; }} />
      {reading ? <p className="screenshot-reader-status" role="status">{progress || 'Starting the local image reader…'}</p> : null}
      {error ? <p className="form-error screenshot-reader-error" role="alert">{error}</p> : null}
      <div className="screenshot-import-note"><Sparkles size={14} /><span>The reader runs from this app. Review every extracted activity before it is saved.</span></div>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>{reading ? 'Cancel reading' : 'Cancel'}</button></div>
    </div>
  </ModalShell>;
}

function SimpleModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <ModalShell eyebrow="Athlete Hub" title={title} labelId={`athlete-${title.toLowerCase().replace(/\s+/g, '-')}`} onClose={onClose}>{children}</ModalShell>;
}

function PlanModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<PlannedWorkoutDraft> | null; onClose: () => void; onSave: (draft: PlannedWorkoutDraft) => Promise<void> }) {
  const initialDistance = initial?.targetDistanceMeters === null || initial?.targetDistanceMeters === undefined ? '' : String(Number((initial.targetDistanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)));
  const [title, setTitle] = useState(initial?.title ?? ''); const [date, setDate] = useState(initial?.workoutDate ?? localDateKey()); const [kind, setKind] = useState<AthleteActivityKind>(initial?.kind ?? 'run'); const [distance, setDistance] = useState(initialDistance); const [notes, setNotes] = useState(initial?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (saving) return; if (!date) { setError('Choose the date before saving.'); return; } if (!title.trim()) { setError('Give the workout a title.'); return; } const value = parseOptionalNumber(distance); if (value !== null && value < 0) { setError('Distance cannot be negative.'); return; } setSaving(true); try { await onSave({ title: title.trim(), workoutDate: date, kind, targetDistanceMeters: value === null ? null : metersFromDistance(value, settings.distanceUnit), notes: notes.trim() }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Plan a workout" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this upcoming workout from the details you confirmed. Check the date and details before saving.</p> : <p className="modal-description">Plans are private. A matching manual activity marks the plan complete automatically.</p>}<div className="form-grid"><label className="full-field">Workout title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="e.g. Easy long run" /></label><label>Activity type<Select value={kind} onChange={(event) => setKind(event.target.value as AthleteActivityKind)}>{activityKinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label><div><DatePicker label="Planned date" value={date} onChange={setDate} /></div><label>Target distance ({settings.distanceUnit})<input type="number" min="0" step="0.01" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="Optional" /></label><label>Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Intervals or focus" /></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button></div></form></SimpleModal>;
}

function RaceModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<Omit<Race, 'id'>> | null; onClose: () => void; onSave: (input: Omit<Race, 'id'>) => Promise<void> }) {
  const initialDistance = initial?.distanceMeters === null || initial?.distanceMeters === undefined ? '' : String(Number((initial.distanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)));
  const [name, setName] = useState(initial?.name ?? ''); const [date, setDate] = useState(initial?.raceDate ?? localDateKey()); const [distance, setDistance] = useState(initialDistance); const [location, setLocation] = useState(initial?.location ?? ''); const [notes, setNotes] = useState(initial?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (saving) return; if (!date) { setError('Choose the date before saving.'); return; } if (!name.trim()) { setError('Give the race a name.'); return; } const value = parseOptionalNumber(distance); if (value !== null && value < 0) { setError('Distance cannot be negative.'); return; } setSaving(true); try { await onSave({ name: name.trim(), raceDate: date, distanceMeters: value === null ? null : metersFromDistance(value, settings.distanceUnit), location: location.trim(), finishSeconds: initial?.finishSeconds ?? null, notes: notes.trim() }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Add a race" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this race event from the details you confirmed. Review it before saving.</p> : <p className="modal-description">Keep your race calendar in one private place. We’ll show the countdown automatically.</p>}<div className="form-grid"><label className="full-field">Race name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. Hyderabad Half Marathon" /></label><div><DatePicker label="Race date" value={date} onChange={setDate} /></div><label>Distance ({settings.distanceUnit})<input type="number" min="0" step="0.01" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="Optional" /></label><label>Location (optional)<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} placeholder="City or course" /></label><label>Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1500} placeholder="Goal or preparation" /></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save race'}</button></div></form></SimpleModal>;
}

function GymModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<GymSessionDraft> | null; onClose: () => void; onSave: (input: GymSessionDraft) => Promise<void> }) {
  const firstExercise = initial?.exercises?.[0];
  const [title, setTitle] = useState(initial?.title ?? ''); const [date, setDate] = useState(initial?.sessionDate ?? localDateKey()); const [duration, setDuration] = useState(initial?.durationMinutes?.toString() ?? ''); const [exercise, setExercise] = useState(firstExercise?.exercise ?? ''); const [sets, setSets] = useState(firstExercise?.sets ? String(firstExercise.sets) : ''); const [reps, setReps] = useState(firstExercise?.reps ? String(firstExercise.reps) : ''); const [weight, setWeight] = useState(firstExercise?.weight?.toString() ?? ''); const [notes, setNotes] = useState(initial?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (saving) return; if (!date) { setError('Choose the date before saving.'); return; } if (!title.trim()) { setError('Give this strength session a title.'); return; } const durationMinutes = parseOptionalNumber(duration); if (durationMinutes !== null && durationMinutes <= 0) { setError('Duration must be above zero.'); return; } setSaving(true); try { await onSave({ sessionDate: date, title: title.trim(), durationMinutes, exercises: exercise.trim() ? [{ exercise: exercise.trim(), sets: Number(sets) || 0, reps: Number(reps) || 0, weight: parseOptionalNumber(weight) }] : [], notes: notes.trim() }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Log strength work" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this strength entry from the details you confirmed. Review it before saving.</p> : <p className="modal-description">Keep gym work minimal and useful for your running. Add one key movement now; you can add a new session whenever needed.</p>}<div className="form-grid"><label className="full-field">Session title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="e.g. Lower body strength" /></label><div><DatePicker label="Session date" value={date} onChange={setDate} /></div><label>Duration (minutes)<input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Optional" /></label><label className="full-field">Key exercise (optional)<input value={exercise} onChange={(event) => setExercise(event.target.value)} placeholder="e.g. Split squat" /></label><label>Sets<input type="number" min="0" value={sets} onChange={(event) => setSets(event.target.value)} placeholder="0" /></label><label>Reps<input type="number" min="0" value={reps} onChange={(event) => setReps(event.target.value)} placeholder="0" /></label><label>Weight ({settings.weightUnit})<input type="number" min="0" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Optional" /></label><label className="full-field">Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1500} placeholder="How it felt" /></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save session'}</button></div></form></SimpleModal>;
}

function GoalModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<AthleteGoalDraft> | null; onClose: () => void; onSave: (input: AthleteGoalDraft) => Promise<void> }) {
  const initialDistance = initial?.targetDistanceMeters === undefined ? '' : String(Number((initial.targetDistanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)));
  const [title, setTitle] = useState(initial?.title ?? ''); const [distance, setDistance] = useState(initialDistance); const [startsOn, setStartsOn] = useState(initial?.startsOn ?? localDateKey()); const [endsOn, setEndsOn] = useState(initial?.endsOn ?? addDays(localDateKey(), 30)); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (saving) return; const value = parseOptionalNumber(distance); if (!title.trim() || value === null || value <= 0 || !startsOn || !endsOn || endsOn < startsOn) { setError('Add a title, a positive distance, and a valid date range.'); return; } setSaving(true); try { await onSave({ title: title.trim(), targetDistanceMeters: metersFromDistance(value, settings.distanceUnit), startsOn, endsOn }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Create running goal" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this goal from the details you confirmed. Fill any missing detail before saving.</p> : <p className="modal-description">Your progress is based on logged activity during the goal period.</p>}<div className="form-grid"><label className="full-field">Goal title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="e.g. Run 100 km this month" /></label><label>Target distance ({settings.distanceUnit})<input type="number" min="0.01" step="0.01" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="e.g. 100" /></label><div><DatePicker label="Start date" value={startsOn} onChange={setStartsOn} /></div><div className="full-field"><DatePicker label="End date" value={endsOn} onChange={setEndsOn} min={startsOn} /></div></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save goal'}</button></div></form></SimpleModal>;
}

function AthleteSettingsModal({ settings, onClose, onSave, onDelete }: { settings: AthleteSettings; onClose: () => void; onSave: (settings: AthleteSettings) => Promise<void>; onDelete: () => Promise<void> }) {
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(settings.distanceUnit);
  const [weightUnit, setWeightUnit] = useState<AthleteSettings['weightUnit']>(settings.weightUnit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setError('');
    try { await onSave({ ...settings, distanceUnit, weightUnit }); onClose(); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };
  return <SimpleModal title="Athlete Hub settings" onClose={onClose}><form className="modal-form athlete-settings-modal" onSubmit={save}>
    <p className="modal-description">Your Athlete Hub is private and stays separate from your finance workspace.</p>
    <section className="athlete-settings-section"><h3>Units</h3><div className="form-grid"><label>Distance unit<Select value={distanceUnit} onChange={(event) => setDistanceUnit(event.target.value as DistanceUnit)}><option value="km">Kilometres</option><option value="mi">Miles</option></Select></label><label>Weight unit<Select value={weightUnit} onChange={(event) => setWeightUnit(event.target.value as AthleteSettings['weightUnit'])}><option value="kg">Kilograms</option><option value="lb">Pounds</option></Select></label></div></section>
    <section className="athlete-settings-section athlete-settings-danger"><h3>Delete Athlete Hub data</h3><p>This permanently removes every Athlete Hub record, but never changes your finance workspace.</p><button type="button" className="ghost-button danger" onClick={() => void onDelete()}><Trash2 size={14} /> Delete all Athlete Hub data</button></section>
    {error ? <p className="form-error">{error}</p> : null}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>
  </form></SimpleModal>;
}



export function AthletePreferencesButton({ onNotify }: { onNotify: (message: string) => void }) {
  const [settings, setSettings] = useState<AthleteSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true);
    try { setSettings((await loadAthleteHubData()).settings); }
    catch (caught) { onNotify(errorMessage(caught)); }
    finally { setLoading(false); }
  };
  return <>
    <button className="secondary-button" type="button" disabled={loading} onClick={() => void open()}><Settings size={15} /> {loading ? 'Loading…' : 'Athlete Hub preferences'}</button>
    {settings ? <AthleteSettingsModal settings={settings} onClose={() => setSettings(null)} onSave={async (next) => {
      await saveAthleteSettings(next);
      onNotify('Athlete Hub settings updated.');
    }} onDelete={async () => {
      if (!window.confirm('Delete all Athlete Hub activities, recovery, plans and goals? This cannot be undone.')) return;
      await deleteAllAthleteData();
      setSettings(null);
      onNotify('Athlete Hub data deleted.');
    }} /> : null}
  </>;
}

function AthleteCalendar({ data, month, onChangeMonth, onDate, onSelectMonth }: {
  data: AthleteHubData; month: Date; onChangeMonth: (amount: number) => void; onDate: (date: string) => void; onSelectMonth: (month: Date) => void;
}) {
  const events = useMemo(() => {
    const map = new Map<string, Array<{ label: string; detail: string; tone: string }>>();
    const push = (date: string, event: { label: string; detail: string; tone: string }) => map.set(date, [...(map.get(date) ?? []), event]);
    // Put recovery first so its score remains visible on busy training days.
    data.recoveryScores.forEach((score) => push(score.recoveryDate, { label: 'Recovery', detail: `${score.score}/100`, tone: `recovery ${score.source === 'whoop' ? whoopTone(score.score) : recoveryTone(score.score)}` }));
    data.activities.filter((activity) => activity.kind !== 'cycle').forEach((activity) => push(activity.activityDate, { label: activity.kind === 'treadmill' ? 'Treadmill' : activity.kind[0].toUpperCase() + activity.kind.slice(1), detail: formatDistance(activity.distanceMeters, data.settings.distanceUnit), tone: 'activity' }));
    data.plannedWorkouts.filter((workout) => workout.status === 'planned').forEach((workout) => push(workout.workoutDate, { label: workout.title, detail: 'Planned', tone: 'planned' }));
    data.races.forEach((race) => push(race.raceDate, { label: race.name, detail: 'Race', tone: 'race' }));
    return map;
  }, [data]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12); const visibleStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay(), 12);
  const dates = Array.from({ length: 42 }, (_, index) => new Date(visibleStart.getFullYear(), visibleStart.getMonth(), visibleStart.getDate() + index, 12)); const today = localDateKey();
  return <section className="surface-card athlete-calendar-card"><div className="card-title-row"><div><h3>Training calendar</h3><p>Runs, recovery scores, plans and races in one monthly view.</p></div><div className="athlete-calendar-controls"><button className="calendar-nav" type="button" onClick={() => onChangeMonth(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button><input aria-label="Jump to month and year" type="month" value={localDateKey(month).slice(0, 7)} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) onSelectMonth(dateFromKey(event.target.value + '-01')); }} /><button className="calendar-nav" type="button" onClick={() => onChangeMonth(1)} aria-label="Next month"><ChevronRight size={17} /></button></div></div><div className="athlete-calendar-grid athlete-calendar-head">{weekDays.map((day) => <span key={day}>{day}</span>)}</div><div className="athlete-calendar-grid athlete-calendar-days">{dates.map((date) => { const key = dayKey(date); const inMonth = date.getMonth() === month.getMonth(); const items = events.get(key) ?? []; return <button type="button" onClick={() => onDate(key)} aria-label={formatAthleteDate(key) + ', ' + items.length + ' records'} className={`athlete-calendar-cell ${inMonth ? '' : 'outside'} ${key === today ? 'today' : ''}`} key={key}><b>{date.getDate()}</b>{items.slice(0, 3).map((item, index) => <span className={`athlete-calendar-event ${item.tone}`} key={`${item.label}-${index}`} title={`${item.label} · ${item.detail}`}><i>{item.label}</i><em>{item.detail}</em></span>)}{items.length > 3 ? <small>+{items.length - 3} more</small> : null}</button>; })}</div></section>;
}

function AthleteTimelinePage({ data, onAdd, onEdit, onDelete, onExport, exporting }: { data: AthleteHubData; onAdd: () => void; onEdit: (activity: AthleteActivity) => void; onDelete: (activity: AthleteActivity) => void; onExport: (format: 'csv' | 'xlsx' | 'pdf', rows: AthleteActivity[]) => void; exporting: boolean }) {
  const [kind, setKind] = useState<'running' | 'all' | AthleteActivityKind>('running');
  const [range, setRange] = useState<'all' | '30' | 'year'>('all');
  const [query, setQuery] = useState('');
  const cutoff = range === '30' ? addDays(localDateKey(), -29) : range === 'year' ? `${localDateKey().slice(0, 4)}-01-01` : '0000-01-01';
  const timeline = useMemo(() => data.activities.filter((activity) => {
    const matchesKind = kind === 'all' || (kind === 'running' ? runningKinds.has(activity.kind) : activity.kind === kind);
    const searchable = `${activity.kind} ${activity.notes} ${activity.source}`.toLowerCase();
    return matchesKind && activity.activityDate >= cutoff && (!query.trim() || searchable.includes(query.trim().toLowerCase()));
  }).sort((first, second) => second.activityDate.localeCompare(first.activityDate) || second.createdAt.localeCompare(first.createdAt)), [cutoff, data.activities, kind, query]);
  const totalDistance = timeline.reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0);
  const totalDuration = timeline.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0), 0);
  return <div className="athlete-hub athlete-timeline-page">
    <div className="finance-export-actions" aria-label="Export filtered activities">{([['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'Print / PDF']] as const).map(([format, label]) =>
      <button className="secondary-button" type="button" disabled={exporting} key={format} onClick={() => onExport(format, timeline)}>{label}</button>)}</div>
    <section className="surface-card athlete-timeline-toolbar"><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Notes, activity or source" /></label><label>Activity<Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="running">Running</option><option value="all">All activities</option>{activityKinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label><label>Period<Select value={range} onChange={(event) => setRange(event.target.value as 'all' | '30' | 'year')}><option value="all">All time</option><option value="30">Last 30 days</option><option value="year">This year</option></Select></label></section>
    <div className="metrics-grid athlete-metrics"><Metric label="Activities" value={new Intl.NumberFormat('en-IN').format(timeline.length)} foot="Matching your current filters" icon={<Activity size={16} />} /><Metric label="Distance" value={formatDistance(totalDistance, data.settings.distanceUnit)} foot="Across the visible timeline" icon={<Footprints size={16} />} /><Metric label="Moving time" value={formatDuration(totalDuration || null)} foot="From activities with duration" icon={<CalendarDays size={16} />} /></div>
    <section className="surface-card athlete-full-timeline"><div className="card-title-row"><div><h3>Activity history</h3><p>Dates, effort and all recorded metrics remain visible together.</p></div><span className="athlete-timeline-count">{timeline.length} record{timeline.length === 1 ? '' : 's'}</span></div>{timeline.length ? <div className="athlete-full-timeline-list">{timeline.map((activity) => <article key={activity.id}><div className="athlete-timeline-date"><b>{formatAthleteDate(activity.activityDate)}</b><small>{activity.source === 'image' ? 'Screenshot import' : activity.source === 'voice' ? 'Previous import' : activity.source === 'manual' ? 'Manual entry' : activity.source.replace('_', ' ')}</small></div><span className="athlete-activity-icon"><IconForActivity kind={activity.kind} /></span><div className="athlete-timeline-main"><b>{activity.kind === 'treadmill' ? 'Treadmill run' : activity.kind[0].toUpperCase() + activity.kind.slice(1)}</b><div className="athlete-timeline-metrics"><span>{formatDistance(activity.distanceMeters, data.settings.distanceUnit)}</span><span>{formatDuration(activity.durationSeconds)}</span><span>{formatPace(activity.distanceMeters, activity.durationSeconds, data.settings.distanceUnit)}</span>{activity.averageHeartRate ? <span>{activity.averageHeartRate} bpm</span> : null}{activity.calories ? <span>{activity.calories} cal</span> : null}{activity.elevationMeters ? <span>+{activity.elevationMeters} m</span> : null}{activity.cadence ? <span>{activity.cadence} spm</span> : null}</div>{activity.notes ? <p>{activity.notes}</p> : null}</div><div className="athlete-activity-stats"><Link className="ghost-button" to={athleteActivityPath(activity.id)}>Details</Link><button className="ghost-button" type="button" onClick={() => onEdit(activity)}><Pencil size={14} /> Edit</button><button className="ghost-button danger" type="button" onClick={() => onDelete(activity)}><Trash2 size={14} /> Delete</button></div></article>)}</div> : <EmptyPanel icon={<Footprints size={20} />} title="No activities found" description="Try another filter, or add a new training activity." action={<button type="button" className="primary-button" onClick={onAdd}><Plus size={15} /> Add activity</button>} />}</section>
  </div>;
}

export function AthleteHub({ onNotify }: { onNotify: (message: string) => void }) {
  const { data, loading, error, refresh } = useAthleteData(true);
  const [period, setPeriod] = useState<Period>('month');
  const [customStart, setCustomStart] = useState(addDays(localDateKey(), -29));
  const [customEnd, setCustomEnd] = useState(localDateKey());
  const [calendarMonth, setCalendarMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1, 12); });
  const [activityEditor, setActivityEditor] = useState<ActivityEditor | null>(null);
  const workoutFileInput = useRef<HTMLInputElement>(null);
  const workoutPending = useRef(false);
  const [readingWorkout, setReadingWorkout] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState<Partial<PlannedWorkoutDraft> | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<Partial<Omit<RecoveryScore, 'id'>> | null>(null);
  const [showRace, setShowRace] = useState(false);
  const [raceDraft, setRaceDraft] = useState<Partial<Omit<Race, 'id'>> | null>(null);
  const [showGym, setShowGym] = useState(false);
  const [gymDraft, setGymDraft] = useState<Partial<GymSessionDraft> | null>(null);
  const [showGoal, setShowGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Partial<AthleteGoalDraft> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pageParams, setPageParams] = useSearchParams();
  const athletePage = athleteTabs.find(([tab]) => tab === pageParams.get('tab'))?.[0] ?? 'dashboard';
  const setAthletePage = (tab: typeof athleteTabs[number][0]) => setPageParams(tab === 'dashboard' ? {} : { tab }, { replace: true });
  const [calendarDate, setCalendarDate] = useState('');
  const [customBestDistance, setCustomBestDistance] = useState('');
  const [exporting, setExporting] = useState(false);
  const screenshotBusy = useRef(false);
  const screenshotAbort = useRef<AbortController | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [screenshotProgress, setScreenshotProgress] = useState('');
  const [screenshotReaderError, setScreenshotReaderError] = useState('');
  const [screenshotImportOpen, setScreenshotImportOpen] = useState(false);
  const [screenshotDrafts, setScreenshotDrafts] = useState<ScreenshotDraft[]>([]);
  const [pendingRecognition, setPendingRecognition] = useState<PendingRecognition | null>(null);
  useEffect(() => () => screenshotAbort.current?.abort(), []);

  const settings = data?.settings;
  const bounds = periodBounds(period, customStart, customEnd);
  const activities = data?.activities ?? emptyActivities;
  const recentActivities = useMemo(() => activities.filter((activity) => activity.kind !== 'cycle').sort((first, second) => second.activityDate.localeCompare(first.activityDate) || second.createdAt.localeCompare(first.createdAt)).slice(0, 3), [activities]);
  const rangeActivities = useMemo(() => activities.filter((activity) => inRange(activity.activityDate, bounds.start, bounds.end)), [activities, bounds.end, bounds.start]);
  const runningActivities = useMemo(() => rangeActivities.filter((activity) => runningKinds.has(activity.kind)), [rangeActivities]);
  const runningDistance = runningActivities.reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0);
  const allDistance = rangeActivities.filter((activity) => activity.kind !== 'cycle').reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0);
  const totalSeconds = runningActivities.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0), 0);
  const totalCalories = rangeActivities.filter((activity) => activity.kind !== 'cycle').reduce((sum, activity) => sum + (activity.calories ?? 0), 0);
  const averagePace = formatPace(runningDistance || null, totalSeconds || null, settings?.distanceUnit ?? 'km');
  const recovery = data?.recoveryScores.find((score) => score.recoveryDate === localDateKey()) ?? null;
  const planned = (data?.plannedWorkouts ?? []).filter((workout) => workout.status === 'planned' && workout.workoutDate >= localDateKey()).slice(0, 4);
  const nextRace = (data?.races ?? []).filter((race) => race.raceDate >= localDateKey()).sort((first, second) => first.raceDate.localeCompare(second.raceDate))[0];
  const personalRecords = useMemo(() => personalBests(activities), [activities]);

  const openRecognizedRecord = ({ route, details, file, files }: PendingRecognition) => {
    if (route.destination === 'recovery') {
      const existing = data?.recoveryScores.find((entry) => entry.recoveryDate === route.recovery.recoveryDate);
      setRecoveryDraft({ ...existing, ...route.recovery, notes: existing?.notes ?? '', metrics: { ...existing?.metrics, ...Object.fromEntries(Object.entries(route.recovery.metrics ?? {}).filter(([, value]) => value !== undefined)) } });
      setShowScore(true);
      return;
    }
    if (route.destination === 'gym') { setGymDraft(route.gym); setShowGym(true); return; }
    if (route.destination === 'goal') { setGoalDraft(route.goal); setShowGoal(true); return; }
    if (route.destination === 'race') { setRaceDraft(route.race); setShowRace(true); return; }
    if (route.destination === 'plan') { setPlanDraft(route.plan); setShowPlan(true); return; }
    setActivityEditor({ draft: { ...route.activity, source: details?.source === 'Samsung Health' ? 'samsung_health' : 'image' },
      details, imported: true, screenshots: files ?? (file ? [file] : []) });
  };
  const reviewRecognizedRecord = (image: ScreenshotDraft) => {
    setPendingRecognition({ ...image, id: crypto.randomUUID() });
    onNotify('Screenshot details are ready for confirmation.');
  };
  const advanceScreenshotDraft = () => {
    if (!screenshotDrafts.length) return false;
    const remaining = screenshotDrafts.slice(1);
    setScreenshotDrafts(remaining);
    if (remaining[0]) { reviewRecognizedRecord(remaining[0]); onNotify(`${remaining.length} screenshot draft${remaining.length === 1 ? '' : 's'} remaining.`); }
    else onNotify('All screenshot drafts were saved.');
    return true;
  };
  const discardScreenshotDrafts = () => {
    if (!screenshotDrafts.length) return;
    setScreenshotDrafts([]);
    onNotify('Remaining screenshot drafts were discarded. No unconfirmed record was saved.');
  };
  const discardPendingRecognition = () => {
    if (!pendingRecognition) return;
    if (screenshotDrafts.length) {
      const remaining = screenshotDrafts.slice(1);
      setScreenshotDrafts(remaining);
      setPendingRecognition(null);
      if (remaining[0]) reviewRecognizedRecord(remaining[0]);
      else onNotify('Screenshot draft discarded.');
      return;
    }
    setPendingRecognition(null);
    onNotify('Recognized details discarded.');
  };

  const saveActivity = async (draft: AthleteActivityDraft, id?: string, details?: WorkoutDetails, batch?: ActivityMediaBatch) => {
    await saveAthleteActivity(draft, id, details, batch);
    await refresh();
    if (screenshotDrafts.length) {
      setActivityEditor(null);
      if (advanceScreenshotDraft()) return;
    }
    setActivityEditor(null);
    onNotify(id ? 'Activity updated.' : 'Activity logged. Your Athlete Hub has been updated.');
  };
  const deleteActivity = async (activity: AthleteActivity) => {
    if (!window.confirm(`Delete this ${activity.kind} on ${formatAthleteDate(activity.activityDate)}?`)) return;
    try { await deleteAthleteActivity(activity.id); await refresh(); onNotify('Activity deleted.'); } catch (caught) { onNotify(errorMessage(caught)); }
  };
  const deleteRecord = async (recordType: 'planned_workout' | 'race' | 'gym_session' | 'goal', id: string, label: string) => {
    if (!window.confirm(`Delete “${label}” from Athlete Hub?`)) return;
    try { await deleteAthleteRecord(recordType, id); await refresh(); onNotify('Athlete Hub record deleted.'); } catch (caught) { onNotify(errorMessage(caught)); }
  };
  const saveSettings = async (next: AthleteSettings) => {
    await saveAthleteSettings(next);
    await refresh();
    onNotify('Athlete Hub settings updated.');
  };
  const deleteAll = async () => {
    if (!window.confirm('Delete every Athlete Hub activity, goal, plan, recovery score, race and gym entry? This cannot be undone.')) return;
    try { await deleteAllAthleteData(); await refresh(); onNotify('All Athlete Hub data was deleted.'); } catch (caught) { onNotify(errorMessage(caught)); }
  };

  const closeActivityEditor = () => {
    discardScreenshotDrafts();
    setActivityEditor(null);
  };
  const importWorkout = async (file: File) => {
    if (workoutPending.current) return;
    workoutPending.current = true;
    setReadingWorkout(true);
    try {
      const { readWorkoutFile } = await import('@/lib/athlete-workout-file');
      const imported = await readWorkoutFile(file, settings?.timezone ?? 'Asia/Kolkata');
      setActivityEditor({ ...imported, imported: true });
    } catch (caught) {
      onNotify(errorMessage(caught));
    } finally {
      workoutPending.current = false;
      setReadingWorkout(false);
    }
  };

  const readScreenshots = async (files: File[], combine: boolean) => {
    if (screenshotBusy.current) return;
    screenshotBusy.current = true;
    const controller = new AbortController();
    screenshotAbort.current = controller;
    setScreenshotReaderError('');
    setScreenshotProgress('Preparing the local image reader…');
    setReadingImage(true);
    try {
      const { readAthleteScreenshots } = await import('@/lib/athlete-ocr');
      const results = await readAthleteScreenshots(files, { signal: controller.signal, onProgress: setScreenshotProgress });
      if (controller.signal.aborted) return;
      const drafts: ScreenshotDraft[] = [];
      const failures: string[] = [];
      let duplicates = 0;
      const bundle: typeof results = [];
      const unit = settings?.distanceUnit ?? 'km';
      const reference = recognitionReferenceDate(settings?.timezone ?? 'Asia/Kolkata');
      for (const [index, result] of results.entries()) {
        if (result.duplicateOf) { duplicates += 1; continue; }
        if (result.error) { failures.push(`${result.fileName}: ${result.error}`); continue; }
        if (combine) { bundle.push(result); continue; }
        const parsed = /workout duration|advanced running metrics|galaxy watch|heart rate zones/i.test(result.readings[0]?.text ?? '')
          ? recognizeSamsungScreenshots([result], unit, reference) : null;
        const route = parsed?.route ?? recognizeWhoopRecovery(result.readings, unit, settings?.timezone ?? 'Asia/Kolkata') ?? recognizeScreenshot(result.readings, unit, reference);
        if (!route) { failures.push(result.fileName + ': no reliable fitness metrics found'); continue; }
        const details = parsed?.details ?? (route.destination === 'activity' ? { metrics: {}, fingerprints: [result.fingerprint] } : undefined);
        drafts.push({ fileName: result.fileName, route, file: files[index], fingerprint: result.fingerprint, details });
      }
      if (combine && bundle.length) {
        const parsed = recognizeSamsungScreenshots(bundle, unit, reference);
        if (parsed) {
          const group = results.flatMap((result, index) => result.fingerprint && !result.duplicateOf ? [{ result, file: files[index] }] : []);
          drafts.push({ route: parsed.route, fileName: group.length + ' screenshots · one workout', files: group.map(({ file }) => file),
            fingerprint: bundle[0].fingerprint, details: { ...parsed.details, fingerprints: group.map(({ result }) => result.fingerprint) } });
        }
      }
      if (!drafts.length) {
        setScreenshotReaderError(failures.join('\n') || 'No readable fitness details found. Try a clearer screenshot with the activity labels and values.');
        return;
      }
      if (failures.length) drafts[0].route.warnings = [...(drafts[0].route.warnings ?? []), ...failures];
      setScreenshotDrafts(drafts);
      reviewRecognizedRecord(drafts[0]);
      setScreenshotImportOpen(false);
      onNotify(`${drafts.length} screenshot draft${drafts.length === 1 ? '' : 's'} ready. ${duplicates ? `${duplicates} repeated file(s) skipped. ` : ''}${failures.length ? `${failures.length} file(s) could not be read; see review details.` : 'Nothing is saved until you confirm.'}`);
    } catch (caught) {
      if (!controller.signal.aborted) setScreenshotReaderError(`The screenshot could not be read. ${errorMessage(caught)}`);
    } finally {
      screenshotBusy.current = false;
      screenshotAbort.current = null;
      setReadingImage(false);
      setScreenshotProgress('');
    }
  };

  if (loading || !data || !settings) return <div className="surface-card"><EmptyPanel icon={<Activity size={20} />} title={error ? 'Athlete Hub could not load' : 'Loading Athlete Hub'} description={error || 'Your private training records are loading.'} action={error ? <button type="button" className="secondary-button" onClick={() => void refresh()}>Try again</button> : undefined} /></div>;


  const removeRecovery = async (score: RecoveryScore) => {
    if (!window.confirm('Delete the recovery entry for ' + formatAthleteDate(score.recoveryDate) + '?')) return;
    try { await deleteRecoveryScore(score.id); await refresh(); onNotify('Recovery entry deleted.'); }
    catch (caught) { onNotify(errorMessage(caught)); }
  };
  const exportTraining = async (format: 'csv' | 'xlsx' | 'pdf', rows: AthleteActivity[]) => {
    setExporting(true);
    try {
      await downloadReport({
        title: 'Athlete Hub activity report', filename: 'athlete-activities',
        summary: [rows.length + ' sessions in the filtered activity list'],
        headers: ['Date', 'Activity', 'Distance (km)', 'Duration (s)', 'Avg heart rate (bpm)', 'Calories', 'Cadence (spm)', 'Source', 'Notes'],
        rows: rows.map((activity) => [
          activity.activityDate, activity.kind, activity.distanceMeters === null ? '' : activity.distanceMeters / 1000,
          activity.durationSeconds ?? '', activity.averageHeartRate ?? '', activity.calories ?? '', activity.cadence ?? '', activity.source, activity.notes,
        ]),
      }, format);
    } catch (caught) { onNotify(errorMessage(caught)); }
    finally { setExporting(false); }
  };
  const calendar = <AthleteCalendar data={data} month={calendarMonth} onDate={setCalendarDate} onSelectMonth={setCalendarMonth}
    onChangeMonth={(amount) => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12))} />;
  const bestTarget = Number(customBestDistance);
  const customBest = bestTarget > 0 ? bestAtDistance(activities, metersFromDistance(bestTarget, settings.distanceUnit)) : undefined;
  const bests = <section className="surface-card athlete-pr-card">
    <div className="card-title-row"><div><h3>Personal bests</h3><p>Fastest recorded finishes. The workout must reach the target and finish within 2% of it.</p></div><Trophy size={18} /></div>
    <div className="athlete-pr-list">{personalRecords.map(({ label, activity }) => <div key={label}><span>{label}</span><b>{activity ? formatDuration(activity.durationSeconds) : '—'}</b>
      {activity ? <Link className="text-button" to={athleteActivityPath(activity.id)}>{formatAthleteDate(activity.activityDate)}</Link> : <small>No qualifying run</small>}
    </div>)}</div>
    {athletePage === 'records' ? <div className="form-grid"><label>Custom distance ({settings.distanceUnit})<input type="number" min="0.01" step="any" value={customBestDistance} onChange={(event) => setCustomBestDistance(event.target.value)} /></label>
      {bestTarget > 0 ? <div>{customBest ? <Link className="text-button" to={athleteActivityPath(customBest.id)}>{formatDuration(customBest.durationSeconds)} · {formatAthleteDate(customBest.activityDate)}</Link> : <p className="form-hint">No qualifying run at this distance.</p>}</div> : null}</div> : null}
    <button className="text-button" type="button" onClick={() => setShowGoal(true)}><Target size={14} /> Create distance goal</button>
  </section>;
  const dayScore = data.recoveryScores.find((entry) => entry.recoveryDate === calendarDate);
  const dayActivities = activities.filter((entry) => entry.activityDate === calendarDate && entry.kind !== 'cycle');
  const dayPlans = data.plannedWorkouts.filter((entry) => entry.workoutDate === calendarDate && entry.status === 'planned');
  const dayRaces = data.races.filter((entry) => entry.raceDate === calendarDate);
  const calendarDay = calendarDate ? <SimpleModal title={formatAthleteDate(calendarDate)} onClose={() => setCalendarDate('')}>
    <div className="modal-form">
      {dayActivities.map((entry) => <Link key={entry.id} className="secondary-button" to={athleteActivityPath(entry.id)}>{entry.kind} · {formatDistance(entry.distanceMeters, settings.distanceUnit)} · {formatDuration(entry.durationSeconds)}</Link>)}
      {dayPlans.map((entry) => <p key={entry.id}>Plan · {entry.title}</p>)}
      {dayRaces.map((entry) => <p key={entry.id}>Race · {entry.name}</p>)}
      <p>{dayScore ? 'Recovery · ' + dayScore.score + '%' : 'No recovery score recorded.'}</p>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => { setRecoveryDraft(dayScore ?? { recoveryDate: calendarDate }); setCalendarDate(''); setShowScore(true); }}>{dayScore ? 'Edit recovery' : 'Log recovery'}</button>
        <button className="primary-button" type="button" onClick={() => { setActivityEditor({ draft: { activityDate: calendarDate } }); setCalendarDate(''); }}>Add activity</button></div>
    </div>
  </SimpleModal> : null;






  return <div className="athlete-hub">
    {calendarDay}
    <input type="file" ref={workoutFileInput} accept={workoutFileAccept} hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importWorkout(file); }} />
    <SectionHeading title="Athlete Hub" description="A private training journal for your runs, recovery, races and essential strength work." action={<><button className="secondary-button" type="button" onClick={() => setShowSettings(true)}><Settings size={15} /> Settings</button><button className="secondary-button athlete-screenshot-button" type="button" disabled={readingImage} onClick={() => setScreenshotImportOpen(true)}><FileImage size={15} />{readingImage ? 'Reading…' : 'Read screenshots'}</button><button className="secondary-button" type="button" disabled={readingWorkout} onClick={() => workoutFileInput.current?.click()}>{readingWorkout ? 'Reading workout…' : 'Import workout file'}</button><button className="primary-button header-action athlete-add-activity" type="button" onClick={() => setActivityEditor({})}><span className="header-action-icon" aria-hidden="true"><Plus size={15} strokeWidth={2} /></span><span>Add activity</span></button></>} />
    <nav className="athlete-analysis-nav" aria-label="Athlete Hub pages">
      {athleteTabs.map(([id, label]) =>
        <button type="button" key={id} className={athletePage === id ? 'active' : undefined} aria-current={athletePage === id ? 'page' : undefined} onClick={() => setAthletePage(id)}>{label}</button>)}
    </nav>
    {athletePage === 'analysis' ? <AthleteAnalysis data={data} onTimeline={() => setAthletePage('timeline')} /> : null}
    {athletePage === 'timeline' ? <AthleteTimelinePage data={data} exporting={exporting} onExport={(format, rows) => void exportTraining(format, rows)}
      onAdd={() => setActivityEditor({})} onEdit={(activity) => setActivityEditor({ entry: activity })} onDelete={(activity) => void deleteActivity(activity)} /> : null}
    {athletePage === 'recovery' ? <RecoveryHistory scores={data.recoveryScores} onAdd={() => setShowScore(true)} onEdit={(score) => { setRecoveryDraft(score); setShowScore(true); }} onDelete={(score) => void removeRecovery(score)} /> : null}
    {athletePage === 'calendar' ? calendar : null}
    {athletePage === 'records' ? bests : null}
    {athletePage === 'dashboard' ? <>

    <div className="athlete-toolbar surface-card"><div className="athlete-period-control"><span>View</span><Select value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="week">Last 7 days</option><option value="month">This month</option><option value="year">This year</option><option value="all">All time</option><option value="custom">Custom range</option></Select>{period === 'custom' ? <div className="athlete-custom-dates"><DatePicker label="From" value={customStart} onChange={setCustomStart} max={customEnd} /><DatePicker label="To" value={customEnd} onChange={setCustomEnd} min={customStart} /></div> : null}</div></div>
    <div className="metrics-grid athlete-metrics"><Metric label="Running distance" value={formatDistance(runningDistance, settings.distanceUnit)} foot={`${runningActivities.length} run${runningActivities.length === 1 ? '' : 's'} in this view`} icon={<Footprints size={16} />} /><Metric label="Run and walk distance" value={formatDistance(allDistance, settings.distanceUnit)} foot="Running and walking combined" icon={<Activity size={16} />} /><Metric label="Average pace" value={averagePace} foot={totalSeconds ? `${formatDuration(totalSeconds)} running time` : 'Add duration to calculate'} icon={<Sparkles size={16} />} /><Metric label="Energy logged" value={new Intl.NumberFormat('en-IN').format(totalCalories)} foot="Calories recorded in this view" icon={<HeartPulse size={16} />} /></div>
    <div className="content-grid athlete-overview-grid"><section className="surface-card athlete-today-card"><div className="card-title-row"><div><h3>Today’s readiness</h3><p>Recovery and your next useful action.</p></div><button type="button" className="text-button" onClick={() => setShowScore(true)}><Plus size={14} /> Log score</button></div><div className="athlete-readiness"><div className={`athlete-recovery-ring ${recovery ? recovery.source === 'whoop' ? whoopTone(recovery.score) : recoveryTone(recovery.score) : 'empty'}`}><b>{recovery?.score ?? '—'}</b><span>{recovery ? 'Recovery' : 'No score'}</span></div><div><strong>{recovery ? recovery.score >= 67 ? 'High recovery' : recovery.score >= 34 ? 'Moderate recovery' : 'Low recovery' : 'Check in with yourself'}</strong><p>{recovery?.notes || 'Log a recovery check-in for today.'}</p></div></div>{nextRace ? <div className="athlete-race-banner"><Flag size={15} /><span><b>{nextRace.name}</b>{nextRace.distanceMeters ? ` · ${formatDistance(nextRace.distanceMeters, settings.distanceUnit)}` : ''}</span><strong>{Math.max(0, daysBetween(localDateKey(), nextRace.raceDate))} days</strong><button className="ghost-button danger" aria-label={`Delete ${nextRace.name}`} type="button" onClick={() => void deleteRecord('race', nextRace.id, nextRace.name)}><Trash2 size={13} /></button></div> : <button className="athlete-add-race" type="button" onClick={() => setShowRace(true)}><Flag size={15} /> Add a race countdown</button>}</section><section className="surface-card athlete-plan-card"><div className="card-title-row"><div><h3>Coming up</h3><p>Planned sessions and races stay in sight.</p></div><button type="button" className="text-button" onClick={() => setShowPlan(true)}><Plus size={14} /> Plan</button></div>{planned.length ? <div className="athlete-upcoming-list">{planned.map((workout) => <div key={workout.id}><span className="athlete-date-chip">{formatAthleteDate(workout.workoutDate)}</span><p><b>{workout.title}</b><small>{workout.targetDistanceMeters ? formatDistance(workout.targetDistanceMeters, settings.distanceUnit) : activityKinds.find((item) => item.value === workout.kind)?.label}</small></p><button className="ghost-button danger" aria-label={`Delete ${workout.title}`} type="button" onClick={() => void deleteRecord('planned_workout', workout.id, workout.title)}><Trash2 size={13} /></button></div>)}</div> : <div className="athlete-empty-inline"><CalendarDays size={16} /><span>No planned workouts. Add the next one when you are ready.</span></div>}</section></div>
    <div className="content-grid athlete-training-grid">{calendar}{bests}</div>
    <div className="content-grid athlete-bottom-grid"><section className="surface-card athlete-goals-card"><div className="card-title-row"><div><h3>Distance goals</h3><p>Progress updates from your completed activity log.</p></div><button type="button" className="text-button" onClick={() => setShowGoal(true)}><Plus size={14} /> Goal</button></div>{data.goals.filter((goal) => goal.isActive).length ? <div className="athlete-goal-list">{data.goals.filter((goal) => goal.isActive).map((goal) => { const covered = activities.filter((activity) => inRange(activity.activityDate, goal.startsOn, goal.endsOn)).reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0); return <div className="athlete-goal-row" key={goal.id}><ProgressRow label={goal.title} detail={<>{formatDistance(covered, settings.distanceUnit)} of <b>{formatDistance(goal.targetDistanceMeters, settings.distanceUnit)}</b> · ends {formatAthleteDate(goal.endsOn)}</>} progress={covered / goal.targetDistanceMeters * 100} /><button className="ghost-button danger" type="button" aria-label={`Delete ${goal.title}`} onClick={() => void deleteRecord('goal', goal.id, goal.title)}><Trash2 size={13} /></button></div>; })}</div> : <div className="athlete-empty-inline"><Target size={16} /><span>Create a running-distance goal for clear momentum.</span></div>}</section><section className="surface-card athlete-strength-card"><div className="card-title-row"><div><h3>Strength for runners</h3><p>Minimal gym logging that supports your training.</p></div><button type="button" className="text-button" onClick={() => setShowGym(true)}><Plus size={14} /> Log strength</button></div>{data.gymSessions.length ? <div className="athlete-strength-summary"><Dumbbell size={19} /><div><b>{data.gymSessions[0].title}</b><small>{formatAthleteDate(data.gymSessions[0].sessionDate)}{data.gymSessions[0].durationMinutes ? ` · ${data.gymSessions[0].durationMinutes} min` : ''}</small></div><button className="ghost-button danger" type="button" aria-label={`Delete ${data.gymSessions[0].title}`} onClick={() => void deleteRecord('gym_session', data.gymSessions[0].id, data.gymSessions[0].title)}><Trash2 size={13} /></button></div> : <div className="athlete-empty-inline"><Dumbbell size={16} /><span>Log simple strength sessions when they help your running.</span></div>}</section></div>
    <section className="surface-card athlete-activity-card"><div className="card-title-row"><div><h3>Recent activity</h3><p>Your latest confirmed training. Open the full timeline for complete history and filters.</p></div><button type="button" className="text-button" onClick={() => setAthletePage('timeline')}>View full timeline</button></div>{recentActivities.length ? <div className="athlete-activity-list">{recentActivities.map((activity) => <article key={activity.id}><span className="athlete-activity-icon"><IconForActivity kind={activity.kind} /></span><div><b>{activity.kind === 'treadmill' ? 'Treadmill run' : activity.kind[0].toUpperCase() + activity.kind.slice(1)}</b><small>{formatAthleteDate(activity.activityDate)} · {formatDistance(activity.distanceMeters, settings.distanceUnit)} · {formatDuration(activity.durationSeconds)} · {formatPace(activity.distanceMeters, activity.durationSeconds, settings.distanceUnit)}</small>{activity.notes ? <p>{activity.notes}</p> : null}</div><div className="athlete-activity-stats"><span>{activity.averageHeartRate ? `${activity.averageHeartRate} bpm` : activity.calories ? `${activity.calories} cal` : 'Manual'}</span><Link className="ghost-button" to={athleteActivityPath(activity.id)}>Details</Link><button className="ghost-button" type="button" onClick={() => setActivityEditor({ entry: activity })}><Pencil size={14} /> Edit</button><button className="ghost-button danger" type="button" onClick={() => void deleteActivity(activity)}><Trash2 size={14} /> Delete</button></div></article>)}</div> : <EmptyPanel icon={<Footprints size={20} />} title="Your training starts here" description="Log a run manually or read a fitness screenshot. Nothing is saved until you confirm it." action={<button className="primary-button" type="button" onClick={() => setActivityEditor({})}><Plus size={16} /> Log your first run</button>} />}</section>
    </> : null}
    {screenshotImportOpen ? <ScreenshotUploadModal reading={readingImage} progress={screenshotProgress} error={screenshotReaderError} onClose={() => { screenshotAbort.current?.abort(); setScreenshotImportOpen(false); }} onFiles={readScreenshots} /> : null}
    {pendingRecognition ? <RecognitionConfirmationModal key={pendingRecognition.id} pending={pendingRecognition} settings={settings} onClose={discardPendingRecognition} onAddInfo={(route) => { const next = { ...pendingRecognition, route }; setPendingRecognition(null); openRecognizedRecord(next); }} /> : null}
    {activityEditor ? <ActivityModal settings={settings} matchingActivities={activities} editor={activityEditor} onClose={closeActivityEditor} onSave={saveActivity} /> : null}
    {showScore ? <RecoveryEditor initial={recoveryDraft} onClose={() => { setShowScore(false); setRecoveryDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveRecoveryScore(input); await refresh(); setShowScore(false); setRecoveryDraft(null); if (advanceScreenshotDraft()) return; onNotify('Recovery score saved.'); }} /> : null}
    {showPlan ? <PlanModal settings={settings} initial={planDraft} onClose={() => { setShowPlan(false); setPlanDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await savePlannedWorkout(input); await refresh(); setShowPlan(false); setPlanDraft(null); if (advanceScreenshotDraft()) return; onNotify('Workout planned.'); }} /> : null}
    {showRace ? <RaceModal settings={settings} initial={raceDraft} onClose={() => { setShowRace(false); setRaceDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveRace(input); await refresh(); setShowRace(false); setRaceDraft(null); if (advanceScreenshotDraft()) return; onNotify('Race added.'); }} /> : null}
    {showGym ? <GymModal settings={settings} initial={gymDraft} onClose={() => { setShowGym(false); setGymDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveGymSession(input); await refresh(); setShowGym(false); setGymDraft(null); if (advanceScreenshotDraft()) return; onNotify('Strength session saved.'); }} /> : null}
    {showGoal ? <GoalModal settings={settings} initial={goalDraft} onClose={() => { setShowGoal(false); setGoalDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveAthleteGoal(input); await refresh(); setShowGoal(false); setGoalDraft(null); if (advanceScreenshotDraft()) return; onNotify('Running goal saved.'); }} /> : null}
    {showSettings ? <AthleteSettingsModal settings={settings} onClose={() => setShowSettings(false)} onSave={saveSettings} onDelete={deleteAll} /> : null}
  </div>;
}
