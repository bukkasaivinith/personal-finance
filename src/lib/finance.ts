export type TransactionKind = 'expense' | 'income' | 'transfer';

export type ItemStatus = {
  isActive: boolean;
  deletedAt: string | null;
};

export type TransactionTypeOption = ItemStatus & { id: string; name: string; kind: TransactionKind };

export type CategoryOption = ItemStatus & {
  id: string;
  name: string;
  emoji: string | null;
  parentId: string | null;
  transactionTypeIds: string[];
};

export type Account = ItemStatus & {
  id: string;
  name: string;
  description: string;
  openingBalance: number;
  openingBalanceDate: string;
  isLiability: boolean;
};

export type Transaction = {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
  typeArchived: boolean;
  kind: TransactionKind;
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  categoryArchived: boolean;
  amount: number;
  date: string;
  accountId: string;
  accountName: string;
  accountArchived: boolean;
  toAccountId: string | null;
  toAccountName: string | null;
  toAccountArchived: boolean;
};

export type TransactionDraft = {
  name: string;
  typeId: string;
  categoryId: string | null;
  amount: number;
  date: string;
  accountId: string;
  toAccountId: string | null;
};

export type Budget = {
  id: string;
  categoryId: string;
  amount: number;
};

export type RecurringFrequency = 'weekly' | 'monthly';

export type RecurringEntry = {
  id: string;
  name: string;
  typeId: string;
  categoryId: string | null;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  frequency: RecurringFrequency;
  nextDate: string;
  isActive: boolean;
};

export type RecurringEntryDraft = Omit<RecurringEntry, 'id' | 'isActive'>;

export type FinanceData = {
  transactionTypes: TransactionTypeOption[];
  categories: CategoryOption[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  recurringEntries: RecurringEntry[];
};

export type CategoryTotal = { name: string; total: number; share: number };

export type MonthSummary = {
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
  dailyAverage: number;
  transactionCount: number;
  categories: CategoryTotal[];
};

export type MonthlyFlow = { month: string; income: number; expense: number };

const pad = (value: number) => String(value).padStart(2, '0');

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}

export function recentMonthKeys(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1)).toISOString().slice(0, 7),
  );
}

export function parseAmount(value: string): number {
  return Math.round(Number(value) * 100) / 100;
}

export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(
    new Date(`${month}-01T12:00:00`),
  );
}

export function formatShortMonth(month: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(`${month}-01T12:00:00`));
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(`${date}T12:00:00`),
  );
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.abs(amount))}`;
}

export function sortByDate(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date));
}

export function categoriesFor(categories: CategoryOption[], typeId: string): CategoryOption[] {
  return categories.filter((category) => category.transactionTypeIds.includes(typeId));
}

export type ItemState = 'active' | 'inactive' | 'deleted';

export function stateOf(item: ItemStatus): ItemState {
  if (item.deletedAt !== null) return 'deleted';
  return item.isActive ? 'active' : 'inactive';
}

export function isUsable(item: ItemStatus): boolean {
  return item.isActive && item.deletedAt === null;
}

export function signedBalance(account: Account, transactions: Transaction[]): number {
  let balance = account.isLiability ? -account.openingBalance : account.openingBalance;
  for (const transaction of transactions) {
    if (transaction.date < account.openingBalanceDate) continue;
    if (transaction.kind === 'income' && transaction.accountId === account.id) {
      balance += transaction.amount;
    }
    if (transaction.kind === 'expense' && transaction.accountId === account.id) {
      balance -= transaction.amount;
    }
    if (transaction.kind === 'transfer') {
      if (transaction.accountId === account.id) balance -= transaction.amount;
      if (transaction.toAccountId === account.id) balance += transaction.amount;
    }
  }
  return balance;
}

export function netPosition(accounts: Account[], transactions: Transaction[]) {
  let assets = 0;
  let owed = 0;
  for (const account of accounts) {
    const signed = signedBalance(account, transactions);
    if (account.isLiability) {
      owed -= signed;
    } else {
      assets += signed;
    }
  }
  return { assets, owed, net: assets - owed };
}

function daysElapsed(month: string): number {
  if (month === currentMonthKey()) return new Date().getUTCDate();
  const [year, monthIndex] = month.split('-').map(Number);
  return new Date(year, monthIndex, 0).getDate();
}

export function summarizeMonth(transactions: Transaction[], month: string): MonthSummary {
  let income = 0;
  let expense = 0;
  let transactionCount = 0;
  const byCategory = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.date.slice(0, 7) !== month) continue;
    transactionCount += 1;
    if (transaction.kind === 'income') income += transaction.amount;
    if (transaction.kind === 'expense') {
      expense += transaction.amount;
      const label = transaction.categoryName || 'Uncategorised';
      byCategory.set(label, (byCategory.get(label) ?? 0) + transaction.amount);
    }
  }

  const categories = [...byCategory]
    .map(([name, total]) => ({ name, total, share: Math.round((total / expense) * 100) }))
    .sort((a, b) => b.total - a.total);

  return {
    income,
    expense,
    net: income - expense,
    savingsRate: income > 0 ? Math.round(((income - expense) / income) * 100) : null,
    dailyAverage: expense / daysElapsed(month),
    transactionCount,
    categories,
  };
}

export function monthlyFlows(transactions: Transaction[], months: string[]): MonthlyFlow[] {
  return months.map((month) => {
    let income = 0;
    let expense = 0;
    for (const transaction of transactions) {
      if (transaction.date.slice(0, 7) !== month) continue;
      if (transaction.kind === 'income') income += transaction.amount;
      if (transaction.kind === 'expense') expense += transaction.amount;
    }
    return { month, income, expense };
  });
}
