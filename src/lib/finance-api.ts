import {
  type Account,
  type Budget,
  type CategoryOption,
  type FinanceData,
  type ItemState,
  type RecurringEntry,
  type RecurringEntryDraft,
  type RecurringFrequency,
  type Transaction,
  type TransactionDraft,
  type TransactionKind,
  type TransactionTypeOption,
  isUsable,
  toDateKey,
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
  account_id: string;
  account_name: string;
  to_account_id: string | null;
  to_account_name: string | null;
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
  next_date: string;
  is_active: boolean;
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
  const [typeResult, categoryResult, linkResult, accountResult, transactionResult, budgetResult, recurringResult] = await Promise.all([
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
        'id, name, transaction_type_id, transaction_type_name, transaction_kind, category_id, category_name, amount, transaction_date, account_id, account_name, to_account_id, to_account_name',
      )
      .order('transaction_date', { ascending: false }),
    supabase.from('budgets').select('id, category_id, amount').order('created_at', { ascending: true }),
    supabase
      .from('recurring_entries')
      .select('id, name, transaction_type_id, category_id, amount, account_id, to_account_id, frequency, next_date, is_active')
      .order('next_date', { ascending: true }),
  ]);

  for (const result of [typeResult, categoryResult, linkResult, accountResult, transactionResult, budgetResult, recurringResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const typeRows = (typeResult.data ?? []) as TransactionTypeRow[];
  const categoryRows = (categoryResult.data ?? []) as CategoryRow[];
  const linkRows = (linkResult.data ?? []) as CategoryLinkRow[];
  const accountRows = (accountResult.data ?? []) as AccountRow[];
  const transactionRows = (transactionResult.data ?? []) as TransactionRow[];
  const budgetRows = (budgetResult.data ?? []) as BudgetRow[];
  const recurringRows = (recurringResult.data ?? []) as RecurringEntryRow[];

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
      accountId: row.account_id,
      accountName: account?.name ?? row.account_name,
      accountArchived: archived(account),
      toAccountId: row.to_account_id,
      toAccountName: row.to_account_id === null ? null : destinationAccount?.name ?? row.to_account_name,
      toAccountArchived: row.to_account_id !== null && archived(destinationAccount),
    };
  });

  const budgets: Budget[] = budgetRows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    amount: Number(row.amount),
  }));

  const recurringEntries: RecurringEntry[] = recurringRows.map((row) => ({
    id: row.id,
    name: row.name,
    typeId: row.transaction_type_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    frequency: row.frequency,
    nextDate: row.next_date,
    isActive: row.is_active,
  }));

  return { transactionTypes, categories, accounts, transactions, budgets, recurringEntries };
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
    account_id: draft.accountId,
    to_account_id: draft.toAccountId,
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
      next_date: input.nextDate,
    })
    .select('id')
    .single();
  if (error) failWith(error);
  return (data as { id: string }).id;
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

function nextRecurringDate(dateKey: string, frequency: RecurringFrequency): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const current = new Date(year, month - 1, day, 12);
  if (frequency === 'weekly') {
    current.setDate(current.getDate() + 7);
    return toDateKey(current);
  }

  const nextMonthIndex = current.getMonth() + 1;
  const nextYear = current.getFullYear() + Math.floor(nextMonthIndex / 12);
  const nextMonth = nextMonthIndex % 12;
  const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
  return toDateKey(new Date(nextYear, nextMonth, Math.min(current.getDate(), lastDay), 12));
}

export async function recordRecurringEntry(entry: RecurringEntry): Promise<void> {
  await insertTransaction({
    name: entry.name,
    typeId: entry.typeId,
    categoryId: entry.categoryId,
    amount: entry.amount,
    date: entry.nextDate,
    accountId: entry.accountId,
    toAccountId: entry.toAccountId,
  });

  const { error } = await supabase
    .from('recurring_entries')
    .update({ next_date: nextRecurringDate(entry.nextDate, entry.frequency), updated_at: new Date().toISOString() })
    .eq('id', entry.id);
  if (error) failWith(error);
}
