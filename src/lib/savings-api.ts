import { supabase } from '@/lib/supabase';

export const savingsLocations = { bank: 'Bank', cash: 'Cash', other: 'Other' } as const;
export type SavingsLocation = keyof typeof savingsLocations;
export type SavingsDraft = {
  name: string;
  amount: number;
  saved_on: string;
  storage_type: SavingsLocation;
  storage_details: string;
  location_id: string | null;
};
export type CustomSavingsLocation = { id: string; name: string };
export type SavingsEntry = SavingsDraft & { id: string; balance: number; last_activity_at: string };
export type SavingsBalance = { storage_type: SavingsLocation; balance: number };
export type SavingsMovementDirection = 'deposit' | 'withdrawal';
export type SavingsMovement = {
  id: string;
  direction: SavingsMovementDirection;
  amount: number;
  note: string;
  recorded_at: string;
};

const accountFields = 'id, name, amount, saved_on, storage_type, storage_details, location_id, balance, last_activity_at';
const movementFields = 'id, direction, amount, note, recorded_at';

function savingsError(error: { message: string; code?: string }): never {
  if (error.code === '23505') throw new Error('That savings location already exists.');
  if (error.code === 'PGRST205' || error.code === 'PGRST202') {
    throw new Error('Apply the Savings SQL update in Supabase, then try again.');
  }
  throw new Error(error.message);
}

export async function loadSavingsLocations(ownerId: string): Promise<CustomSavingsLocation[]> {
  const { data, error } = await supabase.from('savings_locations').select('id, name').eq('user_id', ownerId).order('name');
  if (error) savingsError(error);
  return (data ?? []) as CustomSavingsLocation[];
}

export async function saveSavingsLocation(ownerId: string, id: string, name: string, editing: boolean): Promise<CustomSavingsLocation> {
  const table = supabase.from('savings_locations');
  const write = editing
    ? table.update({ name }).eq('id', id).eq('user_id', ownerId)
    : table.upsert({ id, user_id: ownerId, name });
  const { data, error } = await write.select('id, name').maybeSingle();
  if (error) savingsError(error);
  if (!data) throw new Error('This savings location is no longer available.');
  return data as CustomSavingsLocation;
}

export async function deleteSavingsLocation(ownerId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from('savings_locations').delete().eq('id', id).eq('user_id', ownerId).select('id').maybeSingle();
  if (error) savingsError(error);
  if (!data) throw new Error('This savings location is no longer available.');
}

function asEntry(row: SavingsEntry): SavingsEntry {
  return { ...row, amount: Number(row.amount), balance: Number(row.balance) };
}

export async function loadSavingsEntries(ownerId: string): Promise<SavingsEntry[]> {
  const pageSize = 500;
  const entries: SavingsEntry[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('savings_accounts').select(accountFields)
      .eq('user_id', ownerId)
      .order('last_activity_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + pageSize - 1);
    if (error) savingsError(error);
    const page = (data ?? []) as SavingsEntry[];
    entries.push(...page.map(asEntry));
    if (page.length < pageSize) return entries;
  }
}

export async function loadSavingsMovements(entryId: string): Promise<SavingsMovement[]> {
  const pageSize = 500;
  const movements: SavingsMovement[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('savings_movements').select(movementFields)
      .eq('savings_entry_id', entryId)
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + pageSize - 1);
    if (error) savingsError(error);
    const page = (data ?? []) as SavingsMovement[];
    movements.push(...page.map((row) => ({ ...row, amount: Number(row.amount) })));
    if (page.length < pageSize) return movements;
  }
}

export async function recordSavingsMovement(entryId: string, requestId: string, direction: SavingsMovementDirection, amount: number, note: string) {
  const { data, error } = await supabase.rpc('record_savings_movement', {
    p_savings_entry_id: entryId, p_request_id: requestId, p_direction: direction, p_amount: amount, p_note: note,
  });
  if (error) savingsError(error);
  const { account, movement } = data as { account: SavingsEntry; movement: SavingsMovement };
  return { account: asEntry(account), movement: { ...movement, amount: Number(movement.amount) } };
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
  const saved = await write.select('id').maybeSingle();
  if (saved.error) savingsError(saved.error);
  if (!saved.data) throw new Error('This savings account is no longer available.');
  const { data, error } = await supabase.from('savings_accounts').select(accountFields).eq('id', id).eq('user_id', ownerId).single();
  if (error) savingsError(error);
  return asEntry(data as SavingsEntry);
}

export async function deleteSavingsEntry(ownerId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from('savings_entries').delete()
    .eq('id', id).eq('user_id', ownerId).select('id').maybeSingle();
  if (error) savingsError(error);
  if (!data) throw new Error('This savings entry is no longer available.');
}
