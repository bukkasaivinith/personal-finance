import { useState, type FormEvent } from 'react';
import { kindChoices } from '@/components/transaction-pickers';
import { ModalShell } from '@/components/ui';
import { isUsable, type CategoryOption, type TransactionKind, type TransactionTypeOption } from '@/lib/finance';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function TransactionTypeModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: { name: string; kind: TransactionKind }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the transaction type a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), kind });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell eyebrow="Types & categories" title="Create transaction type" labelId="type-modal-title" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-description">
          Name the type however you like. "Counts as" controls how it affects your totals. It cannot be changed later, so past totals stay correct.
        </p>
        <div className="form-grid">
          <label className="full-field">
            Type name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              placeholder="e.g. Reimbursement"
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
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Create type'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function RenameTypeModal({
  type,
  onClose,
  onSubmit,
}: {
  type: TransactionTypeOption;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(type.name);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the transaction type a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell eyebrow="Types & categories" title="Rename transaction type" labelId="rename-type-title" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-description">Past transactions keep the name they were recorded with.</p>
        <label>
          Type name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} autoFocus />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save name'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export type CategoryFormValues = { name: string; parentId: string | null; transactionTypeIds: string[] };

export function CategoryFormModal({
  category,
  categories,
  transactionTypes,
  onClose,
  onSubmit,
}: {
  category: CategoryOption | null;
  categories: CategoryOption[];
  transactionTypes: TransactionTypeOption[];
  onClose: () => void;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [typeIds, setTypeIds] = useState<string[]>(category?.transactionTypeIds ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const hasChildren = category ? categories.some((option) => option.parentId === category.id) : false;
  const parentOptions = categories.filter((option) => isUsable(option) && option.parentId === null && option.id !== category?.id);
  const typeOptions = transactionTypes.filter((type) => isUsable(type) || typeIds.includes(type.id));

  const toggleType = (id: string) => {
    setTypeIds((current) => (current.includes(id) ? current.filter((typeId) => typeId !== id) : [...current, id]));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the category a name.');
      return;
    }
    if (typeIds.length === 0) {
      setError('Choose at least one transaction type this category applies to.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        parentId: parentId || null,
        transactionTypeIds: typeIds,
      });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <ModalShell
      eyebrow="Types & categories"
      title={category ? 'Edit category' : 'Create category'}
      labelId="category-modal-title"
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <label className="full-field">
            Category name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="e.g. Groceries" autoFocus />
          </label>
          <fieldset className="full-field role-fieldset">
            <legend>Used with these transaction types</legend>
            {typeOptions.length === 0 ? (
              <p className="form-hint">Create a transaction type first.</p>
            ) : (
              <div className="check-list">
                {typeOptions.map((type) => (
                  <label className="check-row" key={type.id}>
                    <input type="checkbox" checked={typeIds.includes(type.id)} onChange={() => toggleType(type.id)} />
                    {type.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {hasChildren ? (
            <p className="form-hint full-field">This category has sub-categories, so it stays at the top level.</p>
          ) : (
            <label className="full-field">
              Parent category (optional)
              <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">None (top level)</option>
                {parentOptions.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving...' : category ? 'Save category' : 'Create category'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
