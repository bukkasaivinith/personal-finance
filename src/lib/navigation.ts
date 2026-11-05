import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Home,
  PiggyBank,
  Tags,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type View =
  | 'overview'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'analytics'
  | 'goals'
  | 'recurring'
  | 'setup'
  | 'settings';

export type NavItem = { id: View; label: string; icon: LucideIcon };

const todayLabel = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date());

export const workspaceNavigation: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
  { id: 'accounts', label: 'Accounts', icon: Wallet },
  { id: 'budgets', label: 'Budgets', icon: PiggyBank },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'goals', label: 'Savings goals', icon: Target },
];

export const manageNavigation: NavItem[] = [
  { id: 'setup', label: 'Types & categories', icon: Tags },
  { id: 'recurring', label: 'Recurring', icon: CalendarDays },
];

export const pageCopy: Record<View, { title: string; eyebrow: string }> = {
  overview: { title: 'Overview', eyebrow: todayLabel },
  transactions: { title: 'Transactions', eyebrow: 'Income, expenses and transfers' },
  accounts: { title: 'Accounts', eyebrow: 'Balances across your money' },
  budgets: { title: 'Budgets', eyebrow: 'Spending limits by category' },
  analytics: { title: 'Analytics', eyebrow: 'Insights for the selected month' },
  goals: { title: 'Savings goals', eyebrow: 'Track what you are saving toward' },
  recurring: { title: 'Recurring', eyebrow: 'Repeating income and bills' },
  setup: { title: 'Types & categories', eyebrow: 'How you record and group money' },
  settings: { title: 'Settings', eyebrow: 'Preferences and data' },
};
