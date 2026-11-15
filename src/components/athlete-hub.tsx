import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  Mic,
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
  routeVoiceAthleteRecord,
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
  type VoiceAthleteRoute,
} from '@/lib/athlete';
import { useAthleteData } from '@/lib/use-athlete-data';

type Period = 'week' | 'month' | 'year' | 'all' | 'custom';
type ActivityEditor = { entry?: AthleteActivity; draft?: Partial<AthleteActivityDraft> };
type ScreenshotDraft = { fileName: string; route: VoiceAthleteRoute };
type PendingRecognition = { route: VoiceAthleteRoute; source: 'voice' | 'image' };
type SpeechAlternative = { transcript: string; confidence?: number };
type SpeechResultLike = ArrayLike<SpeechAlternative> & { isFinal?: boolean };
type SpeechRecognitionEventLike = { resultIndex?: number; results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const activityKinds: Array<{ value: AthleteActivityKind; label: string }> = [
  { value: 'run', label: 'Run' },
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'walk', label: 'Walk' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'race', label: 'Race' },
];
const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const emptyActivities: AthleteActivity[] = [];

function recognitionQuality(text: string): number {
  const normalized = text.toLowerCase();
  const usefulSignals = [
    /\b\d+(?:[.,]\d+)?\s*(?:km|mi)\b/, /(?:duration|moving time|elapsed time|time)\b/,
    /(?:heart rate|\bhr\b|bpm)\b/, /(?:calories|\bkcal\b|\bcal\b)/,
    /(?:elevation|gain)\b/, /(?:cadence|spm)\b/, /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  ].filter((pattern) => pattern.test(normalized)).length;
  const unreadableCharacters = (text.match(/[�]/g) ?? []).length;
  return usefulSignals * 30 + Math.min(text.trim().length, 180) / 12 - unreadableCharacters * 20;
}

function activityMetricCount(route: VoiceAthleteRoute): number {
  return [route.activity.distanceMeters, route.activity.durationSeconds, route.activity.averageHeartRate, route.activity.calories, route.activity.elevationMeters, route.activity.cadence].filter((value) => value !== null && value !== undefined).length;
}

function mostCompleteScreenshotRoute(texts: string[], unit: DistanceUnit): VoiceAthleteRoute | null {
  const candidates = texts.filter((text) => text.trim()).map((text) => ({ text: text.trim(), route: routeVoiceAthleteRecord(text, unit) }));
  if (!candidates.length) return null;
  candidates.sort((first, second) => activityMetricCount(second.route) - activityMetricCount(first.route) || recognitionQuality(second.text) - recognitionQuality(first.text));
  const primary = candidates[0];
  const pickMetric = <Key extends keyof VoiceAthleteRoute['activity']>(key: Key) => candidates.map((candidate) => candidate.route.activity[key]).find((value) => value !== null && value !== undefined) ?? primary.route.activity[key];
  return {
    ...primary.route,
    activity: {
      ...primary.route.activity,
      distanceMeters: pickMetric('distanceMeters'),
      durationSeconds: pickMetric('durationSeconds'),
      averageHeartRate: pickMetric('averageHeartRate'),
      calories: pickMetric('calories'),
      elevationMeters: pickMetric('elevationMeters'),
      cadence: pickMetric('cadence'),
      notes: primary.text,
    },
  };
}

async function enhancedScreenshot(file: File): Promise<Blob | null> {
  try {
    const image = await createImageBitmap(file);
    const largestSide = Math.max(image.width, image.height);
    const scale = Math.min(2, Math.max(.75, 2400 / largestSide));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) { image.close(); return null; }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.filter = 'grayscale(1) contrast(1.55) brightness(1.08)';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}

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

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(date);
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

function ActivityModal({
  settings,
  editor,
  onClose,
  onSave,
}: {
  settings: AthleteSettings;
  editor: ActivityEditor;
  onClose: () => void;
  onSave: (draft: AthleteActivityDraft, id?: string) => Promise<void>;
}) {
  const entry = editor.entry;
  const draft = editor.draft;
  const source: AthleteActivitySource = entry?.source ?? draft?.source ?? 'manual';
  const distance = entry?.distanceMeters ? String((entry.distanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)) : draft?.distanceMeters ? String((draft.distanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)) : '';
  const [kind, setKind] = useState<AthleteActivityKind>(entry?.kind ?? draft?.kind ?? 'run');
  const [activityDate, setActivityDate] = useState(entry?.activityDate ?? draft?.activityDate ?? localDateKey());
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
  const [notesReviewed, setNotesReviewed] = useState(source !== 'image');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const distanceMeters = parseOptionalNumber(distanceValue);
  const durationSeconds = (parseOptionalNumber(hours) ?? 0) * 3600 + (parseOptionalNumber(minutes) ?? 0) * 60 + (parseOptionalNumber(seconds) ?? 0);
  const pace = formatPace(distanceMeters === null ? null : metersFromDistance(distanceMeters, settings.distanceUnit), durationSeconds || null, settings.distanceUnit);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activityDate) { setError('Choose the activity date.'); return; }
    if (distanceMeters !== null && distanceMeters < 0) { setError('Distance cannot be negative.'); return; }
    if (durationSeconds < 0) { setError('Duration cannot be negative.'); return; }
    if (source === 'image' && !notesReviewed) { setError('Review the screenshot notes, then confirm that you checked them.'); return; }
    setSaving(true); setError('');
    try {
      await onSave({
        kind,
        activityDate,
        distanceMeters: distanceMeters === null ? null : metersFromDistance(distanceMeters, settings.distanceUnit),
        durationSeconds: durationSeconds || null,
        averageHeartRate: parseOptionalNumber(heartRate),
        calories: parseOptionalNumber(calories),
        elevationMeters: parseOptionalNumber(elevation),
        cadence: parseOptionalNumber(cadence),
        effort: parseOptionalNumber(effort),
        notes: notes.trim(),
        source,
      }, entry?.id);
    } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };

  return <ModalShell eyebrow={source === 'voice' ? 'Voice draft' : source === 'image' ? 'Screenshot draft' : 'Athlete Hub'} title={entry ? 'Edit activity' : 'Log an activity'} labelId="athlete-activity-title" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      {source !== 'manual' ? <p className="form-hint">We filled what we could from your {source === 'voice' ? 'spoken note' : 'screenshot'}. Review the details before saving.</p> : <p className="modal-description">Capture the essentials first. Pace is calculated automatically when distance and duration are present.</p>}
      <div className="form-grid athlete-form-grid">
        <label>Activity type<select value={kind} onChange={(event) => setKind(event.target.value as AthleteActivityKind)}>{activityKinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <div><DatePicker label="Activity date" value={activityDate} onChange={setActivityDate} /></div>
        <label>Distance ({settings.distanceUnit})<input value={distanceValue} type="number" min="0" step="0.01" inputMode="decimal" onChange={(event) => setDistanceValue(event.target.value)} placeholder="e.g. 10" /></label>
        <label>Auto pace<input value={pace} disabled aria-label="Calculated pace" /></label>
        <div className="full-field athlete-duration"><span>Duration</span><div><label>Hours<input type="number" min="0" value={hours} onChange={(event) => setHours(event.target.value)} placeholder="0" /></label><label>Minutes<input type="number" min="0" max="59" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="0" /></label><label>Seconds<input type="number" min="0" max="59" value={seconds} onChange={(event) => setSeconds(event.target.value)} placeholder="0" /></label></div></div>
        <label>Average HR (bpm)<input type="number" min="20" max="260" value={heartRate} onChange={(event) => setHeartRate(event.target.value)} placeholder="Optional" /></label>
        <label>Calories<input type="number" min="0" value={calories} onChange={(event) => setCalories(event.target.value)} placeholder="Optional" /></label>
        <label>Elevation (m)<input type="number" min="0" value={elevation} onChange={(event) => setElevation(event.target.value)} placeholder="Optional" /></label>
        <label>Cadence (spm)<input type="number" min="1" max="400" value={cadence} onChange={(event) => setCadence(event.target.value)} placeholder="Optional" /></label>
        <label>Effort · 1–10<input type="number" min="1" max="10" value={effort} onChange={(event) => setEffort(event.target.value)} placeholder="Optional" /></label>
        <label className="full-field screenshot-note-field">{source === 'image' ? 'Screenshot notes — review or clear' : 'Notes (optional)'}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1500} placeholder="Route, intervals, how it felt…" /></label>
        {source === 'image' ? <label className="full-field screenshot-note-review"><input type="checkbox" checked={notesReviewed} onChange={(event) => setNotesReviewed(event.target.checked)} /><span>I checked the screenshot notes. I can correct or clear this text before saving.</span></label> : null}
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : entry ? 'Save activity' : 'Save activity'}</button></div>
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
  onFiles: (files: File[]) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const selectFiles = (files: FileList | File[]) => {
    const next = Array.from(files);
    if (next.length) void onFiles(next);
  };
  return <ModalShell eyebrow="Athlete Hub" title="Read fitness screenshots" labelId="athlete-screenshot-import" onClose={reading ? () => undefined : onClose}>
    <div className="screenshot-import">
      <p className="modal-description">Add several running, Samsung Health, WHOOP, treadmill, race, or gym screenshots. Each is read locally in its original and enhanced form, then routed into the matching review form for your approval.</p>
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
      <div className="modal-actions"><button className="secondary-button" type="button" disabled={reading} onClick={onClose}>Cancel</button></div>
    </div>
  </ModalShell>;
}

function SimpleModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <ModalShell eyebrow="Athlete Hub" title={title} labelId={`athlete-${title.toLowerCase().replace(/\s+/g, '-')}`} onClose={onClose}>{children}</ModalShell>;
}

function ScoreModal({ initial, onClose, onSave }: { initial?: Partial<{ recoveryDate: string; score: number; notes: string; source: 'manual' | 'whoop' }> | null; onClose: () => void; onSave: (input: { recoveryDate: string; score: number; notes: string; source: 'manual' | 'whoop' }) => Promise<void> }) {
  const [date, setDate] = useState(initial?.recoveryDate ?? localDateKey()); const [score, setScore] = useState(initial?.score?.toString() ?? ''); const [notes, setNotes] = useState(initial?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = Number(score); if (!Number.isInteger(value) || value < 1 || value > 100) { setError('Enter a recovery score from 1 to 100.'); return; } setSaving(true); try { await onSave({ recoveryDate: date, score: value, notes: notes.trim(), source: 'manual' }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Log recovery" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We filled this recovery check-in from your spoken note. Review it before saving.</p> : <p className="modal-description">A 1–100 score. Low is red, steady is amber, and ready is green.</p>}<div className="form-grid"><div><DatePicker label="Recovery date" value={date} onChange={setDate} /></div><label>Recovery score<input autoFocus type="number" min="1" max="100" value={score} onChange={(event) => setScore(event.target.value)} placeholder="e.g. 78" /></label><label className="full-field">Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={700} placeholder="Sleep, soreness, energy…" /></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save recovery'}</button></div></form></SimpleModal>;
}

function PlanModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<PlannedWorkoutDraft> | null; onClose: () => void; onSave: (draft: PlannedWorkoutDraft) => Promise<void> }) {
  const initialDistance = initial?.targetDistanceMeters === null || initial?.targetDistanceMeters === undefined ? '' : String(Number((initial.targetDistanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)));
  const [title, setTitle] = useState(initial?.title ?? ''); const [date, setDate] = useState(initial?.workoutDate ?? localDateKey()); const [kind, setKind] = useState<AthleteActivityKind>(initial?.kind ?? 'run'); const [distance, setDistance] = useState(initialDistance); const [notes, setNotes] = useState(initial?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!title.trim()) { setError('Give the workout a title.'); return; } const value = parseOptionalNumber(distance); if (value !== null && value < 0) { setError('Distance cannot be negative.'); return; } setSaving(true); try { await onSave({ title: title.trim(), workoutDate: date, kind, targetDistanceMeters: value === null ? null : metersFromDistance(value, settings.distanceUnit), notes: notes.trim() }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Plan a workout" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this upcoming workout from your spoken note. Check the date and details before saving.</p> : <p className="modal-description">Plans are private. A matching manual activity marks the plan complete automatically.</p>}<div className="form-grid"><label className="full-field">Workout title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="e.g. Easy long run" /></label><label>Activity type<select value={kind} onChange={(event) => setKind(event.target.value as AthleteActivityKind)}>{activityKinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div><DatePicker label="Planned date" value={date} onChange={setDate} /></div><label>Target distance ({settings.distanceUnit})<input type="number" min="0" step="0.01" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="Optional" /></label><label>Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Intervals or focus" /></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button></div></form></SimpleModal>;
}

function RaceModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<Omit<Race, 'id'>> | null; onClose: () => void; onSave: (input: Omit<Race, 'id'>) => Promise<void> }) {
  const initialDistance = initial?.distanceMeters === null || initial?.distanceMeters === undefined ? '' : String(Number((initial.distanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)));
  const [name, setName] = useState(initial?.name ?? ''); const [date, setDate] = useState(initial?.raceDate ?? localDateKey()); const [distance, setDistance] = useState(initialDistance); const [location, setLocation] = useState(initial?.location ?? ''); const [notes, setNotes] = useState(initial?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!name.trim()) { setError('Give the race a name.'); return; } const value = parseOptionalNumber(distance); if (value !== null && value < 0) { setError('Distance cannot be negative.'); return; } setSaving(true); try { await onSave({ name: name.trim(), raceDate: date, distanceMeters: value === null ? null : metersFromDistance(value, settings.distanceUnit), location: location.trim(), finishSeconds: initial?.finishSeconds ?? null, notes: notes.trim() }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Add a race" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this race event from your spoken note. Review it before saving.</p> : <p className="modal-description">Keep your race calendar in one private place. We’ll show the countdown automatically.</p>}<div className="form-grid"><label className="full-field">Race name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. Hyderabad Half Marathon" /></label><div><DatePicker label="Race date" value={date} onChange={setDate} /></div><label>Distance ({settings.distanceUnit})<input type="number" min="0" step="0.01" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="Optional" /></label><label>Location (optional)<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} placeholder="City or course" /></label><label>Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1500} placeholder="Goal or preparation" /></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save race'}</button></div></form></SimpleModal>;
}

function GymModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<GymSessionDraft> | null; onClose: () => void; onSave: (input: GymSessionDraft) => Promise<void> }) {
  const firstExercise = initial?.exercises?.[0];
  const [title, setTitle] = useState(initial?.title ?? ''); const [date, setDate] = useState(initial?.sessionDate ?? localDateKey()); const [duration, setDuration] = useState(initial?.durationMinutes?.toString() ?? ''); const [exercise, setExercise] = useState(firstExercise?.exercise ?? ''); const [sets, setSets] = useState(firstExercise?.sets ? String(firstExercise.sets) : ''); const [reps, setReps] = useState(firstExercise?.reps ? String(firstExercise.reps) : ''); const [weight, setWeight] = useState(firstExercise?.weight?.toString() ?? ''); const [notes, setNotes] = useState(initial?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!title.trim()) { setError('Give this strength session a title.'); return; } const durationMinutes = parseOptionalNumber(duration); if (durationMinutes !== null && durationMinutes <= 0) { setError('Duration must be above zero.'); return; } setSaving(true); try { await onSave({ sessionDate: date, title: title.trim(), durationMinutes, exercises: exercise.trim() ? [{ exercise: exercise.trim(), sets: Number(sets) || 0, reps: Number(reps) || 0, weight: parseOptionalNumber(weight) }] : [], notes: notes.trim() }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Log strength work" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this strength entry from your spoken note. Review it before saving.</p> : <p className="modal-description">Keep gym work minimal and useful for your running. Add one key movement now; you can add a new session whenever needed.</p>}<div className="form-grid"><label className="full-field">Session title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="e.g. Lower body strength" /></label><div><DatePicker label="Session date" value={date} onChange={setDate} /></div><label>Duration (minutes)<input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Optional" /></label><label className="full-field">Key exercise (optional)<input value={exercise} onChange={(event) => setExercise(event.target.value)} placeholder="e.g. Split squat" /></label><label>Sets<input type="number" min="0" value={sets} onChange={(event) => setSets(event.target.value)} placeholder="0" /></label><label>Reps<input type="number" min="0" value={reps} onChange={(event) => setReps(event.target.value)} placeholder="0" /></label><label>Weight ({settings.weightUnit})<input type="number" min="0" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Optional" /></label><label className="full-field">Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1500} placeholder="How it felt" /></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save session'}</button></div></form></SimpleModal>;
}

function GoalModal({ settings, initial, onClose, onSave }: { settings: AthleteSettings; initial?: Partial<AthleteGoalDraft> | null; onClose: () => void; onSave: (input: AthleteGoalDraft) => Promise<void> }) {
  const initialDistance = initial?.targetDistanceMeters === undefined ? '' : String(Number((initial.targetDistanceMeters / (settings.distanceUnit === 'mi' ? 1609.344 : 1000)).toFixed(2)));
  const [title, setTitle] = useState(initial?.title ?? ''); const [distance, setDistance] = useState(initialDistance); const [startsOn, setStartsOn] = useState(initial?.startsOn ?? localDateKey()); const [endsOn, setEndsOn] = useState(initial?.endsOn ?? addDays(localDateKey(), 30)); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = parseOptionalNumber(distance); if (!title.trim() || value === null || value <= 0 || endsOn < startsOn) { setError('Add a title, a positive distance, and a valid date range.'); return; } setSaving(true); try { await onSave({ title: title.trim(), targetDistanceMeters: metersFromDistance(value, settings.distanceUnit), startsOn, endsOn }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <SimpleModal title="Create running goal" onClose={onClose}><form className="modal-form" onSubmit={submit}>{initial ? <p className="form-hint">We made this goal from your spoken note. Fill any missing detail before saving.</p> : <p className="modal-description">Your progress is based on logged activity during the goal period.</p>}<div className="form-grid"><label className="full-field">Goal title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="e.g. Run 100 km this month" /></label><label>Target distance ({settings.distanceUnit})<input type="number" min="0.01" step="0.01" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="e.g. 100" /></label><div><DatePicker label="Start date" value={startsOn} onChange={setStartsOn} /></div><div className="full-field"><DatePicker label="End date" value={endsOn} onChange={setEndsOn} min={startsOn} /></div></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save goal'}</button></div></form></SimpleModal>;
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
    <section className="athlete-settings-section"><h3>Units</h3><div className="form-grid"><label>Distance unit<select value={distanceUnit} onChange={(event) => setDistanceUnit(event.target.value as DistanceUnit)}><option value="km">Kilometres</option><option value="mi">Miles</option></select></label><label>Weight unit<select value={weightUnit} onChange={(event) => setWeightUnit(event.target.value as AthleteSettings['weightUnit'])}><option value="kg">Kilograms</option><option value="lb">Pounds</option></select></label></div></section>
    <section className="athlete-settings-section athlete-settings-danger"><h3>Delete Athlete Hub data</h3><p>This permanently removes every Athlete Hub record, but never changes your finance workspace.</p><button type="button" className="ghost-button danger" onClick={() => void onDelete()}><Trash2 size={14} /> Delete all Athlete Hub data</button></section>
    {error ? <p className="form-error">{error}</p> : null}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>
  </form></SimpleModal>;
}

function RecognitionConfirmationModal({ pending, settings, onClose, onAddInfo }: { pending: PendingRecognition; settings: AthleteSettings; onClose: () => void; onAddInfo: () => void }) {
  const { route, source } = pending;
  const kindLabel = route.destination === 'activity' ? 'Activity' : route.destination === 'plan' ? 'Future workout' : route.destination === 'recovery' ? 'Recovery check-in' : route.destination === 'race' ? 'Upcoming race' : route.destination === 'gym' ? 'Strength session' : 'Running goal';
  const details = route.destination === 'activity' ? [
    ['Date', formatAthleteDate(route.date)], ['Type', route.activity.kind ?? 'Run'], ['Distance', formatDistance(route.activity.distanceMeters ?? null, settings.distanceUnit)], ['Duration', formatDuration(route.activity.durationSeconds ?? null)],
  ] : route.destination === 'plan' ? [
    ['Date', formatAthleteDate(route.date)], ['Type', route.plan.kind ?? 'Run'], ['Target', formatDistance(route.plan.targetDistanceMeters ?? null, settings.distanceUnit)],
  ] : route.destination === 'recovery' ? [
    ['Date', formatAthleteDate(route.date)], ['Score', route.recovery.score ? `${route.recovery.score} / 100` : 'Not detected'],
  ] : route.destination === 'race' ? [
    ['Date', formatAthleteDate(route.date)], ['Name', route.race.name ?? 'Upcoming race'], ['Distance', formatDistance(route.race.distanceMeters ?? null, settings.distanceUnit)],
  ] : route.destination === 'gym' ? [
    ['Date', formatAthleteDate(route.date)], ['Session', route.gym.title ?? 'Strength session'], ['Duration', route.gym.durationMinutes ? `${route.gym.durationMinutes} min` : 'Not detected'],
  ] : [
    ['Goal', route.goal.title ?? 'Running goal'], ['Target', formatDistance(route.goal.targetDistanceMeters ?? null, settings.distanceUnit)], ['End date', route.goal.endsOn ? formatAthleteDate(route.goal.endsOn) : 'Not detected'],
  ];
  return <SimpleModal title="Confirm understood details" onClose={onClose}><div className="recognition-confirmation">
    <p className="modal-description">{source === 'voice' ? 'Your spoken note' : 'Your screenshot'} looks like a <b>{kindLabel.toLowerCase()}</b>. This is only a draft; nothing has been saved.</p>
    <div className="recognition-summary"><strong>{kindLabel}</strong>{details.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <p className="form-hint">Choose Add info to open the complete form, edit anything that is wrong or missing, then save it.</p>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Discard</button><button type="button" className="primary-button" onClick={onAddInfo}><Plus size={15} /> Add info</button></div>
  </div></SimpleModal>;
}

function AthleteCalendar({ data, month, onChangeMonth }: { data: AthleteHubData; month: Date; onChangeMonth: (amount: number) => void }) {
  const events = useMemo(() => {
    const map = new Map<string, Array<{ label: string; detail: string; tone: string }>>();
    const push = (date: string, event: { label: string; detail: string; tone: string }) => map.set(date, [...(map.get(date) ?? []), event]);
    data.activities.forEach((activity) => push(activity.activityDate, { label: activity.kind === 'treadmill' ? 'Treadmill' : activity.kind[0].toUpperCase() + activity.kind.slice(1), detail: formatDistance(activity.distanceMeters, data.settings.distanceUnit), tone: 'activity' }));
    data.plannedWorkouts.filter((workout) => workout.status === 'planned').forEach((workout) => push(workout.workoutDate, { label: workout.title, detail: 'Planned', tone: 'planned' }));
    data.races.forEach((race) => push(race.raceDate, { label: race.name, detail: 'Race', tone: 'race' }));
    return map;
  }, [data]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12); const visibleStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay(), 12);
  const dates = Array.from({ length: 42 }, (_, index) => new Date(visibleStart.getFullYear(), visibleStart.getMonth(), visibleStart.getDate() + index, 12)); const today = localDateKey();
  return <section className="surface-card athlete-calendar-card"><div className="card-title-row"><div><h3>Training calendar</h3><p>Runs, plans and races, together in one monthly view.</p></div><div className="athlete-calendar-controls"><button className="calendar-nav" type="button" onClick={() => onChangeMonth(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button><strong>{monthLabel(month)}</strong><button className="calendar-nav" type="button" onClick={() => onChangeMonth(1)} aria-label="Next month"><ChevronRight size={17} /></button></div></div><div className="athlete-calendar-grid athlete-calendar-head">{weekDays.map((day) => <span key={day}>{day}</span>)}</div><div className="athlete-calendar-grid athlete-calendar-days">{dates.map((date) => { const key = dayKey(date); const inMonth = date.getMonth() === month.getMonth(); const items = events.get(key) ?? []; return <div className={`athlete-calendar-cell ${inMonth ? '' : 'outside'} ${key === today ? 'today' : ''}`} key={key}><b>{date.getDate()}</b>{items.slice(0, 2).map((item, index) => <span className={`athlete-calendar-event ${item.tone}`} key={`${item.label}-${index}`} title={`${item.label} · ${item.detail}`}><i>{item.label}</i><em>{item.detail}</em></span>)}{items.length > 2 ? <small>+{items.length - 2} more</small> : null}</div>; })}</div></section>;
}

function AthleteTimelinePage({ data, onBack, onAdd, onEdit, onDelete }: { data: AthleteHubData; onBack: () => void; onAdd: () => void; onEdit: (activity: AthleteActivity) => void; onDelete: (activity: AthleteActivity) => void }) {
  const [kind, setKind] = useState<'all' | AthleteActivityKind>('all');
  const [range, setRange] = useState<'all' | '30' | 'year'>('all');
  const [query, setQuery] = useState('');
  const cutoff = range === '30' ? addDays(localDateKey(), -29) : range === 'year' ? `${localDateKey().slice(0, 4)}-01-01` : '0000-01-01';
  const timeline = useMemo(() => data.activities.filter((activity) => {
    const matchesKind = kind === 'all' || activity.kind === kind;
    const searchable = `${activity.kind} ${activity.notes} ${activity.source}`.toLowerCase();
    return matchesKind && activity.activityDate >= cutoff && (!query.trim() || searchable.includes(query.trim().toLowerCase()));
  }).sort((first, second) => second.activityDate.localeCompare(first.activityDate) || second.createdAt.localeCompare(first.createdAt)), [cutoff, data.activities, kind, query]);
  const totalDistance = timeline.reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0);
  const totalDuration = timeline.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0), 0);
  return <div className="athlete-hub athlete-timeline-page">
    <SectionHeading title="Training timeline" description="Every confirmed activity, ordered from newest to oldest." action={<><button type="button" className="secondary-button" onClick={onBack}>← Athlete Hub</button><button className="primary-button header-action athlete-add-activity" type="button" onClick={onAdd}><span className="header-action-icon" aria-hidden="true"><Plus size={15} strokeWidth={2} /></span><span>Add activity</span></button></>} />
    <section className="surface-card athlete-timeline-toolbar"><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Notes, activity or source" /></label><label>Activity<select value={kind} onChange={(event) => setKind(event.target.value as 'all' | AthleteActivityKind)}><option value="all">All activities</option>{activityKinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Period<select value={range} onChange={(event) => setRange(event.target.value as 'all' | '30' | 'year')}><option value="all">All time</option><option value="30">Last 30 days</option><option value="year">This year</option></select></label></section>
    <div className="metrics-grid athlete-metrics"><Metric label="Activities" value={new Intl.NumberFormat('en-IN').format(timeline.length)} foot="Matching your current filters" icon={<Activity size={16} />} /><Metric label="Distance" value={formatDistance(totalDistance, data.settings.distanceUnit)} foot="Across the visible timeline" icon={<Footprints size={16} />} /><Metric label="Moving time" value={formatDuration(totalDuration || null)} foot="From activities with duration" icon={<CalendarDays size={16} />} /></div>
    <section className="surface-card athlete-full-timeline"><div className="card-title-row"><div><h3>Activity history</h3><p>Dates, effort and all recorded metrics remain visible together.</p></div><span className="athlete-timeline-count">{timeline.length} record{timeline.length === 1 ? '' : 's'}</span></div>{timeline.length ? <div className="athlete-full-timeline-list">{timeline.map((activity) => <article key={activity.id}><div className="athlete-timeline-date"><b>{formatAthleteDate(activity.activityDate)}</b><small>{activity.source === 'image' ? 'Screenshot import' : activity.source === 'voice' ? 'Voice entry' : activity.source === 'manual' ? 'Manual entry' : activity.source.replace('_', ' ')}</small></div><span className="athlete-activity-icon"><IconForActivity kind={activity.kind} /></span><div className="athlete-timeline-main"><b>{activity.kind === 'treadmill' ? 'Treadmill run' : activity.kind[0].toUpperCase() + activity.kind.slice(1)}</b><div className="athlete-timeline-metrics"><span>{formatDistance(activity.distanceMeters, data.settings.distanceUnit)}</span><span>{formatDuration(activity.durationSeconds)}</span><span>{formatPace(activity.distanceMeters, activity.durationSeconds, data.settings.distanceUnit)}</span>{activity.averageHeartRate ? <span>{activity.averageHeartRate} bpm</span> : null}{activity.calories ? <span>{activity.calories} cal</span> : null}{activity.elevationMeters ? <span>+{activity.elevationMeters} m</span> : null}{activity.cadence ? <span>{activity.cadence} spm</span> : null}</div>{activity.notes ? <p>{activity.notes}</p> : null}</div><div className="athlete-activity-stats"><button className="ghost-button" type="button" onClick={() => onEdit(activity)}><Pencil size={14} /> Edit</button><button className="ghost-button danger" type="button" onClick={() => onDelete(activity)}><Trash2 size={14} /> Delete</button></div></article>)}</div> : <EmptyPanel icon={<Footprints size={20} />} title="No activities found" description="Try another filter, or add a new training activity." action={<button type="button" className="primary-button" onClick={onAdd}><Plus size={15} /> Add activity</button>} />}</section>
  </div>;
}

export function AthleteHub({ onNotify }: { onNotify: (message: string) => void }) {
  const { data, loading, error, refresh } = useAthleteData(true);
  const [period, setPeriod] = useState<Period>('month');
  const [customStart, setCustomStart] = useState(addDays(localDateKey(), -29));
  const [customEnd, setCustomEnd] = useState(localDateKey());
  const [calendarMonth, setCalendarMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1, 12); });
  const [activityEditor, setActivityEditor] = useState<ActivityEditor | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [voicePlanDraft, setVoicePlanDraft] = useState<Partial<PlannedWorkoutDraft> | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [voiceRecoveryDraft, setVoiceRecoveryDraft] = useState<Partial<{ recoveryDate: string; score: number; notes: string; source: 'manual' | 'whoop' }> | null>(null);
  const [showRace, setShowRace] = useState(false);
  const [voiceRaceDraft, setVoiceRaceDraft] = useState<Partial<Omit<Race, 'id'>> | null>(null);
  const [showGym, setShowGym] = useState(false);
  const [voiceGymDraft, setVoiceGymDraft] = useState<Partial<GymSessionDraft> | null>(null);
  const [showGoal, setShowGoal] = useState(false);
  const [voiceGoalDraft, setVoiceGoalDraft] = useState<Partial<AthleteGoalDraft> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [athletePage, setAthletePage] = useState<'dashboard' | 'timeline'>('dashboard');
  const [listening, setListening] = useState(false);
  const voiceRecognition = useRef<SpeechRecognitionLike | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [screenshotProgress, setScreenshotProgress] = useState('');
  const [screenshotReaderError, setScreenshotReaderError] = useState('');
  const [screenshotImportOpen, setScreenshotImportOpen] = useState(false);
  const [screenshotDrafts, setScreenshotDrafts] = useState<ScreenshotDraft[]>([]);
  const [pendingRecognition, setPendingRecognition] = useState<PendingRecognition | null>(null);

  const settings = data?.settings;
  const bounds = periodBounds(period, customStart, customEnd);
  const activities = data?.activities ?? emptyActivities;
  const recentActivities = useMemo(() => [...activities].sort((first, second) => second.activityDate.localeCompare(first.activityDate) || second.createdAt.localeCompare(first.createdAt)).slice(0, 3), [activities]);
  const rangeActivities = useMemo(() => activities.filter((activity) => inRange(activity.activityDate, bounds.start, bounds.end)), [activities, bounds.end, bounds.start]);
  const runningActivities = useMemo(() => rangeActivities.filter((activity) => ['run', 'treadmill', 'race'].includes(activity.kind)), [rangeActivities]);
  const runningDistance = runningActivities.reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0);
  const allDistance = rangeActivities.reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0);
  const totalSeconds = runningActivities.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0), 0);
  const totalCalories = rangeActivities.reduce((sum, activity) => sum + (activity.calories ?? 0), 0);
  const averagePace = formatPace(runningDistance || null, totalSeconds || null, settings?.distanceUnit ?? 'km');
  const recovery = data?.recoveryScores.find((score) => score.recoveryDate <= localDateKey()) ?? null;
  const planned = (data?.plannedWorkouts ?? []).filter((workout) => workout.status === 'planned' && workout.workoutDate >= localDateKey()).slice(0, 4);
  const nextRace = (data?.races ?? []).filter((race) => race.raceDate >= localDateKey()).sort((first, second) => first.raceDate.localeCompare(second.raceDate))[0];
  const personalRecords = useMemo(() => {
    const targets = [1000, 5000, 10_000, 21_097.5, 42_195];
    return targets.map((target) => {
      const candidate = activities.filter((activity) => ['run', 'treadmill', 'race'].includes(activity.kind) && activity.distanceMeters && activity.durationSeconds && activity.distanceMeters >= target * .98).sort((first, second) => ((first.durationSeconds ?? Number.MAX_SAFE_INTEGER) / (first.distanceMeters ?? 1)) - ((second.durationSeconds ?? Number.MAX_SAFE_INTEGER) / (second.distanceMeters ?? 1)))[0];
      return { label: target === 1000 ? '1K' : target === 5000 ? '5K' : target === 10_000 ? '10K' : target < 30_000 ? 'Half' : 'Marathon', activity: candidate };
    });
  }, [activities]);

  const openRecognizedRecord = ({ route, source }: PendingRecognition) => {
    if (route.destination === 'recovery') { setVoiceRecoveryDraft(route.recovery); setShowScore(true); return; }
    if (route.destination === 'gym') { setVoiceGymDraft(route.gym); setShowGym(true); return; }
    if (route.destination === 'goal') { setVoiceGoalDraft(route.goal); setShowGoal(true); return; }
    if (route.destination === 'race') { setVoiceRaceDraft(route.race); setShowRace(true); return; }
    if (route.destination === 'plan') { setVoicePlanDraft(route.plan); setShowPlan(true); return; }
    setActivityEditor({ draft: { ...route.activity, source: source === 'image' ? 'image' : 'voice' } });
  };
  const reviewRecognizedRecord = (route: VoiceAthleteRoute, source: PendingRecognition['source']) => {
    setPendingRecognition({ route, source });
    onNotify(`${source === 'voice' ? 'Voice' : 'Screenshot'} details are ready for confirmation.`);
  };
  const advanceScreenshotDraft = () => {
    if (!screenshotDrafts.length) return false;
    const remaining = screenshotDrafts.slice(1);
    setScreenshotDrafts(remaining);
    if (remaining[0]) { reviewRecognizedRecord(remaining[0].route, 'image'); onNotify(`${remaining.length} screenshot draft${remaining.length === 1 ? '' : 's'} remaining.`); }
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
    if (pendingRecognition.source === 'image' && screenshotDrafts.length) {
      const remaining = screenshotDrafts.slice(1);
      setScreenshotDrafts(remaining);
      setPendingRecognition(null);
      if (remaining[0]) reviewRecognizedRecord(remaining[0].route, 'image');
      else onNotify('Screenshot draft discarded.');
      return;
    }
    setPendingRecognition(null);
    onNotify('Recognized details discarded.');
  };

  const saveActivity = async (draft: AthleteActivityDraft, id?: string) => {
    await saveAthleteActivity(draft, id);
    await refresh();
    if (!id && screenshotDrafts.length) {
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

  const startVoice = () => {
    const SpeechCtor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechCtor) { onNotify('Voice entry is not available in this browser. Use quick entry instead.'); return; }
    const recognition = new SpeechCtor();
    let transcript = '';
    let hadError = false;
    recognition.lang = navigator.languages?.[0] || navigator.language || 'en-IN'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 5;
    recognition.onresult = (event) => {
      transcript = Array.from(event.results).filter((result) => result.isFinal ?? true).map((result) => Array.from(result).map((option) => ({ transcript: option.transcript?.trim() ?? '', confidence: option.confidence ?? 0 })).sort((first, second) => (second.confidence * 100 + recognitionQuality(second.transcript)) - (first.confidence * 100 + recognitionQuality(first.transcript)))[0]?.transcript ?? '').filter(Boolean).join(' ').trim();
    };
    recognition.onerror = () => { hadError = true; setListening(false); voiceRecognition.current = null; onNotify('Voice capture stopped. Please try again or use quick entry.'); };
    recognition.onend = () => { setListening(false); voiceRecognition.current = null; if (hadError) return; if (!transcript) { onNotify('We did not hear enough detail. Try again and include distance, time, or effort.'); return; } reviewRecognizedRecord(routeVoiceAthleteRecord(transcript, settings?.distanceUnit ?? 'km'), 'voice'); };
    voiceRecognition.current = recognition;
    setListening(true);
    recognition.start();
  };
  const closeActivityEditor = () => {
    discardScreenshotDrafts();
    setActivityEditor(null);
  };
  const readScreenshots = async (files: File[]) => {
    const accepted = files.filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 10 * 1024 * 1024);
    if (!accepted.length) { onNotify('Choose PNG, JPG, or WebP screenshots under 10 MB each.'); return; }
    const skipped = files.length - accepted.length;
    setScreenshotReaderError('');
    setScreenshotProgress('Preparing the local image reader…');
    setReadingImage(true);
    try {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const assetRoot = `${import.meta.env.BASE_URL.replace(/\/?$/, '/') }athlete-ocr/`;
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${assetRoot}worker.min.js`,
        corePath: `${assetRoot}tesseract-core-lstm.wasm.js`,
        langPath: assetRoot,
        workerBlobURL: false,
        logger: (message) => setScreenshotProgress(`${message.status}${message.progress > 0 ? ` · ${Math.round(message.progress * 100)}%` : ''}`),
      });
      try {
        const drafts: ScreenshotDraft[] = [];
        for (const [index, file] of accepted.entries()) {
          setScreenshotProgress(`Reading screenshot ${index + 1} of ${accepted.length}…`);
          await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' });
          const original = await worker.recognize(file, { rotateAuto: true });
          const enhanced = await enhancedScreenshot(file);
          const readings = [original.data.text];
          if (enhanced) {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' });
            const enhancedAuto = await worker.recognize(enhanced, { rotateAuto: true });
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1', user_defined_dpi: '300' });
            const enhancedSparse = await worker.recognize(enhanced, { rotateAuto: true });
            readings.push(enhancedAuto.data.text, enhancedSparse.data.text);
          }
          const route = mostCompleteScreenshotRoute(readings, settings?.distanceUnit ?? 'km');
          if (route) drafts.push({ fileName: file.name, route });
        }
        if (!drafts.length) {
          const message = 'No readable activity details were found. Use a clear PNG, JPG, or WebP screenshot that includes the metrics.';
          setScreenshotReaderError(message);
          onNotify(message);
          return;
        }
        setScreenshotDrafts(drafts);
        reviewRecognizedRecord(drafts[0].route, 'image');
        setScreenshotImportOpen(false);
        onNotify(`${drafts.length} screenshot draft${drafts.length === 1 ? '' : 's'} ready to review.${skipped ? ` ${skipped} file${skipped === 1 ? '' : 's'} skipped.` : ''}`);
      } finally {
        await worker.terminate().catch(() => undefined);
      }
    } catch (caught) {
      const detail = errorMessage(caught);
      const message = `The screenshot reader could not start. ${detail}`;
      setScreenshotReaderError(message);
      onNotify(message);
    } finally { setReadingImage(false); setScreenshotProgress(''); }
  };

  if (loading || !data || !settings) return <div className="surface-card"><EmptyPanel icon={<Activity size={20} />} title={error ? 'Athlete Hub could not load' : 'Loading Athlete Hub'} description={error || 'Your private training records are loading.'} action={error ? <button type="button" className="secondary-button" onClick={() => void refresh()}>Try again</button> : undefined} /></div>;

  if (athletePage === 'timeline') return <><AthleteTimelinePage data={data} onBack={() => setAthletePage('dashboard')} onAdd={() => setActivityEditor({})} onEdit={(activity) => setActivityEditor({ entry: activity })} onDelete={(activity) => void deleteActivity(activity)} />{activityEditor ? <ActivityModal settings={settings} editor={activityEditor} onClose={closeActivityEditor} onSave={saveActivity} /> : null}</>;

  return <div className="athlete-hub">
    <SectionHeading title="Athlete Hub" description="A private training journal for your runs, recovery, races and essential strength work." action={<><button className="secondary-button" type="button" onClick={() => setShowSettings(true)}><Settings size={15} /> Settings</button><button className="secondary-button athlete-screenshot-button" type="button" disabled={readingImage} onClick={() => setScreenshotImportOpen(true)}><FileImage size={15} />{readingImage ? 'Reading…' : 'Read screenshots'}</button><button className="primary-button header-action athlete-add-activity" type="button" onClick={() => setActivityEditor({})}><span className="header-action-icon" aria-hidden="true"><Plus size={15} strokeWidth={2} /></span><span>Add activity</span></button></>} />

    <div className="athlete-toolbar surface-card"><div className="athlete-period-control"><span>View</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="week">Last 7 days</option><option value="month">This month</option><option value="year">This year</option><option value="all">All time</option><option value="custom">Custom range</option></select>{period === 'custom' ? <div className="athlete-custom-dates"><DatePicker label="From" value={customStart} onChange={setCustomStart} max={customEnd} /><DatePicker label="To" value={customEnd} onChange={setCustomEnd} min={customStart} /></div> : null}</div><div className="athlete-voice-controls"><span className="athlete-voice-hint">Speak naturally in your device language, then stop when you are done. Review every detail before saving.</span><button type="button" className={`secondary-button ${listening ? 'recording' : ''}`} onClick={() => listening ? voiceRecognition.current?.stop() : startVoice()}><Mic size={15} />{listening ? 'Stop & review' : 'Speak activity'}</button></div></div>
    <div className="metrics-grid athlete-metrics"><Metric label="Running distance" value={formatDistance(runningDistance, settings.distanceUnit)} foot={`${runningActivities.length} run${runningActivities.length === 1 ? '' : 's'} in this view`} icon={<Footprints size={16} />} /><Metric label="All movement" value={formatDistance(allDistance, settings.distanceUnit)} foot="Running, walking and cycling combined" icon={<Activity size={16} />} /><Metric label="Average pace" value={averagePace} foot={totalSeconds ? `${formatDuration(totalSeconds)} running time` : 'Add duration to calculate'} icon={<Sparkles size={16} />} /><Metric label="Energy logged" value={new Intl.NumberFormat('en-IN').format(totalCalories)} foot="Calories recorded in this view" icon={<HeartPulse size={16} />} /></div>
    <div className="content-grid athlete-overview-grid"><section className="surface-card athlete-today-card"><div className="card-title-row"><div><h3>Today’s readiness</h3><p>Recovery and your next useful action.</p></div><button type="button" className="text-button" onClick={() => setShowScore(true)}><Plus size={14} /> Log score</button></div><div className="athlete-readiness"><div className={`athlete-recovery-ring ${recovery ? recoveryTone(recovery.score) : 'empty'}`}><b>{recovery?.score ?? '—'}</b><span>{recovery ? 'Recovery' : 'No score'}</span></div><div><strong>{recovery ? recovery.score >= 85 ? 'Ready to push' : recovery.score >= 67 ? 'Solid training day' : recovery.score >= 34 ? 'Keep it controlled' : 'Prioritise recovery' : 'Check in with yourself'}</strong><p>{recovery?.notes || 'Add your own 1–100 recovery score in seconds.'}</p></div></div>{nextRace ? <div className="athlete-race-banner"><Flag size={15} /><span><b>{nextRace.name}</b>{nextRace.distanceMeters ? ` · ${formatDistance(nextRace.distanceMeters, settings.distanceUnit)}` : ''}</span><strong>{Math.max(0, daysBetween(localDateKey(), nextRace.raceDate))} days</strong><button className="ghost-button danger" aria-label={`Delete ${nextRace.name}`} type="button" onClick={() => void deleteRecord('race', nextRace.id, nextRace.name)}><Trash2 size={13} /></button></div> : <button className="athlete-add-race" type="button" onClick={() => setShowRace(true)}><Flag size={15} /> Add a race countdown</button>}</section><section className="surface-card athlete-plan-card"><div className="card-title-row"><div><h3>Coming up</h3><p>Planned sessions and races stay in sight.</p></div><button type="button" className="text-button" onClick={() => setShowPlan(true)}><Plus size={14} /> Plan</button></div>{planned.length ? <div className="athlete-upcoming-list">{planned.map((workout) => <div key={workout.id}><span className="athlete-date-chip">{formatAthleteDate(workout.workoutDate)}</span><p><b>{workout.title}</b><small>{workout.targetDistanceMeters ? formatDistance(workout.targetDistanceMeters, settings.distanceUnit) : activityKinds.find((item) => item.value === workout.kind)?.label}</small></p><button className="ghost-button danger" aria-label={`Delete ${workout.title}`} type="button" onClick={() => void deleteRecord('planned_workout', workout.id, workout.title)}><Trash2 size={13} /></button></div>)}</div> : <div className="athlete-empty-inline"><CalendarDays size={16} /><span>No planned workouts. Add the next one when you are ready.</span></div>}</section></div>
    <div className="content-grid athlete-training-grid"><AthleteCalendar data={data} month={calendarMonth} onChangeMonth={(amount) => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12))} /><section className="surface-card athlete-pr-card"><div className="card-title-row"><div><h3>Personal records</h3><p>Best pace for your standard distances.</p></div><Trophy size={18} /></div><div className="athlete-pr-list">{personalRecords.map((record) => <div key={record.label}><span>{record.label}</span><b>{record.activity ? formatPace(record.activity.distanceMeters, record.activity.durationSeconds, settings.distanceUnit) : '—'}</b><small>{record.activity ? formatAthleteDate(record.activity.activityDate) : 'Log a run to unlock'}</small></div>)}</div><button className="text-button" type="button" onClick={() => setShowGoal(true)}><Target size={14} /> Create distance goal</button></section></div>
    <div className="content-grid athlete-bottom-grid"><section className="surface-card athlete-goals-card"><div className="card-title-row"><div><h3>Distance goals</h3><p>Progress updates from your completed activity log.</p></div><button type="button" className="text-button" onClick={() => setShowGoal(true)}><Plus size={14} /> Goal</button></div>{data.goals.filter((goal) => goal.isActive).length ? <div className="athlete-goal-list">{data.goals.filter((goal) => goal.isActive).map((goal) => { const covered = activities.filter((activity) => inRange(activity.activityDate, goal.startsOn, goal.endsOn)).reduce((sum, activity) => sum + (activity.distanceMeters ?? 0), 0); return <div className="athlete-goal-row" key={goal.id}><ProgressRow label={goal.title} detail={<>{formatDistance(covered, settings.distanceUnit)} of <b>{formatDistance(goal.targetDistanceMeters, settings.distanceUnit)}</b> · ends {formatAthleteDate(goal.endsOn)}</>} progress={covered / goal.targetDistanceMeters * 100} /><button className="ghost-button danger" type="button" aria-label={`Delete ${goal.title}`} onClick={() => void deleteRecord('goal', goal.id, goal.title)}><Trash2 size={13} /></button></div>; })}</div> : <div className="athlete-empty-inline"><Target size={16} /><span>Create a running-distance goal for clear momentum.</span></div>}</section><section className="surface-card athlete-strength-card"><div className="card-title-row"><div><h3>Strength for runners</h3><p>Minimal gym logging that supports your training.</p></div><button type="button" className="text-button" onClick={() => setShowGym(true)}><Plus size={14} /> Log strength</button></div>{data.gymSessions.length ? <div className="athlete-strength-summary"><Dumbbell size={19} /><div><b>{data.gymSessions[0].title}</b><small>{formatAthleteDate(data.gymSessions[0].sessionDate)}{data.gymSessions[0].durationMinutes ? ` · ${data.gymSessions[0].durationMinutes} min` : ''}</small></div><button className="ghost-button danger" type="button" aria-label={`Delete ${data.gymSessions[0].title}`} onClick={() => void deleteRecord('gym_session', data.gymSessions[0].id, data.gymSessions[0].title)}><Trash2 size={13} /></button></div> : <div className="athlete-empty-inline"><Dumbbell size={16} /><span>Log simple strength sessions when they help your running.</span></div>}</section></div>
    <section className="surface-card athlete-activity-card"><div className="card-title-row"><div><h3>Recent activity</h3><p>Your latest confirmed training. Open the full timeline for complete history and filters.</p></div><button type="button" className="text-button" onClick={() => setAthletePage('timeline')}>View full timeline</button></div>{recentActivities.length ? <div className="athlete-activity-list">{recentActivities.map((activity) => <article key={activity.id}><span className="athlete-activity-icon"><IconForActivity kind={activity.kind} /></span><div><b>{activity.kind === 'treadmill' ? 'Treadmill run' : activity.kind[0].toUpperCase() + activity.kind.slice(1)}</b><small>{formatAthleteDate(activity.activityDate)} · {formatDistance(activity.distanceMeters, settings.distanceUnit)} · {formatDuration(activity.durationSeconds)} · {formatPace(activity.distanceMeters, activity.durationSeconds, settings.distanceUnit)}</small>{activity.notes ? <p>{activity.notes}</p> : null}</div><div className="athlete-activity-stats"><span>{activity.averageHeartRate ? `${activity.averageHeartRate} bpm` : activity.calories ? `${activity.calories} cal` : 'Manual'}</span><button className="ghost-button" type="button" onClick={() => setActivityEditor({ entry: activity })}><Pencil size={14} /> Edit</button><button className="ghost-button danger" type="button" onClick={() => void deleteActivity(activity)}><Trash2 size={14} /> Delete</button></div></article>)}</div> : <EmptyPanel icon={<Footprints size={20} />} title="Your training starts here" description="Log a run manually, speak it, or read a fitness screenshot. Nothing is saved until you confirm it." action={<button className="primary-button" type="button" onClick={() => setActivityEditor({})}><Plus size={16} /> Log your first run</button>} />}</section>
    {screenshotImportOpen ? <ScreenshotUploadModal reading={readingImage} progress={screenshotProgress} error={screenshotReaderError} onClose={() => setScreenshotImportOpen(false)} onFiles={readScreenshots} /> : null}
    {pendingRecognition ? <RecognitionConfirmationModal pending={pendingRecognition} settings={settings} onClose={discardPendingRecognition} onAddInfo={() => { const next = pendingRecognition; setPendingRecognition(null); openRecognizedRecord(next); }} /> : null}
    {activityEditor ? <ActivityModal settings={settings} editor={activityEditor} onClose={closeActivityEditor} onSave={saveActivity} /> : null}
    {showScore ? <ScoreModal initial={voiceRecoveryDraft} onClose={() => { setShowScore(false); setVoiceRecoveryDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveRecoveryScore(input); await refresh(); setShowScore(false); setVoiceRecoveryDraft(null); if (advanceScreenshotDraft()) return; onNotify('Recovery score saved.'); }} /> : null}
    {showPlan ? <PlanModal settings={settings} initial={voicePlanDraft} onClose={() => { setShowPlan(false); setVoicePlanDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await savePlannedWorkout(input); await refresh(); setShowPlan(false); setVoicePlanDraft(null); if (advanceScreenshotDraft()) return; onNotify('Workout planned.'); }} /> : null}
    {showRace ? <RaceModal settings={settings} initial={voiceRaceDraft} onClose={() => { setShowRace(false); setVoiceRaceDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveRace(input); await refresh(); setShowRace(false); setVoiceRaceDraft(null); if (advanceScreenshotDraft()) return; onNotify('Race added.'); }} /> : null}
    {showGym ? <GymModal settings={settings} initial={voiceGymDraft} onClose={() => { setShowGym(false); setVoiceGymDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveGymSession(input); await refresh(); setShowGym(false); setVoiceGymDraft(null); if (advanceScreenshotDraft()) return; onNotify('Strength session saved.'); }} /> : null}
    {showGoal ? <GoalModal settings={settings} initial={voiceGoalDraft} onClose={() => { setShowGoal(false); setVoiceGoalDraft(null); discardScreenshotDrafts(); }} onSave={async (input) => { await saveAthleteGoal(input); await refresh(); setShowGoal(false); setVoiceGoalDraft(null); if (advanceScreenshotDraft()) return; onNotify('Running goal saved.'); }} /> : null}
    {showSettings ? <AthleteSettingsModal settings={settings} onClose={() => setShowSettings(false)} onSave={saveSettings} onDelete={deleteAll} /> : null}
  </div>;
}
