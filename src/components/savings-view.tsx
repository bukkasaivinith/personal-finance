import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banknote, Landmark, Pencil, PiggyBank, Plus, Trash2, Wallet } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { EmptyPanel, Metric, ModalShell, SectionHeading } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/finance';
import {
  deleteSavingsEntry, loadSavingsBalances, loadSavingsEntries, saveSavingsEntry, savingsLocations,
  type SavingsBalance, type SavingsDraft, type SavingsEntry, type SavingsLocation,
} from '@/lib/savings-api';

const locationOptions = Object.keys(savingsLocations) as SavingsLocation[];
const locationIcons = { bank: Landmark, cash: Banknote, other: Wallet };
const savingsDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata' }).format(new Date());

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

function SavingsForm({ entry, onSave, onClose }: {
  entry: SavingsEntry | null;
  onSave: (id: string, draft: SavingsDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [name, setName] = useState(entry?.name ?? '');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [date, setDate] = useState(entry?.saved_on ?? savingsDate());
  const [location, setLocation] = useState<SavingsLocation | ''>(entry?.storage_type ?? '');
  const [details, setDetails] = useState(entry?.storage_details ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const amountText = amount.trim();
    if (!name.trim()) return setError('Enter a name for the saving.');
    if (!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(amountText) || Number(amountText) <= 0) {
      return setError('Enter an amount greater than zero with up to two decimal places.');
    }
    if (!date || date > savingsDate()) return setError('Choose a date on or before today.');
    if (!location) return setError('Choose where you keep this saving.');

    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(id, {
        name: name.trim(), amount: Number(amountText), saved_on: date,
        storage_type: location, storage_details: details.trim(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this entry.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const close = () => { if (!pending.current) onClose(); };
  return (
    <ModalShell eyebrow="Savings" title={entry ? 'Edit saving' : 'Add savings'} labelId="savings-form-title" onClose={close}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <label className="full-field">Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Emergency fund" autoFocus />
          </label>
          <label>Amount (₹)
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <DatePicker label="Date saved" value={date} max={savingsDate()} onChange={setDate} />
          <label>Stored in
            <Select value={location} onChange={(event) => setLocation(event.target.value as SavingsLocation | '')}>
              <option value="">Choose where it’s stored</option>
              {locationOptions.map((option) => <option key={option} value={option}>{savingsLocations[option]}</option>)}
            </Select>
          </label>
          <label>{location === 'bank' ? 'Bank or account name (optional)' : 'Location details (optional)'}
            <input value={details} onChange={(event) => setDetails(event.target.value)} maxLength={100} />
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save entry'}</button>
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
  const deletionPending = useRef(false);

  useEffect(() => {
    let active = true;
    void loadSavingsEntries(ownerId).then((result) => {
      if (active) setEntries(result);
    }).catch((caught: unknown) => {
      if (active) setLoadError(caught instanceof Error ? caught.message : 'Could not load your savings.');
    });
    return () => { active = false; };
  }, [ownerId, loadAttempt]);

  async function save(id: string, draft: SavingsDraft) {
    const result = await saveSavingsEntry(ownerId, id, draft, Boolean(editing));
    setEntries((current) => [result, ...(current ?? []).filter((entry) => entry.id !== result.id)]
      .sort((a, b) => b.saved_on.localeCompare(a.saved_on) || b.id.localeCompare(a.id)));
    setEditing(undefined);
    onNotify(editing ? 'Saving updated.' : 'Saving added.');
  }

  async function remove(entry: SavingsEntry) {
    if (deletionPending.current || !window.confirm(`Delete the saving “${entry.name}”?`)) return;
    deletionPending.current = true;
    setDeleting(entry.id);
    try {
      await deleteSavingsEntry(ownerId, entry.id);
      setEntries((current) => current?.filter((item) => item.id !== entry.id));
      onNotify('Saving deleted.');
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not delete this saving.');
    } finally {
      deletionPending.current = false;
      setDeleting(undefined);
    }
  }

  return (
    <>
      <SectionHeading title="Money set aside" description="Record how much you’ve saved and where you keep it."
        action={<button type="button" className="primary-button" disabled={!entries || Boolean(deleting)} onClick={() => setEditing(null)}>
          <Plus size={16} /> Add savings
        </button>}
      />
      <section className="surface-card" aria-labelledby="savings-entries-title">
        <div className="card-title-row">
          <h3 id="savings-entries-title">Savings entries</h3>
          {entries ? <strong className="account-balance">{formatMoney(totalInRupees(entries.map((entry) => entry.amount)))} total</strong> : null}
        </div>
        {loadError ? (
          <EmptyPanel icon={<PiggyBank size={20} />} title="Savings unavailable" description={loadError}
            action={<button type="button" className="secondary-button" onClick={() => { setLoadError(''); setLoadAttempt((value) => value + 1); }}>Try again</button>} />
        ) : !entries ? (
          <p className="card-note" role="status">Loading your savings…</p>
        ) : entries.length === 0 ? (
          <EmptyPanel icon={<PiggyBank size={20} />} title="No savings yet" description="Add the first amount you’ve set aside." />
        ) : (
          <div className="account-list">
            {entries.map((entry) => {
              const Icon = locationIcons[entry.storage_type];
              return (
                <article className="account-row" key={entry.id}>
                  <span className="account-icon"><Icon size={17} /></span>
                  <span className="account-info">
                    <b>{entry.name}</b>
                    <small>{[savingsLocations[entry.storage_type], entry.storage_details, formatDate(entry.saved_on)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="account-balance"><b>{formatMoney(entry.amount)}</b></span>
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
      {editing !== undefined ? <SavingsForm key={editing?.id ?? 'new'} entry={editing} onSave={save} onClose={() => setEditing(undefined)} /> : null}
    </>
  );
}
