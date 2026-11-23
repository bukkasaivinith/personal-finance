import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Plus } from 'lucide-react';
import { RupeeInput } from '@/components/rupee-input';
import { EmptyPanel, ModalShell } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/finance';
import { loadSavingsMovements, recordSavingsMovement, type SavingsEntry, type SavingsMovement, type SavingsMovementDirection } from '@/lib/savings-api';

const activityDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

function SavingsMovementForm({ account, direction, onClose, onSave }: {
  account: SavingsEntry;
  direction: SavingsMovementDirection;
  onClose: () => void;
  onSave: (account: SavingsEntry, movement: SavingsMovement) => void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const requestId = useRef('');
  const withdrawing = direction === 'withdrawal';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    if (!/^[0-9]{1,12}(\.[0-9]{0,2})?$/.test(amount) || Number(amount) <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (withdrawing && Number(amount) > account.balance) {
      setError('The withdrawal exceeds this account’s savings balance.');
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const result = await recordSavingsMovement(account.id, requestId.current, direction, Number(amount), note.trim());
      onSave(result.account, result.movement);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record this entry.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const close = () => { if (!pending.current) onClose(); };
  return (
    <ModalShell eyebrow={account.name} title={withdrawing ? 'Withdraw savings' : 'Add savings'} labelId="savings-movement-title" onClose={close}>
      <form className="modal-form" onSubmit={submit}>
        {withdrawing ? <p className="modal-description">{formatMoney(account.balance)} available in this savings account.</p> : null}
        <div className="form-grid">
          <label className="full-field">Amount (₹)
            <RupeeInput value={amount} onValueChange={(value) => { setAmount(value); requestId.current = ''; }} autoFocus disabled={saving} />
          </label>
          <label className="full-field">Note (optional)
            <input value={note} onChange={(event) => { setNote(event.target.value); requestId.current = ''; }} maxLength={140} disabled={saving} />
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : withdrawing ? 'Record withdrawal' : 'Record savings'}</button>
        </div>
      </form>
    </ModalShell>
  );
}

export function SavingsAccountHistory({ account, location, onAccountChanged, onNotify }: {
  account: SavingsEntry;
  location: string;
  onAccountChanged: (account: SavingsEntry) => void;
  onNotify: (message: string) => void;
}) {
  const [movements, setMovements] = useState<SavingsMovement[]>();
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [direction, setDirection] = useState<SavingsMovementDirection>();

  useEffect(() => {
    let active = true;
    void loadSavingsMovements(account.id).then((result) => {
      if (active) setMovements(result);
    }).catch((caught: unknown) => {
      if (active) setLoadError(caught instanceof Error ? caught.message : 'Could not load your savings history.');
    });
    return () => { active = false; };
  }, [account.id, loadAttempt]);

  function saved(updatedAccount: SavingsEntry, movement: SavingsMovement) {
    setMovements((current) => [movement, ...(current ?? []).filter((item) => item.id !== movement.id)]
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id)));
    onAccountChanged(updatedAccount);
    setDirection(undefined);
    onNotify(movement.direction === 'deposit' ? 'Savings added.' : 'Withdrawal recorded.');
  }

  return (
    <section className="surface-card" aria-labelledby="savings-account-title">
      <div className="card-title-row savings-history-heading">
        <div>
          <h3 id="savings-account-title">{account.name}</h3>
          <p>{[location, account.storage_details].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="savings-history-actions">
          <strong className="account-balance">{formatMoney(account.balance)} balance</strong>
          <button type="button" className="secondary-button" disabled={!movements || account.balance === 0} onClick={() => setDirection('withdrawal')}>
            <ArrowUpRight size={15} /> Withdraw savings
          </button>
          <button type="button" className="primary-button" disabled={!movements} onClick={() => setDirection('deposit')}>
            <Plus size={15} /> Add savings
          </button>
        </div>
      </div>
      {loadError ? (
        <EmptyPanel icon={<PiggyBank size={20} />} title="Savings history unavailable" description={loadError}
          action={<button type="button" className="secondary-button" onClick={() => { setLoadError(''); setLoadAttempt((value) => value + 1); }}>Try again</button>} />
      ) : !movements ? (
        <p className="card-note" role="status">Loading history…</p>
      ) : (
        <div className="account-list" aria-label="Savings history, newest first">
          {movements.map((movement) => {
            const deposit = movement.direction === 'deposit';
            return <div className="account-row" key={movement.id}>
              <span className="account-icon" aria-hidden="true">{deposit ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
              <span className="account-info">
                <b>{deposit ? 'Savings added' : 'Savings withdrawn'}</b>
                <small>{[activityDate.format(new Date(movement.recorded_at)), movement.note].filter(Boolean).join(' · ')}</small>
              </span>
              <span className={`account-balance ${deposit ? 'positive' : 'negative'}`}><b>{deposit ? '+' : ''}{formatMoney(deposit ? movement.amount : -movement.amount)}</b></span>
            </div>;
          })}
          <div className="account-row">
            <span className="account-icon" aria-hidden="true"><PiggyBank size={17} /></span>
            <span className="account-info"><b>Opening balance</b><small>{formatDate(account.saved_on)}</small></span>
            <span className="account-balance"><b>{formatMoney(account.amount)}</b></span>
          </div>
        </div>
      )}
      {direction ? <SavingsMovementForm account={account} direction={direction} onClose={() => setDirection(undefined)} onSave={saved} /> : null}
    </section>
  );
}
