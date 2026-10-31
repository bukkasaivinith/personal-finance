import type { ReactNode } from 'react';
import { Download, Plus, Settings, Target, CalendarDays, PiggyBank } from 'lucide-react';
import { EmptyPanel, SectionHeading } from '@/components/ui';

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

export function BudgetsView({ onNotify }: { onNotify: (message: string) => void }) {
  return (
    <PlanningEmptyView
      title="Budgets"
      description="Set monthly spending limits for each category."
      icon={<PiggyBank size={20} />}
      emptyTitle="No budgets yet"
      emptyDescription="Monthly category limits will appear here and show how much you have used."
      actionLabel="Create budget"
      onAction={() => onNotify('Budgets are coming in the next phase.')}
    />
  );
}

export function GoalsView({ onNotify }: { onNotify: (message: string) => void }) {
  return (
    <PlanningEmptyView
      title="Savings goals"
      description="Track what you are saving toward."
      icon={<Target size={20} />}
      emptyTitle="No savings goals yet"
      emptyDescription="Goals with target amounts and deadlines will show their progress here."
      actionLabel="Create goal"
      onAction={() => onNotify('Savings goals are coming in the next phase.')}
    />
  );
}

export function RecurringView({ onNotify }: { onNotify: (message: string) => void }) {
  return (
    <PlanningEmptyView
      title="Recurring"
      description="Salary, rent, subscriptions and other repeating entries."
      icon={<CalendarDays size={20} />}
      emptyTitle="No recurring entries yet"
      emptyDescription="Repeating income and bills will be listed here once you add them."
      actionLabel="Add recurring entry"
      onAction={() => onNotify('Recurring entries are coming in the next phase.')}
    />
  );
}

export function SettingsView({ onExport, hasData }: { onExport: () => void; hasData: boolean }) {
  return (
    <>
      <SectionHeading title="Settings" description="Preferences and your data." />
      <div className="surface-card settings-card">
        <div className="card-title-row">
          <div>
            <h3>
              <Settings size={16} /> Currency
            </h3>
            <p>All amounts are shown in Indian Rupees (₹).</p>
          </div>
        </div>
      </div>
      <div className="surface-card settings-card">
        <div className="card-title-row">
          <div>
            <h3>
              <Download size={16} /> Export data
            </h3>
            <p>Download every transaction as a spreadsheet-ready CSV file.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onExport} disabled={!hasData}>
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>
    </>
  );
}
