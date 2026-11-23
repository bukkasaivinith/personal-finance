import { toDateKey, type Transaction, type TransactionKind } from '@/lib/finance';

export type AnalysisPeriod = 'month' | 'last-month' | 'week' | 'all' | 'custom';

export type TransactionAnalysisFilters = {
  from: string;
  to: string;
  minAmount: string;
  maxAmount: string;
  category: string;
  account: string;
  kind: 'all' | TransactionKind;
  source: 'all' | Transaction['source'];
  search: string;
};

export const emptyTransactionAnalysisFilters: TransactionAnalysisFilters = {
  from: '',
  to: '',
  minAmount: '',
  maxAmount: '',
  category: '',
  account: '',
  kind: 'all',
  source: 'all',
  search: '',
};

export function transactionAnalysisRange(period: Exclude<AnalysisPeriod, 'custom'>, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = toDateKey(now);

  if (period === 'all') return { from: '', to: '' };
  if (period === 'last-month') {
    return { from: toDateKey(new Date(year, month - 1, 1)), to: toDateKey(new Date(year, month, 0)) };
  }
  if (period === 'week') {
    const daysSinceMonday = (now.getDay() + 6) % 7;
    return { from: toDateKey(new Date(year, month, now.getDate() - daysSinceMonday)), to: today };
  }
  return { from: toDateKey(new Date(year, month, 1)), to: today };
}

export function transactionAnalysisOptions(transactions: Transaction[]) {
  const categories = new Map<string, string>();
  const accounts = new Map<string, string>();
  for (const transaction of transactions) {
    const { categoryId, categoryName, accountId, accountName, toAccountId, toAccountName } = transaction;
    categories.set(categoryId ?? 'uncategorised', categoryName || 'Uncategorised');
    accounts.set(accountId, accountName);
    if (toAccountId && toAccountName) accounts.set(toAccountId, toAccountName);
  }
  const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
  return { categories: [...categories].sort(byName), accounts: [...accounts].sort(byName) };
}

export function analyzeTransactions(transactions: Transaction[], filters: TransactionAnalysisFilters) {
  const min = filters.minAmount === '' ? 0 : Number(filters.minAmount);
  const max = filters.maxAmount === '' ? Infinity : Number(filters.maxAmount);
  const query = filters.search.trim().toLocaleLowerCase();
  const matches: Transaction[] = [];
  let incomePaise = 0;
  let expensePaise = 0;
  let error = '';

  if (filters.from && filters.to && filters.from > filters.to) {
    error = 'Choose an end date on or after the start date.';
  } else if (!Number.isFinite(min) || min < 0 || max < 0 || (filters.maxAmount && !Number.isFinite(max))) {
    error = 'Enter valid amounts of ₹0 or more.';
  } else if (max < min) {
    error = 'Maximum amount must be at least the minimum amount.';
  }

  if (!error) {
    for (const transaction of transactions) {
      if ((filters.from && transaction.date < filters.from) || (filters.to && transaction.date > filters.to)) continue;
      if (transaction.amount < min || transaction.amount > max) continue;
      if (filters.kind !== 'all' && transaction.kind !== filters.kind) continue;
      if (filters.source !== 'all' && transaction.source !== filters.source) continue;
      if (filters.category && (transaction.categoryId ?? 'uncategorised') !== filters.category) continue;
      if (filters.account && transaction.accountId !== filters.account && transaction.toAccountId !== filters.account) continue;
      if (query && ![transaction.name, transaction.categoryName, transaction.typeName, transaction.accountName, transaction.toAccountName]
        .some((label) => label?.toLocaleLowerCase().includes(query))) continue;

      matches.push(transaction);
      const amountPaise = Math.round(transaction.amount * 100);
      if (transaction.kind === 'income') incomePaise += amountPaise;
      if (transaction.kind === 'expense') expensePaise += amountPaise;
    }
  }

  return {
    matches,
    income: incomePaise / 100,
    expense: expensePaise / 100,
    balance: (incomePaise - expensePaise) / 100,
    error,
  };
}
