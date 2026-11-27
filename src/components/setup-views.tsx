import { useState } from 'react';
import { Plus, Tags } from 'lucide-react';
import { CategoryFormModal, type CategoryFormValues } from '@/components/setup-forms';
import { ItemActions, StatusTag } from '@/components/item-actions';
import { EmptyPanel, SectionHeading } from '@/components/ui';
import type { FinanceActions } from '@/lib/finance-actions';
import { stateOf, transactionKindLabels, type CategoryOption, type ItemState, type StandardTransactionType, type TransactionUsage } from '@/lib/finance';

const stateRank: Record<ItemState, number> = { active: 0, inactive: 1, deleted: 2 };

export function SetupView({
  standardTypes,
  categories,
  transactionUsage,
  actions,
  onNotify,
}: {
  standardTypes: StandardTransactionType[];
  categories: CategoryOption[];
  transactionUsage?: TransactionUsage;
  actions: FinanceActions;
  onNotify: (message: string) => void;
}) {
  const [categoryDialog, setCategoryDialog] = useState<{ category: CategoryOption | null } | null>(null);

  const orderedCategories = [...categories].sort((a, b) => stateRank[stateOf(a)] - stateRank[stateOf(b)]);
  const typeName = (id: string) => {
    const kind = standardTypes.find((type) => type.id === id)?.kind;
    return kind && transactionKindLabels[kind];
  };
  const categoryName = (id: string | null) => categories.find((category) => category.id === id)?.name ?? '';

  const saveCategory = async (values: CategoryFormValues) => {
    if (categoryDialog?.category) {
      await actions.updateCategory(categoryDialog.category.id, values);
      onNotify(`${values.name} updated.`);
    } else {
      await actions.createCategory(values);
      onNotify(`Category "${values.name}" created.`);
    }
    setCategoryDialog(null);
  };

  return (
    <>
      <SectionHeading title="Categories" description="Manage categories for income and expenses."
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => setCategoryDialog({ category: null })}
            disabled={standardTypes.length === 0}
          >
            <Plus size={16} /> Add category
          </button>
        } />

      <div className="surface-card">
        {orderedCategories.length === 0 ? (
          <EmptyPanel
            icon={<Tags size={20} />}
            title="No categories yet"
            description="Add categories to organise your transactions."
          />
        ) : (
          <div className="setup-list">
            {orderedCategories.map((category) => {
              const state = stateOf(category);
              const usage = transactionUsage?.categories[category.id] ?? 0;
              const parent = categoryName(category.parentId);
              const types = category.transactionTypeIds.map(typeName).filter(Boolean).join(', ');
              return (
                <div className="setup-row" key={category.id}>
                  <div className="setup-info">
                    <b>
                      {category.emoji ? <span className="category-emoji" aria-hidden="true">{category.emoji}</span> : null}
                      {category.name}
                      <StatusTag state={state} />
                    </b>
                    <small>
                      {parent ? `Under ${parent} · ` : ''}
                      {types || 'Choose where this category is used'} · {usage} {usage === 1 ? 'transaction' : 'transactions'}
                    </small>
                  </div>
                  <ItemActions
                    name={category.name}
                    state={state}
                    usageCount={usage}
                    onEdit={() => setCategoryDialog({ category })}
                    onSetState={(next) => actions.setItemState('categories', category.id, next)}
                    onDeletePermanently={() => actions.deleteItemPermanently('categories', category.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {categoryDialog ? (
        <CategoryFormModal
          category={categoryDialog.category}
          categories={categories}
          standardTypes={standardTypes}
          onClose={() => setCategoryDialog(null)}
          onSubmit={saveCategory}
        />
      ) : null}
    </>
  );
}
