import {
  deleteBudget,
  deleteItemPermanently,
  deleteRecurringEntry,
  createInvestment,
  insertAccount,
  insertCategory,
  insertRecurringEntry,
  insertTransaction,
  insertTransactionType,
  processDueRecurringEntries,
  setRecurringEntryActive,
  settleInvestment,
  setItemState,
  updateAccount,
  updateCategory,
  updateRecurringEntry,
  updateTransaction,
  updateTransactionType,
  upsertBudget,
  type ItemTable,
} from '@/lib/finance-api';
import type { ItemState } from '@/lib/finance';

export function createFinanceActions(refresh: () => Promise<void>) {
  const run = async <T,>(operation: Promise<T>): Promise<T> => {
    const result = await operation;
    await refresh();
    return result;
  };

  return {
    createTransactionType: (input: Parameters<typeof insertTransactionType>[0]) => run(insertTransactionType(input)),
    updateTransactionType: (id: string, input: Parameters<typeof updateTransactionType>[1]) => run(updateTransactionType(id, input)),
    createCategory: (input: Parameters<typeof insertCategory>[0]) => run(insertCategory(input)),
    updateCategory: (id: string, input: Parameters<typeof updateCategory>[1]) => run(updateCategory(id, input)),
    createAccount: (input: Parameters<typeof insertAccount>[0]) => run(insertAccount(input)),
    updateAccount: (id: string, input: Parameters<typeof updateAccount>[1]) => run(updateAccount(id, input)),
    setItemState: (table: ItemTable, id: string, state: ItemState) => run(setItemState(table, id, state)),
    deleteItemPermanently: (table: ItemTable, id: string) => run(deleteItemPermanently(table, id)),
    addTransaction: (draft: Parameters<typeof insertTransaction>[0]) => run(insertTransaction(draft)),
    updateTransaction: (id: string, draft: Parameters<typeof updateTransaction>[1]) => run(updateTransaction(id, draft)),
    createInvestment: (input: Parameters<typeof createInvestment>[0]) => run(createInvestment(input)),
    settleInvestment: (input: Parameters<typeof settleInvestment>[0]) => run(settleInvestment(input)),
    saveBudget: (input: Parameters<typeof upsertBudget>[0]) => run(upsertBudget(input)),
    removeBudget: (id: string) => run(deleteBudget(id)),
    createRecurringEntry: (input: Parameters<typeof insertRecurringEntry>[0]) => run(insertRecurringEntry(input)),
    updateRecurringEntry: (id: string, input: Parameters<typeof updateRecurringEntry>[1]) => run(updateRecurringEntry(id, input)),
    setRecurringEntryActive: (id: string, isActive: boolean) => run(setRecurringEntryActive(id, isActive)),
    removeRecurringEntry: (id: string) => run(deleteRecurringEntry(id)),
    processDueRecurringEntries: () => run(processDueRecurringEntries()),
  };
}

export type FinanceActions = ReturnType<typeof createFinanceActions>;
