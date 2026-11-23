import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BarChart3, Building2, ChevronRight, FileText, Pencil, Trash2, Users, Wallet } from 'lucide-react';
import { AddIpoForm } from '@/components/add-ipo-form';
import { IpoDematAccounts } from '@/components/ipo-demat-accounts';
import { EmptyPanel, Metric } from '@/components/ui';
import { formatDate, formatMoney, type Account } from '@/lib/finance';
import { formatDematAccount, loadIpoPortfolio, removeIpoApplication, type IpoApplication, type IpoPortfolioData } from '@/lib/ipo-portfolio-api';
import './ipo-portfolio.css';

function dematGroup(application: IpoApplication) {
  return application.demat_account_id ?? formatDematAccount(application.holder, application.demat, application.broker);
}

function companyGroup(application: IpoApplication) {
  return application.company.trim().toLocaleLowerCase();
}

function IpoAnalysis({ applications, onView }: { applications: IpoApplication[]; onView: (id: string, label: string) => void }) {
  const byDemat = new Map<string, { label: string; applications: number; lots: number; amountPaise: number }>();
  for (const application of applications) {
    const label = formatDematAccount(application.holder, application.demat, application.broker);
    const key = dematGroup(application);
    const totals = byDemat.get(key) ?? { label, applications: 0, lots: 0, amountPaise: 0 };
    totals.applications += 1;
    totals.lots += application.lots;
    totals.amountPaise += Math.round(application.amount * 100);
    byDemat.set(key, totals);
  }
  const rows = [...byDemat.entries()].sort(([, first], [, second]) => second.amountPaise - first.amountPaise || first.label.localeCompare(second.label));
  return (
    <section className="surface-card" aria-labelledby="ipo-analysis-title">
      <div className="card-title-row"><h3 id="ipo-analysis-title">Applications by demat account</h3></div>
      {rows.length ? <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Demat account</th><th scope="col">Applications</th><th scope="col">Lots applied</th><th scope="col" className="amount-column">Applied amount</th><th scope="col" aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.map(([id, row]) => (
              <tr key={id}>
                <td><b>{row.label}</b></td>
                <td>{row.applications}</td>
                <td>{row.lots}</td>
                <td className="amount-column">{formatMoney(row.amountPaise / 100)}</td>
                <td><button type="button" className="text-button" onClick={() => onView(id, row.label)} aria-label={`View applications for ${row.label}`}>View applications</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : <EmptyPanel icon={<BarChart3 size={20} />} title="No IPO applications yet" description="Record an IPO application to see its account breakdown here." />}
    </section>
  );
}

function IpoApplicationDetails({ title, applications, deleting, onBack, onEdit, onDelete }: {
  title: string;
  applications: IpoApplication[];
  deleting: string;
  onBack: () => void;
  onEdit: (application: IpoApplication) => void;
  onDelete: (application: IpoApplication) => void;
}) {
  return (
    <section className="surface-card" aria-labelledby="ipo-details-title">
      <div className="card-title-row">
        <h3 id="ipo-details-title">{title}</h3>
        <button type="button" className="text-button" onClick={onBack}><ArrowLeft size={15} /> Back to list</button>
      </div>
      {applications.length ? <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Company</th><th scope="col">Demat account</th><th scope="col">Applied on</th><th scope="col">Listing date</th><th scope="col" className="amount-column">Applied amount</th><th scope="col" aria-label="Actions" /></tr></thead>
          <tbody>
            {applications.map((application) => {
              const holder = formatDematAccount(application.holder, application.demat, application.broker);
              return (
                <tr key={application.id}>
                  <td><b>{application.company}</b></td>
                  <td>{holder}</td>
                  <td>{formatDate(application.application_date)}</td>
                  <td>{application.listing_date ? formatDate(application.listing_date) : '—'}</td>
                  <td className="amount-column">{formatMoney(application.amount)}</td>
                  <td>
                    {application.can_change === false ? <span className="ipo-application-detail">Linked activity</span> : (
                      <div className="ipo-application-actions">
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

export function IpoPortfolio({ accounts, ownerName, navigation, section, adding, onClose, onBack, onOpenAnalysis, onManageDemats, onNotify }: {
  accounts: Account[];
  ownerName: string;
  navigation: ReactNode;
  section: 'portfolio' | 'analysis' | 'demats';
  adding: boolean;
  onClose: () => void;
  onBack: () => void;
  onOpenAnalysis: () => void;
  onManageDemats: () => void;
  onNotify: (message: string) => void;
}) {
  const [data, setData] = useState<IpoPortfolioData>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<IpoApplication>();
  const [deleting, setDeleting] = useState('');
  const deletionPending = useRef(false);
  const [details, setDetails] = useState<{ section: 'portfolio' | 'analysis'; id: string; label: string }>();
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

  const applications = data?.applications ?? [];
  const totalApplied = applications.reduce((total, application) => total + Math.round(application.amount * 100), 0) / 100;
  const companies = new Map<string, string>();
  for (const application of applications) {
    const key = companyGroup(application);
    if (!companies.has(key)) companies.set(key, application.company);
  }
  const activeDetails = details?.section === section ? details : undefined;
  const selectedApplications = activeDetails
    ? applications.filter((application) => (section === 'portfolio' ? companyGroup(application) : dematGroup(application)) === activeDetails.id)
    : [];

  function clearDetails() {
    setActionError('');
    setDetails(undefined);
  }

  return (
    <>
      <div className="ipo-subpage-actions">
        {section === 'portfolio' ? (
          <>
            {navigation}
            <button type="button" className="secondary-button" onClick={onOpenAnalysis}><BarChart3 size={15} /> Analysis</button>
            <button type="button" className="secondary-button" onClick={onManageDemats}><Users size={15} /> Demat account holders</button>
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
          onBack={clearDetails} onEdit={(application) => { setActionError(''); setEditing(application); }} onDelete={(application) => void remove(application)} />
      ) : section === 'analysis' ? (
        <IpoAnalysis applications={applications} onView={(id, label) => setDetails({ section: 'analysis', id, label })} />
      ) : (
        <>
          <div className="metrics-grid ipo-portfolio-metrics">
            <Metric label="Companies applied" value={String(companies.size)} foot="Distinct companies" icon={<Building2 size={16} />} />
            <Metric label="Applications" value={String(applications.length)} foot="Recorded across demat accounts" icon={<FileText size={16} />} />
            <Metric label="Total applied" value={formatMoney(totalApplied)} foot="Combined application amounts" icon={<Wallet size={16} />} />
          </div>
          <section className="surface-card" aria-labelledby="ipo-applications-title">
            <div className="card-title-row"><h3 id="ipo-applications-title">IPO applications</h3></div>
            {companies.size ? (
              <div className="account-list expanded">
                {[...companies.entries()].map(([id, label]) => (
                  <button className="account-row ipo-company-link" type="button" key={id} onClick={() => setDetails({ section: 'portfolio', id, label })}>
                    <span className="account-icon" aria-hidden="true"><Building2 size={17} /></span>
                    <span className="account-info"><b>{label}</b></span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : <EmptyPanel icon={<FileText size={20} />} title="No IPO applications yet" description="Use Add IPO to record your first application." />}
          </section>
        </>
      )}
      {(adding || editing) && data && section !== 'demats' ? (
        <AddIpoForm key={editing?.id ?? 'new'} application={editing} accounts={accounts.filter((account) => !account.isLiability)}
          demats={data.demat_accounts} onManageDemats={() => { closeForm(); onManageDemats(); }} onClose={closeForm} onSave={saved} />
      ) : null}
    </>
  );
}
