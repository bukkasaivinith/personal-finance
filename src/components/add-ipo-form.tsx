import { useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { ModalShell } from '@/components/ui';
import { formatMoney, todayKey, type Account } from '@/lib/finance';
import { formatDematAccount, saveIpoApplications, type IpoApplicationDraft, type IpoDematAccount } from '@/lib/ipo-portfolio-api';

type AllocationDraft = { id: string; dematId: string; lots: string };

const maxShares = 2_147_483_647;
const maxAmountPaise = 99_999_999_999_999;
const allocationsPerPage = 3;
const inrPattern = /^[0-9]{1,12}(\.[0-9]{1,2})?$/;

function wholeNumber(value: string) {
  const number = /^[0-9]{1,10}$/.test(value) ? Number(value) : 0;
  return number <= maxShares ? number : 0;
}

function allocation(dematId = '', lots = '1'): AllocationDraft {
  return { id: crypto.randomUUID(), dematId, lots };
}

export function AddIpoForm({ accounts, demats, onManageDemats, onClose, onSave }: {
  accounts: Account[];
  demats: IpoDematAccount[];
  onManageDemats: () => void;
  onClose: () => void;
  onSave: (applicationCount: number) => void;
}) {
  const today = todayKey();
  const [draft, setDraft] = useState<IpoApplicationDraft>(() => ({
    company_name: '', classification: 'Mainboard', application_date: today, listing_date: '',
    issue_price: '', lot_size: '', account_id: accounts.length === 1 ? accounts[0].id : '',
  }));
  const [totalLots, setTotalLots] = useState('1');
  const [allocations, setAllocations] = useState(() => [allocation(demats.length === 1 ? demats[0].id : '')]);
  const [step, setStep] = useState<'details' | 'accounts'>('details');
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const requestId = useRef('');

  const lots = wholeNumber(totalLots);
  const sharesPerLot = wholeNumber(draft.lot_size);
  const issuePaise = inrPattern.test(draft.issue_price) ? Math.round(Number(draft.issue_price) * 100) : 0;
  const lotPaise = issuePaise * sharesPerLot;
  const totalPaise = lotPaise * lots;
  const totalShares = sharesPerLot * lots;
  const validAmount = totalPaise > 0 && totalPaise <= maxAmountPaise && totalShares <= maxShares;
  const enteredLots = allocations.reduce((sum, item) => sum + wholeNumber(item.lots), 0);
  const assignedLots = allocations.reduce((sum, item) => sum + (item.dematId ? wholeNumber(item.lots) : 0), 0);
  const pageCount = Math.ceil(allocations.length / allocationsPerPage);
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * allocationsPerPage;
  const canSplit = allocations.length < Math.min(lots, demats.length);

  function markChanged() {
    requestId.current = '';
    setError('');
  }

  function updateField<Key extends keyof IpoApplicationDraft>(field: Key, value: IpoApplicationDraft[Key]) {
    setDraft((current) => ({ ...current, [field]: value }));
    markChanged();
  }

  function updateTotalLots(value: string) {
    setTotalLots(value);
    setAllocations((current) => current.length === 1 ? [{ ...current[0], lots: value }] : current);
    markChanged();
  }

  function updateAllocation(id: string, field: 'dematId' | 'lots', value: string) {
    setAllocations((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
    markChanged();
  }

  function splitLots() {
    if (!canSplit) return;
    const donor = enteredLots >= lots ? allocations.find((item) => wholeNumber(item.lots) > 1) : undefined;
    const remaining = allocations.map((item) => item.id === donor?.id ? { ...item, lots: String(wholeNumber(item.lots) - 1) } : item);
    setAllocations([...remaining, allocation()]);
    setPage(Math.floor(allocations.length / allocationsPerPage));
    markChanged();
  }

  function deleteAllocation(id: string) {
    const remaining = allocations.filter((item) => item.id !== id);
    if (remaining.length === 1) remaining[0] = { ...remaining[0], lots: totalLots };
    setAllocations(remaining);
    markChanged();
  }

  function close() {
    if (!inFlight.current) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (step === 'details') {
      if (!draft.company_name.trim()) return setError('Enter the company name.');
      if (!draft.application_date || draft.application_date > today) return setError('Choose an application date on or before today.');
      if (draft.listing_date && draft.listing_date < draft.application_date) return setError('The listing date must be on or after the application date.');
      if (!accounts.some((account) => account.id === draft.account_id)) return setError('Choose an active bank or cash account.');
      if (!validAmount) return setError('Enter a valid issue price, shares per lot and whole number of lots.');
      if (!demats.length) return setError('Add a demat account before assigning lots.');
      setStep('accounts');
      setError('');
      return;
    }

    const invalid = allocations.findIndex((item) => !demats.some((demat) => demat.id === item.dematId) || !wholeNumber(item.lots));
    if (invalid !== -1) {
      setPage(Math.floor(invalid / allocationsPerPage));
      return setError('Choose an account and enter whole lots for every allocation.');
    }
    if (new Set(allocations.map((item) => item.dematId)).size !== allocations.length) return setError('Choose each demat account only once.');
    if (assignedLots !== lots) return setError(`Assign exactly ${lots} ${lots === 1 ? 'lot' : 'lots'} before saving.`);

    inFlight.current = true;
    setSaving(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      await saveIpoApplications(
        { ...draft, company_name: draft.company_name.trim() },
        allocations.map((item) => ({ demat_id: item.dematId, lots: wholeNumber(item.lots) })),
        lots,
        requestId.current,
      );
      onSave(allocations.length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save these IPO applications.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell eyebrow={step === 'details' ? 'Application details · 1 of 2' : 'Demat allocations · 2 of 2'} title="Add IPO" labelId="add-ipo-title" onClose={close} className="ipo-application-modal">
      <form className="modal-form ipo-application-form" onSubmit={submit} noValidate>
        {step === 'details' ? (
          <div className="form-grid ipo-details-grid">
            <label className="ipo-company-field">Company name
              <input autoFocus maxLength={120} value={draft.company_name} onChange={(event) => updateField('company_name', event.target.value)} />
            </label>
            <label>Classification
              <Select aria-label="Classification" value={draft.classification} onChange={(event) => updateField('classification', event.target.value as IpoApplicationDraft['classification'])}>
                <option value="Mainboard">Mainboard</option>
                <option value="SME">SME</option>
              </Select>
            </label>
            <DatePicker label="Application date" value={draft.application_date} max={today} onChange={(value) => updateField('application_date', value)} />
            <DatePicker label="Listing date (optional)" value={draft.listing_date} min={draft.application_date || undefined} onChange={(value) => updateField('listing_date', value)} clearable />
            <label>Funding account
              <Select aria-label="Funding account" value={draft.account_id} onChange={(event) => updateField('account_id', event.target.value)}>
                <option value="">Choose a bank or cash account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </Select>
            </label>
            <label>Issue price per share (₹)
              <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.issue_price} onChange={(event) => updateField('issue_price', event.target.value)} />
            </label>
            <label>Shares per lot
              <input type="number" min="1" max={maxShares} step="1" inputMode="numeric" value={draft.lot_size} onChange={(event) => updateField('lot_size', event.target.value)} />
            </label>
            <label>Total lots
              <input type="number" min="1" max={maxShares} step="1" inputMode="numeric" value={totalLots} onChange={(event) => updateTotalLots(event.target.value)} />
            </label>
          </div>
        ) : (
          <div className="ipo-allocations">
            <div className="ipo-lot-summary" aria-live="polite"><span>Lots assigned <b>{assignedLots} of {lots}</b></span><span>Total amount applied <b>{formatMoney(totalPaise / 100)}</b></span></div>
            {allocations.slice(pageStart, pageStart + allocationsPerPage).map((item, index) => {
              const rowNumber = pageStart + index + 1;
              return (
                <div className="ipo-allocation-row" key={item.id}>
                  <label>Demat account {rowNumber}
                    <Select aria-label={`Demat account ${rowNumber}`} value={item.dematId} onChange={(event) => updateAllocation(item.id, 'dematId', event.target.value)} disabled={saving}>
                      <option value="">Choose a demat account</option>
                      {demats.map((demat) => (
                        <option key={demat.id} value={demat.id} disabled={allocations.some((other) => other.id !== item.id && other.dematId === demat.id)}>
                          {formatDematAccount(demat.holder, demat.demat, demat.broker)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>Lots
                    <input aria-label={`Lots for demat account ${rowNumber}`} type="number" min="1" max={lots} step="1" inputMode="numeric" value={item.lots}
                      onChange={(event) => updateAllocation(item.id, 'lots', event.target.value)} disabled={saving} readOnly={allocations.length === 1} />
                  </label>
                  {allocations.length > 1 ? <button className="icon-button danger" type="button" aria-label={`Remove allocation ${rowNumber}`} onClick={() => deleteAllocation(item.id)} disabled={saving}><Trash2 size={15} /></button> : null}
                </div>
              );
            })}
            <div className="ipo-allocation-actions">
              {canSplit ? <button className="text-button" type="button" onClick={splitLots} disabled={saving}><Plus size={15} /> Split across another account</button> : null}
              {pageCount > 1 ? <div className="ipo-allocation-pages" aria-label="Allocation pages">
                <button className="icon-button" type="button" aria-label="Previous allocations" onClick={() => setPage(safePage - 1)} disabled={safePage === 0 || saving}><ChevronLeft size={15} /></button>
                <span>{safePage + 1} of {pageCount}</span>
                <button className="icon-button" type="button" aria-label="Next allocations" onClick={() => setPage(safePage + 1)} disabled={safePage + 1 === pageCount || saving}><ChevronRight size={15} /></button>
              </div> : null}
            </div>
          </div>
        )}
        {step === 'details' && validAmount ? <div className="ipo-lot-summary" aria-live="polite"><span>{totalShares} shares <b>{formatMoney(lotPaise / 100)} per lot</b></span><span>Total amount applied <b>{formatMoney(totalPaise / 100)}</b></span></div> : null}
        {accounts.length === 0 ? <p className="form-hint">Add a bank or cash account in Accounts to save an application.</p> : null}
        {!demats.length ? <button type="button" className="text-button ipo-missing-demats" onClick={onManageDemats}>Add a demat account first</button> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          {step === 'details'
            ? <button className="secondary-button" type="button" onClick={close}>Cancel</button>
            : <button className="secondary-button" type="button" onClick={() => { setStep('details'); setError(''); }} disabled={saving}>Back</button>}
          <button className="primary-button" type="submit" disabled={saving || !accounts.length || !demats.length}>
            {step === 'details' ? 'Choose demat accounts' : saving ? 'Saving…' : 'Save IPO'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
