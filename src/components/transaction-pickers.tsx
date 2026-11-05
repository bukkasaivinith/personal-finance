import { useState, type ReactNode } from 'react';
import { parseAmount, todayKey, type CategoryOption, type TransactionKind, type TransactionTypeOption } from '@/lib/finance';

const NEW_OPTION = '__new__';

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
  children,
}: {
  intro: string;
  error: string;
  saving: boolean;
  onCancel?: () => void;
  onConfirm: () => void;
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
          {saving ? 'Saving...' : 'Add'}
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
}: {
  value: string;
  options: TransactionTypeOption[];
  onChange: (id: string) => void;
  onCreate: (input: { name: string; kind: TransactionKind }) => Promise<string>;
}) {
  const [creating, setCreating] = useState(options.length === 0);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCreating(false);
    setName('');
    setError('');
  };

  const select = (next: string) => {
    if (next === NEW_OPTION) {
      setCreating(true);
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

  return (
    <>
      <label>
        Transaction type
        <select value={creating ? NEW_OPTION : value} onChange={(event) => select(event.target.value)}>
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
    </>
  );
}

export function CategoryPicker({
  value,
  options,
  onChange,
  onCreate,
}: {
  value: string;
  options: CategoryOption[];
  onChange: (id: string) => void;
  onCreate: (input: { name: string; emoji: string | null }) => Promise<string>;
}) {
  const [creating, setCreating] = useState(options.length === 0);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCreating(false);
    setName('');
    setEmoji('');
    setError('');
  };

  const select = (next: string) => {
    if (next === NEW_OPTION) {
      setCreating(true);
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

  return (
    <>
      <label>
        Category
        <select value={creating ? NEW_OPTION : value} onChange={(event) => select(event.target.value)}>
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
          <label>
            Emoji (optional)
            <input
              value={emoji}
              onChange={(event) => setEmoji(event.target.value)}
              maxLength={16}
              placeholder="e.g. 🍽️"
              aria-label="Category emoji"
            />
          </label>
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
      <label>
        Opening balance date
        <input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} />
      </label>
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
}: {
  label: string;
  value: string;
  accounts: { id: string; name: string }[];
  onChange: (id: string) => void;
  onCreate: (draft: AccountDraft) => Promise<string>;
}) {
  const [creating, setCreating] = useState(accounts.length === 0);

  return (
    <>
      <label>
        {label}
        <select
          value={creating ? NEW_OPTION : value}
          onChange={(event) => {
            if (event.target.value === NEW_OPTION) {
              setCreating(true);
              return;
            }
            setCreating(false);
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
              setCreating(false);
              return id;
            }}
            onCancel={accounts.length === 0 ? undefined : () => setCreating(false)}
          />
        </div>
      ) : null}
    </>
  );
}
