import {
  ArrowLeftRight,
  Activity,
  BarChart3,
  CalendarDays,
  ChartNoAxesCombined,
  Home,
  PiggyBank,
  Tags,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export const viewPaths = {
  overview: '/',
  transactions: '/transactions',
  accounts: '/accounts',
  savings: '/savings',
  analytics: '/analytics',
  goals: '/goals',
  recurring: '/recurring',
  investments: '/investments',
  'ipo-portfolio': '/investments/ipo',
  'ipo-demats': '/investments/ipo/demats',
  athlete: '/athlete-hub',
  setup: '/setup',
  settings: '/settings',
} as const;

export type View = keyof typeof viewPaths;

export const financePageRoutes = Object.entries(viewPaths).map(([id, path]) => ({ id, path, element: null }));
export const mobilePath = '/mobile';

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
  { id: 'savings', label: 'Savings', icon: PiggyBank },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'goals', label: 'Savings goals', icon: Target },
];

export const manageNavigation: NavItem[] = [
  { id: 'setup', label: 'Types & categories', icon: Tags },
  { id: 'recurring', label: 'Recurring', icon: CalendarDays },
  { id: 'investments', label: 'Investments', icon: ChartNoAxesCombined },
  { id: 'athlete', label: 'Athlete Hub', icon: Activity },
];

export const pageCopy: Record<View, { title: string; eyebrow: string }> = {
  overview: { title: 'Overview', eyebrow: todayLabel },
  transactions: { title: 'Transactions', eyebrow: 'Income, expenses and transfers' },
  accounts: { title: 'Accounts', eyebrow: 'Balances across your money' },
  savings: { title: 'Savings', eyebrow: 'Set-aside money' },
  analytics: { title: 'Analytics', eyebrow: 'Insights for the selected month' },
  goals: { title: 'Savings goals', eyebrow: 'Track what you are saving toward' },
  recurring: { title: 'Recurring', eyebrow: 'Repeating income and bills' },
  investments: { title: 'Investments', eyebrow: 'Capital, returns and reinvestment' },
  'ipo-portfolio': { title: 'Portfolio', eyebrow: 'IPO' },
  'ipo-demats': { title: 'Demat account holders', eyebrow: 'IPO' },
  athlete: { title: 'Athlete Hub', eyebrow: 'Private training and recovery' },
  setup: { title: 'Types & categories', eyebrow: 'How you record and group money' },
  settings: { title: 'Settings', eyebrow: 'Preferences and data' },
};
