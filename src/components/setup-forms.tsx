import { Select } from '@/components/select';
import { useState, type FormEvent } from 'react';
import { CategoryEmojiPicker } from '@/components/category-emoji-picker';
import { ModalShell } from '@/components/ui';
import { isUsable, transactionKindLabels, type CategoryOption, type StandardTransactionType } from '@/lib/finance';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export type CategoryFormValues = { name: string; emoji: string | null; parentId: string | null; transactionTypeIds: string[] };

export function CategoryFormModal({
  category,
  categories,
  standardTypes,
  onClose,
  onSubmit,
}: {
  category: CategoryOption | null;
  categories: CategoryOption[];
  standardTypes: StandardTransactionType[];
  onClose: () => void;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [typeIds, setTypeIds] = useState<string[]>(category?.transactionTypeIds ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const hasChildren = category ? categories.some((option) => option.parentId === category.id) : false;
  const parentOptions = categories.filter((option) => isUsable(option) && option.parentId === null && option.id !== category?.id);
  const typeOptions = standardTypes.filter((type) => type.kind !== 'transfer');

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
      setError('Choose Income, Expense, or both for this category.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        emoji: emoji.trim() || null,
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
      eyebrow="Categories"
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
          <CategoryEmojiPicker value={emoji} onChange={setEmoji} />
          <fieldset className="full-field role-fieldset">
            <legend>Use this category for</legend>
            {typeOptions.length === 0 ? (
              <p className="form-hint">The database update for the standard types is pending.</p>
            ) : (
              <div className="check-list">
                {typeOptions.map((type) => (
                  <label className="check-row" key={type.id}>
                    <input type="checkbox" checked={typeIds.includes(type.id)} onChange={() => toggleType(type.id)} />
                    {transactionKindLabels[type.kind]}
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
              <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">None (top level)</option>
                {parentOptions.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
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
