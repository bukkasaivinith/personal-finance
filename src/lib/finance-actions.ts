import {
  deleteItemPermanently,
  insertAccount,
  insertCategory,
  insertTransaction,
  insertTransactionType,
  renameTransactionType,
  setItemState,
  updateAccount,
  updateCategory,
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
    renameTransactionType: (id: string, name: string) => run(renameTransactionType(id, name)),
    createCategory: (input: Parameters<typeof insertCategory>[0]) => run(insertCategory(input)),
    updateCategory: (id: string, input: Parameters<typeof updateCategory>[1]) => run(updateCategory(id, input)),
    createAccount: (input: Parameters<typeof insertAccount>[0]) => run(insertAccount(input)),
    updateAccount: (id: string, input: Parameters<typeof updateAccount>[1]) => run(updateAccount(id, input)),
    setItemState: (table: ItemTable, id: string, state: ItemState) => run(setItemState(table, id, state)),
    deleteItemPermanently: (table: ItemTable, id: string) => run(deleteItemPermanently(table, id)),
    addTransaction: (draft: Parameters<typeof insertTransaction>[0]) => run(insertTransaction(draft)),
  };
}

export type FinanceActions = ReturnType<typeof createFinanceActions>;
