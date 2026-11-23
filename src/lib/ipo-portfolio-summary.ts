import { toDateKey } from '@/lib/finance';
import type { IpoApplication } from '@/lib/ipo-portfolio-api';
import { transactionAnalysisRange } from '@/lib/transaction-analysis';

export type IpoPortfolioPeriod = 'all' | 'week' | 'month' | 'year' | 'custom';
type DateRange = { from: string; to: string };

export function defaultIpoCustomRange(now = new Date()): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth() - 6;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const start = new Date(year, month, Math.min(now.getDate(), lastDay));
  return { from: toDateKey(start), to: toDateKey(now) };
}

export function ipoPortfolioRange(period: IpoPortfolioPeriod, custom: DateRange, now = new Date()): DateRange {
  if (period === 'custom') return custom;
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to: toDateKey(now) };
  return transactionAnalysisRange(period, now);
}

export function summarizeIpoPortfolio(applications: IpoApplication[], { from, to }: DateRange) {
  const companies = new Map<string, { label: string; applications: IpoApplication[]; resultPaise: number | null }>();
  let applicationCount = 0;
  let appliedPaise = 0;
  let investedPaise = 0;
  let profitPaise = 0;
  let lossPaise = 0;
  for (const application of applications) {
    if ((from && application.application_date < from) || (to && application.application_date > to)) continue;

    const key = application.company.trim().toLocaleLowerCase();
    const group = companies.get(key) ?? { label: application.company, applications: [], resultPaise: null };
    group.applications.push(application);
    applicationCount++;
    appliedPaise += Math.round(application.amount * 100);
    investedPaise += Math.round((application.invested_amount ?? 0) * 100);

    const result = application.realized_profit_loss;
    if (result != null) {
      const resultPaise = Math.round(result * 100);
      group.resultPaise = (group.resultPaise ?? 0) + resultPaise;
      if (resultPaise > 0) profitPaise += resultPaise;
      if (resultPaise < 0) lossPaise -= resultPaise;
    }
    companies.set(key, group);
  }

  return {
    companies,
    applicationCount,
    applied: appliedPaise / 100,
    invested: investedPaise / 100,
    profit: profitPaise / 100,
    loss: lossPaise / 100,
    netResult: (profitPaise - lossPaise) / 100,
  };
}
