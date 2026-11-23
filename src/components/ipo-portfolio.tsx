import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Building2, FileText, Wallet } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { EmptyPanel, Metric, ModalShell } from '@/components/ui';
import { formatDate, formatMoney, todayKey, type Account } from '@/lib/finance';
import { loadIpoPortfolio, saveIpoApplication, type IpoApplicationDraft, type IpoDematAccount, type IpoPortfolioData } from '@/lib/ipo-portfolio-api';
import './ipo-portfolio.css';

const ownDemat = '__own_demat__';
const newHolder = '__new_holder__';
const inr = /^[0-9]{1,12}(\.[0-9]{1,2})?$/;
const maxShares = 2_147_483_647;

function dematLabel(holder: string, demat: string) {
  return demat === 'Demat' || demat.toLocaleLowerCase() === holder.toLocaleLowerCase() ? holder : `${holder} / ${demat}`;
}

function AddIpoForm({ accounts, demats, ownerName, onClose, onSave }: {
  accounts: Account[];
  demats: IpoDematAccount[];
  ownerName: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const today = todayKey();
  const [draft, setDraft] = useState<IpoApplicationDraft>(() => ({
    company_name: '', classification: 'Mainboard', application_date: today, listing_date: '',
    issue_price: '', lot_size: '', amount: '', demat_id: '', holder_name: '',
    account_id: accounts.length === 1 ? accounts[0].id : '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const requestId = useRef('');
  const shares = /^[0-9]{1,10}$/.test(draft.lot_size) ? Number(draft.lot_size) : 0;
  const issuePaise = inr.test(draft.issue_price) ? Math.round(Number(draft.issue_price) * 100) : 0;
  const amountPaise = inr.test(draft.amount) ? Math.round(Number(draft.amount) * 100) : 0;
  const lotPaise = Number.isInteger(shares) && shares > 0 && shares <= maxShares ? issuePaise * shares : 0;
  const validLotPrice = lotPaise > 0 && Number.isSafeInteger(lotPaise);
  const lots = validLotPrice && amountPaise > 0 && amountPaise % lotPaise === 0 && (amountPaise / lotPaise) * shares <= maxShares
    ? amountPaise / lotPaise
    : 0;

  function update<Key extends keyof IpoApplicationDraft>(field: Key, value: IpoApplicationDraft[Key]) {
    if (inFlight.current) return;
    setDraft((current) => ({ ...current, [field]: value }));
    requestId.current = '';
    setError('');
  }

  function close() {
    if (!inFlight.current) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const isNewAccount = draft.demat_id === newHolder || draft.demat_id === ownDemat;
    const holder = draft.demat_id === ownDemat ? ownerName : draft.holder_name.trim();
    if (!draft.company_name.trim()) return setError('Enter the company name.');
    if (!draft.application_date || draft.application_date > today) return setError('Choose an application date on or before today.');
    if (draft.listing_date && draft.listing_date < draft.application_date) return setError('The listing date must be on or after the application date.');
    if (!draft.demat_id || (isNewAccount && !holder)) return setError('Choose or enter the demat account holder.');
    if (!accounts.some((account) => account.id === draft.account_id)) return setError('Choose an active bank or cash account.');
    if (!lots) return setError('Enter an issue price, shares per lot and an applied amount that buys whole lots.');

    inFlight.current = true;
    setSaving(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      await saveIpoApplication({
        ...draft,
        company_name: draft.company_name.trim(),
        demat_id: isNewAccount ? '' : draft.demat_id,
        holder_name: isNewAccount ? holder : '',
        designation: isNewAccount ? (draft.demat_id === ownDemat ? 'self' : 'friend') : undefined,
      }, requestId.current);
      onSave();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this IPO application.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell eyebrow="Portfolio" title="Add IPO" labelId="add-ipo-title" onClose={close}>
      <form className="modal-form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <label className="full-field">Company name
            <input autoFocus maxLength={120} value={draft.company_name} onChange={(event) => update('company_name', event.target.value)} disabled={saving} />
          </label>
          <DatePicker label="Application date" value={draft.application_date} max={today} onChange={(value) => update('application_date', value)} disabled={saving} />
          <DatePicker label="Listing date (optional)" value={draft.listing_date} min={draft.application_date || undefined} onChange={(value) => update('listing_date', value)} clearable disabled={saving} />
          <label>Demat account holder
            <Select aria-label="Demat account holder" value={draft.demat_id} onChange={(event) => update('demat_id', event.target.value)} disabled={saving}>
              <option value="">Choose whose account</option>
              {demats.map((demat) => <option key={demat.id} value={demat.id}>{dematLabel(demat.holder, demat.demat)}</option>)}
              {!demats.some((demat) => demat.designation === 'self') ? <option value={ownDemat}>My demat account</option> : null}
              <option value={newHolder}>+ Add an account holder</option>
            </Select>
          </label>
          <label>Funding account
            <Select aria-label="Funding account" value={draft.account_id} onChange={(event) => update('account_id', event.target.value)} disabled={saving}>
              <option value="">Choose a bank or cash account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </Select>
          </label>
          {draft.demat_id === newHolder ? <label className="full-field">Account holder name
            <input maxLength={80} value={draft.holder_name} onChange={(event) => update('holder_name', event.target.value)} disabled={saving} />
          </label> : null}
          <label>Classification
            <Select aria-label="Classification" value={draft.classification} onChange={(event) => update('classification', event.target.value as IpoApplicationDraft['classification'])} disabled={saving}>
              <option value="Mainboard">Mainboard</option>
              <option value="SME">SME</option>
            </Select>
          </label>
          <label>Issue price per share (₹)
            <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.issue_price} onChange={(event) => update('issue_price', event.target.value)} disabled={saving} />
          </label>
          <label>Shares per lot
            <input type="number" min="1" max={maxShares} step="1" inputMode="numeric" value={draft.lot_size} onChange={(event) => update('lot_size', event.target.value)} disabled={saving} />
          </label>
          <label>Total amount applied (₹)
            <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.amount} onChange={(event) => update('amount', event.target.value)} disabled={saving} />
          </label>
        </div>
        {validLotPrice ? (
          <div className="investment-settlement-summary" aria-live="polite">
            <span>Cost per lot <b>{formatMoney(lotPaise / 100)}</b></span>
            <span>Lots applied <b>{lots ? `${lots} · ${lots * shares} shares` : '—'}</b></span>
          </div>
        ) : null}
        {accounts.length === 0 ? <p className="form-hint">Add a bank or cash account in Accounts to save an application.</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={close} disabled={saving}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving || accounts.length === 0}>{saving ? 'Saving…' : 'Save IPO'}</button>
        </div>
      </form>
    </ModalShell>
  );
}

export function IpoPortfolio({ accounts, ownerName, adding, onClose, onBack, onNotify }: {
  accounts: Account[];
  ownerName: string;
  adding: boolean;
  onClose: () => void;
  onBack: () => void;
  onNotify: (message: string) => void;
}) {
  const [data, setData] = useState<IpoPortfolioData>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setError('');
    try {
      setData(await loadIpoPortfolio());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your portfolio.');
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const saved = () => {
    onClose();
    onNotify('IPO application saved.');
    void refresh();
  };

  const applications = data?.applications ?? [];
  const totalApplied = applications.reduce((total, application) => total + Math.round(application.amount * 100), 0) / 100;

  return (
    <>
      <button type="button" className="text-button ipo-back-button" onClick={onBack}><ArrowLeft size={15} /> Back to investments</button>
      {error || !data ? (
        <div className="surface-card">
          <EmptyPanel icon={<Building2 size={20} />} title={error ? 'Portfolio unavailable' : 'Loading portfolio'} description={error || 'Fetching your IPO applications.'}
            action={error ? <button className="secondary-button" type="button" onClick={() => void refresh()}>Try again</button> : undefined}
          />
        </div>
      ) : (
        <>
          <div className="metrics-grid ipo-portfolio-metrics">
            <Metric label="Companies applied" value={String(new Set(applications.map((application) => application.company_id)).size)} foot="Distinct IPOs" icon={<Building2 size={16} />} />
            <Metric label="Applications" value={String(applications.length)} foot="Recorded across demat accounts" icon={<FileText size={16} />} />
            <Metric label="Total applied" value={formatMoney(totalApplied)} foot="Combined application amounts" icon={<Wallet size={16} />} />
          </div>
          <section className="surface-card" aria-labelledby="ipo-applications-title">
            <div className="card-title-row"><h3 id="ipo-applications-title">IPO applications</h3></div>
            {applications.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Company</th><th scope="col">Demat account</th><th scope="col">Applied on</th><th scope="col">Listing date</th><th scope="col">Lots</th><th scope="col" className="amount-column">Applied amount</th></tr></thead>
                  <tbody>
                    {applications.map((application) => (
                      <tr key={application.id}>
                        <td><b>{application.company}</b><div className="ipo-application-detail">{formatMoney(application.issue_price)} per share</div></td>
                        <td>{dematLabel(application.holder, application.demat)}</td>
                        <td>{formatDate(application.application_date)}</td>
                        <td>{application.listing_date ? formatDate(application.listing_date) : '—'}</td>
                        <td>{application.lots}<div className="ipo-application-detail">{application.lot_size} shares per lot</div></td>
                        <td className="amount-column">{formatMoney(application.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyPanel icon={<FileText size={20} />} title="No IPO applications yet" description="Use Add IPO to record your first application." />}
          </section>
        </>
      )}
      {adding && data ? (
        <AddIpoForm accounts={accounts.filter((account) => !account.isLiability)} demats={data.demat_accounts} ownerName={ownerName} onClose={onClose} onSave={saved} />
      ) : null}
    </>
  );
}
