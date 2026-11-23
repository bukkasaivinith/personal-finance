import { useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { ModalShell } from '@/components/ui';
import { formatMoney, todayKey, type Account } from '@/lib/finance';
import { groupIpoLots } from '@/lib/ipo-lot-allocations';
import { formatDematAccount, saveIpoApplications, updateIpoApplication, type IpoApplication, type IpoApplicationDraft, type IpoDematAccount } from '@/lib/ipo-portfolio-api';

const maxShares = 2_147_483_647;
const maxAmountPaise = 99_999_999_999_999;
const lotsPerPage = 3;
const inrPattern = /^[0-9]{1,12}(\.[0-9]{1,2})?$/;

function wholeNumber(value: string) {
  const number = /^[0-9]{1,10}$/.test(value) ? Number(value) : 0;
  return number <= maxShares ? number : 0;
}

export function AddIpoForm({ accounts, demats, application, allotmentDateSupported, onManageDemats, onClose, onSave }: {
  accounts: Account[];
  demats: IpoDematAccount[];
  application?: IpoApplication;
  allotmentDateSupported: boolean;
  onManageDemats: () => void;
  onClose: () => void;
  onSave: (applicationCount: number) => void;
}) {
  const today = todayKey();
  const [draft, setDraft] = useState<IpoApplicationDraft>(() => ({
    company_name: application?.company ?? '',
    classification: application?.classification ?? 'Mainboard',
    application_date: application?.application_date ?? today,
    allotment_date: application?.allotment_date ?? '',
    listing_date: application?.listing_date ?? '',
    issue_price: application ? String(application.issue_price) : '',
    lot_size: application ? String(application.lot_size) : '',
    account_id: application?.funding_account_id ?? (accounts.length === 1 ? accounts[0].id : ''),
  }));
  const [totalLots, setTotalLots] = useState(String(application?.lots ?? 1));
  const [defaultDemat, setDefaultDemat] = useState(application?.demat_account_id ?? (demats.length === 1 ? demats[0].id : ''));
  const [selections, setSelections] = useState<Map<number, string>>(() => new Map());
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
  const totalPaise = lotPaise * lots + Math.round((application?.adjustment ?? 0) * 100);
  const totalShares = sharesPerLot * lots;
  const validAmount = lotPaise > 0 && lots > 0 && totalPaise > 0 && totalPaise <= maxAmountPaise && totalShares <= maxShares;
  const allocations = groupIpoLots(lots, defaultDemat, selections);
  const assignedLots = allocations.reduce((sum, item) => sum + item.lots, 0);
  const pageCount = Math.max(1, Math.ceil(lots / lotsPerPage));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * lotsPerPage;
  const visibleLots = Array.from({ length: Math.max(0, Math.min(lotsPerPage, lots - pageStart)) }, (_, index) => pageStart + index);
  const savedFunding = application?.funding_account_id;
  const savedDemat = application?.demat_account_id;
  const hasFunding = accounts.length > 0 || Boolean(savedFunding);
  const hasDemats = demats.length > 0 || Boolean(savedDemat);

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
    if (wholeNumber(value)) setSelections((current) => new Map([...current].filter(([index]) => index < wholeNumber(value))));
    markChanged();
  }

  function updateLot(index: number, value: string) {
    setSelections((current) => new Map(current).set(index, value));
    markChanged();
  }

  function assignAllLots(value: string) {
    setDefaultDemat(value);
    setSelections(new Map());
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
      if (draft.allotment_date) {
        if (!allotmentDateSupported) return setError('Apply the latest IPO Portfolio SQL update in Supabase to save an allotment date.');
        if (draft.allotment_date < draft.application_date || (draft.listing_date && draft.allotment_date > draft.listing_date)) {
          return setError('The allotment date must be on or after the application date and on or before the listing date.');
        }
      }
      if (draft.account_id !== savedFunding && !accounts.some((account) => account.id === draft.account_id)) return setError('Choose an active bank or cash account.');
      if (!validAmount) return setError('Enter a valid issue price, shares per lot and whole number of lots.');
      if (!hasDemats) return setError('Add a demat account before assigning lots.');
      setStep('accounts');
      setError('');
      return;
    }

    if (allocations.some((item) => item.demat_id !== savedDemat && !demats.some((demat) => demat.id === item.demat_id))) return setError('Choose an active demat account.');
    if (assignedLots !== lots) return setError('Choose an account holder for every lot before saving.');

    inFlight.current = true;
    setSaving(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const details = { ...draft, company_name: draft.company_name.trim() };
      if (application) await updateIpoApplication(application.id, details, allocations[0], requestId.current);
      else await saveIpoApplications(details, allocations, lots, requestId.current);
      onSave(allocations.length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save these IPO applications.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell eyebrow={step === 'details' ? 'Application details · 1 of 2' : 'Demat accounts · 2 of 2'} title={application ? 'Edit IPO application' : 'Add IPO'} labelId="add-ipo-title" onClose={close} className="ipo-application-modal">
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
            <label>Funding account
              <Select aria-label="Funding account" value={draft.account_id} onChange={(event) => updateField('account_id', event.target.value)}>
                <option value="">Choose a bank or cash account</option>
                {savedFunding && !accounts.some((account) => account.id === savedFunding)
                  ? <option value={savedFunding}>{application?.funding_account_name ?? 'Saved funding account'}</option> : null}
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </Select>
            </label>
            <DatePicker label="Application date" value={draft.application_date} max={today} onChange={(value) => updateField('application_date', value)} />
            <DatePicker label="Allotment date (optional)" value={draft.allotment_date} min={draft.application_date || undefined} max={draft.listing_date || undefined} onChange={(value) => updateField('allotment_date', value)} clearable />
            <DatePicker label="Listing date (optional)" value={draft.listing_date} min={draft.allotment_date || draft.application_date || undefined} onChange={(value) => updateField('listing_date', value)} clearable />
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
            {application || lots > 1 ? (
              <label className="ipo-all-lots">{application ? 'Demat account' : 'Use one account for all lots (optional)'}
                <Select aria-label={application ? 'Demat account' : 'Use one account for all lots'} value={defaultDemat} onChange={(event) => assignAllLots(event.target.value)} disabled={saving}>
                  <option value="">{application ? 'Choose an account holder' : 'Select each lot below'}</option>
                  {application && savedDemat && !demats.some((demat) => demat.id === savedDemat)
                    ? <option value={savedDemat}>{formatDematAccount(application.holder, application.demat, application.broker)}</option> : null}
                  {demats.map((demat) => <option key={demat.id} value={demat.id}>{formatDematAccount(demat.holder, demat.demat, demat.broker)}</option>)}
                </Select>
              </label>
            ) : null}
            {!application ? <div className="ipo-lot-fields">
              {visibleLots.map((index) => (
                <label key={index}>Lot {index + 1}
                  <Select aria-label={`Account holder for lot ${index + 1}`} value={selections.get(index) ?? defaultDemat} onChange={(event) => updateLot(index, event.target.value)} disabled={saving}>
                    <option value="">Choose an account holder</option>
                    {demats.map((demat) => <option key={demat.id} value={demat.id}>{formatDematAccount(demat.holder, demat.demat, demat.broker)}</option>)}
                  </Select>
                </label>
              ))}
            </div> : null}
            <div className="ipo-allocation-actions">
              {!application && pageCount > 1 ? <div className="ipo-allocation-pages" aria-label="Lot pages">
                <button className="icon-button" type="button" aria-label="Previous allocations" onClick={() => setPage(safePage - 1)} disabled={safePage === 0 || saving}><ChevronLeft size={15} /></button>
                <span>{safePage + 1} of {pageCount}</span>
                <button className="icon-button" type="button" aria-label="Next allocations" onClick={() => setPage(safePage + 1)} disabled={safePage + 1 === pageCount || saving}><ChevronRight size={15} /></button>
              </div> : null}
            </div>
          </div>
        )}
        {application && step === 'details' ? <p className="form-hint">Company name, classification, allotment date and listing date apply to every application for this IPO.</p> : null}
        {step === 'details' && validAmount ? <div className="ipo-lot-summary" aria-live="polite"><span>{totalShares} shares <b>{formatMoney(lotPaise / 100)} per lot</b></span><span>Total amount applied <b>{formatMoney(totalPaise / 100)}</b></span></div> : null}
        {!hasFunding ? <p className="form-hint">Add a bank or cash account in Accounts to save an application.</p> : null}
        {!hasDemats ? <button type="button" className="text-button ipo-missing-demats" onClick={onManageDemats}>Add a demat account first</button> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          {step === 'details'
            ? <button className="secondary-button" type="button" onClick={close}>Cancel</button>
            : <button className="secondary-button" type="button" onClick={() => { setStep('details'); setError(''); }} disabled={saving}>Back</button>}
          <button className="primary-button" type="submit" disabled={saving || !hasFunding || !hasDemats}>
            {step === 'details' ? 'Choose demat accounts' : saving ? 'Saving…' : application ? 'Save changes' : 'Save IPO'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
