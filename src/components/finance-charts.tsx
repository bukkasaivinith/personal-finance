import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, type AnalyticsTransaction, type MonthlyFlow } from '@/lib/finance';

const series = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
  opening: 'Savings opening balances',
  deposit: 'Savings deposits',
  withdrawal: 'Savings withdrawals',
} as const;
type Series = keyof typeof series;
type Grain = 'day' | 'month' | 'year';
type Bucket = { key: string; through: string; totals: Partial<Record<Series, number>> };

const seriesKeys = Object.keys(series) as Series[];
const cashFlowSeries: Series[] = ['income', 'expense'];
const intervals = 4;
const amountAxis = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 2,
});
const shortDay = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDay = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthName = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const fullMonth = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function bucketLabel(key: string, grain: Grain, detailed: boolean, compactMonths: boolean): string {
  if (grain === 'year') return key;
  const date = new Date((grain === 'month' ? key + '-01' : key) + 'T00:00:00Z');
  const monthFormatter = compactMonths ? monthName : shortMonth;
  const formatter = grain === 'month' ? (detailed ? fullMonth : monthFormatter) : (detailed ? fullDay : shortDay);
  return formatter.format(date);
}

function buildTrend(transactions: AnalyticsTransaction[], from: string, to: string, days: number, months: number) {
  const grain: Grain = months > 36 ? 'year' : days > 62 ? 'month' : 'day';
  const length = { day: 10, month: 7, year: 4 }[grain];
  const buckets = new Map<string, Bucket>();
  const visibleSeries = new Set<Series>();
  if (!transactions.length) return { grain, buckets: [], visibleSeries: [] };

  const end = Date.parse(to);
  const cursor = new Date((grain === 'year' ? from.slice(0, 4) + '-01-01' : grain === 'month' ? from.slice(0, 7) + '-01' : from) + 'T00:00:00Z');
  while (cursor.getTime() <= end) {
    const key = cursor.toISOString().slice(0, length);
    buckets.set(key, { key, through: key, totals: {} });
    if (grain === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (grain === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    if (grain === 'year') cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }

  for (const entry of transactions) {
    const bucket = buckets.get(entry.date.slice(0, length));
    if (!bucket) continue;
    const key = entry.kind === 'savings' ? entry.savingsActivity : entry.kind;
    bucket.totals[key] = (bucket.totals[key] ?? 0) + Math.round(entry.amount * 100);
    visibleSeries.add(key);
  }

  return { grain, buckets: [...buckets.values()], visibleSeries: seriesKeys.filter((key) => visibleSeries.has(key)) };
}

function groupBuckets(buckets: Bucket[], size: number): Bucket[] {
  if (size === 1) return buckets;
  const result: Bucket[] = [];
  for (let start = 0; start < buckets.length; start += size) {
    const group = buckets.slice(start, start + size);
    const totals: Bucket['totals'] = {};
    for (const bucket of group) {
      for (const key of seriesKeys) {
        const amount = bucket.totals[key];
        if (amount !== undefined) totals[key] = (totals[key] ?? 0) + amount;
      }
    }
    result.push({ key: group[0].key, through: group[group.length - 1].through, totals });
  }
  return result;
}

function axisStep(buckets: Bucket[]): number {
  const peak = buckets.reduce((largest, bucket) => Math.max(largest, ...Object.values(bucket.totals)), 0);
  const target = Math.max(1, peak / intervals);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return Math.ceil(([1, 2, 2.5, 5, 10].find((multiple) => multiple * magnitude >= target) ?? 10) * magnitude);
}

function FinanceChart({ title, description, className, periods, grain, visibleSeries, fitToWidth = false, emptyMessage }: {
  title: string;
  description: string;
  className: string;
  periods: Bucket[];
  grain: Grain;
  visibleSeries: Series[];
  fitToWidth?: boolean;
  emptyMessage: string;
}) {
  const headingId = useId();
  const plot = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const [selected, setSelected] = useState('');
  const showPlot = periods.length > 0;
  useLayoutEffect(() => {
    const element = plot.current;
    if (!fitToWidth || !showPlot || !element) return;
    const measure = () => setPlotWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitToWidth, showPlot]);

  const columnWidth = Math.max(grain === 'day' ? 45 : 62, visibleSeries.length * 10 + 8);
  const columns = Math.max(1, Math.floor(plotWidth / columnWidth));
  const groupSize = fitToWidth ? Math.max(1, Math.ceil(periods.length / columns)) : 1;
  const buckets = useMemo(() => groupBuckets(periods, groupSize), [periods, groupSize]);
  const step = useMemo(() => axisStep(buckets), [buckets]);
  const active = buckets.find(({ key, through }) => selected >= key && selected <= through)
    ?? [...buckets].reverse().find(({ totals }) => Object.values(totals).some((amount) => amount > 0))
    ?? buckets[buckets.length - 1];
  const totalFor = (bucket: Bucket, key: Series) => bucket.totals[key] ?? 0;
  const maximum = step * intervals;
  const label = (key: string, detailed: boolean) => bucketLabel(key, grain, detailed, !fitToWidth);
  const periodLabel = (bucket: Bucket) => bucket.key === bucket.through
    ? label(bucket.key, true)
    : label(bucket.key, true) + ' to ' + label(bucket.through, true);

  return (
    <section className={`surface-card finance-chart ${className}`} aria-labelledby={headingId}>
      <div className="card-title-row">
        <div>
          <h3 id={headingId}>{title}</h3>
          <p>{groupSize > 1 ? `Amounts grouped across up to ${groupSize} ${grain}s` : description}</p>
        </div>
        {showPlot && visibleSeries.length ? <ul className="finance-chart-legend" aria-label="Chart legend">
          {visibleSeries.map((key) => <li key={key}><span className={`finance-chart-series finance-chart-series-${key}`} />{series[key]}</li>)}
        </ul> : null}
      </div>
      {active ? <>
        <div className="finance-chart-frame">
          <div className="finance-chart-axis" aria-hidden="true">
            {Array.from({ length: intervals + 1 }, (_, index) => (
              <span key={index} style={{ top: `${100 * index / intervals}%` }}>{amountAxis.format(step * (intervals - index) / 100)}</span>
            ))}
          </div>
          <div className="finance-chart-plot" ref={plot}>
            <div className="finance-chart-buckets" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
              <div className="finance-chart-gridlines" aria-hidden="true" />
              {buckets.map((bucket) => {
                const date = periodLabel(bucket);
                const description = visibleSeries.map((key) => series[key] + ' ' + formatMoney(totalFor(bucket, key) / 100)).join(', ');
                return <button key={bucket.key} type="button" className="finance-chart-bucket" aria-label={date + ', ' + description}
                  aria-pressed={active.key === bucket.key} onPointerEnter={() => setSelected(bucket.key)}
                  onFocus={() => setSelected(bucket.key)} onClick={() => setSelected(bucket.key)}>
                  <span className="finance-chart-bar-group" aria-hidden="true">
                    {visibleSeries.map((key) => <span key={key} className={`finance-chart-series finance-chart-series-${key}`}
                      style={{ height: `${totalFor(bucket, key) * 100 / maximum}%` }} />)}
                  </span>
                  <small>{label(bucket.key, false)}</small>
                </button>;
              })}
            </div>
          </div>
        </div>
        <div className="finance-chart-details">
          <strong>{periodLabel(active)}</strong>
          {visibleSeries.map((key) => <span key={key}>{series[key]} <b>{formatMoney(totalFor(active, key) / 100)}</b></span>)}
        </div>
      </> : <p className="card-note">{emptyMessage}</p>}
    </section>
  );
}

export function AnalyticsTrend({ transactions, from, to, days, months }: {
  transactions: AnalyticsTransaction[];
  from: string;
  to: string;
  days: number;
  months: number;
}) {
  const { grain, buckets, visibleSeries } = useMemo(
    () => buildTrend(transactions, from, to, days, months), [transactions, from, to, days, months],
  );
  return <FinanceChart title="Transaction trend" description={`Amounts by ${grain}`} className="analytics-trend"
    periods={buckets} grain={grain} visibleSeries={visibleSeries} fitToWidth emptyMessage="No transaction activity in this view." />;
}

export function DashboardCashFlow({ flows }: { flows: MonthlyFlow[] }) {
  const periods = useMemo(() => flows.map(({ month, income, expense }) => ({
    key: month,
    through: month,
    totals: { income: Math.round(income * 100), expense: Math.round(expense * 100) },
  })), [flows]);
  const hasActivity = flows.some(({ income, expense }) => income > 0 || expense > 0);
  return <FinanceChart title="Cash flow" description="Income and expenses over the last six months" className="dashboard-cash-flow"
    periods={hasActivity ? periods : []} grain="month" visibleSeries={cashFlowSeries}
    emptyMessage="Income and expenses will appear here once you record transactions." />;
}
