import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Pencil, Trash2, Users } from 'lucide-react';
import { Select } from '@/components/select';
import { EmptyPanel, ModalShell } from '@/components/ui';
import { formatDematAccount, removeIpoDematAccount, saveIpoDematAccount, updateIpoDematAccount, type IpoDematAccount } from '@/lib/ipo-portfolio-api';

function BrokerAppField({ value, savedApps, disabled, onChange }: {
  value: string;
  savedApps: string[];
  disabled: boolean;
  onChange: (app: string) => void;
}) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const query = value.trim().toLocaleLowerCase();
  const matches = query
    ? savedApps.filter((app) => app !== value.trim() && app.toLocaleLowerCase().includes(query)).slice(0, 5)
    : [];
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const expanded = focused && !disabled && matches.length > 0;

  function choose(app: string) {
    onChange(app);
    setFocused(false);
    setHighlighted(-1);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setFocused(false);
      setHighlighted(-1);
    } else if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setFocused(true);
      setHighlighted((index) => event.key === 'ArrowDown'
        ? (index + 1) % matches.length
        : index <= 0 ? matches.length - 1 : index - 1);
    } else if (event.key === 'Enter' && expanded && matches[highlighted]) {
      event.preventDefault();
      choose(matches[highlighted]);
    }
  }

  return (
    <div className="demat-broker-field">
      <label htmlFor={id}>Broker app (optional)
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && matches[highlighted] ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          maxLength={80}
          placeholder="e.g. Kite, Groww or Upstox"
          value={value}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setHighlighted(-1); }}
          onKeyDown={handleKey}
          onChange={(event) => { onChange(event.target.value); setFocused(true); setHighlighted(-1); }}
        />
      </label>
      {expanded ? (
        <div id={listId} className="ui-select-menu demat-broker-suggestions" role="listbox" aria-label="Saved broker apps">
          {matches.map((app, index) => (
            <div id={`${listId}-${index}`} key={app} role="option" aria-selected={highlighted === index}
              className={`ui-select-option${highlighted === index ? ' is-highlighted' : ''}`}
              onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setHighlighted(index)} onClick={() => choose(app)}>
              {app}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DematAccountForm({ account, savedApps, ownerName, onClose, onSave }: {
  account?: IpoDematAccount;
  savedApps: string[];
  ownerName: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [designation, setDesignation] = useState<IpoDematAccount['designation']>(account?.designation ?? 'friend');
  const [holder, setHolder] = useState(account?.holder ?? '');
  const [nickname, setNickname] = useState(account?.demat === 'Demat' ? '' : account?.demat ?? '');
  const [broker, setBroker] = useState(account?.broker ?? '');
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
      const app = broker.trim();
      const appName = savedApps.find((saved) => saved.toLocaleLowerCase() === app.toLocaleLowerCase()) ?? app;
      if (account) await updateIpoDematAccount(account.id, name, nickname.trim(), designation, appName);
      else await saveIpoDematAccount(name, nickname.trim(), designation, appName);
      onSave();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the demat account.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell eyebrow="Demat account holders" title={account ? 'Edit demat account' : 'Add new account'} labelId="demat-account-title" onClose={close}>
      <form className="modal-form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>Whose account?
            <Select aria-label="Whose account?" value={designation} disabled={saving} onChange={(event) => {
              const value = event.target.value as IpoDematAccount['designation'];
              setDesignation(value);
              if (!account) setHolder(value === 'self' ? ownerName : '');
            }}>
              <option value="friend">Friend’s account</option>
              <option value="self">My account</option>
            </Select>
          </label>
          <label>Account holder name
            <input autoFocus maxLength={80} value={holder} onChange={(event) => setHolder(event.target.value)} disabled={saving} />
          </label>
          <label>Demat nickname (optional)
            <input maxLength={80} value={nickname} placeholder="e.g. Primary demat" onChange={(event) => setNickname(event.target.value)} disabled={saving} />
          </label>
          <BrokerAppField value={broker} savedApps={savedApps} onChange={setBroker} disabled={saving} />
        </div>
        {account ? <p className="form-hint">Changing the holder name or type updates all demat accounts for this holder.</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : account ? 'Save changes' : 'Save account'}</button>
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
  const [editing, setEditing] = useState<IpoDematAccount>();
  const [error, setError] = useState('');
  const deletionPending = useRef(false);
  const savedApps = [...new Map(demats.flatMap(({ broker }) => {
    const app = broker?.trim();
    return app ? [[app.toLocaleLowerCase(), app] as const] : [];
  })).values()].sort((first, second) => first.localeCompare(second));

  function closeForm() {
    if (editing) setEditing(undefined);
    else onClose();
  }

  async function remove(demat: IpoDematAccount) {
    if (deletionPending.current || !window.confirm(`Delete “${formatDematAccount(demat.holder, demat.demat, demat.broker)}” from your available demat accounts? Its past IPO applications will still show this account.`)) return;
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
            {demats.map((demat) => {
              const label = formatDematAccount(demat.holder, demat.demat, demat.broker);
              return (
                <div className="account-row" key={demat.id}>
                  <span className="account-icon" aria-hidden="true"><Users size={17} /></span>
                  <span className="account-info">
                    <b>{label}</b>
                    <small>{demat.designation === 'self' ? 'My account' : 'Friend’s account'}</small>
                  </span>
                  <div className="account-actions">
                    <button type="button" className="ghost-button" aria-label={`Edit ${label}`}
                      onClick={() => setEditing(demat)} disabled={Boolean(deleting)}>
                      <Pencil size={15} /> Edit
                    </button>
                    <button type="button" className="ghost-button danger" aria-label={`Delete ${label}`}
                      onClick={() => void remove(demat)} disabled={Boolean(deleting)}>
                      <Trash2 size={15} /> {deleting === demat.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyPanel icon={<Users size={20} />} title="No demat accounts yet" description="Use Add new account to save an account for your IPO applications." />}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
      {adding || editing ? <DematAccountForm key={editing?.id ?? 'new'} account={editing} savedApps={savedApps} ownerName={ownerName} onClose={closeForm} onSave={() => {
        closeForm();
        onNotify(editing ? 'Demat account updated.' : 'Demat account saved.');
        void onChanged();
      }} /> : null}
    </>
  );
}
