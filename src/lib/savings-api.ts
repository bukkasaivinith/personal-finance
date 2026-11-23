import { supabase } from '@/lib/supabase';

export const savingsLocations = { bank: 'Bank', cash: 'Cash', other: 'Other' } as const;
export type SavingsLocation = keyof typeof savingsLocations;
export type SavingsDraft = {
  name: string;
  amount: number;
  saved_on: string;
  storage_type: SavingsLocation;
  storage_details: string;
};
export type SavingsEntry = SavingsDraft & { id: string };
export type SavingsBalance = { storage_type: SavingsLocation; balance: number };

const entryFields = 'id, name, amount, saved_on, storage_type, storage_details';

function savingsError(error: { message: string; code?: string }): never {
  if (error.code === 'PGRST205' || error.code === 'PGRST202') {
    throw new Error('Apply the Savings SQL update in Supabase, then try again.');
  }
  throw new Error(error.message);
}

function asEntry(row: SavingsDraft & { id: string }): SavingsEntry {
  return { ...row, amount: Number(row.amount) };
}

export async function loadSavingsEntries(ownerId: string): Promise<SavingsEntry[]> {
  const pageSize = 500;
  const entries: SavingsEntry[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('savings_entries').select(entryFields)
      .eq('user_id', ownerId)
      .order('saved_on', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + pageSize - 1);
    if (error) savingsError(error);
    const page = (data ?? []) as SavingsEntry[];
    entries.push(...page.map(asEntry));
    if (page.length < pageSize) return entries;
  }
}

export async function loadSavingsBalances(): Promise<SavingsBalance[]> {
  const { data, error } = await supabase.rpc('get_savings_balances');
  if (error) savingsError(error);
  return ((data ?? []) as SavingsBalance[]).map((row) => ({ ...row, balance: Number(row.balance) }));
}

export async function saveSavingsEntry(ownerId: string, id: string, draft: SavingsDraft, editing: boolean): Promise<SavingsEntry> {
  const table = supabase.from('savings_entries');
  const write = editing
    ? table.update(draft).eq('id', id).eq('user_id', ownerId)
    : table.upsert({ ...draft, id, user_id: ownerId });
  const { data, error } = await write.select(entryFields).maybeSingle();
  if (error) savingsError(error);
  if (!data) throw new Error('This savings entry is no longer available.');
  return asEntry(data as SavingsEntry);
}

export async function deleteSavingsEntry(ownerId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from('savings_entries').delete()
    .eq('id', id).eq('user_id', ownerId).select('id').maybeSingle();
  if (error) savingsError(error);
  if (!data) throw new Error('This savings entry is no longer available.');
}
