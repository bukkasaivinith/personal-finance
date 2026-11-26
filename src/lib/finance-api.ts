import {
  type Account,
  type ActivityAction,
  type ActivityEvent,
  type AnalyticsTransaction,
  type Budget,
  type CategoryOption,
  type FinanceData,
  type ItemState,
  type Investment,
  type InvestmentDraft,
  type InvestmentType,
  type InvestmentStatus,
  type RecurringEntry,
  type RecurringEntryDraft,
  type RecurringFrequency,
  type RecurringIntervalUnit,
  type Transaction,
  type TransactionDraft,
  type TransactionKind,
  type TransactionTypeOption,
  isUsable,
} from '@/lib/finance';
import { supabase } from '@/lib/supabase';
import { publicApiError } from '@/lib/public-api-error';

export type ItemTable = 'transaction_types' | 'categories' | 'accounts';

type StatusRow = { id: string; is_active: boolean; deleted_at: string | null };
type TransactionTypeRow = StatusRow & { name: string; kind: TransactionKind };
type CategoryRow = StatusRow & { name: string; emoji: string | null; parent_id: string | null };
type CategoryLinkRow = { category_id: string; transaction_type_id: string };
type AccountRow = StatusRow & {
  name: string;
  description: string | null;
  opening_balance: number | string;
  opening_balance_date: string;
  is_liability: boolean;
};
type TransactionRow = {
  id: string;
  name: string;
  transaction_type_id: string;
  transaction_type_name: string;
  transaction_kind: TransactionKind;
  category_id: string | null;
  category_name: string | null;
  amount: number | string;
  transaction_date: string;
  transaction_time: string | null;
  account_id: string;
  account_name: string;
  to_account_id: string | null;
  to_account_name: string | null;
  recurring_entry_id: string | null;
  investment_id: string | null;
  transaction_source: 'manual' | 'scheduled' | 'investment';
  visible_transfer_direction?: 'in' | 'out' | null;
};
type BudgetRow = { id: string; category_id: string; amount: number | string };
type RecurringEntryRow = {
  id: string;
  name: string;
  transaction_type_id: string;
  category_id: string | null;
  amount: number | string;
  account_id: string;
  to_account_id: string | null;
  frequency: RecurringFrequency;
  interval_value: number;
  interval_unit: RecurringIntervalUnit;
  next_date: string;
  end_date: string | null;
  month_day: number | null;
  is_active: boolean;
};
type InvestmentRow = {
  id: string;
  name: string;
  investment_type: string;
  investment_type_id: string;
  notes: string | null;
  funding_account_id: string;
  capital_account_id: string;
  principal_amount: number | string;
  invested_on: string;
  status: InvestmentStatus;
  final_amount: number | string | null;
  profit_amount: number | string | null;
  settled_on: string | null;
  accounting_mode: 'capital_pool' | 'return_to_funding';
  current_estimated_value: number | string | null;
  value_updated_on: string | null;
  target_amount: number | string | null;
  maturity_date: string | null;
};
type InvestmentWithdrawalRow = { investment_id: string; amount_received: number | string; capital_return: number | string; profit_amount: number | string };
type InvestmentTypeRow = { id: string; name: string };
type ActivityRow = {
  id: string;
  entity_table: ActivityEvent['entityTable'];
  entity_id: string;
  entity_name: string;
  action: ActivityAction;
  created_at: string;
  details: Record<string, unknown> | null;
  actor_email?: string;
};

type PostgrestError = { code?: string; message: string };

function failWith(error: PostgrestError): never {
  if (error.code === '23505') throw new Error('That name is already in use.');
  if (error.code === '23503') {
    throw new Error('This item is used by existing transactions, so it can only be deactivated or deleted.');
  }
  throw publicApiError(error, 'Could not complete the finance request. Please try again.');
}

function requireWrittenRecord({ data, error }: { data: { id: string } | null; error: PostgrestError | null }): void {
  if (error) failWith(error);
  if (!data) throw new Error('This record is no longer available. Refresh the page and try again.');
}

function statusOf(row: StatusRow) {
  return { isActive: row.is_active, deletedAt: row.deleted_at };
}

export type FinanceScope = 'forms' | 'ledger' | 'analytics' | 'recurring' | 'investments' | 'audit' | 'setup';

const pageSize = 1000;

async function loadWorkspaceTransactions(workspaceOwnerId: string, signal?: AbortSignal, scheduledOnly = false, lookup?: Pick<ActivityEvent, 'entityTable' | 'entityId'>): Promise<TransactionRow[]> {
  const rows: TransactionRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    let request = supabase.rpc('get_finance_transaction_page', {
      p_owner_id: workspaceOwnerId, p_limit: pageSize, p_after_id: cursor ?? null, p_scheduled_only: scheduledOnly,
      p_transaction_id: lookup?.entityTable === 'transactions' ? lookup.entityId : null,
      p_recurring_entry_id: lookup?.entityTable === 'recurring_entries' ? lookup.entityId : null,
    }).order('id');
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) failWith(error);
    const batch = (data ?? []) as TransactionRow[];
    if (!batch.length) return rows;
    rows.push(...batch);
    if (lookup?.entityTable === 'transactions') return rows;
    cursor = batch[batch.length - 1].id;
  }
}

export async function hasWorkspaceTransactions(ownerId: string, signal: AbortSignal): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_finance_transaction_page', { p_owner_id: ownerId, p_limit: 1 }).select('id').abortSignal(signal);
  if (error) failWith(error);
  return Boolean(data?.length);
}

async function loadTransactionUsage(ownerId: string, signal?: AbortSignal): Promise<FinanceData['transactionUsage']> {
  const request = supabase.rpc('get_finance_transaction_usage', { p_owner_id: ownerId });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) failWith(error);
  return data as FinanceData['transactionUsage'];
}

type RowPage = PromiseLike<{ data: unknown[] | null; error: PostgrestError | null; count?: number | null }> & {
  range(from: number, to: number): RowPage;
  abortSignal(signal: AbortSignal): RowPage;
};

async function readRows(enabled: boolean, request: RowPage, signal?: AbortSignal): Promise<unknown[]> {
  if (!enabled) return [];
  const rows: unknown[] = [];
  if (signal) request = request.abortSignal(signal);
  for (;;) {
    const { data, error, count } = await request.range(rows.length, rows.length + pageSize - 1);
    if (error) failWith(error);
    if (!data?.length) return rows;
    rows.push(...data);
    if (count != null && rows.length >= count) return rows;
  }
}

type SavingsOpeningRow = { id: string; name: string; amount: number; saved_on: string };
type SavingsMovementRow = {
  id: string;
  savings_entry_id: string;
  direction: 'deposit' | 'withdrawal';
  amount: number;
  note: string;
  recorded_at: string;
  savings_entries: { name: string };
};

const savingsActivityLabels = { opening: 'Savings opening balance', deposit: 'Savings deposit', withdrawal: 'Savings withdrawal' };
const savingsActivityDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata' });
const savingsActivityTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', timeStyle: 'medium' });

async function loadAnalyticsSavingsActivity(ownerId: string, signal?: AbortSignal): Promise<AnalyticsTransaction[]> {
  const [openings, movements] = await Promise.all([
    readRows(true, supabase.from('savings_entries').select('id, name, amount, saved_on', { count: 'exact' })
      .eq('user_id', ownerId).order('id'), signal) as Promise<SavingsOpeningRow[]>,
    readRows(true, supabase.from('savings_movements')
      .select('id, savings_entry_id, direction, amount, note, recorded_at, savings_entries!inner(name)', { count: 'exact' })
      .eq('user_id', ownerId).order('id'), signal) as Promise<SavingsMovementRow[]>,
  ]);

  function entry(id: string, account: Pick<SavingsOpeningRow, 'id' | 'name'>, activity: keyof typeof savingsActivityLabels,
    amount: number, date: string, time: string | null, note = ''): AnalyticsTransaction {
    const typeName = savingsActivityLabels[activity];
    return {
      id: `savings-${activity}:${id}`,
      name: [typeName, note].filter(Boolean).join(' · '),
      typeId: `savings:${activity}`, typeName, categoryId: 'savings', categoryName: 'Savings',
      kind: 'savings', source: 'savings', savingsActivity: activity,
      amount: Number(amount), date, time, accountId: `savings:${account.id}`, accountName: `${account.name} (Savings)`,
      toAccountId: null, toAccountName: null,
    };
  }

  return [
    ...openings.map((opening) => entry(opening.id, opening, 'opening', opening.amount, opening.saved_on, null)),
    ...movements.map((movement) => {
      const recorded = new Date(movement.recorded_at);
      return entry(movement.id, { id: movement.savings_entry_id, name: movement.savings_entries.name }, movement.direction,
        movement.amount, savingsActivityDate.format(recorded), savingsActivityTime.format(recorded), movement.note);
    }),
  ];
}

type LegacyIpoLinks = {
  accounts?: { id: string; custody: string | null }[];
  investments?: { id: string }[];
};

async function loadLegacyIpoLinks(workspaceOwnerId: string, signal?: AbortSignal): Promise<LegacyIpoLinks> {
  // Keep former custody accounts and managed holdings out of the regular finance screens.
  const request = supabase.rpc('ipo_finance_links', { p_owner_id: workspaceOwnerId });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error?.code === 'PGRST202') return {};
  if (error) failWith(error);
  return (data ?? {}) as LegacyIpoLinks;
}

export async function loadFinanceData(workspaceOwnerId: string, scope: FinanceScope, signal?: AbortSignal, lookup?: Pick<ActivityEvent, 'entityTable' | 'entityId'>): Promise<FinanceData> {
  const recordId = (table: ActivityEvent['entityTable']) => scope === 'audit' && lookup?.entityTable === table ? lookup.entityId : null;
  const investmentId = recordId('investments');
  const investmentTypeId = recordId('investment_types');
  const recurringId = recordId('recurring_entries');
  const budgetId = recordId('budgets');
  const budgetsQuery = supabase.from('budgets').select('id, category_id, amount', { count: 'exact' })
    .eq('user_id', workspaceOwnerId).order('created_at').order('id');
  const recurringQuery = supabase.from('recurring_entries')
    .select('id, name, transaction_type_id, category_id, amount, account_id, to_account_id, frequency, interval_value, interval_unit, next_date, end_date, month_day, is_active', { count: 'exact' })
    .eq('user_id', workspaceOwnerId).order('next_date').order('id');
  const investmentsQuery = supabase.from('investments')
    .select('id, name, investment_type, investment_type_id, notes, funding_account_id, capital_account_id, principal_amount, invested_on, status, final_amount, profit_amount, settled_on, accounting_mode, current_estimated_value, value_updated_on, target_amount, maturity_date', { count: 'exact' })
    .eq('user_id', workspaceOwnerId).order('invested_on', { ascending: false }).order('id');
  const investmentTypesQuery = supabase.from('investment_types').select('id, name', { count: 'exact' })
    .eq('user_id', workspaceOwnerId).order('name').order('id');
  const withdrawalsQuery = supabase.from('investment_withdrawals').select('investment_id, amount_received, capital_return, profit_amount', { count: 'exact' })
    .eq('user_id', workspaceOwnerId).order('id');
  if (budgetId) budgetsQuery.eq('id', budgetId);
  if (recurringId) recurringQuery.eq('id', recurringId);
  if (investmentId) {
    investmentsQuery.eq('id', investmentId);
    withdrawalsQuery.eq('investment_id', investmentId);
  }
  if (investmentTypeId) investmentTypesQuery.eq('id', investmentTypeId);
  const [typeResult, categoryResult, linkResult, accountResult, transactionRows, budgetResult, recurringResult, investmentResult,
    investmentTypeResult, withdrawalResult, ipoLinks, transactionUsage, savingsActivity] = await Promise.all([
    readRows(true, supabase.from('transaction_types').select('id, name, kind, is_active, deleted_at', { count: 'exact' })
      .eq('user_id', workspaceOwnerId).order('created_at').order('id'), signal),
    readRows(true, supabase.from('categories').select('id, name, emoji, parent_id, is_active, deleted_at', { count: 'exact' })
      .eq('user_id', workspaceOwnerId).order('created_at').order('id'), signal),
    readRows(true, supabase.from('category_transaction_types').select('category_id, transaction_type_id', { count: 'exact' })
      .eq('user_id', workspaceOwnerId).order('category_id').order('transaction_type_id'), signal),
    readRows(true, supabase.from('accounts').select('id, name, description, opening_balance, opening_balance_date, is_liability, is_active, deleted_at', { count: 'exact' })
      .eq('user_id', workspaceOwnerId).order('created_at').order('id'), signal),
    scope === 'ledger' || scope === 'analytics' || scope === 'recurring' || recurringId || recordId('transactions')
      ? loadWorkspaceTransactions(workspaceOwnerId, signal, scope === 'recurring' || Boolean(recurringId), lookup)
      : [],
    readRows(Boolean(budgetId), budgetsQuery, signal),
    readRows(scope === 'recurring' || Boolean(recurringId), recurringQuery, signal),
    readRows(scope === 'investments' || Boolean(investmentId), investmentsQuery, signal),
    readRows(scope === 'investments' || Boolean(investmentTypeId), investmentTypesQuery, signal),
    readRows(scope === 'investments' || Boolean(investmentId), withdrawalsQuery, signal),
    loadLegacyIpoLinks(workspaceOwnerId, signal),
    scope === 'setup' ? loadTransactionUsage(workspaceOwnerId, signal) : undefined,
    scope === 'analytics' ? loadAnalyticsSavingsActivity(workspaceOwnerId, signal) : undefined,
  ]);

  const typeRows = typeResult as TransactionTypeRow[];
  const categoryRows = categoryResult as CategoryRow[];
  const linkRows = linkResult as CategoryLinkRow[];
  const accountRows = accountResult as AccountRow[];
  const budgetRows = budgetResult as BudgetRow[];
  const recurringRows = recurringResult as RecurringEntryRow[];
  const investmentRows = investmentResult as InvestmentRow[];
  const investmentTypeRows = investmentTypeResult as InvestmentTypeRow[];
  const withdrawalRows = withdrawalResult as InvestmentWithdrawalRow[];

  const transactionTypes: TransactionTypeOption[] = typeRows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    ...statusOf(row),
  }));

  const categories: CategoryOption[] = categoryRows.map((row) => ({
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    parentId: row.parent_id,
    transactionTypeIds: linkRows
      .filter((link) => link.category_id === row.id)
      .map((link) => link.transaction_type_id),
    ...statusOf(row),
  }));

  const custodyByAccount = new Map(ipoLinks.accounts?.map((link) => [link.id, link.custody]));
  const accounts: Account[] = accountRows.map((row) => ({
    ipoCustody: custodyByAccount.get(row.id),
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    openingBalance: Number(row.opening_balance),
    openingBalanceDate: row.opening_balance_date,
    isLiability: row.is_liability,
    ...statusOf(row),
  }));

  const typeById = new Map(transactionTypes.map((option) => [option.id, option]));
  const categoryById = new Map(categories.map((option) => [option.id, option]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const archived = (item: { isActive: boolean; deletedAt: string | null } | undefined) =>
    !item || !isUsable(item);

  const transactions: Transaction[] = transactionRows.map((row) => {
    const transactionType = typeById.get(row.transaction_type_id);
    const category = row.category_id === null ? undefined : categoryById.get(row.category_id);
    const account = accountById.get(row.account_id);
    const destinationAccount = row.to_account_id === null ? undefined : accountById.get(row.to_account_id);
    return {
      id: row.id,
      name: row.name,
      typeId: row.transaction_type_id,
      typeName: transactionType?.name ?? row.transaction_type_name,
      typeArchived: archived(transactionType),
      kind: transactionType?.kind ?? row.transaction_kind,
      categoryId: row.category_id,
      categoryName: row.category_id === null ? null : category?.name ?? row.category_name,
      categoryEmoji: category?.emoji ?? null,
      categoryArchived: row.category_id !== null && archived(category),
      amount: Number(row.amount),
      date: row.transaction_date,
      time: row.transaction_time,
      accountId: row.account_id,
      accountName: account?.name ?? row.account_name,
      accountArchived: archived(account),
      toAccountId: row.to_account_id,
      toAccountName: row.to_account_id === null ? null : destinationAccount?.name ?? row.to_account_name,
      toAccountArchived: row.to_account_id !== null && archived(destinationAccount),
      recurringEntryId: row.recurring_entry_id,
      investmentId: row.investment_id,
      source: row.transaction_source ?? 'manual',
      transferDirection: row.visible_transfer_direction ?? null,
    };
  });

  const budgets: Budget[] = budgetRows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    amount: Number(row.amount),
  }));

  const lastProcessedByEntry = new Map<string, string>();
  for (const transaction of transactions) {
    if (transaction.recurringEntryId && transaction.source === 'scheduled') {
      const current = lastProcessedByEntry.get(transaction.recurringEntryId);
      if (!current || transaction.date > current) lastProcessedByEntry.set(transaction.recurringEntryId, transaction.date);
    }
  }

  const recurringEntries: RecurringEntry[] = recurringRows.map((row) => ({
    id: row.id,
    name: row.name,
    typeId: row.transaction_type_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    frequency: row.frequency,
    intervalValue: row.interval_value,
    intervalUnit: row.interval_unit,
    nextDate: row.next_date,
    endDate: row.end_date,
    monthDay: row.month_day,
    isActive: row.is_active,
    lastProcessedDate: lastProcessedByEntry.get(row.id) ?? null,
  }));

  const withdrawalsByInvestment = new Map<string, { capital: number; profit: number; total: number }>();
  withdrawalRows.forEach((row) => {
    const current = withdrawalsByInvestment.get(row.investment_id) ?? { capital: 0, profit: 0, total: 0 };
    current.capital += Number(row.capital_return); current.profit += Number(row.profit_amount); current.total += Number(row.amount_received);
    withdrawalsByInvestment.set(row.investment_id, current);
  });
  const legacyInvestmentIds = new Set(ipoLinks.investments?.map((link) => link.id));
  const regularInvestmentRows = investmentRows.filter((row) => !legacyInvestmentIds.has(row.id));
  const investments: Investment[] = regularInvestmentRows.map((row) => ({
    id: row.id,
    name: row.name,
    investmentType: row.investment_type,
    investmentTypeId: row.investment_type_id,
    notes: row.notes ?? '',
    fundingAccountId: row.funding_account_id,
    capitalAccountId: row.capital_account_id,
    principalAmount: Number(row.principal_amount),
    investedOn: row.invested_on,
    status: row.status,
    finalAmount: row.final_amount === null ? null : Number(row.final_amount),
    profitAmount: row.profit_amount === null ? null : Number(row.profit_amount),
    settledOn: row.settled_on,
    accountingMode: row.accounting_mode,
    currentEstimatedValue: row.current_estimated_value === null ? null : Number(row.current_estimated_value),
    valueUpdatedOn: row.value_updated_on,
    targetAmount: row.target_amount === null ? null : Number(row.target_amount),
    maturityDate: row.maturity_date,
    withdrawnCapital: withdrawalsByInvestment.get(row.id)?.capital ?? 0,
    withdrawnProfit: withdrawalsByInvestment.get(row.id)?.profit ?? 0,
    withdrawnTotal: withdrawalsByInvestment.get(row.id)?.total ?? 0,
  }));
  const legacyInvestmentTypeIds = new Set(investmentRows.filter((row) => legacyInvestmentIds.has(row.id)).map((row) => row.investment_type_id));
  const regularInvestmentTypeIds = new Set(regularInvestmentRows.map((row) => row.investment_type_id));
  const investmentTypes: InvestmentType[] = investmentTypeRows
    .filter((row) => !legacyInvestmentTypeIds.has(row.id) || regularInvestmentTypeIds.has(row.id))
    .map((row) => ({ id: row.id, name: row.name }));

  const analyticsTransactions = savingsActivity && [...transactions, ...savingsActivity];
  return { transactionTypes, categories, accounts, transactions, budgets, recurringEntries, investments, investmentTypes, transactionUsage, analyticsTransactions };
}

export async function insertTransactionType(input: { name: string; kind: TransactionKind }, workspaceOwnerId: string): Promise<string> {
  const { data, error } = await supabase
    .from('transaction_types')
    .insert({ name: input.name, kind: input.kind, user_id: workspaceOwnerId })
    .select('id')
    .single();
  if (error) failWith(error);
  return (data as { id: string }).id;
}

async function replaceCategoryLinks(categoryId: string, transactionTypeIds: string[], workspaceOwnerId: string): Promise<void> {
  const { error: clearError } = await supabase
    .from('category_transaction_types')
    .delete()
    .eq('category_id', categoryId);
  if (clearError) failWith(clearError);
  if (transactionTypeIds.length === 0) return;
  const { error: linkError } = await supabase
    .from('category_transaction_types')
    .insert(transactionTypeIds.map((typeId) => ({ category_id: categoryId, transaction_type_id: typeId, user_id: workspaceOwnerId })));
  if (linkError) failWith(linkError);
}

export async function insertCategory(input: {
  name: string;
  emoji: string | null;
  parentId: string | null;
  transactionTypeIds: string[];
}, workspaceOwnerId: string): Promise<string> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ name: input.name, emoji: input.emoji, parent_id: input.parentId, user_id: workspaceOwnerId })
    .select('id')
    .single();
  if (error) failWith(error);
  const categoryId = (data as { id: string }).id;
  await replaceCategoryLinks(categoryId, input.transactionTypeIds, workspaceOwnerId);
  return categoryId;
}

export async function updateCategory(
  id: string,
  input: { name: string; emoji: string | null; parentId: string | null; transactionTypeIds: string[] },
): Promise<void> {
  const { error } = await supabase.rpc('update_finance_category', {
    p_category_id: id,
    p_name: input.name,
    p_emoji: input.emoji,
    p_parent_id: input.parentId,
    p_transaction_type_ids: input.transactionTypeIds,
  });
  if (error) failWith(error);
}

export async function updateTransactionType(id: string, input: { name: string; kind: TransactionKind }): Promise<void> {
  const result = await supabase
    .from('transaction_types')
    .update({ name: input.name, kind: input.kind, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  requireWrittenRecord(result);
}

export async function updateAccount(id: string, input: { name: string; description: string }): Promise<void> {
  const result = await supabase
    .from('accounts')
    .update({ name: input.name, description: input.description || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  requireWrittenRecord(result);
}

const statusPatch: Record<ItemState, { is_active: boolean; deleted_at: string | null }> = {
  active: { is_active: true, deleted_at: null },
  inactive: { is_active: false, deleted_at: null },
  deleted: { is_active: false, deleted_at: new Date().toISOString() },
};

export async function setItemState(table: ItemTable, id: string, state: ItemState): Promise<void> {
  const patch = { ...statusPatch[state], updated_at: new Date().toISOString() };
  const result = await supabase.from(table).update(patch).eq('id', id).select('id').maybeSingle();
  requireWrittenRecord(result);
}

export async function deleteItemPermanently(table: ItemTable, id: string): Promise<void> {
  const result = await supabase.from(table).delete().eq('id', id).select('id').maybeSingle();
  requireWrittenRecord(result);
}

export async function insertAccount(input: {
  name: string;
  description: string;
  openingBalance: number;
  openingBalanceDate: string;
  isLiability: boolean;
}, workspaceOwnerId: string): Promise<string> {
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name: input.name,
      description: input.description || null,
      opening_balance: input.openingBalance,
      opening_balance_date: input.openingBalanceDate,
      is_liability: input.isLiability,
      user_id: workspaceOwnerId,
    })
    .select('id')
    .single();
  if (error) failWith(error);
  return (data as { id: string }).id;
}

export async function insertTransaction(draft: TransactionDraft, workspaceOwnerId: string): Promise<void> {
  const { error } = await supabase.from('transactions').insert({
    name: draft.name,
    transaction_type_id: draft.typeId,
    category_id: draft.categoryId,
    amount: draft.amount,
    transaction_date: draft.date,
    transaction_time: draft.time,
    account_id: draft.accountId,
    to_account_id: draft.toAccountId,
    user_id: workspaceOwnerId,
  });
  if (error) failWith(error);
}

export async function updateTransaction(id: string, draft: TransactionDraft): Promise<void> {
  const result = await supabase
    .from('transactions')
    .update({
      name: draft.name,
      transaction_type_id: draft.typeId,
      category_id: draft.categoryId,
      amount: draft.amount,
      transaction_date: draft.date,
      transaction_time: draft.time,
      account_id: draft.accountId,
      to_account_id: draft.toAccountId,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  requireWrittenRecord(result);
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_transaction', { p_transaction_id: id });
  if (error) failWith(error);
}

export async function createInvestmentType(input: { name: string }): Promise<string> {
  const { data, error } = await supabase.rpc('create_investment_type', { p_name: input.name });
  if (error) failWith(error);
  return String(data);
}

export async function updateInvestmentType(id: string, input: { name: string }): Promise<void> {
  const { error } = await supabase.rpc('rename_investment_type', { p_investment_type_id: id, p_name: input.name });
  if (error) failWith(error);
}

export async function deleteInvestmentType(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_investment_type', { p_investment_type_id: id });
  if (error) failWith(error);
}

export async function createInvestment(input: InvestmentDraft): Promise<string> {
  const { data, error } = await supabase.rpc('record_investment', {
    p_name: input.name,
    p_investment_type_id: input.investmentTypeId,
    p_notes: input.notes || null,
    p_funding_account_id: input.fundingAccountId,
    p_principal_amount: input.principalAmount,
    p_invested_on: input.investedOn,
  });
  if (error) failWith(error);
  return String(data);
}

export async function updateInvestment(id: string, input: InvestmentDraft): Promise<void> {
  const { error } = await supabase.rpc('update_investment', {
    p_investment_id: id,
    p_name: input.name,
    p_investment_type_id: input.investmentTypeId,
    p_notes: input.notes || null,
    p_funding_account_id: input.fundingAccountId,
    p_principal_amount: input.principalAmount,
    p_invested_on: input.investedOn,
  });
  if (error) failWith(error);
}

export async function deleteInvestment(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_investment', { p_investment_id: id });
  if (error) failWith(error);
}

export async function settleInvestment(input: { id: string; finalAmount: number; settledOn: string }): Promise<void> {
  const { error } = await supabase.rpc('settle_investment', {
    p_investment_id: input.id,
    p_final_amount: input.finalAmount,
    p_settled_on: input.settledOn,
  });
  if (error) failWith(error);
}

export async function updateInvestmentTracking(input: { id: string; currentEstimatedValue: number; valuedOn: string; targetAmount: number | null; maturityDate: string | null }): Promise<void> {
  const { error } = await supabase.rpc('update_investment_tracking', {
    p_investment_id: input.id,
    p_current_estimated_value: input.currentEstimatedValue,
    p_valued_on: input.valuedOn,
    p_target_amount: input.targetAmount,
    p_maturity_date: input.maturityDate,
  });
  if (error) failWith(error);
}

export async function recordInvestmentWithdrawal(input: { id: string; amountReceived: number; withdrawnOn: string }): Promise<void> {
  const { error } = await supabase.rpc('record_investment_withdrawal', { p_investment_id: input.id, p_amount_received: input.amountReceived, p_withdrawn_on: input.withdrawnOn });
  if (error) failWith(error);
}

export async function insertRecurringEntry(input: RecurringEntryDraft, workspaceOwnerId: string): Promise<string> {
  const { data, error } = await supabase
    .from('recurring_entries')
    .insert({
      name: input.name,
      transaction_type_id: input.typeId,
      category_id: input.categoryId,
      amount: input.amount,
      account_id: input.accountId,
      to_account_id: input.toAccountId,
      frequency: input.frequency,
      interval_value: input.intervalValue,
      interval_unit: input.intervalUnit,
      next_date: input.nextDate,
      end_date: input.endDate,
      month_day: input.monthDay,
      user_id: workspaceOwnerId,
    })
    .select('id')
    .single();
  if (error) failWith(error);
  return (data as { id: string }).id;
}

export async function updateRecurringEntry(id: string, input: RecurringEntryDraft): Promise<void> {
  const result = await supabase
    .from('recurring_entries')
    .update({
      name: input.name,
      transaction_type_id: input.typeId,
      category_id: input.categoryId,
      amount: input.amount,
      account_id: input.accountId,
      to_account_id: input.toAccountId,
      frequency: input.frequency,
      interval_value: input.intervalValue,
      interval_unit: input.intervalUnit,
      next_date: input.nextDate,
      end_date: input.endDate,
      month_day: input.monthDay,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  requireWrittenRecord(result);
}

export async function setRecurringEntryActive(id: string, isActive: boolean): Promise<void> {
  const result = await supabase
    .from('recurring_entries')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  requireWrittenRecord(result);
}

export async function deleteRecurringEntry(id: string): Promise<void> {
  const result = await supabase.from('recurring_entries').delete().eq('id', id).select('id').maybeSingle();
  requireWrittenRecord(result);
}

export async function processDueRecurringEntries(): Promise<number> {
  const { data, error } = await supabase.rpc('process_due_recurring_entries');
  if (error) failWith(error);
  return Number(data ?? 0);
}

export async function loadActivityEvents(input: {
  workspaceOwnerId: string;
  action?: ActivityAction | 'all';
  entity?: ActivityEvent['entityTable'] | 'all';
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}): Promise<{ events: ActivityEvent[]; hasMore: boolean }> {
  const start = Math.max(0, input.page * input.pageSize);
  const { data, error } = await supabase.rpc('get_workspace_activity', {
    p_owner_id: input.workspaceOwnerId,
    p_action: input.action && input.action !== 'all' ? input.action : null,
    p_entity: input.entity && input.entity !== 'all' ? input.entity : null,
    p_from: input.from ? `${input.from}T00:00:00` : null,
    p_to: input.to ? `${input.to}T23:59:59.999` : null,
    p_limit: input.pageSize,
    p_offset: start,
  });
  if (error) failWith(error);
  const response = (data ?? {}) as { events?: ActivityRow[]; count?: number | string };
  const events = (response.events ?? []).map((row) => ({
    id: row.id,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    entityName: row.entity_name,
    action: row.action,
    createdAt: row.created_at,
    details: row.details ?? {},
    actorEmail: row.actor_email,
  }));
  return { events, hasMore: Number(response.count ?? 0) > start + input.pageSize };
}
