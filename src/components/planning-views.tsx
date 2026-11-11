import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Pencil, PiggyBank, Play, Plus, Repeat2, Settings, Target, Trash2 } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { EmptyPanel, Metric, ModalShell, SectionHeading } from '@/components/ui';
import type { FinanceActions } from '@/lib/finance-actions';
import { loadActivityEvents } from '@/lib/finance-api';
import {
  AVERAGE_DAYS_PER_MONTH,
  addDays,
  frequencyLabel,
  monthBounds,
  monthlyEquivalent,
  scheduledOccurrences,
  shiftMonthBounds,
} from '@/lib/recurring-analytics';
import {
  categoriesFor,
  currentMonthKey,
  formatDate,
  formatMoney,
  formatTime,
  isInvestmentManagedTransactionType,
  isUsable,
  parseAmount,
  todayKey,
  type Account,
  type ActivityAction,
  type ActivityEvent,
  type Budget,
  type CategoryOption,
  type FinanceData,
  type Investment,
  type RecurringEntry,
  type RecurringEntryDraft,
  type Transaction,
  type TransactionTypeOption,
} from '@/lib/finance';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function calendarKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calendarDaysForMonth(monthKey: string): Date[] {
  const [year, month] = monthKey.slice(0, 7).split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1, 12);
  const firstVisibleDay = new Date(year, month - 1, 1 - firstDay.getDay(), 12);
  return Array.from({ length: 42 }, (_, index) => new Date(firstVisibleDay.getFullYear(), firstVisibleDay.getMonth(), firstVisibleDay.getDate() + index, 12));
}

function PlanningEmptyView({
  title,
  description,
  icon,
  emptyTitle,
  emptyDescription,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <>
      <SectionHeading title={title} description={description} />
      <div className="surface-card">
        <EmptyPanel
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
          action={
            <button className="primary-button" type="button" onClick={onAction}>
              <Plus size={16} /> {actionLabel}
            </button>
          }
        />
      </div>
    </>
  );
}

function BudgetModal({
  budget,
  categories,
  budgets,
  onClose,
  onSubmit,
}: {
  budget: Budget | null;
  categories: CategoryOption[];
  budgets: Budget[];
  onClose: () => void;
  onSubmit: (input: { categoryId: string; amount: number }) => Promise<void>;
}) {
  const usableCategories = categories.filter(isUsable);
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? usableCategories[0]?.id ?? '');
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const categoryWithBudget = new Set(budgets.filter((item) => item.id !== budget?.id).map((item) => item.categoryId));
  const availableCategories = usableCategories.filter((category) => !categoryWithBudget.has(category.id) || category.id === categoryId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = parseAmount(amount);
    if (!categoryId) {
      setError('Create a category first, then choose it here.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a monthly limit greater than zero.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ categoryId, amount: value });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell eyebrow="Budgets" title={budget ? 'Edit budget' : 'Create budget'} labelId="budget-modal-title" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-description">Set the maximum you want to spend in a category each month.</p>
        <div className="form-grid">
          <label className="full-field">
            Category
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={saving || availableCategories.length === 0}>
              {availableCategories.length === 0 ? <option value="">No categories available</option> : null}
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji ? `${category.emoji} ` : ''}{category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="full-field">
            Monthly limit (₹)
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 10000" autoFocus={!budget} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving || availableCategories.length === 0}>
            {saving ? 'Saving...' : budget ? 'Save budget' : 'Create budget'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function BudgetsView({
  budgets,
  categories,
  transactions,
  actions,
  onNotify,
}: {
  budgets: Budget[];
  categories: CategoryOption[];
  transactions: Transaction[];
  actions: FinanceActions;
  onNotify: (message: string) => void;
}) {
  const [editingBudget, setEditingBudget] = useState<Budget | null | undefined>(undefined);
  const [busyId, setBusyId] = useState('');
  const monthlySpending = useMemo(() => {
    const totals = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.kind !== 'expense' || !transaction.categoryId || !transaction.date.startsWith(currentMonthKey())) continue;
      totals.set(transaction.categoryId, (totals.get(transaction.categoryId) ?? 0) + transaction.amount);
    }
    return totals;
  }, [transactions]);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  const saveBudget = async (input: { categoryId: string; amount: number }) => {
    const previous = editingBudget;
    await actions.saveBudget(input);
    if (previous && previous.categoryId !== input.categoryId) await actions.removeBudget(previous.id);
    setEditingBudget(undefined);
    onNotify('Budget saved.');
  };

  const removeBudget = async (budget: Budget) => {
    setBusyId(budget.id);
    try {
      await actions.removeBudget(budget.id);
      onNotify('Budget removed.');
    } catch (error) {
      onNotify(errorMessage(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <>
      <SectionHeading
        title="Budgets"
        description="Set monthly spending limits for each category."
        action={<button className="primary-button" type="button" onClick={() => setEditingBudget(null)}><Plus size={16} /> Create budget</button>}
      />
      {budgets.length === 0 ? (
        <div className="surface-card"><EmptyPanel icon={<PiggyBank size={20} />} title="No budgets yet" description="Create a monthly limit to see your category spending progress." action={<button className="primary-button" type="button" onClick={() => setEditingBudget(null)}><Plus size={16} /> Create budget</button>} /></div>
      ) : (
        <div className="planning-grid">
          {budgets.map((budget) => {
            const category = categoriesById.get(budget.categoryId);
            const spent = monthlySpending.get(budget.categoryId) ?? 0;
            const percent = Math.round((spent / budget.amount) * 100);
            const remaining = budget.amount - spent;
            return (
              <article className="surface-card budget-card" key={budget.id}>
                <div className="planning-card-top">
                  <div className="planning-category"><span>{category?.emoji || '•'}</span><div><h3>{category?.name || 'Archived category'}</h3><p>{currentMonthKey()}</p></div></div>
                  <div className="item-actions">
                    <button className="ghost-button" type="button" aria-label="Edit budget" onClick={() => setEditingBudget(budget)}><Pencil size={15} /> Edit</button>
                    <button className="ghost-button danger" type="button" aria-label="Delete budget" onClick={() => void removeBudget(budget)} disabled={busyId === budget.id}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="budget-money"><strong>{formatMoney(spent)}</strong><span>of {formatMoney(budget.amount)}</span></div>
                <div className="premium-progress" aria-label={`${Math.max(0, percent)} percent of budget used`}><span className={percent >= 100 ? 'over' : percent >= 80 ? 'warning' : ''} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
                <div className="budget-card-footer"><span className={remaining < 0 ? 'negative' : 'positive'}>{remaining < 0 ? `${formatMoney(Math.abs(remaining))} over limit` : `${formatMoney(remaining)} remaining`}</span><span>{percent}% used</span></div>
              </article>
            );
          })}
        </div>
      )}
      {editingBudget !== undefined ? <BudgetModal budget={editingBudget} categories={categories} budgets={budgets} onClose={() => setEditingBudget(undefined)} onSubmit={saveBudget} /> : null}
    </>
  );
}

function RecurringModal({
  transactionTypes,
  categories,
  accounts,
  entry,
  onClose,
  onSubmit,
}: {
  transactionTypes: TransactionTypeOption[];
  categories: CategoryOption[];
  accounts: Account[];
  entry?: RecurringEntry | null;
  onClose: () => void;
  onSubmit: (draft: RecurringEntryDraft) => Promise<void>;
}) {
  const usableTypes = transactionTypes.filter((type) => isUsable(type) && !isInvestmentManagedTransactionType(type));
  const usableAccounts = accounts.filter(isUsable);
  const [typeId, setTypeId] = useState(entry?.typeId ?? usableTypes[0]?.id ?? '');
  const [name, setName] = useState(entry?.name ?? '');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? '');
  const [accountId, setAccountId] = useState(entry?.accountId ?? usableAccounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(entry?.toAccountId ?? '');
  const [intervalValue, setIntervalValue] = useState(String(entry?.intervalValue ?? 1));
  const [intervalUnit, setIntervalUnit] = useState(entry?.intervalUnit ?? 'month');
  const [nextDate, setNextDate] = useState(entry?.nextDate ?? todayKey());
  const [endDate, setEndDate] = useState(entry?.endDate ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedType = usableTypes.find((item) => item.id === typeId);
  const isTransfer = selectedType?.kind === 'transfer';
  const compatibleCategories = selectedType ? categoriesFor(categories, selectedType.id).filter(isUsable) : [];
  const destinationAccounts = usableAccounts.filter((account) => account.id !== accountId);

  const changeType = (nextTypeId: string) => {
    setTypeId(nextTypeId);
    setCategoryId('');
    setToAccountId('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = parseAmount(amount);
    const interval = Number(intervalValue);
    if (!selectedType) { setError('Choose a transaction type.'); return; }
    if (!name.trim()) { setError('Add a name for this repeating entry.'); return; }
    if (!Number.isFinite(value) || value <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!accountId) { setError('Choose an account.'); return; }
    if (!isTransfer && !categoryId) { setError('Choose a category that fits this type.'); return; }
    if (isTransfer && !toAccountId) { setError('Choose the account to move money into.'); return; }
    if (!Number.isInteger(interval) || interval < 1 || interval > 366) { setError('Choose an interval between 1 and 366.'); return; }
    if (endDate && endDate < nextDate) { setError('The end date must be on or after the first due date.'); return; }
    setSaving(true);
    setError('');
    try {
      const frequency = interval === 1 && intervalUnit === 'day' ? 'daily' : interval === 1 && intervalUnit === 'week' ? 'weekly' : interval === 1 && intervalUnit === 'month' ? 'monthly' : 'custom';
      await onSubmit({
        name: name.trim(), typeId, categoryId: isTransfer ? null : categoryId, amount: value,
        accountId, toAccountId: isTransfer ? toAccountId : null, frequency,
        intervalValue: interval, intervalUnit, nextDate, endDate: endDate || null,
        monthDay: intervalUnit === 'month' ? Number(nextDate.slice(8)) : null,
      });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell eyebrow="Recurring" title={entry ? 'Edit recurring entry' : 'Add recurring entry'} labelId="recurring-modal-title" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-description">Due entries are safely generated once when you open the app or process them below. Generated entries are marked Scheduled until you reconcile them with your bank.</p>
        <div className="form-grid">
          <label className="full-field">Transaction type<select value={typeId} onChange={(event) => changeType(event.target.value)}>{usableTypes.length === 0 ? <option value="">No active types available</option> : null}{usableTypes.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.kind})</option>)}</select></label>
          <label className="full-field">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Monthly rent" maxLength={60} autoFocus /></label>
          <label>Amount (₹)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 15000" /></label>
          <label>Every<input type="number" min="1" max="366" inputMode="numeric" value={intervalValue} onChange={(event) => setIntervalValue(event.target.value)} /></label>
          <label>Interval unit<select value={intervalUnit} onChange={(event) => setIntervalUnit(event.target.value as 'day' | 'week' | 'month')}><option value="day">day(s)</option><option value="week">week(s)</option><option value="month">month(s)</option></select></label>
          {!isTransfer ? <label className="full-field">Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Choose a category</option>{compatibleCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji ? `${category.emoji} ` : ''}{category.name}</option>)}</select></label> : null}
          <label className={isTransfer ? '' : 'full-field'}>{isTransfer ? 'From account' : 'Account'}<select value={accountId} onChange={(event) => { setAccountId(event.target.value); setToAccountId(''); }}><option value="">Choose an account</option>{usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          {isTransfer ? <label>To account<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}><option value="">Choose an account</option>{destinationAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : null}
          <div className="full-field"><DatePicker label="First due date" value={nextDate} onChange={setNextDate} /></div>
          <div className="full-field"><DatePicker label="End date (optional)" value={endDate} onChange={setEndDate} min={nextDate} clearable placeholder="No end date" /></div>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || usableTypes.length === 0 || usableAccounts.length === 0}>{saving ? 'Saving...' : entry ? 'Save changes' : 'Add recurring entry'}</button></div>
      </form>
    </ModalShell>
  );
}

export function RecurringView({
  entries,
  transactions,
  categories,
  accounts,
  transactionTypes,
  actions,
  onNotify,
}: {
  entries: RecurringEntry[];
  transactions: Transaction[];
  categories: CategoryOption[];
  accounts: Account[];
  transactionTypes: TransactionTypeOption[];
  actions: FinanceActions;
  onNotify: (message: string) => void;
}) {
  const [editingEntry, setEditingEntry] = useState<RecurringEntry | null | undefined>(undefined);
  const [busyId, setBusyId] = useState('');
  const [distributionView, setDistributionView] = useState<'entry' | 'account'>('entry');
  const [selectedDistributionId, setSelectedDistributionId] = useState('');
  const [scheduleMonth, setScheduleMonth] = useState(() => todayKey());
  const typeById = useMemo(() => new Map(transactionTypes.map((item) => [item.id, item])), [transactionTypes]);
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((item) => [item.id, item])), [accounts]);
  const kindByTypeId = useMemo(() => new Map(transactionTypes.map((item) => [item.id, item.kind])), [transactionTypes]);
  const today = todayKey();

  const activeExpenseEntries = useMemo(
    () => entries.filter((entry) => entry.isActive && kindByTypeId.get(entry.typeId) === 'expense'),
    [entries, kindByTypeId],
  );
  const activeIncomeEntries = useMemo(
    () => entries.filter((entry) => entry.isActive && kindByTypeId.get(entry.typeId) === 'income'),
    [entries, kindByTypeId],
  );
  const pausedExpenseCount = useMemo(
    () => entries.filter((entry) => !entry.isActive && kindByTypeId.get(entry.typeId) === 'expense').length,
    [entries, kindByTypeId],
  );
  const monthlyExpense = useMemo(() => activeExpenseEntries.reduce((total, entry) => total + monthlyEquivalent(entry), 0), [activeExpenseEntries]);
  const monthlyIncome = useMemo(() => activeIncomeEntries.reduce((total, entry) => total + monthlyEquivalent(entry), 0), [activeIncomeEntries]);
  const netMonthlyCashFlow = monthlyIncome - monthlyExpense;

  const upcoming = useMemo(
    () => scheduledOccurrences(entries, transactions, kindByTypeId, today, addDays(today, 29))
      .filter((occurrence) => occurrence.kind === 'expense' && occurrence.status === 'scheduled'),
    [entries, transactions, kindByTypeId, today],
  );
  const upcomingSeven = useMemo(
    () => upcoming.filter((occurrence) => occurrence.date <= addDays(today, 6)),
    [upcoming, today],
  );
  const upcomingThirtyAmount = useMemo(() => upcoming.reduce((total, occurrence) => total + occurrence.amount, 0), [upcoming]);
  const upcomingSevenAmount = useMemo(() => upcomingSeven.reduce((total, occurrence) => total + occurrence.amount, 0), [upcomingSeven]);

  const distribution = useMemo(() => {
    const total = activeExpenseEntries.reduce((sum, entry) => sum + monthlyEquivalent(entry), 0);
    if (distributionView === 'entry') {
      return activeExpenseEntries
        .map((entry) => {
          const amount = monthlyEquivalent(entry);
          return { id: entry.id, label: entry.name, amount, share: total ? amount / total : 0, entries: [entry] };
        })
        .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));
    }
    const grouped = new Map<string, { label: string; amount: number; entries: RecurringEntry[] }>();
    for (const entry of activeExpenseEntries) {
      const current = grouped.get(entry.accountId) ?? { label: accountById.get(entry.accountId)?.name ?? 'Archived account', amount: 0, entries: [] };
      current.amount += monthlyEquivalent(entry);
      current.entries.push(entry);
      grouped.set(entry.accountId, current);
    }
    return [...grouped.entries()]
      .map(([id, item]) => ({ id, ...item, share: total ? item.amount / total : 0 }))
      .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));
  }, [activeExpenseEntries, accountById, distributionView]);
  const donutBackground = useMemo(() => {
    if (distribution.length === 0) return '#edf1ec';
    let position = 0;
    const colors = ['#1f573f', '#6e9475', '#b99b5c', '#8291aa', '#bd806c', '#9b819e', '#4f7f82', '#c4a56e'];
    return `conic-gradient(${distribution.map((item, index) => {
      const next = position + item.share * 100;
      const segment = `${colors[index % colors.length]} ${position}% ${next}%`;
      position = next;
      return segment;
    }).join(', ')})`;
  }, [distribution]);
  const selectedDistribution = distribution.find((item) => item.id === selectedDistributionId) ?? null;

  const scheduleBounds = useMemo(() => monthBounds(scheduleMonth), [scheduleMonth]);
  const scheduleMonthLabel = useMemo(
    () => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(`${scheduleBounds.start}T12:00:00`)),
    [scheduleBounds.start],
  );
  const scheduleDays = useMemo(() => calendarDaysForMonth(scheduleBounds.start), [scheduleBounds.start]);
  const scheduledExpensesByDate = useMemo(() => {
    const grouped = new Map<string, ReturnType<typeof scheduledOccurrences>>();
    for (const occurrence of scheduledOccurrences(entries, transactions, kindByTypeId, scheduleBounds.start, scheduleBounds.end)) {
      if (occurrence.kind !== 'expense') continue;
      const items = grouped.get(occurrence.date) ?? [];
      items.push(occurrence);
      grouped.set(occurrence.date, items);
    }
    return grouped;
  }, [entries, transactions, kindByTypeId, scheduleBounds]);
  const scheduledExpenseCount = useMemo(
    () => [...scheduledExpensesByDate.values()].reduce((total, occurrences) => total + occurrences.length, 0),
    [scheduledExpensesByDate],
  );

  const createEntry = async (draft: RecurringEntryDraft) => {
    if (editingEntry) {
      await actions.updateRecurringEntry(editingEntry.id, draft);
      onNotify('Recurring entry updated.');
    } else {
      await actions.createRecurringEntry(draft);
      onNotify('Recurring entry added.');
    }
    setEditingEntry(undefined);
  };
  const changeActive = async (entry: RecurringEntry) => {
    setBusyId(entry.id);
    try {
      await actions.setRecurringEntryActive(entry.id, !entry.isActive);
      onNotify(entry.isActive ? 'Recurring entry paused.' : 'Recurring entry resumed.');
    } catch (error) { onNotify(errorMessage(error)); } finally { setBusyId(''); }
  };
  const processDue = async () => {
    setBusyId('processing');
    try {
      const generated = await actions.processDueRecurringEntries();
      onNotify(generated ? `${generated} due recurring ${generated === 1 ? 'entry was' : 'entries were'} generated.` : 'No recurring entries are due yet.');
    } catch (error) { onNotify(errorMessage(error)); } finally { setBusyId(''); }
  };
  const remove = async (entry: RecurringEntry) => {
    setBusyId(entry.id);
    try {
      await actions.removeRecurringEntry(entry.id);
      onNotify('Recurring entry removed.');
    } catch (error) { onNotify(errorMessage(error)); } finally { setBusyId(''); }
  };

  return (
    <>
      <SectionHeading title="Recurring" description="Salary, rent, subscriptions and other repeating entries." action={<button className="primary-button" type="button" onClick={() => setEditingEntry(null)}><Plus size={16} /> Add recurring entry</button>} />
      <section className="recurring-dashboard" aria-label="Recurring financial commitments dashboard">
        <div className="recurring-summary-grid">
          <Metric label="Active recurring expenses" value={String(activeExpenseEntries.length)} foot={pausedExpenseCount ? `${pausedExpenseCount} paused expense${pausedExpenseCount === 1 ? '' : 's'}` : 'No paused recurring expenses'} icon={<Repeat2 size={17} />} />
          <Metric label="Monthly recurring spending" value={formatMoney(monthlyExpense)} foot="Normalised from each schedule interval" icon={<CalendarDays size={17} />} />
          <Metric label="Average daily commitment" value={formatMoney(monthlyExpense / AVERAGE_DAYS_PER_MONTH)} foot="Monthly total ÷ 30.4375 days" icon={<CalendarDays size={17} />} />
          <Metric label="Monthly recurring income" value={formatMoney(monthlyIncome)} foot={`${activeIncomeEntries.length} active income ${activeIncomeEntries.length === 1 ? 'entry' : 'entries'}`} icon={<Repeat2 size={17} />} />
          <Metric label="Net recurring cash flow" value={formatMoney(netMonthlyCashFlow)} foot={netMonthlyCashFlow >= 0 ? 'Positive monthly recurring cash flow' : 'Recurring expenses exceed recurring income'} icon={<PiggyBank size={17} />} />
          <Metric label="Upcoming payments" value={String(upcoming.length)} foot={upcoming.length ? `${formatMoney(upcomingSevenAmount)} in 7 days · ${formatMoney(upcomingThirtyAmount)} in 30 days · next ${formatDate(upcoming[0].date)}` : 'No future recurring debits scheduled'} icon={<CalendarDays size={17} />} />
        </div>

        <div className="recurring-analytics-grid">
          <section className="surface-card recurring-analytics-card recurring-distribution-card">
            <div className="card-title-row"><div><h3>Recurring expense distribution</h3><p>{distributionView === 'entry' ? 'Each active recurring expense, normalised to its monthly equivalent.' : 'The accounts recurring expenses are taken from, normalised to monthly equivalents.'}</p></div><div className="analytics-tabs" aria-label="Recurring expense distribution view"><button className={distributionView === 'entry' ? 'active' : ''} type="button" onClick={() => { setDistributionView('entry'); setSelectedDistributionId(''); }}>Recurring entries</button><button className={distributionView === 'account' ? 'active' : ''} type="button" onClick={() => { setDistributionView('account'); setSelectedDistributionId(''); }}>Accounts</button></div></div>
            {distribution.length === 0 ? <div className="recurring-chart-empty">No active recurring expenses to chart yet.</div> : <>
              <div className="recurring-donut-layout">
                <div className="recurring-donut" style={{ background: donutBackground }} aria-label="Recurring expenses by entry"><span>{formatMoney(monthlyExpense)}<small>per month</small></span></div>
                <div className="recurring-distribution-list">
                  {distribution.map((item, index) => <button className={`recurring-distribution-item ${selectedDistributionId === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedDistributionId(item.id)}><i style={{ background: ['#1f573f', '#6e9475', '#b99b5c', '#8291aa', '#bd806c', '#9b819e', '#4f7f82', '#c4a56e'][index % 8] }} /><span>{item.label}<small>{distributionView === 'entry' ? `${accountById.get(item.entries[0].accountId)?.name ?? 'Archived account'} · ` : `${item.entries.length} ${item.entries.length === 1 ? 'entry' : 'entries'} · `}{(item.share * 100).toFixed(1)}% of recurring spending</small></span><b>{formatMoney(item.amount)}</b></button>)}
                </div>
              </div>
              {selectedDistribution ? <div className="recurring-selection-detail"><div><strong>{selectedDistribution.label}</strong><span>{formatMoney(selectedDistribution.amount)} monthly-normalised · {(selectedDistribution.share * 100).toFixed(1)}% of active expenses</span></div><div className="recurring-selection-entries">{selectedDistribution.entries.map((entry) => <div key={entry.id}><span>{entry.name}<small>{frequencyLabel(entry)} · {accountById.get(entry.accountId)?.name ?? 'Archived account'} · next {formatDate(entry.nextDate)}</small></span><b>{formatMoney(entry.amount)}</b></div>)}</div></div> : <p className="recurring-hint">Select a {distributionView === 'entry' ? 'recurring entry' : 'funding account'} to inspect its schedule.</p>}
            </>}
          </section>
        </div>

        <section className="surface-card recurring-analytics-card recurring-schedule-calendar">
          <div className="recurring-calendar-heading">
            <div><h3>Scheduled expense dates</h3><p>All active recurring expense dates for the month, shown directly in your calendar.</p></div>
            <div className="recurring-calendar-controls">
              <button type="button" aria-label="Previous month" onClick={() => setScheduleMonth((current) => shiftMonthBounds(current, -1).start)}><ChevronLeft size={17} /></button>
              <strong>{scheduleMonthLabel}</strong>
              <button type="button" aria-label="Next month" onClick={() => setScheduleMonth((current) => shiftMonthBounds(current, 1).start)}><ChevronRight size={17} /></button>
            </div>
          </div>
          <div className="recurring-month-scroll">
            <div className="recurring-month-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="recurring-month-grid">
              {scheduleDays.map((day) => {
                const date = calendarKey(day);
                const occurrences = scheduledExpensesByDate.get(date) ?? [];
                const inMonth = date >= scheduleBounds.start && date <= scheduleBounds.end;
                return (
                  <article className={`recurring-month-day ${inMonth ? '' : 'outside'} ${date === today ? 'today' : ''}`} key={date} aria-label={formatDate(date)}>
                    <time dateTime={date}>{day.getDate()}</time>
                    <div className="recurring-month-events">
                      {occurrences.map((occurrence) => <div className={`recurring-month-event ${occurrence.status}`} key={occurrence.key} title={`${occurrence.entry.name} · ${formatMoney(occurrence.amount)}`}><span>{occurrence.entry.name}</span><b>{formatMoney(occurrence.amount)}</b></div>)}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          {scheduledExpenseCount === 0 ? <p className="recurring-calendar-empty">No active recurring expenses are scheduled for {scheduleMonthLabel}.</p> : <p className="recurring-calendar-note">{scheduledExpenseCount} scheduled recurring expense{scheduledExpenseCount === 1 ? '' : 's'} in {scheduleMonthLabel}. Processed entries use the lighter marker.</p>}
        </section>

      </section>

      <div className="recurring-list-heading"><div><h3>Recurring entries</h3><p>Keep your existing schedules organised and ready to process.</p></div></div>
      {entries.length === 0 ? (
        <div className="surface-card"><EmptyPanel icon={<CalendarDays size={20} />} title="No recurring entries yet" description="Add a repeating income, bill or transfer. It will generate once when its due date arrives." action={<button className="primary-button" type="button" onClick={() => setEditingEntry(null)}><Plus size={16} /> Add recurring entry</button>} /></div>
      ) : (
        <div className="recurring-list">
          {entries.map((entry) => {
            const type = typeById.get(entry.typeId);
            const category = entry.categoryId ? categoryById.get(entry.categoryId) : null;
            const account = accountById.get(entry.accountId);
            const due = entry.nextDate <= todayKey();
            return (
              <article className={`surface-card recurring-card ${entry.isActive ? '' : 'paused'}`} key={entry.id}>
                <div className="recurring-icon">{category?.emoji || <Repeat2 size={18} />}</div>
                <div className="recurring-main"><div className="recurring-title-row"><h3>{entry.name}</h3>{!entry.isActive ? <span className="status-tag inactive">Paused</span> : due ? <span className="due-tag">Due now</span> : null}</div><p>{type?.name || 'Archived type'} · {category?.name || (type?.kind === 'transfer' ? 'Transfer' : 'Archived category')} · {account?.name || 'Archived account'}</p><small>Every {entry.intervalValue} {entry.intervalUnit}{entry.intervalValue === 1 ? '' : 's'} · Next due {formatDate(entry.nextDate)}{entry.endDate ? ` · Ends ${formatDate(entry.endDate)}` : ''}{entry.lastProcessedDate ? ` · Last processed ${formatDate(entry.lastProcessedDate)}` : ''}</small></div>
                <div className="recurring-amount"><strong className={type?.kind === 'income' ? 'positive' : ''}>{formatMoney(entry.amount)}</strong><span>{type?.kind || 'transaction'}</span></div>
                <div className="item-actions recurring-actions">
                  {due ? <button className="primary-button compact-primary" type="button" onClick={() => void processDue()} disabled={busyId === 'processing' || !entry.isActive}><Play size={14} /> Process due</button> : null}
                  <button className="ghost-button" type="button" onClick={() => setEditingEntry(entry)} disabled={busyId === entry.id}><Pencil size={15} /> Edit</button>
                  <button className="ghost-button" type="button" onClick={() => void changeActive(entry)} disabled={busyId === entry.id}>{entry.isActive ? 'Pause' : 'Resume'}</button>
                  <button className="ghost-button danger" type="button" aria-label="Remove recurring entry" onClick={() => void remove(entry)} disabled={busyId === entry.id}><Trash2 size={15} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {entries.some((entry) => entry.isActive && entry.nextDate <= todayKey()) ? <div className="recurring-process-row"><span>Due entries generate once only and are labelled Scheduled.</span><button className="secondary-button" type="button" onClick={() => void processDue()} disabled={busyId === 'processing'}>{busyId === 'processing' ? 'Processing...' : 'Process all due entries'}</button></div> : null}
      {editingEntry !== undefined ? <RecurringModal transactionTypes={transactionTypes} categories={categories} accounts={accounts} entry={editingEntry} onClose={() => setEditingEntry(undefined)} onSubmit={createEntry} /> : null}
    </>
  );
}

export function GoalsView({ onNotify }: { onNotify: (message: string) => void }) {
  return <PlanningEmptyView title="Savings goals" description="Track what you are saving toward." icon={<Target size={20} />} emptyTitle="No savings goals yet" emptyDescription="Goals with target amounts and deadlines will show their progress here." actionLabel="Create goal" onAction={() => onNotify('Savings goals are coming in the next phase.')} />;
}

function ActivityLog({ data }: { data: FinanceData }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [action, setAction] = useState<ActivityAction | 'all'>('all');
  const [entity, setEntity] = useState<ActivityEvent['entityTable'] | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadActivityEvents({ action, entity, from: from || undefined, to: to || undefined, page, pageSize: 20 })
      .then((result) => {
        if (!active) return;
        setEvents(result.events);
        setHasMore(result.hasMore);
        setError('');
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [action, entity, from, to, page]);

  const changeFilters = (next: () => void) => { setPage(0); next(); };
  const toggleDetails = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  return (
    <div className="surface-card activity-log-card">
      <div className="card-title-row"><div><h3>Activity log</h3><p>Important changes to your finance workspace. Records cannot be edited here.</p></div></div>
      <div className="filter-row activity-filters">
        <select value={action} onChange={(event) => changeFilters(() => setAction(event.target.value as ActivityAction | 'all'))} aria-label="Filter activity by action">
          <option value="all">All actions</option><option value="created">Created</option><option value="updated">Updated</option><option value="renamed">Renamed</option><option value="deleted">Deleted</option><option value="paused">Paused</option><option value="resumed">Resumed</option><option value="signed_in">Signed in</option><option value="signed_out">Signed out</option>
        </select>
        <select value={entity} onChange={(event) => changeFilters(() => setEntity(event.target.value as ActivityEvent['entityTable'] | 'all'))} aria-label="Filter activity by item type">
          <option value="all">All items</option><option value="transactions">Transactions</option><option value="investments">Investments</option><option value="investment_types">Investment types</option><option value="recurring_entries">Recurring</option><option value="budgets">Budgets</option><option value="accounts">Accounts</option><option value="categories">Categories</option><option value="transaction_types">Transaction types</option><option value="authentication">Sign-in activity</option>
        </select>
        <DatePicker label="From" value={from} max={to || undefined} onChange={(value) => changeFilters(() => setFrom(value))} clearable />
        <DatePicker label="To" value={to} min={from || undefined} onChange={(value) => changeFilters(() => setTo(value))} clearable />
      </div>
      {loading ? <p className="card-note">Loading activity…</p> : error ? <p className="form-error">{error}</p> : events.length === 0 ? <p className="card-note">No activity matches these filters yet.</p> : <div className="activity-list">{events.map((event) => <ActivityLogRow key={event.id} event={event} data={data} expanded={expandedIds.has(event.id)} onToggle={() => toggleDetails(event.id)} />)}</div>}
      <div className="table-pagination"><span>{events.length ? `Page ${page + 1}` : ''}</span><div><button className="secondary-button" type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button className="secondary-button" type="button" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </div>
  );
}

function isDetailObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readableDetail(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function DetailGroup({ title, values }: { title: string; values: Record<string, unknown> }) {
  const entries = Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!entries.length) return null;
  return <section className="activity-detail-group"><h4>{title}</h4><dl>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{readableDetail(value)}</dd></div>)}</dl></section>;
}

function currentRecordDetails(event: ActivityEvent, data: FinanceData): Record<string, unknown> | null {
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const typeById = new Map(data.transactionTypes.map((type) => [type.id, type]));
  const categoryById = new Map(data.categories.map((category) => [category.id, category]));
  if (event.entityTable === 'transactions') {
    const item = data.transactions.find((transaction) => transaction.id === event.entityId);
    if (!item) return null;
    return {
      'Name': item.name, 'Amount': formatMoney(item.amount), 'Counts as': item.kind,
      'Transaction type': item.typeName, 'Category': item.categoryName ?? 'None', 'Account': item.accountName,
      'To account': item.toAccountName ?? '—', 'Date': formatDate(item.date), 'Time': item.time ? formatTime(item.time) : 'Not recorded',
      'Source': item.source === 'scheduled' ? 'Scheduled recurring entry' : item.source === 'investment' ? 'Investment entry' : 'Manual entry',
    };
  }
  if (event.entityTable === 'recurring_entries') {
    const item = data.recurringEntries.find((entry) => entry.id === event.entityId);
    if (!item) return null;
    return {
      'Name': item.name, 'Amount': formatMoney(item.amount), 'Transaction type': typeById.get(item.typeId)?.name ?? 'Archived type',
      'Category': item.categoryId ? (categoryById.get(item.categoryId)?.name ?? 'Archived category') : 'Transfer',
      'Account': accountById.get(item.accountId)?.name ?? 'Archived account',
      'To account': item.toAccountId ? (accountById.get(item.toAccountId)?.name ?? 'Archived account') : '—',
      'Frequency': `Every ${item.intervalValue} ${item.intervalUnit}${item.intervalValue === 1 ? '' : 's'}`,
      'Next due': formatDate(item.nextDate), 'End date': item.endDate ? formatDate(item.endDate) : 'No end date',
      'Status': item.isActive ? 'Active' : 'Paused', 'Last processed': item.lastProcessedDate ? formatDate(item.lastProcessedDate) : 'Not processed yet',
    };
  }
  if (event.entityTable === 'budgets') {
    const item = data.budgets.find((budget) => budget.id === event.entityId);
    if (!item) return null;
    return { 'Category': categoryById.get(item.categoryId)?.name ?? 'Archived category', 'Monthly limit': formatMoney(item.amount) };
  }
  if (event.entityTable === 'accounts') {
    const item = data.accounts.find((account) => account.id === event.entityId);
    if (!item) return null;
    return { 'Account name': item.name, 'Description': item.description || '—', 'Opening balance': formatMoney(item.openingBalance), 'Opening balance date': formatDate(item.openingBalanceDate), 'Account kind': item.isLiability ? 'Credit card / loan' : 'Asset', 'Status': item.deletedAt ? 'Deleted' : item.isActive ? 'Active' : 'Inactive' };
  }
  if (event.entityTable === 'categories') {
    const item = data.categories.find((category) => category.id === event.entityId);
    if (!item) return null;
    return { 'Category name': item.name, 'Emoji': item.emoji || 'None', 'Transaction types': item.transactionTypeIds.map((id) => typeById.get(id)?.name ?? 'Archived type').join(', ') || 'None', 'Status': item.deletedAt ? 'Deleted' : item.isActive ? 'Active' : 'Inactive' };
  }
  if (event.entityTable === 'transaction_types') {
    const item = data.transactionTypes.find((type) => type.id === event.entityId);
    if (!item) return null;
    return { 'Type name': item.name, 'Counts as': item.kind, 'Status': item.deletedAt ? 'Deleted' : item.isActive ? 'Active' : 'Inactive' };
  }
  if (event.entityTable === 'investments') {
    const item = data.investments.find((investment) => investment.id === event.entityId);
    if (!item) return null;
    return investmentDetails(item, accountById);
  }
  if (event.entityTable === 'investment_types') {
    const item = data.investmentTypes.find((investmentType) => investmentType.id === event.entityId);
    return item ? { 'Investment type': item.name } : null;
  }
  if (event.entityTable === 'authentication') return { 'Email': event.entityName, 'Action': event.action.replace(/_/g, ' '), 'Session policy': 'This browser tab only' };
  return null;
}

function investmentDetails(item: Investment, accountById: Map<string, Account>): Record<string, unknown> {
  return {
    'Investment name': item.name, 'Investment type': item.investmentType, 'Capital': formatMoney(item.principalAmount),
    'Funded from': accountById.get(item.fundingAccountId)?.name ?? 'Archived account',
    'Investment Capital account': accountById.get(item.capitalAccountId)?.name ?? 'Archived account',
    'Invested on': formatDate(item.investedOn), 'Status': item.status === 'active' ? 'Active' : 'Settled',
    'Final value': item.finalAmount === null ? 'Not settled' : formatMoney(item.finalAmount),
    'Profit / loss': item.profitAmount === null ? 'Not settled' : formatMoney(item.profitAmount),
    'Settled on': item.settledOn ? formatDate(item.settledOn) : 'Not settled', 'Notes': item.notes || '—',
  };
}

function ActivityLogRow({ event, data, expanded, onToggle }: { event: ActivityEvent; data: FinanceData; expanded: boolean; onToggle: () => void }) {
  const current = isDetailObject(event.details.current) ? event.details.current : null;
  const previous = isDetailObject(event.details.previous) ? event.details.previous : null;
  const directDetails = current || previous ? null : event.details;
  const hasStoredDetails = [current, previous, directDetails].some((value) => value && Object.keys(value).length);
  const fallbackDetails = hasStoredDetails ? null : currentRecordDetails(event, data);
  const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt));
  return (
    <article className={`activity-row ${expanded ? 'expanded' : ''}`}>
      <div className="activity-row-summary"><div><b>{event.entityName || event.entityTable.replace(/_/g, ' ')}</b><small>{event.entityTable.replace(/_/g, ' ')}</small></div><span className="activity-action">{event.action.replace(/_/g, ' ')}</span><time dateTime={event.createdAt}>{dateTime}</time><button className="ghost-button activity-details-button" type="button" onClick={onToggle} aria-expanded={expanded}>{expanded ? 'Hide details' : 'View details'}</button></div>
      {expanded ? <div className="activity-details"><DetailGroup title={previous ? 'Before' : 'Recorded details'} values={previous ?? directDetails ?? fallbackDetails ?? {}} /><DetailGroup title={previous ? 'After' : 'Current details'} values={current ?? {}} />{!hasStoredDetails ? <p className="activity-legacy-note">{fallbackDetails ? 'This event happened before detailed auditing was enabled. Values above are the current record and may have changed since this activity.' : 'Detailed fields were not captured for this earlier activity, and its original record is no longer available.'}</p> : null}</div> : null}
    </article>
  );
}

export function SettingsView({ onExport, hasData, data }: { onExport: () => void; hasData: boolean; data: FinanceData }) {
  return (
    <>
      <SectionHeading title="Settings" description="Preferences and your data." />
      <div className="surface-card settings-card"><div className="card-title-row"><div><h3><Settings size={16} /> Currency</h3><p>All amounts are shown in Indian Rupees (₹).</p></div></div></div>
      <div className="surface-card settings-card"><div className="card-title-row"><div><h3><Download size={16} /> Export data</h3><p>Download every transaction as a spreadsheet-ready CSV file.</p></div><button className="secondary-button" type="button" onClick={onExport} disabled={!hasData}><Download size={16} /> Export CSV</button></div></div>
      <ActivityLog data={data} />
    </>
  );
}
