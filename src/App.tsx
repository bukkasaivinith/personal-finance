import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatches, useNavigate } from 'react-router';
import { IndianRupee, LogOut, Menu, MoreHorizontal, Plus, Settings, X } from 'lucide-react';
import { signOut } from '@/lib/auth-api';
import { AddAccountModal, AddTransactionModal, EditAccountModal } from '@/components/finance-forms';
import { AccountsView, AnalyticsView, DashboardView, TransactionsView } from '@/components/finance-views';
import { GoalsView, RecurringView, SettingsView } from '@/components/planning-views';
import { SavingsView } from '@/components/savings-view';
import { InvestmentsView } from '@/components/investments-view';
import { IpoPortfolio } from '@/components/ipo-portfolio';
import { AthleteHub, AthletePreferencesButton } from '@/components/athlete-hub';
import { AthleteActivityPage } from '@/components/athlete-activity-page';
import { loadAthleteHubData } from '@/lib/athlete-api';
import { SetupView } from '@/components/setup-views';
import { EmptyPanel } from '@/components/ui';
import { WorkspaceSettings } from '@/components/workspace-settings';
import { useCurrentFinanceProfile } from '@/lib/current-finance-profile';
import { createFinanceActions } from '@/lib/finance-actions';
import { hasWorkspaceTransactions, loadFinanceData } from '@/lib/finance-api';
import { downloadReport } from '@/lib/report-export';
import {
  formatMonth,
  isUsable,
  monthlyFlows,
  netPosition,
  recentMonthKeys,
  sortByDate,
  summarizeMonth,
  transactionKindLabels,
  type Account,
  type FinanceData,
  type TransactionKind,
  type Transaction,
} from '@/lib/finance';
import { manageNavigation, pageCopy, viewPaths, workspaceNavigation, type NavItem, type View } from '@/lib/navigation';
import { useFinanceData } from '@/lib/use-finance-data';

type ModalKind = 'transaction' | 'account' | 'ipo' | 'ipo-demat';

const monthOptions = recentMonthKeys(6);

const emptyFinance: FinanceData = {
  standardTypes: [],
  categories: [],
  accounts: [],
  transactions: [],
  budgets: [],
  recurringEntries: [],
  investments: [],
  investmentTypes: [],
};

function NavigationGroup({
  label,
  items,
  activeView,
  onSelect,
}: {
  label: string;
  items: NavItem[];
  activeView: View;
  onSelect: () => void;
}) {
  const selectedView = activeView === 'ipo-portfolio' || activeView === 'ipo-demats' ? 'investments'
    : activeView === 'athlete-activity' ? 'athlete' : activeView;
  return (
    <div className="nav-group">
      <span className="nav-label">{label}</span>
      <nav>
        {items.map((item) => (
          <Link
            key={item.id}
            to={viewPaths[item.id]}
            aria-current={selectedView === item.id ? 'page' : undefined}
            className={`side-link ${selectedView === item.id ? 'active' : ''}`}
            onClick={onSelect}
          >
            <item.icon size={17} />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const profile = useCurrentFinanceProfile();
  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Personal Financing';
  const routerNavigate = useNavigate();
  const matches = useMatches();
  const currentRoute = matches[matches.length - 1];
  const activeView = currentRoute.id as View;
  const isIpoApplicationPage = activeView === 'ipo-portfolio';
  const isIpoDemats = activeView === 'ipo-demats';
  const activeOwnerId = profile?.id ?? null;
  const ledgerPage = activeView === 'overview' || activeView === 'transactions' || activeView === 'accounts';
  const scope = ledgerPage ? 'ledger' : activeView === 'analytics' || activeView === 'investments' || activeView === 'recurring' || activeView === 'setup' ? activeView : 'forms';
  const isAthletePage = activeView === 'athlete' || activeView === 'athlete-activity';
  const needsForms = !isAthletePage && activeView !== 'savings' && activeView !== 'ipo-demats';
  const finance = useFinanceData(needsForms ? activeOwnerId : null, scope);
  const data = finance.data ?? emptyFinance;
  const { accounts, transactions, categories, standardTypes, recurringEntries, investments, investmentTypes } = data;
  const actions = useMemo(() => createFinanceActions(finance.refresh, activeOwnerId ?? ''), [finance.refresh, activeOwnerId]);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | TransactionKind>('all');
  const [recurringChecked, setRecurringChecked] = useState(false);
  const [canExportCsv, setCanExportCsv] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const exportRequests = useRef(new Set<AbortController>());
  const selectedMonth = monthOptions[0];

  useEffect(() => { setRecurringChecked(false); }, [activeOwnerId]);

  const usableAccounts = useMemo(() => accounts.filter(isUsable), [accounts]);
  const usableCategories = useMemo(() => categories.filter(isUsable), [categories]);
  const summary = useMemo(() => summarizeMonth(transactions, selectedMonth), [transactions, selectedMonth]);
  const flows = useMemo(() => monthlyFlows(transactions, [...monthOptions].reverse()), [transactions]);
  const position = useMemo(() => netPosition(accounts, transactions), [accounts, transactions]);
  const sorted = useMemo(() => sortByDate(transactions), [transactions]);
  const visibleTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sorted.filter((transaction) => {
      const matchesKind = filter === 'all' || transaction.kind === filter;
      const matchesQuery =
        !query ||
        transaction.name.toLowerCase().includes(query) ||
        (transaction.categoryName ?? '').toLowerCase().includes(query) ||
        transactionKindLabels[transaction.kind].toLowerCase().includes(query);
      return matchesKind && matchesQuery;
    });
  }, [sorted, searchQuery, filter]);

  const monthLabel = formatMonth(selectedMonth);


  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  useEffect(() => {
    if (!activeOwnerId || (needsForms && !finance.data) || recurringChecked) return;
    setRecurringChecked(true);
    void actions.processDueRecurringEntries()
      .then((generated) => { if (generated) showToast(`${generated} due recurring ${generated === 1 ? 'entry was' : 'entries were'} added.`); })
      .catch(() => {
        // A recurring rule is optional. The Recurring page gives the user a
        // visible retry button if processing is temporarily unavailable.
      });
  }, [actions, activeOwnerId, finance.data, needsForms, recurringChecked]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setModal((current) => {
      const closeIpo = current === 'ipo' && activeView !== 'ipo-portfolio';
      const closeDemat = current === 'ipo-demat' && activeView !== 'ipo-demats';
      return closeIpo || closeDemat ? null : current;
    });
  }, [activeView]);

  const navigate = (view: View) => {
    setMobileMenuOpen(false);
    if (view !== activeView) void routerNavigate(viewPaths[view]);
  };

  const closeModal = () => setModal(null);

  const addAccount = async (draft: Parameters<typeof actions.createAccount>[0]) => {
    const id = await actions.createAccount(draft);
    setModal(null);
    showToast(`${draft.name} added.`);
    return id;
  };

  const saveAccount = async (input: { name: string; description: string }) => {
    if (!editingAccount) return;
    await actions.updateAccount(editingAccount.id, input);
    setEditingAccount(null);
    showToast(`${input.name} updated.`);
  };

  const saveTransaction = async (draft: Parameters<typeof actions.addTransaction>[0]) => {
    if (editingTransaction) {
      await actions.updateTransaction(editingTransaction.id, draft);
      setEditingTransaction(null);
      setModal(null);
      showToast('Transaction updated. Balances and reports have been recalculated.');
      return;
    }
    await actions.addTransaction(draft);
    setModal(null);
    showToast('Transaction saved.');
    navigate('transactions');
  };

  const deleteTransaction = async (transaction: Transaction) => {
    if (!window.confirm(`Delete “${transaction.name}”? This cannot be undone.`)) return;
    try {
      await actions.deleteTransaction(transaction.id);
      showToast('Transaction deleted. Balances, reports and dates have been recalculated.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete the transaction.');
    }
  };

  useEffect(() => {
    if (activeView !== 'settings' || !activeOwnerId) return;
    const controller = new AbortController();
    void hasWorkspaceTransactions(activeOwnerId, controller.signal)
      .then((hasData) => { if (!controller.signal.aborted) setCanExportCsv(hasData); })
      .catch(() => { if (!controller.signal.aborted) setCanExportCsv(true); });
    return () => { controller.abort(); setCanExportCsv(false); };
  }, [activeView, activeOwnerId, finance.data]);

  useEffect(() => {
    const requests = exportRequests.current;
    return () => { for (const request of requests) request.abort(); };
  }, []);

  const exportCsv = async () => {
    if (!activeOwnerId || exportingCsv) return;
    const request = new AbortController();
    exportRequests.current.add(request);
    setExportingCsv(true);
    try {
      const ledger = await loadFinanceData(activeOwnerId, 'ledger', request.signal);
      if (request.signal.aborted) return;
      const rows = sortByDate(ledger.transactions).map((transaction) => [
        transaction.date, transaction.time ?? '', transaction.name, transactionKindLabels[transaction.kind],
        transaction.categoryName ?? '', transaction.accountName, transaction.toAccountName ?? '', transaction.amount,
      ]);
      await downloadReport({
        title: 'Transactions', filename: 'personal-financing-transactions', summary: [],
        headers: ['Date', 'Time', 'Name', 'Type', 'Category', 'Account', 'To account', 'Amount'], rows,
      }, 'csv');
      showToast('CSV export downloaded.');
    } catch {
      if (!request.signal.aborted) showToast('Could not export transactions. Please try again.');
    } finally {
      exportRequests.current.delete(request);
      if (!request.signal.aborted) setExportingCsv(false);
    }
  };

  const exportAthleteData = async () => {
    const request = new AbortController();
    exportRequests.current.add(request);
    try {
      const athleteData = await loadAthleteHubData(request.signal);
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(athleteData, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'athlete-hub-private-data.json';
      link.click();
      URL.revokeObjectURL(url);
      showToast('Private Athlete Hub export downloaded.');
    } catch (error) {
      if (!request.signal.aborted) showToast(error instanceof Error ? error.message : 'Could not export Athlete Hub data.');
    } finally {
      exportRequests.current.delete(request);
    }
  };

  const renderView = () => {
    const investmentsSelected = activeView === 'investments';
    const investmentNavigation = (
      <nav className="analytics-tabs investment-page-switch" aria-label="Investment pages">
        <button type="button" className={investmentsSelected ? 'active' : ''} aria-current={investmentsSelected ? 'page' : undefined} onClick={() => navigate('investments')}>
          Investments
        </button>
        <button type="button" className={investmentsSelected ? '' : 'active'} aria-current={investmentsSelected ? undefined : 'page'} onClick={() => navigate('ipo-portfolio')}>
          IPO
        </button>
      </nav>
    );
    switch (activeView) {
      case 'overview':
        return (
          <DashboardView
            accounts={usableAccounts}
            transactions={sorted}
            summary={summary}
            flows={flows}
            position={position}
            monthLabel={monthLabel}
            userName={profile?.firstName ?? undefined}
            onAddAccount={() => setModal('account')}
            onAddTransaction={() => setModal('transaction')}
            onNavigate={navigate}
          />
        );
      case 'transactions':
        return (
          <TransactionsView
            transactions={visibleTransactions}
            allTransactions={sorted}
            searchQuery={searchQuery}
            filter={filter}
            onSearch={setSearchQuery}
            onFilter={setFilter}
            onAddTransaction={() => { setEditingTransaction(null); setModal('transaction'); }}
            onEditTransaction={transaction => { setEditingTransaction(transaction); setModal('transaction'); }}
            onDeleteTransaction={transaction => void deleteTransaction(transaction)}
          />
        );
      case 'accounts':
        return (
          <AccountsView
            accounts={accounts}
            transactions={transactions}
            position={position}
            actions={actions}
            onAddAccount={() => setModal('account')}
            onEditAccount={setEditingAccount}
          />
        );
      case 'setup':
        return (
          <SetupView
            standardTypes={standardTypes}
            categories={categories}
            transactionUsage={data.transactionUsage}
            actions={actions}
            onNotify={showToast}
          />
        );
      case 'analytics':
        return <AnalyticsView transactions={data.analyticsTransactions ?? transactions} />;
      case 'savings':
        return <SavingsView key={activeOwnerId} ownerId={activeOwnerId ?? ''} onNotify={showToast} />;
      case 'goals':
        return <GoalsView onNotify={showToast} />;
      case 'recurring':
        return (
          <RecurringView
            entries={recurringEntries}
            transactions={transactions}
            categories={categories}
            accounts={accounts}
            standardTypes={standardTypes}
            actions={actions}
            onNotify={showToast}
          />
        );
      case 'investments':
        return <InvestmentsView key={activeOwnerId} investments={investments} investmentTypes={investmentTypes} accounts={accounts} actions={actions} onNotify={showToast} navigation={investmentNavigation} />;
      case 'ipo-portfolio':
      case 'ipo-demats':
        return (
          <IpoPortfolio
            accounts={usableAccounts}
            ownerName={displayName}
            navigation={investmentNavigation}
            section={isIpoDemats ? 'demats' : 'portfolio'}
            adding={isIpoDemats ? modal === 'ipo-demat' : modal === 'ipo'}
            onClose={closeModal}
            onBack={() => navigate('ipo-portfolio')}
            onManageDemats={() => navigate('ipo-demats')}
            onNotify={showToast}
          />
        );
      case 'athlete':
        return <AthleteHub onNotify={showToast} />;
      case 'athlete-activity':
        return <AthleteActivityPage key={currentRoute.params.activityId} id={currentRoute.params.activityId ?? ''} onNotify={showToast} />;
      case 'settings':
        return <SettingsView onExport={exportCsv} onExportAthleteData={exportAthleteData} hasData={canExportCsv && !exportingCsv} data={data} workspaceOwnerId={activeOwnerId ?? ''} workspaceControls={<WorkspaceSettings />} athletePreferences={<AthletePreferencesButton onNotify={showToast} />} />;
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-visible' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="brand-mark" aria-hidden="true">
              <IndianRupee size={19} strokeWidth={2} />
            </span>
            <div className="brand-text">
              <strong title={displayName}>{displayName}</strong>
              <small>Personal finance</small>
            </div>
          </div>
          <button className="sidebar-close" type="button" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}>
            <X size={18} />
          </button>
          <NavigationGroup label="Workspace" items={workspaceNavigation} activeView={activeView} onSelect={() => setMobileMenuOpen(false)} />
          <NavigationGroup label="Manage" items={manageNavigation} activeView={activeView} onSelect={() => setMobileMenuOpen(false)} />
        </div>
        <div className="sidebar-bottom">
          <Link className={`side-link ${activeView === 'settings' ? 'active' : ''}`} to={viewPaths.settings} aria-current={activeView === 'settings' ? 'page' : undefined} onClick={() => setMobileMenuOpen(false)}>
            <Settings size={17} /> Settings
          </Link>
          <button className="side-link" type="button" onClick={() => void signOut()}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu-button"
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={18} />
          </button>
          <div>
            <div className="eyebrow">{pageCopy[activeView].eyebrow}</div>
            <h1>{pageCopy[activeView].title}</h1>
          </div>
          {activeView !== 'transactions' && !isAthletePage && activeView !== 'savings' ? (
            <div className="top-actions">
              <button className={`primary-button header-action${isIpoApplicationPage ? ' ipo-header-action' : ''}`} type="button" onClick={() => setModal(isIpoApplicationPage ? 'ipo' : isIpoDemats ? 'ipo-demat' : 'transaction')}>
                <span className="header-action-icon" aria-hidden="true">
                  <Plus size={15} strokeWidth={2} />
                </span>
                <span>{isIpoApplicationPage ? 'Add IPO' : isIpoDemats ? 'Add new account' : 'Add transaction'}</span>
              </button>
            </div>
          ) : null}
        </header>

        {!needsForms || finance.data ? (
          renderView()
        ) : (
          <div className="surface-card">
            <EmptyPanel
              icon={<IndianRupee size={20} />}
              title={finance.loadError ? 'We could not load your records' : 'Loading your records'}
              description={finance.loadError || 'This only takes a moment.'}
              action={
                finance.loadError ? (
                  <button className="secondary-button" type="button" onClick={() => void finance.refresh()}>
                    Try again
                  </button>
                ) : null
              }
            />
          </div>
        )}
      </main>

      <nav className="mobile-nav" aria-label="Primary">
        {[workspaceNavigation[0], workspaceNavigation[1], workspaceNavigation[2], workspaceNavigation[4]].map((item) => (
          <Link key={item.id} to={viewPaths[item.id]} className={activeView === item.id ? 'active' : ''}
            aria-current={activeView === item.id ? 'page' : undefined} onClick={() => setMobileMenuOpen(false)}
          >
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMobileMenuOpen(true)}>
          <MoreHorizontal size={18} />
          More
        </button>
      </nav>

      {modal === 'transaction' ? (
        <AddTransactionModal
          accounts={usableAccounts}
          standardTypes={standardTypes}
          categories={usableCategories}
          transaction={editingTransaction}
          onClose={() => { setEditingTransaction(null); closeModal(); }}
          onSubmit={saveTransaction}
          onCreateCategory={actions.createCategory}
          onUpdateCategory={actions.updateCategory}
          onCreateAccount={actions.createAccount}
          onUpdateAccount={actions.updateAccount}
        />
      ) : null}
      {modal === 'account' ? (
        <AddAccountModal accounts={accounts} onCreate={addAccount} onClose={closeModal} />
      ) : null}
      {editingAccount ? (
        <EditAccountModal account={editingAccount} onSubmit={saveAccount} onClose={() => setEditingAccount(null)} />
      ) : null}

      <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
