import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Activity, ArrowLeft, Download, FileImage, FileUp, Merge, Pencil } from 'lucide-react';
import { ActivityModal } from '@/components/athlete-hub';
import { EmptyPanel, ModalShell, SectionHeading } from '@/components/ui';
import { Select } from '@/components/select';
import { WorkoutSummary } from '@/components/athlete-workout-details';
import { WorkoutTrace } from '@/components/athlete-workout-trace';
import { addAthleteActivityMedia, combineAthleteActivities, loadAthleteActivityMedia, loadAthleteActivityPage, loadAthleteHubData, saveAthleteActivity } from '@/lib/athlete-api';
import { formatAthleteDate, formatDistance, formatDuration, formatPace } from '@/lib/athlete';
import { workoutFileMime, type ActivityMedia, type ActivityMediaBatch } from '@/lib/athlete-media';
import { activitySummaryMetrics, workoutFileAccept, workoutOptionLabel, type WorkoutDetails } from '@/lib/athlete-workout';
import { athleteActivitiesPath } from '@/lib/navigation';

type ActivityPageData = Awaited<ReturnType<typeof loadAthleteActivityPage>>;
const activityNames = { run: 'Run', walk: 'Walk', cycle: 'Cycling', treadmill: 'Treadmill run', race: 'Race' };
const sourceNames = { manual: 'Manual entry', image: 'Screenshot import', samsung_health: 'Samsung Health', whoop: 'WHOOP', voice: 'Previous import' };
const groupDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });
const activityIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function DownloadWorkoutFile({ item }: { item: ActivityMedia }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const download = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    try {
      const file = await loadAthleteActivityMedia(item.id, item.mime, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };
  return <li className="activity-attachment-row">
    <span>{item.name}</span>
    <button className="secondary-button" type="button" disabled={pending} onClick={() => void download()}
      aria-label={`Download ${item.name}`}><Download size={15} /> {pending ? 'Preparing…' : 'Download'}</button>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </li>;
}

function StoredScreenshot({ item }: { item: ActivityMedia }) {
  const { id, mime } = item;
  const [image, setImage] = useState<{ url?: string; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void loadAthleteActivityMedia(id, mime, controller.signal).then((file) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(file);
      setImage({ url });
    }, (error: unknown) => {
      if (!controller.signal.aborted) setImage({ error: errorMessage(error) });
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [id, mime, attempt]);

  return <figure className="activity-screenshot">
    {image?.url ? <a href={image.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.name} full size`}>
      <img src={image.url} alt={item.name} loading="lazy" />
    </a> : image?.error ? <div>
      <p className="form-error">{image.error}</p>
      <button className="text-button" type="button" onClick={() => { setImage(undefined); setAttempt((current) => current + 1); }}>Try again</button>
    </div> : <p className="activity-screenshot-placeholder" role="status">Loading screenshot…</p>}
    <figcaption>
      <span>{item.name}</span>
      {image?.url ? <a className="text-button" href={image.url}
        download={mime === 'image/jpeg' ? item.name.replace(/(?:[.][^.]*)?$/, '.jpg') : item.name}
        aria-label={`Download ${item.name}`}><Download size={14} /> Download</a> : null}
    </figcaption>
  </figure>;
}

function ScreenshotGroup({ items }: { items: ActivityMedia[] }) {
  const [expanded, setExpanded] = useState(false);
  const title = items.length === 1 ? '1 screenshot' : `${items.length} screenshots`;
  return <details className="activity-screenshot-group" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><FileImage size={17} aria-hidden="true" /><span>{title}</span><small>Added {groupDate.format(new Date(items[0].created_at))}</small></summary>
    {expanded ? <div className="activity-screenshot-grid">
      {items.map((item) => <StoredScreenshot key={item.id} item={item} />)}
    </div> : null}
  </details>;
}

function ActivityScreenshots({ id, media, onChanged }: { id: string; media: ActivityMedia[]; onChanged: () => void }) {
  const [batch, setBatch] = useState<ActivityMediaBatch>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const groups = new Map<string, ActivityMedia[]>();
  for (const item of media) {
    const group = groups.get(item.batch_id);
    if (group) group.push(item);
    else groups.set(item.batch_id, [item]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batch?.files.length || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await addAthleteActivityMedia(id, batch);
      setBatch(undefined);
      if (input.current) input.current.value = '';
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <section className="surface-card activity-detail-section activity-screenshots" aria-labelledby="activity-screenshots-title">
    <h3 id="activity-screenshots-title">Screenshots</h3>
    {media.length ? <div className="activity-screenshot-groups">
      {[...groups].map(([key, items]) => <ScreenshotGroup key={key} items={items} />)}
    </div> : <p className="card-note">Screenshots not uploaded.</p>}
    <details className="activity-screenshot-upload">
      <summary>Attach screenshots</summary>
      <form onSubmit={submit}>
        <label>Choose screenshots
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={saving}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              setBatch(files.length ? { id: crypto.randomUUID(), files } : undefined);
              setError('');
            }} />
        </label>
        <button className="secondary-button" disabled={!batch || saving} type="submit">{saving ? 'Saving…' : 'Save screenshot group'}</button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </details>
  </section>;
}

const shown = (value: number | null, unit: string) => value == null ? '—' : `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)} ${unit}`;

function ActivityOverview({ activity, settings, details }: ActivityPageData) {
  const metrics = [
    ['Distance', formatDistance(activity.distanceMeters, settings.distanceUnit)],
    ['Moving time', formatDuration(activity.durationSeconds)],
    ['Average pace', formatPace(activity.distanceMeters, activity.durationSeconds, settings.distanceUnit)],
    ['Average heart rate', shown(activity.averageHeartRate, 'bpm')],
    ['Peak heart rate', shown(details?.metrics.maxHeartRate ?? null, 'bpm')],
    ['Calories', shown(activity.calories, 'kcal')],
    ['Elevation gain', shown(activity.elevationMeters, 'm')],
    ['Average cadence', shown(activity.cadence, 'spm')],
    ['Effort', shown(activity.effort, '/ 10')],
  ].filter(([, value]) => value !== '—');

  return <section className="surface-card activity-detail-section" aria-labelledby="activity-overview-title">
    <h3 id="activity-overview-title">Workout summary</h3>
    {metrics.length ? <dl className="activity-detail-metrics">
      {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl> : <p className="card-note">No workout measurements were recorded.</p>}
    {activity.notes ? <div className="activity-detail-notes"><h4>Notes</h4><p>{activity.notes}</p></div> : null}
  </section>;
}

function CombineActivitiesModal({ activity, settings, onClose, onCombined }: Pick<ActivityPageData, 'activity' | 'settings'> & {
  onClose: () => void;
  onCombined: () => void;
}) {
  const [options, setOptions] = useState<ActivityPageData['activity'][]>();
  const [otherId, setOtherId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRequest = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadAthleteHubData(controller.signal).then(({ activities }) => {
      if (!controller.signal.aborted) setOptions(activities.filter(({ id }) => id !== activity.id));
    }, (caught: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    });
    return () => controller.abort();
  }, [activity.id]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!otherId || savingRequest.current) return;
    savingRequest.current = true;
    setSaving(true);
    setError('');
    try {
      await combineAthleteActivities(activity.id, otherId);
      onCombined();
    } catch (caught) {
      setError(errorMessage(caught));
      savingRequest.current = false;
      setSaving(false);
    }
  };

  return <ModalShell eyebrow="Athlete Hub" title="Combine activities" labelId="athlete-combine-title"
    onClose={() => { if (!savingRequest.current) onClose(); }}>
    <form className="modal-form" onSubmit={submit}>
      <p className="modal-description">Keep the current activity dated {formatAthleteDate(activity.activityDate)}. Its values take priority. The other entry’s screenshots, notes, and additional workout details move here, and its separate entry is removed.</p>
      <label>Other activity
        <Select value={otherId} disabled={!options?.length || saving} onChange={(event) => setOtherId(event.target.value)}>
          <option value="">{!options ? error ? 'Activities unavailable' : 'Loading activities…' : options.length ? 'Choose the other copy of this workout' : 'No other activities'}</option>
          {options?.map((option) => <option key={option.id} value={option.id}>{workoutOptionLabel(option, settings.distanceUnit)}</option>)}
        </Select>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="primary-button" type="submit" disabled={!otherId || saving}>{saving ? 'Combining…' : 'Combine into this activity'}</button>
      </div>
    </form>
  </ModalShell>;
}

export function AthleteActivityPage({ id, onNotify }: { id: string; onNotify: (message: string) => void }) {
  const [data, setData] = useState<ActivityPageData>();
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ imported?: WorkoutDetails; file?: File } | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [combining, setCombining] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => { setError(''); setAttempt((current) => current + 1); };

  useEffect(() => {
    if (!activityIdPattern.test(id)) return;
    const controller = new AbortController();
    void loadAthleteActivityPage(id, controller.signal).then((activity) => {
      if (!controller.signal.aborted) setData(activity);
    }, (caught: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    });
    return () => controller.abort();
  }, [id, attempt]);

  const back = <Link className="text-button activity-back" to={athleteActivitiesPath}><ArrowLeft size={16} /> Back to activities</Link>;
  if (!data) {
    const failure = !activityIdPattern.test(id) ? 'That activity is unavailable.' : error;
    return <>{back}<div className="surface-card"><EmptyPanel icon={<Activity size={20} />}
      title={failure ? 'Activity unavailable' : 'Loading activity'} description={failure || 'Your workout details are loading.'}
      action={error ? <button type="button" className="secondary-button" onClick={refresh}>Try again</button> : undefined} /></div></>;
  }

  const { activity, settings, details, media } = data;
  const workoutFiles = media.filter(({ mime }) => mime === workoutFileMime);
  const screenshots = media.filter(({ mime }) => mime.startsWith('image/'));
  const attachWorkoutFile = async (file: File) => {
    setReadingFile(true);
    try {
      const { readWorkoutFile } = await import('@/lib/athlete-workout-file');
      const workout = await readWorkoutFile(file, settings.timezone);
      if (workout.draft.activityDate && workout.draft.activityDate !== activity.activityDate) {
        onNotify('This file is dated ' + formatAthleteDate(workout.draft.activityDate) + '. Open the activity for that date.');
        return;
      }
      setEditor({
        imported: details?.samples?.length
          ? { ...details, fingerprints: workout.details.fingerprints }
          : workout.details,
        file,
      });
    } catch (caught) {
      onNotify(errorMessage(caught));
    } finally {
      setReadingFile(false);
    }
  };

  return <div className="athlete-activity-page">
    {back}
    <SectionHeading title={activityNames[activity.kind]} description={`${formatAthleteDate(activity.activityDate)} · ${details?.source ?? sourceNames[activity.source]}`}
      action={<>
        <button className="secondary-button" type="button" disabled={readingFile} onClick={() => setCombining(true)}><Merge size={15} /> Combine activities</button>
        <button className="secondary-button" type="button" disabled={readingFile} onClick={() => setEditor({})}><Pencil size={15} /> Edit activity</button>
      </>} />
    {error ? <div className="surface-card" role="alert"><p className="form-error">{error}</p><button className="text-button" type="button" onClick={refresh}>Try again</button></div> : null}
    <ActivityOverview {...data} />
    <WorkoutTrace details={details} distanceUnit={settings.distanceUnit} />
    {details && (activitySummaryMetrics.some(([key]) => details.metrics[key] != null) || details.zones?.length || details.laps?.length) ? (
      <section className="surface-card activity-detail-section"><h3>Recorded details</h3><WorkoutSummary details={details} distanceUnit={settings.distanceUnit} /></section>
    ) : null}
    <section className="surface-card activity-detail-section" aria-label="Workout file">
      <div className="card-title-row">
        <h3>Workout file</h3>
        {!workoutFiles.length ? <>
          <input ref={fileInput} type="file" accept={workoutFileAccept} hidden onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file && !readingFile) void attachWorkoutFile(file);
          }} />
          <button className="secondary-button" type="button" disabled={readingFile} onClick={() => fileInput.current?.click()}>
            <FileUp size={15} /> {readingFile ? 'Reading workout…' : 'Attach workout file'}
          </button>
        </> : null}
      </div>
      {workoutFiles.length ? <ul className="activity-attachment-list">
        {workoutFiles.map((item) => <DownloadWorkoutFile key={item.id} item={item} />)}
      </ul> : <p className="card-note">{details?.samples?.length ? 'Original workout file not uploaded.' : 'Workout file not uploaded.'}</p>}
    </section>
    <ActivityScreenshots id={id} media={screenshots} onChanged={() => { refresh(); onNotify('Screenshot group saved.'); }} />
    {combining ? <CombineActivitiesModal activity={activity} settings={settings} onClose={() => setCombining(false)}
      onCombined={() => { setCombining(false); refresh(); onNotify('Activities combined.'); }} /> : null}
    {editor ? <ActivityModal editor={{ entry: activity, details: editor.imported ?? details ?? { metrics: {} }, imported: Boolean(editor.imported), workoutFile: editor.file }}
      settings={settings} matchingActivities={[]} onClose={() => setEditor(null)} onSave={async (draft, activityId, workout, batch) => {
        await saveAthleteActivity(draft, activityId, workout, batch);
        setEditor(null);
        refresh();
        onNotify(editor.imported ? 'Workout file attached.' : 'Activity updated.');
      }} /> : null}
  </div>;
}
