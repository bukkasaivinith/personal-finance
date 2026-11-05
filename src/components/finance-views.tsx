import type { ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  FileText,
  PiggyBank,
  Plus,
  Search,
  Wallet,
} from 'lucide-react';
import { EmptyPanel, Metric, ProgressRow, SectionHeading } from '@/components/ui';
import { ItemActions, StatusTag } from '@/components/item-actions';
import type { FinanceActions } from '@/lib/finance-actions';
import {
  formatDate,
  formatMoney,
  formatShortMonth,
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
        <small>{isCard ? 'Owed' : 'Available'}</small>
      </span>
      {actions ? <div className="account-actions">{actions}</div> : null}
    </div>
  );
}

function TransactionTable({
  transactions,
  compact = false,
  emptyMessage = 'No transactions match your filters.',
}: {
  transactions: Transaction[];
  compact?: boolean;
  emptyMessage?: string;
}) {

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            {compact ? null : <th>Type</th>}
            <th>Account</th>
            <th>Date</th>
            <th className="amount-column">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 ? (
            <tr>
              <td colSpan={compact ? 4 : 5} className="table-empty">
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
                    {transaction.kind === 'transfer' ? (
                      <>
                        {' → '}
                        {transaction.toAccountName ?? '—'}
                        {transaction.toAccountArchived ? <ArchivedTag /> : null}
                      </>
                    ) : null}
                  </td>
                  <td>{formatDate(transaction.date)}</td>
                  <td className={`amount-column ${tone}`}>
                    {sign}
                    {formatMoney(transaction.amount)}
                  </td>
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
  onAddAccount: () => void;
  onAddTransaction: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <>
      <SectionHeading
        title="Monthly overview"
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
          action={
            <button className="primary-button" type="button" onClick={onAddAccount}>
              <Plus size={16} /> Add account
            </button>
          }
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
              action={
                <button className="primary-button" type="button" onClick={onAddTransaction}>
                  <Plus size={16} /> Add transaction
                </button>
              }
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

export function TransactionsView({
  transactions,
  totalCount,
  searchQuery,
  filter,
  onSearch,
  onFilter,
  onAddTransaction,
}: {
  transactions: Transaction[];
  totalCount: number;
  searchQuery: string;
  filter: 'all' | TransactionKind;
  onSearch: (value: string) => void;
  onFilter: (value: 'all' | TransactionKind) => void;
  onAddTransaction: () => void;
}) {
  return (
    <>
      <SectionHeading
        title="Transactions"
        description="Every income, expense and transfer you have recorded."
        action={
          <button className="primary-button" type="button" onClick={onAddTransaction}>
            <Plus size={16} /> Add transaction
          </button>
        }
      />
      {totalCount === 0 ? (
        <div className="surface-card">
          <EmptyPanel
            icon={<FileText size={20} />}
            title="No transactions yet"
            description="Record your first income, expense, or transfer to start building your history."
            action={
              <button className="primary-button" type="button" onClick={onAddTransaction}>
                <Plus size={16} /> Add transaction
              </button>
            }
          />
        </div>
      ) : (
        <div className="surface-card">
          <div className="filter-row">
            <label className="search-field">
              <Search size={16} />
              <input
                value={searchQuery}
                onChange={(event) => onSearch(event.target.value)}
                placeholder="Search transactions"
                aria-label="Search transactions"
              />
            </label>
            <select
              className="compact-select"
              value={filter}
              onChange={(event) => onFilter(event.target.value as 'all' | TransactionKind)}
              aria-label="Filter by kind"
            >
              <option value="all">All kinds</option>
              <option value="income">Counts as income</option>
              <option value="expense">Counts as expense</option>
              <option value="transfer">Counts as transfer</option>
            </select>
          </div>
          <TransactionTable transactions={transactions} />
        </div>
      )}
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
  onAddAccount: () => void;
  onEditAccount: (account: Account) => void;
}) {
  const rank = { active: 0, inactive: 1, deleted: 2 } as const;
  const ordered = [...accounts].sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)]);
  return (
    <>
      <SectionHeading
        title="Accounts"
        description="Bank accounts, cash, wallets and credit cards in one place."
        action={
          <button className="primary-button" type="button" onClick={onAddAccount}>
            <Plus size={16} /> Add account
          </button>
        }
      />
      <div className="metrics-grid">
        <Metric label="Total assets" value={formatMoney(position.assets)} foot="Bank, cash and wallets" icon={<Wallet size={16} />} />
        <Metric label="Credit card owed" value={formatMoney(position.owed)} foot="Outstanding on your cards" icon={<CreditCard size={16} />} />
        <Metric label="Net position" value={formatMoney(position.net)} foot="Assets minus amounts owed" icon={<PiggyBank size={16} />} />
      </div>
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h3>All accounts</h3>
            <p>Balances update automatically from your transactions</p>
          </div>
        </div>
        {accounts.length === 0 ? (
          <EmptyPanel
            icon={<Wallet size={20} />}
            title="No accounts yet"
            description="Add the places your money lives so every transaction has somewhere to go."
            action={
              <button className="primary-button" type="button" onClick={onAddAccount}>
                <Plus size={16} /> Add account
              </button>
            }
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
                  actions={
                    <ItemActions
                      name={account.name}
                      state={stateOf(account)}
                      usageCount={usage}
                      onEdit={() => onEditAccount(account)}
                      onSetState={(state) => actions.setItemState('accounts', account.id, state)}
                      onDeletePermanently={() => actions.deleteItemPermanently('accounts', account.id)}
                    />
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export function AnalyticsView({ summary, monthLabel }: { summary: MonthSummary; monthLabel: string }) {
  const hasData = summary.transactionCount > 0;
  return (
    <>
      <SectionHeading title="Analytics" description={`Insights for ${monthLabel}.`} />
      <div className="metrics-grid">
        <Metric
          label="Savings rate"
          value={summary.savingsRate === null ? '—' : `${summary.savingsRate}%`}
          foot="Share of income left over"
          icon={<PiggyBank size={16} />}
        />
        <Metric
          label="Largest expense"
          value={summary.categories[0]?.name ?? '—'}
          foot={summary.categories[0] ? formatMoney(summary.categories[0].total) : 'No expenses yet'}
          icon={<ArrowUpRight size={16} />}
        />
        <Metric
          label="Daily average spend"
          value={formatMoney(summary.dailyAverage)}
          foot="Expenses divided by days so far"
          icon={<FileText size={16} />}
        />
        <Metric
          label="Transactions"
          value={String(summary.transactionCount)}
          foot="Recorded this month"
          icon={<ArrowLeftRight size={16} />}
        />
      </div>
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h3>Expenses by category</h3>
            <p>Share of this month's spending</p>
          </div>
        </div>
        {hasData ? (
          <CategoryBreakdown categories={summary.categories} />
        ) : (
          <p className="card-note">Record transactions for this month to see insights.</p>
        )}
      </div>
    </>
  );
}
