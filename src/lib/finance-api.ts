import {
  type Account,
  type ActivityAction,
  type ActivityEvent,
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
};
type InvestmentTypeRow = { id: string; name: string };
type ActivityRow = {
  id: string;
  entity_table: ActivityEvent['entityTable'];
  entity_id: string;
  entity_name: string;
  action: ActivityAction;
  created_at: string;
  details: Record<string, unknown> | null;
};

type PostgrestError = { code?: string; message: string };

function failWith(error: PostgrestError): never {
  if (error.code === '23505') throw new Error('That name is already in use.');
  if (error.code === '23503') {
    throw new Error('This item is used by existing transactions, so it can only be deactivated or deleted.');
  }
  throw new Error(error.message);
}

function statusOf(row: StatusRow) {
  return { isActive: row.is_active, deletedAt: row.deleted_at };
}

export async function loadFinanceData(): Promise<FinanceData> {
  const [typeResult, categoryResult, linkResult, accountResult, transactionResult, budgetResult, recurringResult, investmentResult, investmentTypeResult] = await Promise.all([
    supabase
      .from('transaction_types')
      .select('id, name, kind, is_active, deleted_at')
      .order('created_at', { ascending: true }),
    supabase
      .from('categories')
      .select('id, name, emoji, parent_id, is_active, deleted_at')
      .order('created_at', { ascending: true }),
    supabase.from('category_transaction_types').select('category_id, transaction_type_id'),
    supabase
      .from('accounts')
      .select('id, name, description, opening_balance, opening_balance_date, is_liability, is_active, deleted_at')
      .order('created_at', { ascending: true }),
    supabase
      .from('transactions')
      .select(
        'id, name, transaction_type_id, transaction_type_name, transaction_kind, category_id, category_name, amount, transaction_date, transaction_time, account_id, account_name, to_account_id, to_account_name, recurring_entry_id, investment_id, transaction_source',
      )
      .order('transaction_date', { ascending: false }),
    supabase.from('budgets').select('id, category_id, amount').order('created_at', { ascending: true }),
    supabase
      .from('recurring_entries')
      .select('id, name, transaction_type_id, category_id, amount, account_id, to_account_id, frequency, interval_value, interval_unit, next_date, end_date, month_day, is_active')
      .order('next_date', { ascending: true }),
    supabase
      .from('investments')
      .select('id, name, investment_type, investment_type_id, notes, funding_account_id, capital_account_id, principal_amount, invested_on, status, final_amount, profit_amount, settled_on, accounting_mode')
      .order('invested_on', { ascending: false }),
    supabase.from('investment_types').select('id, name').order('name', { ascending: true }),
  ]);

  for (const result of [typeResult, categoryResult, linkResult, accountResult, transactionResult, budgetResult, recurringResult, investmentResult, investmentTypeResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const typeRows = (typeResult.data ?? []) as TransactionTypeRow[];
  const categoryRows = (categoryResult.data ?? []) as CategoryRow[];
  const linkRows = (linkResult.data ?? []) as CategoryLinkRow[];
  const accountRows = (accountResult.data ?? []) as AccountRow[];
  const transactionRows = (transactionResult.data ?? []) as TransactionRow[];
  const budgetRows = (budgetResult.data ?? []) as BudgetRow[];
  const recurringRows = (recurringResult.data ?? []) as RecurringEntryRow[];
  const investmentRows = (investmentResult.data ?? []) as InvestmentRow[];
  const investmentTypeRows = (investmentTypeResult.data ?? []) as InvestmentTypeRow[];

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

  const accounts: Account[] = accountRows.map((row) => ({
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

  const investments: Investment[] = investmentRows.map((row) => ({
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
  }));
  const investmentTypes: InvestmentType[] = investmentTypeRows.map((row) => ({ id: row.id, name: row.name }));

  return { transactionTypes, categories, accounts, transactions, budgets, recurringEntries, investments, investmentTypes };
}

export async function insertTransactionType(input: { name: string; kind: TransactionKind }): Promise<string> {
  const { data, error } = await supabase
    .from('transaction_types')
    .insert({ name: input.name, kind: input.kind })
    .select('id')
    .single();
  if (error) failWith(error);
  return (data as { id: string }).id;
}

async function replaceCategoryLinks(categoryId: string, transactionTypeIds: string[]): Promise<void> {
  const { error: clearError } = await supabase
    .from('category_transaction_types')
    .delete()
    .eq('category_id', categoryId);
  if (clearError) failWith(clearError);
  if (transactionTypeIds.length === 0) return;
  const { error: linkError } = await supabase
    .from('category_transaction_types')
    .insert(transactionTypeIds.map((typeId) => ({ category_id: categoryId, transaction_type_id: typeId })));
  if (linkError) failWith(linkError);
}

export async function insertCategory(input: {
  name: string;
  emoji: string | null;
  parentId: string | null;
  transactionTypeIds: string[];
}): Promise<string> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ name: input.name, emoji: input.emoji, parent_id: input.parentId })
    .select('id')
    .single();
  if (error) failWith(error);
  const categoryId = (data as { id: string }).id;
  await replaceCategoryLinks(categoryId, input.transactionTypeIds);
  return categoryId;
}

export async function updateCategory(
  id: string,
  input: { name: string; emoji: string | null; parentId: string | null; transactionTypeIds: string[] },
): Promise<void> {
  const { error } = await supabase
    .from('categories')
    .update({ name: input.name, emoji: input.emoji, parent_id: input.parentId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) failWith(error);
  await replaceCategoryLinks(id, input.transactionTypeIds);
}

export async function updateTransactionType(id: string, input: { name: string; kind: TransactionKind }): Promise<void> {
  const { error } = await supabase
    .from('transaction_types')
    .update({ name: input.name, kind: input.kind, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) failWith(error);
}

export async function updateAccount(id: string, input: { name: string; description: string }): Promise<void> {
  const { error } = await supabase
    .from('accounts')
    .update({ name: input.name, description: input.description || null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) failWith(error);
}

const statusPatch: Record<ItemState, { is_active: boolean; deleted_at: string | null }> = {
  active: { is_active: true, deleted_at: null },
  inactive: { is_active: false, deleted_at: null },
  deleted: { is_active: false, deleted_at: new Date().toISOString() },
};

export async function setItemState(table: ItemTable, id: string, state: ItemState): Promise<void> {
  const patch = { ...statusPatch[state], updated_at: new Date().toISOString() };
  const { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error) failWith(error);
}

export async function deleteItemPermanently(table: ItemTable, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) failWith(error);
}

export async function insertAccount(input: {
  name: string;
  description: string;
  openingBalance: number;
  openingBalanceDate: string;
  isLiability: boolean;
}): Promise<string> {
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name: input.name,
      description: input.description || null,
      opening_balance: input.openingBalance,
      opening_balance_date: input.openingBalanceDate,
      is_liability: input.isLiability,
    })
    .select('id')
    .single();
  if (error) failWith(error);
  return (data as { id: string }).id;
}

export async function insertTransaction(draft: TransactionDraft): Promise<void> {
  const { error } = await supabase.from('transactions').insert({
    name: draft.name,
    transaction_type_id: draft.typeId,
    category_id: draft.categoryId,
    amount: draft.amount,
    transaction_date: draft.date,
    transaction_time: draft.time,
    account_id: draft.accountId,
    to_account_id: draft.toAccountId,
  });
  if (error) failWith(error);
}

export async function updateTransaction(id: string, draft: TransactionDraft): Promise<void> {
  const { error } = await supabase
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
    .eq('id', id);
  if (error) failWith(error);
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

export async function upsertBudget(input: { categoryId: string; amount: number }): Promise<void> {
  const { error } = await supabase.from('budgets').upsert(
    {
      category_id: input.categoryId,
      amount: input.amount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'category_id' },
  );
  if (error) failWith(error);
}

export async function deleteBudget(id: string): Promise<void> {
  const { error } = await supabase.from('budgets').delete().eq('id', id);
  if (error) failWith(error);
}

export async function insertRecurringEntry(input: RecurringEntryDraft): Promise<string> {
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
    })
    .select('id')
    .single();
  if (error) failWith(error);
  return (data as { id: string }).id;
}

export async function updateRecurringEntry(id: string, input: RecurringEntryDraft): Promise<void> {
  const { error } = await supabase
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
    .eq('id', id);
  if (error) failWith(error);
}

export async function setRecurringEntryActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('recurring_entries')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) failWith(error);
}

export async function deleteRecurringEntry(id: string): Promise<void> {
  const { error } = await supabase.from('recurring_entries').delete().eq('id', id);
  if (error) failWith(error);
}

export async function processDueRecurringEntries(): Promise<number> {
  const { data, error } = await supabase.rpc('process_due_recurring_entries');
  if (error) failWith(error);
  return Number(data ?? 0);
}

export async function loadActivityEvents(input: {
  action?: ActivityAction | 'all';
  entity?: ActivityEvent['entityTable'] | 'all';
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}): Promise<{ events: ActivityEvent[]; hasMore: boolean }> {
  const start = Math.max(0, input.page * input.pageSize);
  const end = start + input.pageSize - 1;
  let query = supabase
    .from('audit_events')
    .select('id, entity_table, entity_id, entity_name, action, created_at, details', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(start, end);
  if (input.action && input.action !== 'all') query = query.eq('action', input.action);
  if (input.entity && input.entity !== 'all') query = query.eq('entity_table', input.entity);
  if (input.from) query = query.gte('created_at', `${input.from}T00:00:00`);
  if (input.to) query = query.lte('created_at', `${input.to}T23:59:59.999`);
  const { data, error, count } = await query;
  if (error) failWith(error);
  const events = ((data ?? []) as ActivityRow[]).map((row) => ({
    id: row.id,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    entityName: row.entity_name,
    action: row.action,
    createdAt: row.created_at,
    details: row.details ?? {},
  }));
  return { events, hasMore: (count ?? 0) > start + input.pageSize };
}
