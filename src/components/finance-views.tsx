import { Select } from '@/components/select';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  FileText,
  PiggyBank,
  Plus,
  Pencil,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { RupeeInput } from '@/components/rupee-input';
import { EmptyPanel, Metric, ProgressRow, SectionHeading } from '@/components/ui';
import { ItemActions, StatusTag } from '@/components/item-actions';
import { SavingsBalanceMetric } from '@/components/savings-view';
import type { FinanceActions } from '@/lib/finance-actions';
import {
  formatDate,
  formatMoney,
  formatShortMonth,
  formatTime,
  signedBalance,
  stateOf,
  type Account,
  type CategoryTotal,
  type MonthSummary,
  type MonthlyFlow,
  type Transaction,
  type TransactionKind,
} from '@/lib/finance';
import type { View } from '@/lib/navigation';
import {
  analyticsFilterOptions,
  analyzeTransactions,
  emptyAnalyticsFilters,
  emptyTransactionAnalysisFilters,
  reconcileAnalyticsFilters,
  transactionAnalysisOptions,
  transactionAnalysisRange,
  type AnalysisPeriod,
  type AnalyticsFilters,
  type TransactionAnalysisFilters,
} from '@/lib/transaction-analysis';
import { type TableReport, downloadReport } from '@/lib/report-export';
import './transaction-analysis.css';
import './finance-analytics.css';

const kindIcons: Record<TransactionKind, typeof Wallet> = {
  expense: FileText,
  income: ArrowDownLeft,
  transfer: ArrowLeftRight,
};

function ArchivedTag() {
  return <span className="archived-tag">Archived</span>;
}

function AccountRow({
  account,
  transactions,
  actions,
}: {
  account: Account;
  transactions: Transaction[];
  actions?: ReactNode;
}) {
  const signed = signedBalance(account, transactions);
  const isCard = account.isLiability;
  const shown = isCard ? -signed : signed;
  const Icon = isCard ? CreditCard : Banknote;
  return (
    <div className="account-row">
      <span className={`account-icon ${isCard ? 'card' : ''}`}>
        <Icon size={17} />
      </span>
      <span className="account-info">
        <b>
          {account.name}
          {stateOf(account) !== 'active' ? <StatusTag state={stateOf(account)} /> : null}
        </b>
        <small>
          {account.description ? `${account.description} · ` : ''}Opened {formatDate(account.openingBalanceDate)}
        </small>
      </span>
      <span className="account-balance">
        <b className={isCard && shown > 0 ? 'negative' : ''}>{formatMoney(shown)}</b>
        <small>{isCard ? 'Owed' : 'Posted balance'}</small>
      </span>
      {actions ? <div className="account-actions">{actions}</div> : null}
    </div>
  );
}

function TransactionTable({
  transactions,
  compact = false,
  emptyMessage = 'No transactions match your filters.',
  onEdit,
  onDelete,
}: {
  transactions: Transaction[];
  compact?: boolean;
  emptyMessage?: string;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}) {

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            {compact ? null : <th>Type</th>}
            <th>Account</th>
            <th>Date & time</th>
            <th className="amount-column">Amount</th>
            {onEdit || onDelete ? <th aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 ? (
            <tr>
              <td colSpan={(compact ? 4 : 5) + (onEdit || onDelete ? 1 : 0)} className="table-empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            transactions.map((transaction) => {
              const Icon = kindIcons[transaction.kind];
              const sign = transaction.kind === 'income' ? '+' : transaction.kind === 'expense' ? '−' : '';
              const tone = transaction.kind === 'income' ? 'positive' : transaction.kind === 'expense' ? 'negative' : '';
              return (
                <tr key={transaction.id}>
                  <td>
                    <div className="transaction-name">
                      <span className={`transaction-icon ${transaction.kind}`}>
                        {transaction.categoryEmoji ? <span className="transaction-category-emoji" aria-hidden="true">{transaction.categoryEmoji}</span> : <Icon size={15} />}
                      </span>
                      <span>
                        <b>{transaction.name}</b>
                        <small>
                          {transaction.categoryEmoji ? `${transaction.categoryEmoji} ` : ''}{transaction.categoryName ?? transaction.typeName}
                          {transaction.categoryArchived ? <ArchivedTag /> : null}
                          {transaction.source === 'scheduled' ? <span className="scheduled-tag">Scheduled</span> : null}
                        </small>
                      </span>
                    </div>
                  </td>
                  {compact ? null : (
                    <td>
                      {transaction.typeName}
                      {transaction.typeArchived ? <ArchivedTag /> : null}
                    </td>
                  )}
                  <td>
                    {transaction.accountName}
                    {transaction.accountArchived ? <ArchivedTag /> : null}
                    {transaction.kind === 'transfer' && transaction.transferDirection === null ? (
                      <>
                        {' → '}
                        {transaction.toAccountName ?? '—'}
                        {transaction.toAccountArchived ? <ArchivedTag /> : null}
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className="transaction-datetime">
                      {formatDate(transaction.date)}
                      {transaction.time ? <small>{formatTime(transaction.time)}</small> : null}
                    </span>
                  </td>
                  <td className={`amount-column ${tone}`}>
                    {sign}
                    {formatMoney(transaction.amount)}
                  </td>
                  {onEdit || onDelete ? (
                    <td className="table-action-cell">
                      {transaction.investmentId || transaction.source === 'investment' ? <span className="managed-entry">Investment-managed</span> : transaction.transferDirection ? <span className="managed-entry">Private counterpart hidden</span> : <div className="table-row-actions">
                        {onEdit ? <button className="ghost-button table-edit-button" type="button" onClick={() => onEdit(transaction)} aria-label={`Edit ${transaction.name}`}><Pencil size={15} /> Edit</button> : null}
                        {onDelete ? <button className="ghost-button table-edit-button danger" type="button" onClick={() => onDelete(transaction)} aria-label={`Delete ${transaction.name}`}><Trash2 size={15} /> Delete</button> : null}
                      </div>}
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function CashFlowCard({ flows }: { flows: MonthlyFlow[] }) {
  const peak = Math.max(0, ...flows.flatMap((flow) => [flow.income, flow.expense]));
  return (
    <div className="surface-card">
      <div className="card-title-row">
        <div>
          <h3>Cash flow</h3>
          <p>Income and expenses over the last six months</p>
        </div>
      </div>
      <div className="legend">
        <span>
          <i className="dot income-dot" /> Income
        </span>
        <span>
          <i className="dot expense-dot" /> Expenses
        </span>
      </div>
      <div className="chart" role="img" aria-label="Income and expenses for the last six months">
        <div className="chart-gridlines">
          <span />
          <span />
          <span />
          <span />
        </div>
        {peak > 0 ? (
          <div className="bars">
            {flows.map((flow) => (
              <div className="bar-pair" key={flow.month}>
                <i className="expense-bar" style={{ height: `${(flow.expense / peak) * 100}%` }} title={`Expenses ${formatMoney(flow.expense)}`} />
                <i className="income-bar" style={{ height: `${(flow.income / peak) * 100}%` }} title={`Income ${formatMoney(flow.income)}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="chart-empty">Income and expenses will chart here once you record transactions.</div>
        )}
      </div>
      <div className="chart-labels">
        {flows.map((flow) => (
          <span key={flow.month}>{formatShortMonth(flow.month)}</span>
        ))}
      </div>
    </div>
  );
}

function CategoryBreakdown({ categories }: { categories: CategoryTotal[] }) {
  if (categories.length === 0) {
    return <p className="card-note">No expenses recorded for this month yet.</p>;
  }
  return (
    <div className="budget-list">
      {categories.slice(0, 5).map((category) => (
        <ProgressRow
          key={category.name}
          label={category.name}
          detail={`${formatMoney(category.total)} · ${category.share}%`}
          progress={category.share}
        />
      ))}
    </div>
  );
}

export function OverviewView({
  accounts,
  transactions,
  summary,
  flows,
  position,
  monthLabel,
  userName,
  onAddAccount,
  onAddTransaction,
  onNavigate,
}: {
  accounts: Account[];
  transactions: Transaction[];
  summary: MonthSummary;
  flows: MonthlyFlow[];
  position: { assets: number; owed: number; net: number };
  monthLabel: string;
  userName?: string;
  onAddAccount?: () => void;
  onAddTransaction?: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <>
      <SectionHeading
        title={userName ? `${userName}'s overview` : 'Monthly overview'}
        description={`Your summary for ${monthLabel}.`}
        action={
          <button className="text-button" type="button" onClick={() => onNavigate('analytics')}>
            View insights <ArrowUpRight size={14} />
          </button>
        }
      />

      {accounts.length === 0 ? (
        <EmptyPanel
          icon={<Wallet size={20} />}
          title="Add your first account"
          description="Start with a bank account, cash, wallet, or credit card. Balances update as you record transactions."
          action={onAddAccount ? (
            <button className="primary-button" type="button" onClick={onAddAccount}>
              <Plus size={16} /> Add account
            </button>
          ) : undefined}
        />
      ) : null}

      <div className="metrics-grid">
        <Metric
          label="Net position"
          value={formatMoney(position.net)}
          foot={`Assets ${formatMoney(position.assets)} · Owed ${formatMoney(position.owed)}`}
          icon={<Wallet size={16} />}
        />
        <Metric
          label="Income"
          value={formatMoney(summary.income)}
          foot="Received this month"
          icon={<ArrowDownLeft size={16} />}
        />
        <Metric
          label="Expenses"
          value={formatMoney(summary.expense)}
          foot="Spent this month"
          icon={<ArrowUpRight size={16} />}
        />
        <Metric
          label="Left after expenses"
          value={formatMoney(summary.net)}
          foot={summary.savingsRate === null ? 'Add income to see your savings rate' : `${summary.savingsRate}% of income kept`}
          icon={<PiggyBank size={16} />}
        />
      </div>

      <div className="content-grid">
        <CashFlowCard flows={flows} />
        <div className="surface-card">
          <div className="card-title-row">
            <div>
              <h3>Spending by category</h3>
              <p>Where this month's expenses went</p>
            </div>
          </div>
          <CategoryBreakdown categories={summary.categories} />
        </div>
      </div>

      <div className="lower-grid">
        <div className="surface-card">
          <div className="card-title-row">
            <div>
              <h3>Recent transactions</h3>
              <p>Your latest money movements</p>
            </div>
            {transactions.length > 0 ? (
              <button className="text-button" type="button" onClick={() => onNavigate('transactions')}>
                See all
              </button>
            ) : null}
          </div>
          {transactions.length === 0 ? (
            <EmptyPanel
              icon={<FileText size={20} />}
              title="No transactions yet"
              description="Record income, expenses, or transfers to see them here."
              action={onAddTransaction ? (
                <button className="primary-button" type="button" onClick={onAddTransaction}>
                  <Plus size={16} /> Add transaction
                </button>
              ) : undefined}
            />
          ) : (
            <TransactionTable transactions={transactions.slice(0, 4)} compact />
          )}
        </div>

        <div className="surface-card">
          <div className="card-title-row">
            <div>
              <h3>Accounts</h3>
              <p>Current balance of each account</p>
            </div>
          </div>
          {accounts.length === 0 ? (
            <p className="card-note">No accounts yet. Add one to start tracking balances.</p>
          ) : (
            <div className="account-list">
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} transactions={transactions} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const transactionPageSize = 25;

function PagedTransactionTable({
  transactions,
  page,
  onPage,
  onEdit,
  onDelete,
}: {
  transactions: Transaction[];
  page: number;
  onPage: (page: number) => void;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(transactions.length / transactionPageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * transactionPageSize;
  const end = Math.min(start + transactionPageSize, transactions.length);
  return (
    <>
      <TransactionTable transactions={transactions.slice(start, end)} onEdit={onEdit} onDelete={onDelete} />
      {pageCount > 1 ? (
        <div className="table-pagination" aria-label="Transaction pages">
          <span>Showing {start + 1}–{end} of {transactions.length}</span>
          <div>
            <button className="secondary-button" type="button" onClick={() => onPage(safePage - 1)} disabled={safePage === 0}>Previous</button>
            <button className="secondary-button" type="button" onClick={() => onPage(safePage + 1)} disabled={safePage >= pageCount - 1}>Next</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function TransactionAnalysis({ transactions }: { transactions: Transaction[] }) {
  const [period, setPeriod] = useState<AnalysisPeriod>('month');
  const [filters, setFilters] = useState(emptyTransactionAnalysisFilters);
  const [page, setPage] = useState(0);
  const { categories, accounts } = useMemo(() => transactionAnalysisOptions(transactions), [transactions]);
  const { from, to } = period === 'custom' ? filters : transactionAnalysisRange(period);
  const analysis = useMemo(
    () => analyzeTransactions(transactions, { ...filters, from, to }),
    [transactions, filters, from, to],
  );

  function updateFilter<Key extends keyof TransactionAnalysisFilters>(key: Key, value: TransactionAnalysisFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }

  function reset() {
    setPeriod('month');
    setFilters(emptyTransactionAnalysisFilters);
    setPage(0);
  }

  const periodLabel = from && to ? `${formatDate(from)} – ${formatDate(to)}`
    : from ? `From ${formatDate(from)}`
    : to ? `Through ${formatDate(to)}`
    : 'All dates';

  return (
    <div className="transaction-analysis">
      <div className="metrics-grid transaction-analysis-metrics" aria-live="polite">
        <Metric label="Total income" value={analysis.error ? '—' : formatMoney(analysis.income)} foot="Matching income entries" icon={<ArrowDownLeft size={16} />} />
        <Metric label="Total expenses" value={analysis.error ? '—' : formatMoney(analysis.expense)} foot="Matching expense entries" icon={<ArrowUpRight size={16} />} />
        <Metric label="Money left" value={analysis.error ? '—' : formatMoney(analysis.balance)} foot="Income minus expenses" icon={<Wallet size={16} />} />
      </div>
      <section className="surface-card transaction-analysis-filters" aria-labelledby="transaction-filters-title">
        <div className="card-title-row">
          <div><h3 id="transaction-filters-title">Filters</h3><p>{periodLabel}</p></div>
          <button type="button" className="text-button" onClick={reset}>Reset filters</button>
        </div>
        <div className="transaction-filter-grid">
          <label className="transaction-filter-field">
            <span>Period</span>
            <Select aria-label="Period" value={period} onChange={(event) => { setPeriod(event.target.value as AnalysisPeriod); setPage(0); }}>
              <option value="month">This month</option>
              <option value="last-month">Last month</option>
              <option value="week">This week</option>
              <option value="all">All time</option>
              <option value="custom">Custom date range</option>
            </Select>
          </label>
          {period === 'custom' ? (
            <>
              <DatePicker label="From" value={filters.from} max={filters.to || undefined} onChange={(value) => updateFilter('from', value)} placeholder="Any start date" clearable />
              <DatePicker label="To" value={filters.to} min={filters.from || undefined} onChange={(value) => updateFilter('to', value)} placeholder="Any end date" clearable />
            </>
          ) : null}
          <label className="transaction-filter-field">
            <span>Minimum amount (₹)</span>
            <RupeeInput placeholder="Any minimum" value={filters.minAmount} onValueChange={(value) => updateFilter('minAmount', value)} />
          </label>
          <label className="transaction-filter-field">
            <span>Maximum amount (₹)</span>
            <RupeeInput placeholder="Any maximum" value={filters.maxAmount} onValueChange={(value) => updateFilter('maxAmount', value)} />
          </label>
          <label className="transaction-filter-field">
            <span>Category</span>
            <Select aria-label="Category" value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}>
              <option value="">All categories</option>
              {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </label>
          <label className="transaction-filter-field">
            <span>Account</span>
            <Select aria-label="Account" value={filters.account} onChange={(event) => updateFilter('account', event.target.value)}>
              <option value="">All accounts</option>
              {accounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </label>
          <label className="transaction-filter-field">
            <span>Kind</span>
            <Select aria-label="Kind" value={filters.kind} onChange={(event) => updateFilter('kind', event.target.value as TransactionAnalysisFilters['kind'])}>
              <option value="all">All kinds</option>
              <option value="income">Income</option>
              <option value="expense">Expenses</option>
              <option value="transfer">Transfers</option>
            </Select>
          </label>
          <label className="transaction-filter-field">
            <span>Source</span>
            <Select aria-label="Source" value={filters.source} onChange={(event) => updateFilter('source', event.target.value as TransactionAnalysisFilters['source'])}>
              <option value="all">All sources</option>
              <option value="manual">Manual</option>
              <option value="scheduled">Scheduled</option>
              <option value="investment">Investment</option>
            </Select>
          </label>
          <label className="transaction-filter-field">
            <span>Search</span>
            <input type="search" placeholder="Search transactions" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
          </label>
        </div>
        {analysis.error ? <p role="alert" className="form-error">{analysis.error}</p> : null}
      </section>
      <section className="surface-card" aria-labelledby="transaction-matches-title">
        <div className="card-title-row">
          <div>
            <h3 id="transaction-matches-title">Matching transactions</h3>
            {!analysis.error ? <p>{analysis.matches.length} {analysis.matches.length === 1 ? 'entry' : 'entries'}</p> : null}
          </div>
        </div>
        {analysis.error ? <p className="card-note">Adjust the filters to see matching entries.</p> : <PagedTransactionTable transactions={analysis.matches} page={page} onPage={setPage} />}
      </section>
    </div>
  );
}

export function TransactionsView({
  transactions,
  allTransactions,
  searchQuery,
  filter,
  onSearch,
  onFilter,
  onAddTransaction,
  onEditTransaction,
  onDeleteTransaction,
}: {
  transactions: Transaction[];
  allTransactions: Transaction[];
  searchQuery: string;
  filter: 'all' | TransactionKind;
  onSearch: (value: string) => void;
  onFilter: (value: 'all' | TransactionKind) => void;
  onAddTransaction?: () => void;
  onEditTransaction?: (transaction: Transaction) => void;
  onDeleteTransaction?: (transaction: Transaction) => void;
}) {
  const [section, setSection] = useState<'history' | 'analysis'>('history');
  const [page, setPage] = useState(0);
  const analysisOpen = section === 'analysis';
  return (
    <>
      <SectionHeading
        title={analysisOpen ? 'Transaction analysis' : 'Transactions'}
        description={analysisOpen ? 'Review your income, spending and money left for the records you select.' : 'Every income, expense and transfer you have recorded.'}
        action={onAddTransaction ? (
          <button className="primary-button" type="button" onClick={onAddTransaction}>
            <Plus size={16} /> Add transaction
          </button>
        ) : undefined}
      />
      <nav className="analytics-tabs transaction-pages" aria-label="Transaction pages">
        <button type="button" className={!analysisOpen ? 'active' : ''} aria-current={!analysisOpen ? 'page' : undefined} onClick={() => setSection('history')}>History</button>
        <button type="button" className={analysisOpen ? 'active' : ''} aria-current={analysisOpen ? 'page' : undefined} onClick={() => setSection('analysis')}>Analysis</button>
      </nav>
      {analysisOpen ? <TransactionAnalysis transactions={allTransactions} /> : <>
      {allTransactions.length === 0 ? (
        <div className="surface-card">
          <EmptyPanel
            icon={<FileText size={20} />}
            title="No transactions yet"
            description="Record your first income, expense, or transfer to start building your history."
            action={onAddTransaction ? (
              <button className="primary-button" type="button" onClick={onAddTransaction}>
                <Plus size={16} /> Add transaction
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="surface-card">
          <div className="filter-row">
            <label className="search-field">
              <Search size={16} />
              <input
                value={searchQuery}
                onChange={(event) => { setPage(0); onSearch(event.target.value); }}
                placeholder="Search transactions"
                aria-label="Search transactions"
              />
            </label>
            <Select
              className="compact-select"
              value={filter}
              onChange={(event) => { setPage(0); onFilter(event.target.value as 'all' | TransactionKind); }}
              aria-label="Filter by kind"
            >
              <option value="all">All kinds</option>
              <option value="income">Counts as income</option>
              <option value="expense">Counts as expense</option>
              <option value="transfer">Counts as transfer</option>
            </Select>
          </div>
          <PagedTransactionTable transactions={transactions} page={page} onPage={setPage} onEdit={onEditTransaction} onDelete={onDeleteTransaction} />
        </div>
      )}
      </>}
    </>
  );
}

export function AccountsView({
  accounts,
  transactions,
  position,
  actions,
  onAddAccount,
  onEditAccount,
}: {
  accounts: Account[];
  transactions: Transaction[];
  position: { assets: number; owed: number; net: number };
  actions: FinanceActions;
  onAddAccount?: () => void;
  onEditAccount?: (account: Account) => void;
}) {
  const rank = { active: 0, inactive: 1, deleted: 2 } as const;
  const ordered = accounts.filter(a => !a.ipoCustody).sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)]);
  return (
    <>
      <SectionHeading
        title="Accounts"
        description="Bank accounts, cash, wallets and credit cards in one place."
        action={onAddAccount ? (
          <button className="primary-button" type="button" onClick={onAddAccount}>
            <Plus size={16} /> Add account
          </button>
        ) : undefined}
      />
      <div className="metrics-grid">
        <Metric label="Total assets" value={formatMoney(position.assets)} foot="Bank, cash and wallets" icon={<Wallet size={16} />} />
        <Metric label="Credit card owed" value={formatMoney(position.owed)} foot="Outstanding on your cards" icon={<CreditCard size={16} />} />
        <Metric label="Net position" value={formatMoney(position.net)} foot="Assets minus amounts owed" icon={<PiggyBank size={16} />} />
        <SavingsBalanceMetric />
      </div>
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h3>All accounts</h3>
            <p>Balances update automatically from your transactions</p>
          </div>
        </div>
        {ordered.length === 0 ? (
          <EmptyPanel
            icon={<Wallet size={20} />}
            title="No accounts yet"
            description="Add the places your money lives so every transaction has somewhere to go."
            action={onAddAccount ? (
              <button className="primary-button" type="button" onClick={onAddAccount}>
                <Plus size={16} /> Add account
              </button>
            ) : undefined}
          />
        ) : (
          <div className="account-list expanded">
            {ordered.map((account) => {
              const usage = transactions.filter((t) => t.accountId === account.id || t.toAccountId === account.id).length;
              return (
                <AccountRow
                  key={account.id}
                  account={account}
                  transactions={transactions}
                  actions={onEditAccount ? (
                    <ItemActions
                      name={account.name}
                      state={stateOf(account)}
                      usageCount={usage}
                      onEdit={onEditAccount ? () => onEditAccount(account) : undefined}
                      onSetState={(state) => actions.setItemState('accounts', account.id, state)}
                      onDeletePermanently={() => actions.deleteItemPermanently('accounts', account.id)}
                    />
                  ) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

type AnalyticsRange = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

function dateOffset(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`;
}

function rangeForPreset(range: Exclude<AnalyticsRange, 'custom'>) {
  const now = new Date();
  const end = dateOffset(now, 0);
  if (range === 'yearly') return { from: end.slice(0, 4) + '-01-01', to: end };
  if (range === 'daily') return { from: end, to: end };
  if (range === 'weekly') {
    const mondayOffset = (now.getDay() + 6) % 7;
    return { from: dateOffset(now, -mondayOffset), to: end };
  }
  return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: end };
}

export function AnalyticsView({ transactions }: { transactions: Transaction[] }) {
  const [range, setRange] = useState<AnalyticsRange>('monthly');
  const monthly = rangeForPreset('monthly');
  const [customFrom, setCustomFrom] = useState(monthly.from);
  const [customTo, setCustomTo] = useState(monthly.to);
  const [selectedFilters, setFilters] = useState(emptyAnalyticsFilters);
  const [compare, setCompare] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const activeRange = range === 'custom' ? { from: customFrom, to: customTo } : rangeForPreset(range);
  const { from, to } = activeRange;
  const validRange = Boolean(from && to && from <= to);
  const periodTransactions = useMemo(() => validRange
    ? analyzeTransactions(transactions, { ...emptyTransactionAnalysisFilters, from, to }).matches
    : [], [transactions, validRange, from, to]);
  const filters = useMemo(() => reconcileAnalyticsFilters(periodTransactions, selectedFilters), [periodTransactions, selectedFilters]);
  if (validRange && filters !== selectedFilters) setFilters(filters);

  const options = useMemo(() => analyticsFilterOptions(periodTransactions, filters), [periodTransactions, filters]);
  const analytics = useMemo(() => analyzeTransactions(periodTransactions, { ...emptyTransactionAnalysisFilters, ...filters, from, to }),
    [periodTransactions, filters, from, to]);
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 || 1);
  const months = Math.max(1, ((Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1) || 1);
  const previousRange = useMemo(() => {
    const anchor = new Date(from + 'T12:00:00');
    return { from: dateOffset(anchor, -days), to: dateOffset(anchor, -1) };
  }, [from, days]);
  const previous = useMemo(() => compare && validRange
    ? analyzeTransactions(transactions, { ...emptyTransactionAnalysisFilters, ...filters, ...previousRange }) : null,
    [compare, validRange, transactions, filters, previousRange]);
  const rollups = useMemo(() => {
    const categories = new Map<string, { name: string; amount: number }>();
    const types = new Map<string, { name: string; amount: number }>();
    const accounts = new Map<string, { name: string; amount: number }>();
    const trend = new Map<string, { income: number; expense: number }>();
    let largestExpense: Transaction | undefined;
    let largestIncome: Transaction | undefined;
    const add = (groups: typeof categories, key: string, name: string, paise: number) => groups.set(key, { name, amount: (groups.get(key)?.amount ?? 0) + paise });
    for (const transaction of analytics.matches) {
      if (transaction.kind === 'transfer') continue;
      const paise = Math.round(transaction.amount * 100);
      const key = days > 62 ? transaction.date.slice(0, 7) : transaction.date;
      const bucket = trend.get(key) ?? { income: 0, expense: 0 };
      bucket[transaction.kind] += paise;
      trend.set(key, bucket);
      if (transaction.kind === 'expense') {
        if (!largestExpense || transaction.amount > largestExpense.amount) largestExpense = transaction;
        add(categories, transaction.categoryId ?? 'uncategorised', transaction.categoryName ?? 'Uncategorised', paise);
      } else if (!largestIncome || transaction.amount > largestIncome.amount) largestIncome = transaction;
      add(types, transaction.typeId, transaction.typeName, paise);
      add(accounts, transaction.accountId, transaction.accountName, transaction.kind === 'income' ? paise : -paise);
    }
    return { categories, types, accounts, trend: [...trend].sort(([a], [b]) => a.localeCompare(b)), largestExpense, largestIncome };
  }, [analytics.matches, days]);
  const statement = useMemo(() => [...analytics.matches].sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '')), [analytics.matches]);
  const peak = rollups.trend.reduce((maximum, [, entry]) => Math.max(maximum, entry.income, entry.expense), 1);
  const savingsRate = analytics.income ? Math.round((analytics.balance / analytics.income) * 100) : null;
  const invalid = analytics.error || (!from || !to ? 'Choose both dates.' : '');

  const exportStatement = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(true);
    setExportError('');
    const account = options.account.find(([id]) => id === filters.account)?.[1] ?? 'All accounts';
    const category = options.category.find(([id]) => id === filters.category)?.[1] ?? 'All categories';
    const type = options.typeId.find(([id]) => id === filters.typeId)?.[1] ?? 'All types';
    const report: TableReport = {
      title: 'Financial transaction statement', filename: 'transactions-' + from + '-to-' + to,
      summary: [
        formatDate(from) + ' – ' + formatDate(to), [account, category, type, filters.kind === 'all' ? 'All classifications' : filters.kind].join(' · '),
        'Income ' + formatMoney(analytics.income) + ' · Expenses ' + formatMoney(analytics.expense) + ' · Net movement ' + formatMoney(analytics.balance),
      ],
      headers: ['Date', 'Description', 'Category', 'Type', 'Account', 'Classification', 'Amount (INR)'],
      rows: statement.map((row) => [row.date, row.name, row.categoryName ?? '', row.typeName, row.toAccountName ? row.accountName + ' → ' + row.toAccountName : row.accountName, row.kind, row.amount]),
      amountColumn: 6,
    };
    try { await downloadReport(report, format); }
    catch (error) { setExportError(error instanceof Error ? error.message : 'Could not export this statement.'); }
    finally { setExporting(false); }
  };

  return <>
    <SectionHeading title="Analytics" description="See income, expenses and cash flow in your selected period." />
    <div className="analytics-controls surface-card">
      <div className="analytics-tabs" aria-label="Analytics period">
        {(['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const).map((option) => (
          <button key={option} type="button" className={range === option ? 'active' : ''} aria-pressed={range === option} onClick={() => setRange(option)}>{option[0].toUpperCase() + option.slice(1)}</button>
        ))}
      </div>
      {range === 'custom' ? <div className="analytics-date-range"><DatePicker label="From" value={customFrom} max={customTo || undefined} onChange={setCustomFrom} clearable /><DatePicker label="To" value={customTo} min={customFrom || undefined} onChange={setCustomTo} clearable /></div> : null}
      <p>{formatDate(from)} – {formatDate(to)}</p>
      <div className="form-grid finance-analytics-filters">
        {([['account', 'Account', options.account], ['typeId', 'Transaction type', options.typeId], ['category', 'Category', options.category]] as const).map(([key, label, values]) =>
          <label key={key}>{label}<Select aria-label={label} value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}>
            <option value="">All</option>{values.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select></label>)}
        <label>Classification<Select aria-label="Classification" value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value as AnalyticsFilters['kind'] })}>
          <option value="all">All</option>{options.kind.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select></label>
      </div>
      <label className="recognition-check"><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} /> Compare with the previous period of equal length</label>
    </div>
    {invalid ? <p className="form-error" role="alert">{invalid}</p> : <>
      <div className="metrics-grid">
        <Metric label="Income" value={formatMoney(analytics.income)} foot={previous ? 'Previous ' + formatMoney(previous.income) : 'Selected period'} icon={<ArrowDownLeft size={16} />} />
        <Metric label="Expenses" value={formatMoney(analytics.expense)} foot={previous ? 'Previous ' + formatMoney(previous.expense) : 'Selected period'} icon={<ArrowUpRight size={16} />} />
        <Metric label="Net cash flow" value={formatMoney(analytics.balance)} foot={previous ? 'Previous ' + formatMoney(previous.balance) : 'Income minus expenses'} icon={<Wallet size={16} />} />
        <Metric label="Savings rate" value={savingsRate === null ? '—' : savingsRate + '%'} foot="Share of income left over" icon={<PiggyBank size={16} />} />
        <Metric label="Largest expense" value={rollups.largestExpense ? formatMoney(rollups.largestExpense.amount) : '—'} foot={rollups.largestExpense?.name ?? 'No expenses in this period'} icon={<ArrowUpRight size={16} />} />
        <Metric label="Largest income" value={rollups.largestIncome ? formatMoney(rollups.largestIncome.amount) : '—'} foot={rollups.largestIncome?.name ?? 'No income in this period'} icon={<ArrowDownLeft size={16} />} />
        <Metric label="Daily average spend" value={formatMoney(analytics.expense / days)} foot={days + ' calendar days'} icon={<FileText size={16} />} />
        <Metric label="Monthly average spend" value={formatMoney(analytics.expense / months)} foot={months + ' calendar months in range'} icon={<FileText size={16} />} />
      </div>
      {previous ? <p className="form-hint">Comparison period · {formatDate(previousRange.from)} – {formatDate(previousRange.to)}
        {previous.expense > 0 ? ' · Spending changed by ' + new Intl.NumberFormat('en-IN', { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format((analytics.expense - previous.expense) / previous.expense) : null}
      </p> : null}
      <div className="content-grid analytics-grid">
        <div className="card-title-row"><div><h3>Cash-flow trend</h3><p>{days > 62 ? 'Income and spending by month' : 'Income and spending by day'}</p></div></div>
        <div className="surface-card analytics-trend" role="img" aria-label="Income and expense trend for the selected dates">
          {rollups.trend.length ? <div className="analytics-bars">{rollups.trend.map(([date, point]) => <div className="analytics-bar-pair" key={date} title={date + ' · income ' + formatMoney(point.income / 100) + ' · expense ' + formatMoney(point.expense / 100)}><i className="expense-bar" style={{ height: point.expense / peak * 100 + '%' }} /><i className="income-bar" style={{ height: point.income / peak * 100 + '%' }} /><small>{date.length === 7 ? date.slice(5) : date.slice(8)}</small></div>)}</div> : <p className="card-note">No income or expenses in this view.</p>}
        </div>
      </div>
      <div className="content-grid analytics-grid">
        {([['Expenses by category', 'category', rollups.categories], ['Transactions by type', 'typeId', rollups.types], ['Net cash flow by account', 'account', rollups.accounts]] as const).map(([title, key, groups]) =>
          <section className="surface-card" key={key}><h3>{title}</h3>
            {[...groups].sort((a, b) => Math.abs(b[1].amount) - Math.abs(a[1].amount)).map(([id, entry]) =>
              <button className="text-button finance-drilldown" key={id} type="button" aria-pressed={filters[key] === id} onClick={() => setFilters({ ...filters, [key]: filters[key] === id ? '' : id })}><span>{entry.name}</span><strong>{formatMoney(entry.amount / 100)}</strong></button>)}
            {!groups.size ? <p className="card-note">No matching income or expenses.</p> : null}
          </section>)}
      </div>
      <section className="surface-card">
        <div className="card-title-row"><div><h3>Transaction statement</h3><p>{statement.length} transactions in your filtered view</p></div>
          <div className="finance-export-actions">
            {([['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'Print / PDF']] as const).map(([format, label]) => <button className="secondary-button" key={format} type="button" disabled={exporting} onClick={() => void exportStatement(format)}>{label}</button>)}
          </div>
        </div>
        {exportError ? <p className="form-error" role="alert">{exportError}</p> : null}
        {statement.length ? <div className="workout-table"><table className="finance-analytics-table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th>Account</th><th>Amount</th></tr></thead>
          <tbody>{statement.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{row.name}</td><td>{row.categoryName || '—'}</td><td>{row.typeName}</td><td>{row.accountName}{row.toAccountName ? ' → ' + row.toAccountName : ''}</td><td>{formatMoney(row.amount)}</td></tr>)}</tbody></table></div> : <p className="card-note">No transactions match these filters.</p>}
      </section>
    </>}
  </>;
}
