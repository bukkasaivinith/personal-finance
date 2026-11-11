import type { RecurringEntry, Transaction, TransactionKind } from '@/lib/finance';

/** The average number of days in a calendar month (365.25 / 12). */
export const AVERAGE_DAYS_PER_MONTH = 30.4375;

export type RecurringOccurrence = {
  key: string;
  entry: RecurringEntry;
  kind: TransactionKind;
  date: string;
  amount: number;
  status: 'scheduled' | 'processed';
};

export type RecurringDistribution = {
  id: string;
  label: string;
  emoji: string | null;
  amount: number;
  share: number;
  entryCount: number;
  entries: RecurringEntry[];
};

type Lookup = Map<string, TransactionKind>;

function dateAtNoon(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function keyForDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number): string {
  const date = dateAtNoon(dateKey);
  if (!date) return dateKey;
  date.setDate(date.getDate() + days);
  return keyForDate(date);
}

export function monthBounds(dateKey: string): { start: string; end: string } {
  const date = dateAtNoon(dateKey) ?? new Date();
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  return { start: keyForDate(start), end: keyForDate(end) };
}

export function shiftMonthBounds(dateKey: string, offset: number): { start: string; end: string; label: string } {
  const date = dateAtNoon(dateKey) ?? new Date();
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 12);
  return {
    start: keyForDate(start),
    end: keyForDate(end),
    label: new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(start),
  };
}

function addMonths(dateKey: string, count: number, preferredDay: number | null): string {
  const date = dateAtNoon(dateKey);
  if (!date) return dateKey;
  const targetYear = date.getFullYear() + Math.floor((date.getMonth() + count) / 12);
  const targetMonth = ((date.getMonth() + count) % 12 + 12) % 12;
  const finalDay = Math.min(preferredDay ?? date.getDate(), new Date(targetYear, targetMonth + 1, 0).getDate());
  return keyForDate(new Date(targetYear, targetMonth, finalDay, 12));
}

export function nextScheduledDate(entry: RecurringEntry, dateKey = entry.nextDate): string {
  const interval = Math.max(1, Number(entry.intervalValue) || 1);
  if (entry.intervalUnit === 'day') return addDays(dateKey, interval);
  if (entry.intervalUnit === 'week') return addDays(dateKey, interval * 7);
  return addMonths(dateKey, interval, entry.monthDay);
}

/**
 * Converts any recurring interval into its comparable monthly amount.
 * An entry every 20 days, for example, is amount × 30.4375 / 20.
 */
export function monthlyEquivalent(entry: RecurringEntry): number {
  const interval = Math.max(1, Number(entry.intervalValue) || 1);
  if (entry.intervalUnit === 'day') return entry.amount * (AVERAGE_DAYS_PER_MONTH / interval);
  if (entry.intervalUnit === 'week') return entry.amount * ((52 / 12) / interval);
  return entry.amount / interval;
}

export function frequencyLabel(entry: RecurringEntry): string {
  const interval = Math.max(1, Number(entry.intervalValue) || 1);
  return `Every ${interval} ${entry.intervalUnit}${interval === 1 ? '' : 's'}`;
}

function plannedOccurrences(
  entries: RecurringEntry[],
  kinds: Lookup,
  start: string,
  end: string,
): RecurringOccurrence[] {
  const occurrences: RecurringOccurrence[] = [];
  for (const entry of entries) {
    if (!entry.isActive || entry.nextDate > end || (entry.endDate && entry.endDate < start)) continue;
    const kind = kinds.get(entry.typeId);
    if (!kind) continue;
    let date = entry.nextDate;
    let guard = 0;
    while (date < start && guard < 5_000) {
      const next = nextScheduledDate(entry, date);
      if (next <= date) break;
      date = next;
      guard += 1;
    }
    while (date <= end && (!entry.endDate || date <= entry.endDate) && guard < 5_000) {
      occurrences.push({ key: `${entry.id}:${date}`, entry, kind, date, amount: entry.amount, status: 'scheduled' });
      const next = nextScheduledDate(entry, date);
      if (next <= date) break;
      date = next;
      guard += 1;
    }
  }
  return occurrences;
}

/**
 * Returns actual generated recurring transactions plus still-scheduled future occurrences.
 * A generated transaction always wins when it shares the same rule and due date, preventing
 * duplicate totals when a due rule has already been processed.
 */
export function scheduledOccurrences(
  entries: RecurringEntry[],
  transactions: Transaction[],
  kinds: Lookup,
  start: string,
  end: string,
): RecurringOccurrence[] {
  const activeById = new Map(entries.filter((entry) => entry.isActive).map((entry) => [entry.id, entry]));
  const byKey = new Map(plannedOccurrences(entries, kinds, start, end).map((item) => [item.key, item]));

  for (const transaction of transactions) {
    if (transaction.source !== 'scheduled' || !transaction.recurringEntryId || transaction.date < start || transaction.date > end) continue;
    const entry = activeById.get(transaction.recurringEntryId);
    if (!entry) continue;
    const kind = kinds.get(entry.typeId) ?? transaction.kind;
    byKey.set(`${entry.id}:${transaction.date}`, {
      key: `${entry.id}:${transaction.date}`,
      entry,
      kind,
      date: transaction.date,
      amount: transaction.amount,
      status: 'processed',
    });
  }

  return [...byKey.values()].sort((left, right) => left.date.localeCompare(right.date) || left.entry.name.localeCompare(right.entry.name));
}

export function recurringDistribution(
  entries: RecurringEntry[],
  kinds: Lookup,
  mode: 'category' | 'account',
  labels: Map<string, { name: string; emoji?: string | null }>,
): RecurringDistribution[] {
  const grouped = new Map<string, { label: string; emoji: string | null; amount: number; entries: RecurringEntry[] }>();
  for (const entry of entries) {
    if (!entry.isActive || kinds.get(entry.typeId) !== 'expense') continue;
    const id = mode === 'category' ? entry.categoryId ?? 'uncategorized' : entry.accountId;
    const option = labels.get(id);
    const current = grouped.get(id) ?? {
      label: option?.name ?? (mode === 'category' ? 'Uncategorised' : 'Archived account'),
      emoji: mode === 'category' ? option?.emoji ?? null : null,
      amount: 0,
      entries: [],
    };
    current.amount += monthlyEquivalent(entry);
    current.entries.push(entry);
    grouped.set(id, current);
  }
  const total = [...grouped.values()].reduce((sum, item) => sum + item.amount, 0);
  return [...grouped.entries()]
    .map(([id, item]) => ({ id, label: item.label, emoji: item.emoji, amount: item.amount, share: total ? item.amount / total : 0, entryCount: item.entries.length, entries: item.entries }))
    .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));
}
