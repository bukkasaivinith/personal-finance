import { useMemo, useState } from 'react';
import { IndianRupee, LogOut, Menu, MoreHorizontal, Plus, Settings, X } from 'lucide-react';
import { AddAccountModal, AddTransactionModal, EditAccountModal } from '@/components/finance-forms';
import { AccountsView, AnalyticsView, OverviewView, TransactionsView } from '@/components/finance-views';
import { BudgetsView, GoalsView, RecurringView, SettingsView } from '@/components/planning-views';
import { SetupView } from '@/components/setup-views';
import { EmptyPanel } from '@/components/ui';
import { signOut } from '@/lib/auth-api';
import { createFinanceActions } from '@/lib/finance-actions';
import {
  formatMonth,
  isUsable,
  monthlyFlows,
  netPosition,
  recentMonthKeys,
  sortByDate,
  summarizeMonth,
  type Account,
  type FinanceData,
  type TransactionKind,
} from '@/lib/finance';
import { manageNavigation, pageCopy, workspaceNavigation, type NavItem, type View } from '@/lib/navigation';
import { useFinanceData } from '@/lib/use-finance-data';

type ModalKind = 'transaction' | 'account';

const monthOptions = recentMonthKeys(6);

const emptyFinance: FinanceData = {
  transactionTypes: [],
  categories: [],
  accounts: [],
  transactions: [],
};

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function NavigationGroup({
  label,
  items,
  activeView,
  onSelect,
}: {
  label: string;
  items: NavItem[];
  activeView: View;
  onSelect: (view: View) => void;
}) {
  return (
    <div className="nav-group">
      <span className="nav-label">{label}</span>
      <nav>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`side-link ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <item.icon size={17} />
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<View>('overview');
  const finance = useFinanceData();
  const data = finance.data ?? emptyFinance;
  const { accounts, transactions, categories, transactionTypes } = data;
  const actions = createFinanceActions(finance.refresh);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | TransactionKind>('all');
  const selectedMonth = monthOptions[0];

  const usableAccounts = useMemo(() => accounts.filter(isUsable), [accounts]);
  const usableTypes = useMemo(() => transactionTypes.filter(isUsable), [transactionTypes]);
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
        transaction.typeName.toLowerCase().includes(query);
      return matchesKind && matchesQuery;
    });
  }, [sorted, searchQuery, filter]);

  const monthLabel = formatMonth(selectedMonth);
  const hasTransactions = transactions.length > 0;

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const navigate = (view: View) => {
    setActiveView(view);
    setMobileMenuOpen(false);
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

  const addTransaction = async (draft: Parameters<typeof actions.addTransaction>[0]) => {
    await actions.addTransaction(draft);
    setModal(null);
    showToast('Transaction saved.');
    navigate('transactions');
  };

  const exportCsv = () => {
    const rows = [
      ['Date', 'Name', 'Type', 'Counts as', 'Category', 'Account', 'To account', 'Amount'],
      ...sorted.map((transaction) => [
        transaction.date,
        transaction.name,
        transaction.typeName,
        transaction.kind,
        transaction.categoryName ?? '',
        transaction.accountName,
        transaction.toAccountName ?? '',
        String(transaction.amount),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'personal-financing-transactions.csv';
    link.click();
    URL.revokeObjectURL(url);
    showToast('CSV export downloaded.');
  };

  const renderView = () => {
    switch (activeView) {
      case 'overview':
        return (
          <OverviewView
            accounts={usableAccounts}
            transactions={sorted}
            summary={summary}
            flows={flows}
            position={position}
            monthLabel={monthLabel}
            onAddAccount={() => setModal('account')}
            onAddTransaction={() => setModal('transaction')}
            onNavigate={navigate}
          />
        );
      case 'transactions':
        return (
          <TransactionsView
            transactions={visibleTransactions}
            totalCount={transactions.length}
            searchQuery={searchQuery}
            filter={filter}
            onSearch={setSearchQuery}
            onFilter={setFilter}
            onAddTransaction={() => setModal('transaction')}
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
            transactionTypes={transactionTypes}
            categories={categories}
            transactions={transactions}
            actions={actions}
            onNotify={showToast}
          />
        );
      case 'analytics':
        return <AnalyticsView summary={summary} monthLabel={monthLabel} />;
      case 'budgets':
        return <BudgetsView onNotify={showToast} />;
      case 'goals':
        return <GoalsView onNotify={showToast} />;
      case 'recurring':
        return <RecurringView onNotify={showToast} />;
      case 'settings':
        return <SettingsView onExport={exportCsv} hasData={hasTransactions} />;
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
              <strong>Personal Financing</strong>
              <small>Personal finance</small>
            </div>
          </div>
          <button className="sidebar-close" type="button" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}>
            <X size={18} />
          </button>
          <NavigationGroup label="Workspace" items={workspaceNavigation} activeView={activeView} onSelect={navigate} />
          <NavigationGroup label="Manage" items={manageNavigation} activeView={activeView} onSelect={navigate} />
        </div>
        <div className="sidebar-bottom">
          <button
            className={`side-link ${activeView === 'settings' ? 'active' : ''}`}
            type="button"
            onClick={() => navigate('settings')}
          >
            <Settings size={17} /> Settings
          </button>
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
          {activeView !== 'transactions' ? (
            <div className="top-actions">
              <button className="primary-button header-action" type="button" onClick={() => setModal('transaction')}>
                <span className="header-action-icon" aria-hidden="true">
                  <Plus size={15} strokeWidth={2} />
                </span>
                <span>Add transaction</span>
              </button>
            </div>
          ) : null}
        </header>

        {finance.data ? (
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
          <button
            key={item.id}
            type="button"
            className={activeView === item.id ? 'active' : ''}
            onClick={() => navigate(item.id)}
          >
            <item.icon size={18} />
            {item.label}
          </button>
        ))}
        <button type="button" onClick={() => setMobileMenuOpen(true)}>
          <MoreHorizontal size={18} />
          More
        </button>
      </nav>

      {modal === 'transaction' ? (
        <AddTransactionModal
          accounts={usableAccounts}
          transactionTypes={usableTypes}
          categories={usableCategories}
          onClose={closeModal}
          onSubmit={addTransaction}
          onCreateTransactionType={actions.createTransactionType}
          onCreateCategory={actions.createCategory}
          onCreateAccount={actions.createAccount}
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
