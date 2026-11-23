import { useRef, useState, type FormEvent } from 'react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { ModalShell } from '@/components/ui';
import { formatAthleteDate, localDateKey, type RecoveryMetrics, type RecoveryScore } from '@/lib/athlete';
import { recoveryFields, whoopTone } from '@/lib/athlete-recovery';

type RecoveryDraft = Omit<RecoveryScore, 'id'>;
const [whoopFields, journalFields] = [recoveryFields.slice(0, 6), recoveryFields.slice(6)];

export function RecoveryEditor({ initial, onClose, onSave }: { initial?: Partial<RecoveryDraft> | null; onClose: () => void; onSave: (input: RecoveryDraft) => Promise<void> }) {
  const [date, setDate] = useState(initial?.recoveryDate ?? localDateKey());
  const [score, setScore] = useState(initial?.score?.toString() ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [source, setSource] = useState<RecoveryScore['source']>(initial?.source ?? 'manual');
  const [metrics, setMetrics] = useState<RecoveryMetrics>(initial?.metrics ?? {});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    if (!date) { setError('Choose a recovery date.'); return; }
    const value = Number(score);
    if (score === '' || !Number.isInteger(value) || value < 0 || value > 100) { setError('Enter a recovery score from 0 to 100.'); return; }
    busy.current = true;
    setSaving(true);
    setError('');
    try { await onSave({ recoveryDate: date, score: value, notes: notes.trim(), source, metrics }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save recovery.'); }
    finally { busy.current = false; setSaving(false); }
  };
  const inputs = (fields: typeof recoveryFields[number][]) => fields.map(([key, label, min, max]) =>
    <label key={key}>{label}<input type="number" min={min} max={max} step="any" value={metrics[key] ?? ''} onChange={(event) => {
      const next = { ...metrics };
      if (event.target.value === '') delete next[key];
      else next[key] = event.target.valueAsNumber;
      setMetrics(next);
    }} /></label>);
  return <ModalShell eyebrow="Athlete Hub" title="Log recovery" labelId="athlete-log-recovery" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <div><DatePicker label="Recovery date" value={date} onChange={setDate} /></div>
        <label>Recovery score (%)<input autoFocus required type="number" min="0" max="100" value={score} onChange={(event) => setScore(event.target.value)} /></label>
        <label className="full-field">Source<Select value={source} onChange={(event) => setSource(event.target.value as RecoveryScore['source'])}><option value="manual">Manual check-in</option><option value="whoop">WHOOP</option></Select></label>
        {inputs(whoopFields)}
        <details className="full-field workout-edit"><summary>Wellness journal (optional)</summary><div className="form-grid">{inputs(journalFields)}</div></details>
        <label className="full-field">Notes (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={700} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save recovery'}</button></div>
    </form>
  </ModalShell>;
}

export function RecoveryHistory({ scores, onEdit, onDelete, onAdd }: { scores: RecoveryScore[]; onEdit: (score: RecoveryScore) => void; onDelete: (score: RecoveryScore) => void; onAdd: () => void }) {
  return <section className="surface-card">
    <div className="card-title-row"><h3>Daily recovery</h3><button className="primary-button" type="button" onClick={onAdd}>Log recovery</button></div>
    {scores.length ? <div className="athlete-activity-list">{scores.map((score) => <article key={score.id}>
      <div className={'athlete-recovery-ring ' + whoopTone(score.score)}><b>{score.score}%</b></div>
      <div><b>{formatAthleteDate(score.recoveryDate)}</b><small>{score.source === 'whoop' ? 'WHOOP' : 'Manual'}</small>
        <dl className="workout-summary">{recoveryFields.map(([key, label]) => score.metrics?.[key] === undefined ? null : <div key={key}><dt>{label}</dt><dd>{score.metrics[key]}</dd></div>)}</dl>
        {score.notes ? <p>{score.notes}</p> : null}
      </div>
      <div className="athlete-activity-stats"><button className="ghost-button" type="button" onClick={() => onEdit(score)}>Edit</button><button className="ghost-button danger" type="button" onClick={() => onDelete(score)}>Delete</button></div>
    </article>)}</div> : <p className="card-note">No recovery entries yet.</p>}
  </section>;
}
