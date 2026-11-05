import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, Download, Pencil, PiggyBank, Play, Plus, Repeat2, Settings, Target, Trash2 } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { EmptyPanel, ModalShell, SectionHeading } from '@/components/ui';
import type { FinanceActions } from '@/lib/finance-actions';
import {
  categoriesFor,
  currentMonthKey,
  formatDate,
  formatMoney,
  isUsable,
  parseAmount,
  todayKey,
  type Account,
  type Budget,
  type CategoryOption,
  type RecurringEntry,
  type RecurringEntryDraft,
  type Transaction,
  type TransactionTypeOption,
} from '@/lib/finance';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
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
  onClose,
  onSubmit,
}: {
  transactionTypes: TransactionTypeOption[];
  categories: CategoryOption[];
  accounts: Account[];
  onClose: () => void;
  onSubmit: (draft: RecurringEntryDraft) => Promise<void>;
}) {
  const usableTypes = transactionTypes.filter(isUsable);
  const usableAccounts = accounts.filter(isUsable);
  const [typeId, setTypeId] = useState(usableTypes[0]?.id ?? '');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState(usableAccounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [nextDate, setNextDate] = useState(todayKey());
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
    if (!selectedType) { setError('Choose a transaction type.'); return; }
    if (!name.trim()) { setError('Add a name for this repeating entry.'); return; }
    if (!Number.isFinite(value) || value <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!accountId) { setError('Choose an account.'); return; }
    if (!isTransfer && !categoryId) { setError('Choose a category that fits this type.'); return; }
    if (isTransfer && !toAccountId) { setError('Choose the account to move money into.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), typeId, categoryId: isTransfer ? null : categoryId, amount: value, accountId, toAccountId: isTransfer ? toAccountId : null, frequency, nextDate });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell eyebrow="Recurring" title="Add recurring entry" labelId="recurring-modal-title" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-description">When it is due, record it once and we will create the transaction and move its next date forward.</p>
        <div className="form-grid">
          <label className="full-field">Transaction type<select value={typeId} onChange={(event) => changeType(event.target.value)}>{usableTypes.length === 0 ? <option value="">No active types available</option> : null}{usableTypes.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.kind})</option>)}</select></label>
          <label className="full-field">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Monthly rent" maxLength={60} autoFocus /></label>
          <label>Amount (₹)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 15000" /></label>
          <label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as 'weekly' | 'monthly')}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></label>
          {!isTransfer ? <label className="full-field">Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Choose a category</option>{compatibleCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji ? `${category.emoji} ` : ''}{category.name}</option>)}</select></label> : null}
          <label className={isTransfer ? '' : 'full-field'}>{isTransfer ? 'From account' : 'Account'}<select value={accountId} onChange={(event) => { setAccountId(event.target.value); setToAccountId(''); }}><option value="">Choose an account</option>{usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          {isTransfer ? <label>To account<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}><option value="">Choose an account</option>{destinationAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : null}
          <div className="full-field"><DatePicker label="First due date" value={nextDate} onChange={setNextDate} /></div>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || usableTypes.length === 0 || usableAccounts.length === 0}>{saving ? 'Saving...' : 'Add recurring entry'}</button></div>
      </form>
    </ModalShell>
  );
}

export function RecurringView({
  entries,
  categories,
  accounts,
  transactionTypes,
  actions,
  onNotify,
}: {
  entries: RecurringEntry[];
  categories: CategoryOption[];
  accounts: Account[];
  transactionTypes: TransactionTypeOption[];
  actions: FinanceActions;
  onNotify: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const typeById = new Map(transactionTypes.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const accountById = new Map(accounts.map((item) => [item.id, item]));

  const createEntry = async (draft: RecurringEntryDraft) => {
    await actions.createRecurringEntry(draft);
    setAdding(false);
    onNotify('Recurring entry added.');
  };
  const changeActive = async (entry: RecurringEntry) => {
    setBusyId(entry.id);
    try {
      await actions.setRecurringEntryActive(entry.id, !entry.isActive);
      onNotify(entry.isActive ? 'Recurring entry paused.' : 'Recurring entry resumed.');
    } catch (error) { onNotify(errorMessage(error)); } finally { setBusyId(''); }
  };
  const record = async (entry: RecurringEntry) => {
    setBusyId(entry.id);
    try {
      await actions.recordRecurringEntry(entry);
      onNotify(`${entry.name} recorded. The next date has been moved forward.`);
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
      <SectionHeading title="Recurring" description="Salary, rent, subscriptions and other repeating entries." action={<button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add recurring entry</button>} />
      {entries.length === 0 ? (
        <div className="surface-card"><EmptyPanel icon={<CalendarDays size={20} />} title="No recurring entries yet" description="Add a repeating income, bill or transfer, then record it whenever it is due." action={<button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add recurring entry</button>} /></div>
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
                <div className="recurring-main"><div className="recurring-title-row"><h3>{entry.name}</h3>{!entry.isActive ? <span className="status-tag inactive">Paused</span> : due ? <span className="due-tag">Due now</span> : null}</div><p>{type?.name || 'Archived type'} · {category?.name || (type?.kind === 'transfer' ? 'Transfer' : 'Archived category')} · {account?.name || 'Archived account'}</p><small>{entry.frequency === 'monthly' ? 'Every month' : 'Every week'} · Next due {formatDate(entry.nextDate)}</small></div>
                <div className="recurring-amount"><strong className={type?.kind === 'income' ? 'positive' : ''}>{formatMoney(entry.amount)}</strong><span>{type?.kind || 'transaction'}</span></div>
                <div className="item-actions recurring-actions">
                  <button className="primary-button compact-primary" type="button" onClick={() => void record(entry)} disabled={busyId === entry.id || !entry.isActive}><Play size={14} /> Record</button>
                  <button className="ghost-button" type="button" onClick={() => void changeActive(entry)} disabled={busyId === entry.id}>{entry.isActive ? 'Pause' : 'Resume'}</button>
                  <button className="ghost-button danger" type="button" aria-label="Remove recurring entry" onClick={() => void remove(entry)} disabled={busyId === entry.id}><Trash2 size={15} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {adding ? <RecurringModal transactionTypes={transactionTypes} categories={categories} accounts={accounts} onClose={() => setAdding(false)} onSubmit={createEntry} /> : null}
    </>
  );
}

export function GoalsView({ onNotify }: { onNotify: (message: string) => void }) {
  return <PlanningEmptyView title="Savings goals" description="Track what you are saving toward." icon={<Target size={20} />} emptyTitle="No savings goals yet" emptyDescription="Goals with target amounts and deadlines will show their progress here." actionLabel="Create goal" onAction={() => onNotify('Savings goals are coming in the next phase.')} />;
}

export function SettingsView({ onExport, hasData }: { onExport: () => void; hasData: boolean }) {
  return (
    <>
      <SectionHeading title="Settings" description="Preferences and your data." />
      <div className="surface-card settings-card"><div className="card-title-row"><div><h3><Settings size={16} /> Currency</h3><p>All amounts are shown in Indian Rupees (₹).</p></div></div></div>
      <div className="surface-card settings-card"><div className="card-title-row"><div><h3><Download size={16} /> Export data</h3><p>Download every transaction as a spreadsheet-ready CSV file.</p></div><button className="secondary-button" type="button" onClick={onExport} disabled={!hasData}><Download size={16} /> Export CSV</button></div></div>
    </>
  );
}
