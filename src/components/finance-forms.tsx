import { useState, type FormEvent } from 'react';
import { AccountCreateForm, AccountPicker, CategoryPicker, TypePicker, type AccountDraft } from '@/components/transaction-pickers';
import { ModalShell } from '@/components/ui';
import {
  categoriesFor,
  parseAmount,
  todayKey,
  type Account,
  type CategoryOption,
  type TransactionDraft,
  type TransactionKind,
  type TransactionTypeOption,
} from '@/lib/finance';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function AddAccountModal({
  accounts,
  onCreate,
  onClose,
}: {
  accounts: { name: string }[];
  onCreate: (draft: AccountDraft) => Promise<string>;
  onClose: () => void;
}) {
  return (
    <ModalShell eyebrow="Accounts" title="Add account" labelId="account-modal-title" onClose={onClose}>
      <div className="modal-form">
        <AccountCreateForm accounts={accounts} onCreate={onCreate} onCancel={onClose} />
      </div>
    </ModalShell>
  );
}

export function EditAccountModal({
  account,
  onSubmit,
  onClose,
}: {
  account: Account;
  onSubmit: (input: { name: string; description: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [description, setDescription] = useState(account.description);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the account a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell eyebrow="Accounts" title="Edit account" labelId="edit-account-title" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-description">Past transactions keep the name they were recorded with. Opening balance cannot be changed here.</p>
        <div className="form-grid">
          <label className="full-field">
            Account name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoFocus />
          </label>
          <label className="full-field">
            Description (optional)
            <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save account'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function AddTransactionModal({
  accounts,
  transactionTypes,
  categories,
  onClose,
  onSubmit,
  onCreateTransactionType,
  onCreateCategory,
  onCreateAccount,
}: {
  accounts: Account[];
  transactionTypes: TransactionTypeOption[];
  categories: CategoryOption[];
  onClose: () => void;
  onSubmit: (draft: TransactionDraft) => Promise<void>;
  onCreateTransactionType: (input: { name: string; kind: TransactionKind }) => Promise<string>;
  onCreateCategory: (input: { name: string; emoji: string | null; parentId: null; transactionTypeIds: string[] }) => Promise<string>;
  onCreateAccount: (draft: AccountDraft) => Promise<string>;
}) {
  const [typeId, setTypeId] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [date, setDate] = useState(todayKey());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedType = transactionTypes.find((option) => option.id === typeId);
  const isTransfer = selectedType?.kind === 'transfer';
  const compatibleCategories = selectedType ? categoriesFor(categories, selectedType.id) : [];
  const activeCategoryId = compatibleCategories.some((option) => option.id === categoryId) ? categoryId : '';
  const activeAccountId = accounts.some((account) => account.id === accountId) ? accountId : '';
  const destinationAccounts = accounts.filter((account) => account.id !== activeAccountId);
  const activeToAccountId = destinationAccounts.some((account) => account.id === toAccountId) ? toAccountId : '';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedType) {
      setError('Choose a transaction type.');
      return;
    }
    const value = parseAmount(amount);
    if (!name.trim()) {
      setError('Add a name or description for this transaction.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!isTransfer && !activeCategoryId) {
      setError('Choose a category that fits this transaction type.');
      return;
    }
    if (!activeAccountId) {
      setError(isTransfer ? 'Choose the account to move money from.' : 'Choose an account.');
      return;
    }
    if (isTransfer && !activeToAccountId) {
      setError('Choose the account to move money into.');
      return;
    }
    if (!date) {
      setError('Choose a date.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        typeId: selectedType.id,
        categoryId: isTransfer ? null : activeCategoryId,
        amount: value,
        date,
        accountId: activeAccountId,
        toAccountId: isTransfer ? activeToAccountId : null,
      });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell eyebrow="Transactions" title="Add transaction" labelId="transaction-modal-title" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <TypePicker value={typeId} options={transactionTypes} onChange={setTypeId} onCreate={onCreateTransactionType} />
          <label>
            Amount (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              autoFocus
            />
          </label>
          <label className="full-field">
            Description
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              placeholder="e.g. Grocery run"
            />
          </label>
          {selectedType ? (
            <>
              {!isTransfer ? (
                <CategoryPicker
                  value={activeCategoryId}
                  options={compatibleCategories}
                  onChange={setCategoryId}
                  onCreate={(category) =>
                    onCreateCategory({ ...category, parentId: null, transactionTypeIds: [selectedType.id] })
                  }
                />
              ) : null}
              <AccountPicker
                label={isTransfer ? 'From account' : 'Account'}
                value={activeAccountId}
                accounts={accounts}
                onChange={setAccountId}
                onCreate={onCreateAccount}
              />
              {isTransfer ? (
                <AccountPicker
                  label="To account"
                  value={activeToAccountId}
                  accounts={destinationAccounts}
                  onChange={setToAccountId}
                  onCreate={onCreateAccount}
                />
              ) : null}
            </>
          ) : (
            <p className="modal-description full-field">
              {transactionTypes.length === 0
                ? 'Create a transaction type first. Its categories and accounts will appear here.'
                : 'Choose a transaction type to see its categories and accounts.'}
            </p>
          )}
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save transaction'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
