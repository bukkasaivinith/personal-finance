import { toDateKey, type AnalyticsTransaction } from '@/lib/finance';

export type AnalysisPeriod = 'month' | 'last-month' | 'week' | 'all' | 'custom';

export type AnalyticsFilters = {
  account: string;
  typeId: string;
  category: string;
  kind: 'all' | AnalyticsTransaction['kind'];
  source: 'all' | AnalyticsTransaction['source'];
};

export type TransactionAnalysisFilters = AnalyticsFilters & {
  from: string;
  to: string;
  minAmount: string;
  maxAmount: string;
  search: string;
};

export const emptyAnalyticsFilters: AnalyticsFilters = { account: '', typeId: '', category: '', kind: 'all', source: 'all' };
const analyticsFilterKeys = ['account', 'typeId', 'category', 'kind', 'source'] as const;
export const analyticsClassifications = { income: 'Income', expense: 'Expense', transfer: 'Transfer', savings: 'Savings' } as const;
export const analyticsSources = { manual: 'Manual', scheduled: 'Scheduled', investment: 'Investments', savings: 'Savings' } as const;

export const emptyTransactionAnalysisFilters: TransactionAnalysisFilters = {
  ...emptyAnalyticsFilters,
  from: '',
  to: '',
  minAmount: '',
  maxAmount: '',
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

const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);

export function transactionAnalysisOptions(transactions: AnalyticsTransaction[]) {
  const categories = new Map<string, string>();
  const accounts = new Map<string, string>();
  for (const transaction of transactions) {
    const { categoryId, categoryName, accountId, accountName, toAccountId, toAccountName } = transaction;
    categories.set(categoryId ?? 'uncategorised', categoryName || 'Uncategorised');
    accounts.set(accountId, accountName);
    if (toAccountId && toAccountName) accounts.set(toAccountId, toAccountName);
  }
  return { categories: [...categories].sort(byName), accounts: [...accounts].sort(byName) };
}

function matchesAnalyticsFilter(transaction: AnalyticsTransaction, key: keyof AnalyticsFilters, value: string): boolean {
  if (value === emptyAnalyticsFilters[key]) return true;
  switch (key) {
    case 'account': return transaction.accountId === value || transaction.toAccountId === value;
    case 'typeId': return transaction.typeId === value;
    case 'category': return (transaction.categoryId ?? 'uncategorised') === value;
    case 'kind': return transaction.kind === value;
    case 'source': return transaction.source === value;
  }
}

export function reconcileAnalyticsFilters(transactions: AnalyticsTransaction[], selected: AnalyticsFilters): AnalyticsFilters {
  let matching = transactions;
  let filters = selected;
  // When the date range changes, retain compatible filters in the order they appear on screen.
  for (const key of analyticsFilterKeys) {
    if (selected[key] === emptyAnalyticsFilters[key]) continue;
    const narrowed = matching.filter((transaction) => matchesAnalyticsFilter(transaction, key, selected[key]));
    if (narrowed.length) matching = narrowed;
    else filters = { ...filters, [key]: emptyAnalyticsFilters[key] };
  }
  return filters;
}

export function analyticsFilterOptions(transactions: AnalyticsTransaction[], filters: AnalyticsFilters) {
  const choices = (field: keyof AnalyticsFilters) => transactions.filter((transaction) =>
    analyticsFilterKeys.every((key) => key === field || matchesAnalyticsFilter(transaction, key, filters[key])));
  const types = new Map(choices('typeId').map((transaction) => [transaction.typeId, transaction.typeName]));
  const kinds = new Set(choices('kind').map((transaction) => transaction.kind));
  const sources = new Set(choices('source').map((transaction) => transaction.source));
  return {
    account: transactionAnalysisOptions(choices('account')).accounts,
    category: transactionAnalysisOptions(choices('category')).categories,
    typeId: [...types].sort(byName),
    kind: Object.entries(analyticsClassifications).filter(([kind]) => kinds.has(kind as AnalyticsTransaction['kind'])),
    source: Object.entries(analyticsSources).filter(([source]) => sources.has(source as AnalyticsTransaction['source'])),
  };
}

export function analyzeTransactions<Entry extends AnalyticsTransaction>(transactions: Entry[], filters: TransactionAnalysisFilters) {
  const min = filters.minAmount === '' ? 0 : Number(filters.minAmount);
  const max = filters.maxAmount === '' ? Infinity : Number(filters.maxAmount);
  const query = filters.search.trim().toLocaleLowerCase();
  const matches: Entry[] = [];
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
      if (!analyticsFilterKeys.every((key) => matchesAnalyticsFilter(transaction, key, filters[key]))) continue;
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
