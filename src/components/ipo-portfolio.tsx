import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Building2, FileText, Users, Wallet } from 'lucide-react';
import { AddIpoForm } from '@/components/add-ipo-form';
import { IpoDematAccounts } from '@/components/ipo-demat-accounts';
import { EmptyPanel, Metric } from '@/components/ui';
import { formatDate, formatMoney, type Account } from '@/lib/finance';
import { formatDematAccount, loadIpoPortfolio, type IpoPortfolioData } from '@/lib/ipo-portfolio-api';
import './ipo-portfolio.css';

export function IpoPortfolio({ accounts, ownerName, managingDemats, adding, onClose, onBack, onManageDemats, onNotify }: {
  accounts: Account[];
  ownerName: string;
  managingDemats: boolean;
  adding: boolean;
  onClose: () => void;
  onBack: () => void;
  onManageDemats: () => void;
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

  const saved = (applicationCount: number) => {
    onClose();
    onNotify(applicationCount === 1 ? 'IPO application saved.' : `${applicationCount} IPO applications saved.`);
    void refresh();
  };

  const applications = data?.applications ?? [];
  const totalApplied = applications.reduce((total, application) => total + Math.round(application.amount * 100), 0) / 100;

  return (
    <>
      <nav className="ipo-subpage-actions" aria-label="IPO pages">
        <button type="button" className="text-button" onClick={onBack}><ArrowLeft size={15} /> {managingDemats ? 'Back to portfolio' : 'Back to investments'}</button>
        {!managingDemats ? <button type="button" className="secondary-button" onClick={onManageDemats}><Users size={15} /> Demat account holders</button> : null}
      </nav>
      {error || !data ? (
        <div className="surface-card">
          <EmptyPanel icon={<Building2 size={20} />} title={error ? 'Portfolio unavailable' : 'Loading portfolio'} description={error || 'Fetching your IPO applications.'}
            action={error ? <button className="secondary-button" type="button" onClick={() => void refresh()}>Try again</button> : undefined}
          />
        </div>
      ) : managingDemats ? (
        <IpoDematAccounts demats={data.demat_accounts} ownerName={ownerName} adding={adding} onClose={onClose} onChanged={refresh} onNotify={onNotify} />
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
                        <td>{formatDematAccount(application.holder, application.demat)}</td>
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
      {adding && data && !managingDemats ? (
        <AddIpoForm accounts={accounts.filter((account) => !account.isLiability)} demats={data.demat_accounts} onManageDemats={onManageDemats} onClose={onClose} onSave={saved} />
      ) : null}
    </>
  );
}
