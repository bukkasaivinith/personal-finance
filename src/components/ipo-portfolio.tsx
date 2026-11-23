import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Building2, ChevronRight, FileText, Pencil, Search, Trash2, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import { AddIpoForm } from '@/components/add-ipo-form';
import { DatePicker } from '@/components/date-picker';
import { IpoDematAccounts } from '@/components/ipo-demat-accounts';
import { IpoResultForm } from '@/components/ipo-result-form';
import { Select } from '@/components/select';
import { EmptyPanel, Metric } from '@/components/ui';
import { formatDate, formatMoney, todayKey, type Account } from '@/lib/finance';
import { ipoLotPricePaise } from '@/lib/ipo-lot-allocations';
import { formatDematAccount, loadIpoPortfolio, removeIpoApplication, type IpoApplication, type IpoPortfolioData } from '@/lib/ipo-portfolio-api';
import { defaultIpoCustomRange, ipoPortfolioRange, summarizeIpoPortfolio, type IpoPortfolioPeriod } from '@/lib/ipo-portfolio-summary';
import './ipo-portfolio.css';

function ProfitLoss({ value }: { value: number }) {
  const tone = value > 0 ? 'positive' : value < 0 ? 'negative' : '';
  const label = value > 0 ? 'Profit' : value < 0 ? 'Loss' : 'Break even';
  return <span className={`ipo-profit-loss ${tone}`}>{label} {formatMoney(value)}</span>;
}

function IpoApplicationDetails({ title, applications, deleting, onBack, onEdit, onDelete, onRecordResult }: {
  title: string;
  applications: IpoApplication[];
  deleting: string;
  onBack: () => void;
  onEdit: (application: IpoApplication) => void;
  onDelete: (application: IpoApplication) => void;
  onRecordResult: (application: IpoApplication) => void;
}) {
  return (
    <section className="surface-card" aria-labelledby="ipo-details-title">
      <button type="button" className="text-button ipo-details-back" onClick={onBack}><ArrowLeft size={15} /> Back to list</button>
      <div className="card-title-row">
        <h3 id="ipo-details-title">{title}</h3>
      </div>
      {applications.length ? <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Company</th><th scope="col">Demat account</th><th scope="col">Applied on</th><th scope="col">Allotment date</th><th scope="col">Listing date</th><th scope="col" className="amount-column">Applied amount</th><th scope="col">Result</th><th scope="col" aria-label="Actions" /></tr></thead>
          <tbody>
            {applications.map((application) => {
              const holder = formatDematAccount(application.holder, application.demat, application.broker);
              const hasResult = application.not_allotted || application.realized_profit_loss != null || application.present_total_value != null;
              return (
                <tr key={application.id}>
                  <td><b>{application.company}</b></td>
                  <td>{holder}</td>
                  <td>{formatDate(application.application_date)}</td>
                  <td>{application.allotment_date ? formatDate(application.allotment_date) : '—'}</td>
                  <td>{application.listing_date ? formatDate(application.listing_date) : '—'}</td>
                  <td className="amount-column">{formatMoney(application.amount)}</td>
                  <td>{application.not_allotted ? <>
                    <strong>Not allotted</strong>
                    <div className="ipo-application-detail">{formatMoney(ipoLotPricePaise(application.issue_price, application.lot_size) / 100)} per lot</div>
                  </> : <>
                    {application.realized_profit_loss != null ? <ProfitLoss value={application.realized_profit_loss} /> : null}
                    {application.present_total_value != null ? <div className="ipo-application-detail">{formatMoney(application.present_total_value)} present value</div> : null}
                    {application.invested_amount != null ? <div className="ipo-application-detail">{formatMoney(application.invested_amount)} invested</div> : null}
                    {!hasResult && application.invested_amount == null ? '—' : null}
                  </>}</td>
                  <td>
                    {application.can_change === false ? <span className="ipo-application-detail">Linked activity</span> : (
                      <div className="ipo-application-actions">
                        <button type="button" className="ghost-button" onClick={() => onRecordResult(application)} disabled={Boolean(deleting)}>
                          {hasResult ? 'Edit result' : 'Record result'}
                        </button>
                        <button type="button" className="ghost-button" onClick={() => onEdit(application)} disabled={Boolean(deleting)}
                          aria-label={`Edit ${application.company} application for ${holder}`}><Pencil size={15} /> Edit</button>
                        <button type="button" className="ghost-button danger" onClick={() => onDelete(application)} disabled={Boolean(deleting)}
                          aria-label={`Delete ${application.company} application for ${holder}`}><Trash2 size={15} /> {deleting === application.id ? 'Deleting…' : 'Delete'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div> : <EmptyPanel icon={<FileText size={20} />} title="No applications in this group" description="Go back to see the rest of your applications." />}
    </section>
  );
}

export function IpoPortfolio({ accounts, ownerName, navigation, section, adding, onClose, onBack, onManageDemats, onNotify }: {
  accounts: Account[];
  ownerName: string;
  navigation: ReactNode;
  section: 'portfolio' | 'demats';
  adding: boolean;
  onClose: () => void;
  onBack: () => void;
  onManageDemats: () => void;
  onNotify: (message: string) => void;
}) {
  const [data, setData] = useState<IpoPortfolioData>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<IpoApplication>();
  const [recordingResult, setRecordingResult] = useState<IpoApplication>();
  const [deleting, setDeleting] = useState('');
  const deletionPending = useRef(false);
  const [details, setDetails] = useState<{ id: string; label: string }>();
  const [period, setPeriod] = useState<IpoPortfolioPeriod>('all');
  const [custom, setCustom] = useState(defaultIpoCustomRange);
  const [companySearch, setCompanySearch] = useState('');
  const refresh = useCallback(async () => {
    setError('');
    try {
      setData(await loadIpoPortfolio());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your portfolio.');
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function closeForm() {
    if (editing) setEditing(undefined);
    else onClose();
  }

  const saved = (applicationCount: number) => {
    closeForm();
    if (editing) {
      setDetails(undefined);
      onNotify('IPO application updated.');
    } else onNotify(applicationCount === 1 ? 'IPO application saved.' : `${applicationCount} IPO applications saved.`);
    void refresh();
  };

  async function remove(application: IpoApplication) {
    const holder = formatDematAccount(application.holder, application.demat, application.broker);
    if (deletionPending.current || !window.confirm(`Delete the “${application.company}” application for ${holder}?`)) return;
    deletionPending.current = true;
    setDeleting(application.id);
    setActionError('');
    try {
      await removeIpoApplication(application.id);
      await refresh();
      onNotify('IPO application deleted.');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not delete this IPO application.');
    } finally {
      deletionPending.current = false;
      setDeleting('');
    }
  }

  const range = ipoPortfolioRange(period, custom);
  const { companies, applicationCount, applied, profit, loss } = summarizeIpoPortfolio(data?.applications ?? [], range);
  const companyQuery = companySearch.trim().toLocaleLowerCase();
  const visibleCompanies = [...companies.entries()].filter(([name]) => name.includes(companyQuery));
  const activeDetails = section === 'portfolio' ? details : undefined;
  const selectedApplications = activeDetails ? companies.get(activeDetails.id)?.applications ?? [] : [];

  function clearDetails() {
    setActionError('');
    setDetails(undefined);
  }

  function changePeriod(next: IpoPortfolioPeriod) {
    if (period === 'custom' && next !== 'custom') setCustom(defaultIpoCustomRange());
    setPeriod(next);
  }

  return (
    <>
      <div className="ipo-subpage-actions">
        {section === 'portfolio' ? (
          <>
            {navigation}
            <button type="button" className="secondary-button" onClick={onManageDemats}><Users size={15} /> Demat account holders</button>
            <div className="ipo-range-controls">
              {period === 'custom' ? <>
                <DatePicker label="Applied from" value={custom.from} max={custom.to} onChange={(from) => setCustom((current) => ({ ...current, from }))} />
                <DatePicker label="Applied through" value={custom.to} min={custom.from} max={todayKey()} onChange={(to) => setCustom((current) => ({ ...current, to }))} />
              </> : null}
              <Select className="compact-select" aria-label="Application date range" value={period} onChange={(event) => changePeriod(event.target.value as IpoPortfolioPeriod)}>
                <option value="all">All time</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="year">This year</option>
                <option value="custom">Custom range</option>
              </Select>
            </div>
          </>
        ) : (
          <button type="button" className="text-button" onClick={() => { clearDetails(); onBack(); }}><ArrowLeft size={15} /> Back to portfolio</button>
        )}
      </div>
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      {error || !data ? (
        <div className="surface-card">
          <EmptyPanel icon={<Building2 size={20} />} title={error ? 'Portfolio unavailable' : 'Loading portfolio'} description={error || 'Fetching your IPO applications.'}
            action={error ? <button className="secondary-button" type="button" onClick={() => void refresh()}>Try again</button> : undefined}
          />
        </div>
      ) : section === 'demats' ? (
        <IpoDematAccounts demats={data.demat_accounts} ownerName={ownerName} adding={adding} onClose={onClose} onChanged={refresh} onNotify={onNotify} />
      ) : activeDetails ? (
        <IpoApplicationDetails title={activeDetails.label} applications={selectedApplications} deleting={deleting}
          onBack={clearDetails} onEdit={(application) => { setActionError(''); setEditing(application); }} onDelete={(application) => void remove(application)}
          onRecordResult={setRecordingResult} />
      ) : (
        <>
          <div className="metrics-grid ipo-portfolio-metrics">
            <Metric label="Companies applied" value={String(companies.size)} foot="Distinct companies" icon={<Building2 size={16} />} />
            <Metric label="Applications" value={String(applicationCount)} foot="Recorded across demat accounts" icon={<FileText size={16} />} />
            <Metric label="Total applied" value={formatMoney(applied)} foot="Combined application amounts" icon={<Wallet size={16} />} />
            <Metric label="Total profit" value={formatMoney(profit)} foot="Profitable applications" icon={<TrendingUp size={16} />} />
            <Metric label="Total loss" value={formatMoney(loss === 0 ? 0 : -loss)} foot="Loss-making applications" icon={<TrendingDown size={16} />} />
          </div>
          <section className="surface-card" aria-labelledby="ipo-applications-title">
            <div className="card-title-row ipo-company-list-header">
              <h3 id="ipo-applications-title">IPO applications</h3>
              <label className="search-field">
                <Search size={16} aria-hidden="true" />
                <input type="search" aria-label="Search company names" placeholder="Search company names" value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)} />
              </label>
            </div>
            {visibleCompanies.length ? (
              <div className="account-list">
                {visibleCompanies.map(([id, { label, resultPaise }]) => (
                  <button className="account-row ipo-company-link" type="button" key={id} onClick={() => setDetails({ id, label })}>
                    <span className="account-icon" aria-hidden="true"><Building2 size={17} /></span>
                    <span className="account-info"><b>{label}</b></span>
                    {resultPaise != null ? <ProfitLoss value={resultPaise / 100} /> : null}
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : companyQuery ? <EmptyPanel icon={<Search size={20} />} title="No matching company" description="Try a different company name." />
              : <EmptyPanel icon={<FileText size={20} />} title={period === 'all' ? 'No IPO applications yet' : 'No IPO applications in this range'}
              description={period === 'all' ? 'Use Add IPO to record your first application.' : 'Choose a different application date range.'} />}
          </section>
        </>
      )}
      {(adding || editing) && data && section !== 'demats' ? (
        <AddIpoForm key={editing?.id ?? 'new'} application={editing} accounts={accounts.filter((account) => !account.isLiability)}
          allotmentDateSupported={data.allotment_date_supported === true}
          demats={data.demat_accounts} onManageDemats={() => { closeForm(); onManageDemats(); }} onClose={closeForm} onSave={saved} />
      ) : null}
      {recordingResult && section === 'portfolio' ? (
        <IpoResultForm key={recordingResult.id} application={recordingResult} onClose={() => setRecordingResult(undefined)} onSaved={(result) => {
          setData((current) => current && ({ ...current, applications: current.applications.map((application) => application.id === recordingResult.id
            ? { ...application, ...result }
            : application) }));
          setRecordingResult(undefined);
          onNotify('IPO result saved.');
        }} />
      ) : null}
    </>
  );
}
