import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Banknote, ChevronRight, Landmark, Pencil, PiggyBank, Plus, Trash2, Wallet } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { EmptyPanel, Metric, ModalShell, SectionHeading } from '@/components/ui';
import { RupeeInput } from '@/components/rupee-input';
import { formatMoney } from '@/lib/finance';
import {
  deleteSavingsEntry, loadSavingsBalances, loadSavingsEntries, loadSavingsLocations, saveSavingsEntry, savingsLocations,
  type CustomSavingsLocation, type SavingsBalance, type SavingsDraft, type SavingsEntry, type SavingsLocation,
} from '@/lib/savings-api';
import { SavingsAccountHistory } from '@/components/savings-account-history';
import { SavingsLocationsManager } from '@/components/savings-locations';
import './savings-view.css';

const locationOptions = Object.keys(savingsLocations) as SavingsLocation[];
const locationIcons = { bank: Landmark, cash: Banknote, other: Wallet };
const savingsDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata' }).format(new Date());
const lastActivityDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' });

function totalInRupees(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + Math.round(amount * 100), 0) / 100;
}

export function SavingsBalanceMetric() {
  const [balances, setBalances] = useState<SavingsBalance[]>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void loadSavingsBalances().then((result) => {
      if (active) setBalances(result);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Could not load savings.');
    });
    return () => { active = false; };
  }, []);

  const breakdown = balances?.map(({ storage_type, balance }) =>
    `${savingsLocations[storage_type]} ${formatMoney(balance)}`).join(' · ');
  return <Metric
    label="Savings balance"
    value={balances ? formatMoney(totalInRupees(balances.map((row) => row.balance))) : '—'}
    foot={error || breakdown || (balances ? 'No savings recorded' : 'Loading savings…')}
    icon={<PiggyBank size={16} />}
  />;
}

function SavingsForm({ ownerId, entry, locations, onSave, onLocationSaved, onLocationDeleted, onClose }: {
  ownerId: string;
  entry: SavingsEntry | null;
  locations: CustomSavingsLocation[];
  onSave: (id: string, draft: SavingsDraft) => Promise<void>;
  onLocationSaved: (location: CustomSavingsLocation) => void;
  onLocationDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [name, setName] = useState(entry?.name ?? '');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [date, setDate] = useState(entry?.saved_on ?? savingsDate());
  const [location, setLocation] = useState(entry?.location_id ?? entry?.storage_type ?? '');
  const [managingLocations, setManagingLocations] = useState(false);
  const [details, setDetails] = useState(entry?.storage_details ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const amountText = amount.trim();
    if (!name.trim()) return setError('Enter a name for the saving.');
    if (!/^[0-9]{1,12}(\.[0-9]{0,2})?$/.test(amountText) || Number(amountText) <= 0) {
      return setError('Enter an amount greater than zero with up to two decimal places.');
    }
    if (!date || date > savingsDate()) return setError('Choose a date on or before today.');
    const custom = locations.find((item) => item.id === location);
    if (!custom && !locationOptions.includes(location as SavingsLocation)) return setError('Choose where you keep this saving.');

    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(id, {
        name: name.trim(), amount: Number(amountText), saved_on: date,
        storage_type: custom ? 'other' : location as SavingsLocation,
        storage_details: details.trim(), location_id: custom?.id ?? null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this entry.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const close = () => { if (!pending.current) onClose(); };
  if (managingLocations) {
    return <SavingsLocationsManager ownerId={ownerId} locations={locations}
      onSave={(item, creating) => { onLocationSaved(item); if (creating) setLocation(item.id); }}
      onDelete={(id) => { onLocationDeleted(id); if (location === id) setLocation('other'); }}
      onClose={() => setManagingLocations(false)} />;
  }
  return (
    <ModalShell eyebrow="Savings" title={entry ? 'Edit savings account' : 'New savings account'} labelId="savings-form-title" onClose={close}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <label className="full-field">Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Emergency fund" autoFocus />
          </label>
          <label>Opening amount (₹)
            <RupeeInput value={amount} onValueChange={setAmount} />
          </label>
          <DatePicker label="Opening date" value={date} max={savingsDate()} onChange={setDate} />
          <label>Stored in
            <Select value={location} onChange={(event) => setLocation(event.target.value)}>
              <option value="">Choose where it’s stored</option>
              {locationOptions.map((option) => <option key={option} value={option}>{savingsLocations[option]}</option>)}
              {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <label>{location === 'bank' ? 'Bank or account name (optional)' : 'Location details (optional)'}
            <input value={details} onChange={(event) => setDetails(event.target.value)} maxLength={100} />
          </label>
        </div>
        <button type="button" className="text-button savings-location-tools" disabled={saving} onClick={() => setManagingLocations(true)}>
          Manage locations
        </button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save account'}</button>
        </div>
      </form>
    </ModalShell>
  );
}

export function SavingsView({ ownerId, onNotify }: { ownerId: string; onNotify: (message: string) => void }) {
  const [entries, setEntries] = useState<SavingsEntry[]>();
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editing, setEditing] = useState<SavingsEntry | null>();
  const [deleting, setDeleting] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [locations, setLocations] = useState<CustomSavingsLocation[]>([]);
  const [managingLocations, setManagingLocations] = useState(false);
  const deletionPending = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([loadSavingsEntries(ownerId), loadSavingsLocations(ownerId)]).then(([accounts, customLocations]) => {
      if (active) {
        setEntries(accounts);
        setLocations(customLocations);
      }
    }).catch((caught: unknown) => {
      if (active) setLoadError(caught instanceof Error ? caught.message : 'Could not load your savings.');
    });
    return () => { active = false; };
  }, [ownerId, loadAttempt]);

  function updateAccount(result: SavingsEntry) {
    setEntries((current) => [result, ...(current ?? []).filter((entry) => entry.id !== result.id)]
      .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at) || b.id.localeCompare(a.id)));
  }

  async function save(id: string, draft: SavingsDraft) {
    const result = await saveSavingsEntry(ownerId, id, draft, Boolean(editing));
    updateAccount(result);
    setEditing(undefined);
    onNotify(editing ? 'Savings account updated.' : 'Savings account added.');
  }

  async function remove(entry: SavingsEntry) {
    if (deletionPending.current || !window.confirm(`Delete “${entry.name}” and all its savings history?`)) return;
    deletionPending.current = true;
    setDeleting(entry.id);
    try {
      await deleteSavingsEntry(ownerId, entry.id);
      setEntries((current) => current?.filter((item) => item.id !== entry.id));
      onNotify('Savings account deleted.');
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not delete this saving.');
    } finally {
      deletionPending.current = false;
      setDeleting(undefined);
    }
  }

  const selected = entries?.find((entry) => entry.id === selectedId);
  const locationLabel = (entry: SavingsEntry) => locations.find((item) => item.id === entry.location_id)?.name ?? savingsLocations[entry.storage_type];

  function updateLocation(location: CustomSavingsLocation) {
    setLocations((current) => [location, ...current.filter((item) => item.id !== location.id)].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function removeLocation(id: string) {
    setLocations((current) => current.filter((item) => item.id !== id));
    setEntries((current) => current?.map((entry) => entry.location_id === id ? { ...entry, location_id: null } : entry));
  }

  return (
    <>
      {selected ? (
        <>
          <button type="button" className="text-button savings-back" onClick={() => setSelectedId(undefined)}><ArrowLeft size={15} /> Back to savings</button>
          <SavingsAccountHistory key={selected.id} account={selected} location={locationLabel(selected)} onAccountChanged={updateAccount} onNotify={onNotify} />
        </>
      ) : (
        <>
          <SectionHeading title="Money set aside" description="Open an account to add or withdraw savings and see its history."
            action={<>
              <button type="button" className="secondary-button" disabled={!entries || Boolean(deleting)} onClick={() => setManagingLocations(true)}>Manage locations</button>
              <button type="button" className="primary-button" disabled={!entries || Boolean(deleting)} onClick={() => setEditing(null)}>
                <Plus size={16} /> New savings account
              </button>
            </>}
          />
          <section className="surface-card" aria-labelledby="savings-entries-title">
            <div className="card-title-row">
              <h3 id="savings-entries-title">Savings accounts</h3>
              {entries ? <strong className="account-balance">{formatMoney(totalInRupees(entries.map((entry) => entry.balance)))} total</strong> : null}
            </div>
            {loadError ? (
              <EmptyPanel icon={<PiggyBank size={20} />} title="Savings unavailable" description={loadError}
                action={<button type="button" className="secondary-button" onClick={() => { setLoadError(''); setLoadAttempt((value) => value + 1); }}>Try again</button>} />
            ) : !entries ? (
              <p className="card-note" role="status">Loading your savings…</p>
            ) : entries.length === 0 ? (
              <EmptyPanel icon={<PiggyBank size={20} />} title="No savings accounts yet" description="Create an account for the money you’ve set aside." />
            ) : (
              <div className="account-list">
                {entries.map((entry) => {
                  const Icon = locationIcons[entry.storage_type];
                  return (
                    <article className="account-row savings-account-row" key={entry.id}>
                      <button type="button" className="account-row savings-account-link" onClick={() => setSelectedId(entry.id)}>
                        <span className="account-icon" aria-hidden="true"><Icon size={17} /></span>
                        <span className="account-info">
                          <b>{entry.name}</b>
                          <small>{[locationLabel(entry), entry.storage_details, lastActivityDate.format(new Date(entry.last_activity_at))].filter(Boolean).join(' · ')}</small>
                        </span>
                        <span className="account-balance"><b>{formatMoney(entry.balance)}</b></span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                      <div className="item-actions">
                        <button type="button" className="ghost-button" aria-label={`Edit ${entry.name}`} disabled={Boolean(deleting)} onClick={() => setEditing(entry)}><Pencil size={15} /> Edit</button>
                        <button type="button" className="ghost-button danger" aria-label={`Delete ${entry.name}`} disabled={Boolean(deleting)} onClick={() => void remove(entry)}><Trash2 size={15} /> {deleting === entry.id ? 'Deleting…' : 'Delete'}</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
      {editing !== undefined ? <SavingsForm key={editing?.id ?? 'new'} ownerId={ownerId} entry={editing} locations={locations}
        onLocationSaved={updateLocation} onLocationDeleted={removeLocation} onSave={save} onClose={() => setEditing(undefined)} /> : null}
      {managingLocations ? <SavingsLocationsManager ownerId={ownerId} locations={locations}
        onSave={updateLocation} onDelete={removeLocation} onClose={() => setManagingLocations(false)} /> : null}
    </>
  );
}
