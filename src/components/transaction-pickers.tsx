import { useState, type ReactNode } from 'react';
import { CategoryEmojiPicker } from '@/components/category-emoji-picker';
import { DatePicker } from '@/components/date-picker';
import { parseAmount, todayKey, type Account, type CategoryOption, type TransactionKind, type TransactionTypeOption } from '@/lib/finance';

const NEW_OPTION = '__new__';
const EDIT_OPTION = '__edit__';

export const kindChoices: { value: TransactionKind; label: string }[] = [
  { value: 'expense', label: 'Expense (money out)' },
  { value: 'income', label: 'Income (money in)' },
  { value: 'transfer', label: 'Transfer (between your accounts)' },
];

export type AccountDraft = {
  name: string;
  description: string;
  openingBalance: number;
  openingBalanceDate: string;
  isLiability: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function hasName(list: { name: string }[], name: string): boolean {
  return list.some((item) => item.name.toLowerCase() === name.toLowerCase());
}

function InlineCreate({
  intro,
  error,
  saving,
  onCancel,
  onConfirm,
  confirmLabel = 'Add',
  children,
}: {
  intro: string;
  error: string;
  saving: boolean;
  onCancel?: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="inline-create form-grid full-field"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          onConfirm();
        }
      }}
    >
      <p className="inline-create-intro full-field">{intro}</p>
      {children}
      {error ? <p className="form-error full-field">{error}</p> : null}
      <div className="inline-create-actions full-field">
        {onCancel ? (
          <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        ) : null}
        <button className="primary-button" type="button" onClick={onConfirm} disabled={saving}>
          {saving ? 'Saving...' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function TypePicker({
  value,
  options,
  onChange,
  onCreate,
  onUpdate,
}: {
  value: string;
  options: TransactionTypeOption[];
  onChange: (id: string) => void;
  onCreate: (input: { name: string; kind: TransactionKind }) => Promise<string>;
  onUpdate: (id: string, input: { name: string; kind: TransactionKind }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(options.length === 0);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [editName, setEditName] = useState('');
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [editKind, setEditKind] = useState<TransactionKind>('expense');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = options.find((option) => option.id === value);

  const reset = () => {
    setCreating(false);
    setEditing(false);
    setName('');
    setEditName('');
    setEditKind('expense');
    setError('');
  };

  const select = (next: string) => {
    if (next === NEW_OPTION) {
      setEditing(false);
      setCreating(true);
      return;
    }
    if (next === EDIT_OPTION && selected) {
      setCreating(false);
      setEditing(true);
      setEditName(selected.name);
      setEditKind(selected.kind);
      setError('');
      return;
    }
    reset();
    onChange(next);
  };

  const confirm = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the transaction type a name.');
      return;
    }
    if (hasName(options, trimmed)) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = await onCreate({ name: trimmed, kind });
      onChange(id);
      reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmEdit = async () => {
    if (!selected) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('Give the transaction type a name.');
      return;
    }
    if (options.some((option) => option.id !== selected.id && option.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onUpdate(selected.id, { name: trimmed, kind: editKind });
      reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <label>
        Transaction type
        <select value={creating ? NEW_OPTION : editing ? EDIT_OPTION : value} onChange={(event) => select(event.target.value)}>
          {value === '' && !creating ? (
            <option value="" disabled>
              {options.length === 0 ? 'No transaction types yet' : 'Choose a type'}
            </option>
          ) : null}
          {options.map((option) => (
            <option value={option.id} key={option.id}>
              {option.name}
            </option>
          ))}
          {selected ? <option value={EDIT_OPTION}>✎ Edit selected transaction type</option> : null}
          <option value={NEW_OPTION}>+ Create transaction type</option>
        </select>
      </label>
      {creating ? (
        <InlineCreate
          intro={options.length === 0 ? 'Create your first transaction type to get started.' : 'New transaction type'}
          error={error}
          saving={saving}
          onCancel={options.length === 0 ? undefined : reset}
          onConfirm={() => void confirm()}
        >
          <label className="full-field">
            Type name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              placeholder="e.g. Groceries"
              autoFocus
            />
          </label>
          <label className="full-field">
            Counts as
            <select value={kind} onChange={(event) => setKind(event.target.value as TransactionKind)}>
              {kindChoices.map((choice) => (
                <option value={choice.value} key={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </InlineCreate>
      ) : null}
      {editing && selected ? (
        <InlineCreate
          intro="Correct the name or whether this type counts as income or an expense. Existing transactions will update too."
          error={error}
          saving={saving}
          onCancel={reset}
          onConfirm={() => void confirmEdit()}
          confirmLabel="Save changes"
        >
          <label className="full-field">
            Transaction type name
            <input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={32} autoFocus />
          </label>
          <label className="full-field">
            Counts as
            <select value={editKind} onChange={(event) => setEditKind(event.target.value as TransactionKind)} disabled={selected.kind === 'transfer'}>
              {kindChoices
                .filter((choice) => (selected.kind === 'transfer' ? choice.value === 'transfer' : choice.value !== 'transfer'))
                .map((choice) => <option value={choice.value} key={choice.value}>{choice.label}</option>)}
            </select>
          </label>
          {selected.kind === 'transfer' ? <p className="form-hint full-field">Transfer types stay as transfers because their existing entries have two accounts.</p> : null}
        </InlineCreate>
      ) : null}
    </>
  );
}

export function CategoryPicker({
  value,
  options,
  onChange,
  onCreate,
  onUpdate,
}: {
  value: string;
  options: CategoryOption[];
  onChange: (id: string) => void;
  onCreate: (input: { name: string; emoji: string | null }) => Promise<string>;
  onUpdate: (id: string, input: { name: string; emoji: string | null; parentId: string | null; transactionTypeIds: string[] }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(options.length === 0);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = options.find((option) => option.id === value);

  const reset = () => {
    setCreating(false);
    setEditing(false);
    setName('');
    setEmoji('');
    setEditName('');
    setEditEmoji('');
    setError('');
  };

  const select = (next: string) => {
    if (next === NEW_OPTION) {
      setEditing(false);
      setCreating(true);
      return;
    }
    if (next === EDIT_OPTION && selected) {
      setCreating(false);
      setEditing(true);
      setEditName(selected.name);
      setEditEmoji(selected.emoji ?? '');
      setError('');
      return;
    }
    reset();
    onChange(next);
  };

  const confirm = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the category a name.');
      return;
    }
    if (hasName(options, trimmed)) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = await onCreate({ name: trimmed, emoji: emoji.trim() || null });
      onChange(id);
      reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmEdit = async () => {
    if (!selected) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('Give the category a name.');
      return;
    }
    if (options.some((option) => option.id !== selected.id && option.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onUpdate(selected.id, {
        name: trimmed,
        emoji: editEmoji.trim() || null,
        parentId: selected.parentId,
        transactionTypeIds: selected.transactionTypeIds,
      });
      reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <label>
        Category
        <select value={creating ? NEW_OPTION : editing ? EDIT_OPTION : value} onChange={(event) => select(event.target.value)}>
          {value === '' && !creating ? (
            <option value="" disabled>
              {options.length === 0 ? 'No categories for this type yet' : 'Choose a category'}
            </option>
          ) : null}
          {options.map((option) => (
            <option value={option.id} key={option.id}>
              {option.emoji ? `${option.emoji} ${option.name}` : option.name}
            </option>
          ))}
          {selected ? <option value={EDIT_OPTION}>✎ Edit selected category</option> : null}
          <option value={NEW_OPTION}>+ Create category</option>
        </select>
      </label>
      {creating ? (
        <InlineCreate
          intro={
            options.length === 0
              ? 'No categories fit this transaction type yet. Create one to continue.'
              : 'New category for this transaction type'
          }
          error={error}
          saving={saving}
          onCancel={options.length === 0 ? undefined : reset}
          onConfirm={() => void confirm()}
        >
          <label className="full-field">
            Category name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              placeholder="e.g. Pets"
              autoFocus
            />
          </label>
          <CategoryEmojiPicker value={emoji} onChange={setEmoji} />
        </InlineCreate>
      ) : null}
      {editing && selected ? (
        <InlineCreate
          intro="Correct this category's name or emoji. Its transaction type stays unchanged."
          error={error}
          saving={saving}
          onCancel={reset}
          onConfirm={() => void confirmEdit()}
          confirmLabel="Save changes"
        >
          <label className="full-field">
            Category name
            <input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={32} autoFocus />
          </label>
          <CategoryEmojiPicker value={editEmoji} onChange={setEditEmoji} />
        </InlineCreate>
      ) : null}
    </>
  );
}

export function AccountCreateForm({
  accounts,
  onCreate,
  onCancel,
}: {
  accounts: { name: string }[];
  onCreate: (draft: AccountDraft) => Promise<string>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [balance, setBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(todayKey());
  const [isLiability, setIsLiability] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give this account a name.');
      return;
    }
    if (hasName(accounts, trimmedName)) {
      setError(`"${trimmedName}" already exists.`);
      return;
    }
    const amount = balance.trim() === '' ? 0 : parseAmount(balance);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter an opening balance of zero or more.');
      return;
    }
    if (!openingDate) {
      setError('Choose the date this opening balance starts from.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onCreate({
        name: trimmedName,
        description: description.trim(),
        openingBalance: amount,
        openingBalanceDate: openingDate,
        isLiability,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-grid account-create">
      <label className="full-field">
        Account name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="e.g. HDFC Savings"
          autoFocus
        />
      </label>
      <label>
        {isLiability ? 'Amount currently owed (₹)' : 'Opening balance (₹)'}
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          placeholder="0"
        />
      </label>
      <DatePicker label="Opening balance date" value={openingDate} onChange={setOpeningDate} />
      <label className="full-field">
        Description (optional)
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={200}
          placeholder="e.g. Joint account for household bills"
        />
      </label>
      <label className="check-row full-field">
        <input type="checkbox" checked={isLiability} onChange={(event) => setIsLiability(event.target.checked)} />
        This is a credit card or loan (money I owe)
      </label>
      {error ? <p className="form-error full-field">{error}</p> : null}
      <div className="modal-actions full-field">
        {onCancel ? (
          <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        ) : null}
        <button className="primary-button" type="button" onClick={() => void submit()} disabled={saving}>
          {saving ? 'Saving...' : 'Save account'}
        </button>
      </div>
    </div>
  );
}

export function AccountPicker({
  label,
  value,
  accounts,
  onChange,
  onCreate,
  onUpdate,
}: {
  label: string;
  value: string;
  accounts: Account[];
  onChange: (id: string) => void;
  onCreate: (draft: AccountDraft) => Promise<string>;
  onUpdate: (id: string, input: { name: string; description: string }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(accounts.length === 0);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = accounts.find((account) => account.id === value);

  const reset = () => {
    setCreating(false);
    setEditing(false);
    setEditName('');
    setEditDescription('');
    setError('');
  };

  const confirmEdit = async () => {
    if (!selected) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('Give this account a name.');
      return;
    }
    if (accounts.some((account) => account.id !== selected.id && account.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onUpdate(selected.id, { name: trimmed, description: editDescription.trim() });
      reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <label>
        {label}
        <select
          value={creating ? NEW_OPTION : editing ? EDIT_OPTION : value}
          onChange={(event) => {
            if (event.target.value === NEW_OPTION) {
              setEditing(false);
              setCreating(true);
              return;
            }
            if (event.target.value === EDIT_OPTION && selected) {
              setCreating(false);
              setEditing(true);
              setEditName(selected.name);
              setEditDescription(selected.description);
              setError('');
              return;
            }
            reset();
            onChange(event.target.value);
          }}
        >
          {value === '' && !creating ? (
            <option value="" disabled>
              {accounts.length === 0 ? 'No accounts yet' : 'Choose an account'}
            </option>
          ) : null}
          {accounts.map((account) => (
            <option value={account.id} key={account.id}>
              {account.name}
            </option>
          ))}
          {selected ? <option value={EDIT_OPTION}>✎ Edit selected account</option> : null}
          <option value={NEW_OPTION}>+ Create account</option>
        </select>
      </label>
      {creating ? (
        <div className="full-field">
          <AccountCreateForm
            accounts={accounts}
            onCreate={async (draft) => {
              const id = await onCreate(draft);
              onChange(id);
              reset();
              return id;
            }}
            onCancel={accounts.length === 0 ? undefined : reset}
          />
        </div>
      ) : null}
      {editing && selected ? (
        <InlineCreate
          intro="Correct this account's name or description. Its opening balance stays unchanged."
          error={error}
          saving={saving}
          onCancel={reset}
          onConfirm={() => void confirmEdit()}
          confirmLabel="Save changes"
        >
          <label className="full-field">
            Account name
            <input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={40} autoFocus />
          </label>
          <label className="full-field">
            Description (optional)
            <input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={200} />
          </label>
        </InlineCreate>
      ) : null}
    </>
  );
}
