import { useRef, useState, type FormEvent } from 'react';
import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { ModalShell } from '@/components/ui';
import { deleteSavingsLocation, saveSavingsLocation, savingsLocations, type CustomSavingsLocation } from '@/lib/savings-api';

export function SavingsLocationsManager({ ownerId, locations, onSave, onDelete, onClose }: {
  ownerId: string;
  locations: CustomSavingsLocation[];
  onSave: (location: CustomSavingsLocation, creating: boolean) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<{ id: string; name: string; creating: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending.current) return;
    const name = draft.name.trim();
    if (!name) return setError('Enter a location name.');
    if (Object.prototype.hasOwnProperty.call(savingsLocations, name.toLowerCase())) return setError('Choose a name other than Bank, Cash, or Other.');
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      onSave(await saveSavingsLocation(ownerId, draft.id, name, !draft.creating), draft.creating);
      setDraft(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this location.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function remove(location: CustomSavingsLocation) {
    if (pending.current || !window.confirm(`Delete “${location.name}”? Savings stored there will move to Other.`)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteSavingsLocation(ownerId, location.id);
      onDelete(location.id);
      if (draft?.id === location.id) setDraft(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete this location.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const close = () => { if (!pending.current) onClose(); };
  return (
    <ModalShell eyebrow="Savings" title="Manage locations" labelId="savings-locations-title" onClose={close}>
      {locations.length ? (
        <div className="account-list">
          {locations.map((location) => <div className="account-row" key={location.id}>
            <span className="account-icon" aria-hidden="true"><Landmark size={16} /></span>
            <span className="account-info"><b>{location.name}</b></span>
            <div className="item-actions">
              <button type="button" className="ghost-button" aria-label={`Edit ${location.name}`} disabled={busy}
                onClick={() => { setError(''); setDraft({ ...location, creating: false }); }}><Pencil size={15} /> Edit</button>
              <button type="button" className="ghost-button danger" aria-label={`Delete ${location.name}`} disabled={busy}
                onClick={() => void remove(location)}><Trash2 size={15} /> Delete</button>
            </div>
          </div>)}
        </div>
      ) : <p className="card-note">No custom locations yet.</p>}
      {draft ? (
        <form className="modal-form savings-location-form" onSubmit={save}>
          <div className="form-grid">
            <label className="full-field">Location name
              <input key={draft.id} autoFocus maxLength={80} value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={busy} />
            </label>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => { setError(''); setDraft(undefined); }} disabled={busy}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save location'}</button>
          </div>
        </form>
      ) : (
        <>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={close} disabled={busy}>Done</button>
            <button type="button" className="primary-button" disabled={busy}
              onClick={() => { setError(''); setDraft({ id: crypto.randomUUID(), name: '', creating: true }); }}><Plus size={15} /> Add location</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
