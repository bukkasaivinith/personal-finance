import { useState } from 'react';
import { Plus, Tags } from 'lucide-react';
import { CategoryFormModal, RenameTypeModal, TransactionTypeModal, type CategoryFormValues } from '@/components/setup-forms';
import { ItemActions, StatusTag } from '@/components/item-actions';
import { kindChoices } from '@/components/transaction-pickers';
import { EmptyPanel, SectionHeading } from '@/components/ui';
import type { FinanceActions } from '@/lib/finance-actions';
import { stateOf, type CategoryOption, type ItemState, type Transaction, type TransactionTypeOption } from '@/lib/finance';

const stateRank: Record<ItemState, number> = { active: 0, inactive: 1, deleted: 2 };

const kindLabel = (kind: TransactionTypeOption['kind']) => kindChoices.find((choice) => choice.value === kind)?.label ?? kind;

export function SetupView({
  transactionTypes,
  categories,
  transactions,
  actions,
  onNotify,
}: {
  transactionTypes: TransactionTypeOption[];
  categories: CategoryOption[];
  transactions: Transaction[];
  actions: FinanceActions;
  onNotify: (message: string) => void;
}) {
  const [creatingType, setCreatingType] = useState(false);
  const [renamingType, setRenamingType] = useState<TransactionTypeOption | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<{ category: CategoryOption | null } | null>(null);

  const orderedTypes = [...transactionTypes].sort((a, b) => stateRank[stateOf(a)] - stateRank[stateOf(b)]);
  const orderedCategories = [...categories].sort((a, b) => stateRank[stateOf(a)] - stateRank[stateOf(b)]);
  const typeName = (id: string) => transactionTypes.find((type) => type.id === id)?.name ?? '';
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
      <SectionHeading
        title="Types & categories"
        description="Define how you record money. Changes to names and income/expense settings update matching existing entries too."
      />

      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h3>Transaction types</h3>
            <p>Each type says whether it counts as income, an expense, or a transfer</p>
          </div>
          <button className="primary-button" type="button" onClick={() => setCreatingType(true)}>
            <Plus size={16} /> Add type
          </button>
        </div>
        {orderedTypes.length === 0 ? (
          <EmptyPanel
            icon={<Tags size={20} />}
            title="No transaction types yet"
            description="Create the first type, such as Salary or Groceries, before recording transactions."
            action={
              <button className="primary-button" type="button" onClick={() => setCreatingType(true)}>
                <Plus size={16} /> Add type
              </button>
            }
          />
        ) : (
          <div className="setup-list">
            {orderedTypes.map((type) => {
              const state = stateOf(type);
              const usage = transactions.filter((t) => t.typeId === type.id).length;
              return (
                <div className="setup-row" key={type.id}>
                  <div className="setup-info">
                    <b>
                      {type.name}
                      <StatusTag state={state} />
                    </b>
                    <small>
                      {kindLabel(type.kind)} · {usage} {usage === 1 ? 'transaction' : 'transactions'}
                    </small>
                  </div>
                  <ItemActions
                    name={type.name}
                    state={state}
                    usageCount={usage}
                    onEdit={() => setRenamingType(type)}
                    onSetState={(next) => actions.setItemState('transaction_types', type.id, next)}
                    onDeletePermanently={() => actions.deleteItemPermanently('transaction_types', type.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h3>Categories</h3>
            <p>Group transactions within a type, such as Groceries under Expense</p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => setCategoryDialog({ category: null })}
            disabled={transactionTypes.length === 0}
          >
            <Plus size={16} /> Add category
          </button>
        </div>
        {orderedCategories.length === 0 ? (
          <EmptyPanel
            icon={<Tags size={20} />}
            title="No categories yet"
            description={
              transactionTypes.length === 0
                ? 'Create a transaction type first, then add categories for it.'
                : 'Add categories to organise your transactions.'
            }
          />
        ) : (
          <div className="setup-list">
            {orderedCategories.map((category) => {
              const state = stateOf(category);
              const usage = transactions.filter((t) => t.categoryId === category.id).length;
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
                      {types || 'No transaction types'} · {usage} {usage === 1 ? 'transaction' : 'transactions'}
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

      {creatingType ? (
        <TransactionTypeModal
          onClose={() => setCreatingType(false)}
          onSubmit={async (input) => {
            await actions.createTransactionType(input);
            setCreatingType(false);
            onNotify(`Transaction type "${input.name}" created.`);
          }}
        />
      ) : null}
      {renamingType ? (
        <RenameTypeModal
          type={renamingType}
          onClose={() => setRenamingType(null)}
          onSubmit={async (input) => {
            await actions.updateTransactionType(renamingType.id, input);
            setRenamingType(null);
            onNotify(`Transaction type updated to "${input.name}".`);
          }}
        />
      ) : null}
      {categoryDialog ? (
        <CategoryFormModal
          category={categoryDialog.category}
          categories={categories}
          transactionTypes={transactionTypes}
          onClose={() => setCategoryDialog(null)}
          onSubmit={saveCategory}
        />
      ) : null}
    </>
  );
}
