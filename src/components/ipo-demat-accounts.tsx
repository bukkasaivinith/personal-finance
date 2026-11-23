import { useRef, useState, type FormEvent } from 'react';
import { Trash2, Users } from 'lucide-react';
import { Select } from '@/components/select';
import { EmptyPanel, ModalShell } from '@/components/ui';
import { formatDematAccount, removeIpoDematAccount, saveIpoDematAccount, type IpoDematAccount } from '@/lib/ipo-portfolio-api';

function AddDematAccountForm({ ownerName, onClose, onSave }: {
  ownerName: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [designation, setDesignation] = useState<IpoDematAccount['designation']>('friend');
  const [holder, setHolder] = useState('');
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  function close() {
    if (!inFlight.current) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const name = holder.trim();
    if (!name) return setError('Enter the account holder name.');
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await saveIpoDematAccount(name, nickname.trim(), designation);
      onSave();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the demat account.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell eyebrow="Demat account holders" title="Add new account" labelId="add-demat-title" onClose={close}>
      <form className="modal-form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>Whose account?
            <Select aria-label="Whose account?" value={designation} disabled={saving} onChange={(event) => {
              const value = event.target.value as IpoDematAccount['designation'];
              setDesignation(value);
              setHolder(value === 'self' ? ownerName : '');
            }}>
              <option value="friend">Friend’s account</option>
              <option value="self">My account</option>
            </Select>
          </label>
          <label>Account holder name
            <input autoFocus maxLength={80} value={holder} onChange={(event) => setHolder(event.target.value)} disabled={saving} />
          </label>
          <label className="full-field">Demat nickname (optional)
            <input maxLength={80} value={nickname} placeholder="e.g. Zerodha" onChange={(event) => setNickname(event.target.value)} disabled={saving} />
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save account'}</button>
        </div>
      </form>
    </ModalShell>
  );
}

export function IpoDematAccounts({ demats, ownerName, adding, onClose, onChanged, onNotify }: {
  demats: IpoDematAccount[];
  ownerName: string;
  adding: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState('');
  const [error, setError] = useState('');
  const deletionPending = useRef(false);

  async function remove(demat: IpoDematAccount) {
    if (deletionPending.current || !window.confirm(`Delete “${formatDematAccount(demat.holder, demat.demat)}” from your available demat accounts? Its past IPO applications will still show this account.`)) return;
    deletionPending.current = true;
    setDeleting(demat.id);
    setError('');
    try {
      await removeIpoDematAccount(demat.id);
      await onChanged();
      onNotify('Demat account removed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the demat account.');
    } finally {
      deletionPending.current = false;
      setDeleting('');
    }
  }

  return (
    <>
      <section className="surface-card" aria-labelledby="saved-demat-accounts-title">
        <div className="card-title-row"><h3 id="saved-demat-accounts-title">Saved demat accounts</h3></div>
        {demats.length ? (
          <div className="account-list expanded">
            {demats.map((demat) => (
              <div className="account-row" key={demat.id}>
                <span className="account-icon" aria-hidden="true"><Users size={17} /></span>
                <span className="account-info">
                  <b>{formatDematAccount(demat.holder, demat.demat)}</b>
                  <small>{demat.designation === 'self' ? 'My account' : 'Friend’s account'}</small>
                </span>
                <button type="button" className="ghost-button danger" aria-label={`Delete ${formatDematAccount(demat.holder, demat.demat)}`}
                  onClick={() => void remove(demat)} disabled={Boolean(deleting)}>
                  <Trash2 size={15} /> {deleting === demat.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        ) : <EmptyPanel icon={<Users size={20} />} title="No demat accounts yet" description="Use Add new account to save an account for your IPO applications." />}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
      {adding ? <AddDematAccountForm ownerName={ownerName} onClose={onClose} onSave={() => {
        onClose();
        onNotify('Demat account saved.');
        void onChanged();
      }} /> : null}
    </>
  );
}
