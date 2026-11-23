import { useRef, useState, type FormEvent } from 'react';
import { ModalShell } from '@/components/ui';
import { Select } from '@/components/select';
import { RupeeInput } from '@/components/rupee-input';
import { formatDematAccount, saveIpoApplicationResult, type IpoApplication } from '@/lib/ipo-portfolio-api';

type ResultKind = 'profit' | 'loss' | 'even' | 'unrecorded';
const positiveRupees = (value: string) => /^[0-9]{1,12}(\.[0-9]{0,2})?$/.test(value) && Number(value) > 0;

export function IpoResultForm({ application, onClose, onSaved }: {
  application: IpoApplication;
  onClose: () => void;
  onSaved: (profitLoss: number | null, investedAmount: number | null) => void;
}) {
  const initial = application.realized_profit_loss;
  const [kind, setKind] = useState<ResultKind>(initial == null ? 'unrecorded' : initial > 0 ? 'profit' : initial < 0 ? 'loss' : 'even');
  const [amount, setAmount] = useState(initial ? String(Math.abs(initial)) : '');
  const [invested, setInvested] = useState(application.invested_amount == null ? '' : String(application.invested_amount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const needsAmount = kind === 'profit' || kind === 'loss';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const text = amount.trim();
    if (needsAmount && !positiveRupees(text)) {
      setError('Enter an amount greater than zero with up to two decimal places.');
      return;
    }
    const investedText = invested.trim();
    if (investedText && !positiveRupees(investedText)) {
      setError('Enter a positive invested amount with up to two decimal places.');
      return;
    }

    const result = kind === 'unrecorded' ? null : kind === 'even' ? 0 : Number(text) * (kind === 'loss' ? -1 : 1);
    const investedAmount = investedText ? Number(investedText) : null;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await saveIpoApplicationResult(application.id, result, investedAmount);
      onSaved(result, investedAmount);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the IPO result.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const close = () => { if (!pending.current) onClose(); };
  return (
    <ModalShell eyebrow="IPO portfolio" title="Record IPO result" labelId="ipo-result-title" onClose={close}>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-description">{application.company} · {formatDematAccount(application.holder, application.demat, application.broker)}</p>
        <div className="form-grid">
          <label className={needsAmount ? undefined : 'full-field'}>Result
            <Select value={kind} onChange={(event) => setKind(event.target.value as ResultKind)} disabled={saving}>
              <option value="unrecorded">No profit or loss recorded</option>
              <option value="profit">Profit</option>
              <option value="loss">Loss</option>
              <option value="even">Break even</option>
            </Select>
          </label>
          {needsAmount ? <label>Net amount (₹)
            <RupeeInput value={amount} onValueChange={setAmount} disabled={saving} />
          </label> : null}
          <label className="full-field">Invested in allotted shares (₹, optional)
            <RupeeInput value={invested} onValueChange={setInvested} disabled={saving} />
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save result'}</button>
        </div>
      </form>
    </ModalShell>
  );
}
