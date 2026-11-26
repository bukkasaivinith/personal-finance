import { useMemo, useState } from 'react';
import { formatMoney, type AnalyticsTransaction } from '@/lib/finance';

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
type Bucket = { key: string; totals: Partial<Record<Series, number>> };

const seriesKeys = Object.keys(series) as Series[];
const intervals = 4;
const amountAxis = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 2,
});
const shortDay = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDay = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const fullMonth = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function bucketLabel(key: string, grain: Grain, detailed = false): string {
  if (grain === 'year') return key;
  const date = new Date((grain === 'month' ? key + '-01' : key) + 'T00:00:00Z');
  const formatter = grain === 'month' ? (detailed ? fullMonth : shortMonth) : (detailed ? fullDay : shortDay);
  return formatter.format(date);
}

function buildTrend(transactions: AnalyticsTransaction[], from: string, to: string, days: number, months: number) {
  const grain: Grain = months > 36 ? 'year' : days > 62 ? 'month' : 'day';
  const length = { day: 10, month: 7, year: 4 }[grain];
  const buckets = new Map<string, Bucket>();
  const visibleSeries = new Set<Series>();
  if (!transactions.length) return { grain, buckets: [], visibleSeries: [], step: 1 };

  const end = Date.parse(to);
  const cursor = new Date((grain === 'year' ? from.slice(0, 4) + '-01-01' : grain === 'month' ? from.slice(0, 7) + '-01' : from) + 'T00:00:00Z');
  while (cursor.getTime() <= end) {
    const key = cursor.toISOString().slice(0, length);
    buckets.set(key, { key, totals: {} });
    if (grain === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (grain === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    if (grain === 'year') cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }

  let peak = 0;
  for (const entry of transactions) {
    const bucket = buckets.get(entry.date.slice(0, length));
    if (!bucket) continue;
    const key = entry.kind === 'savings' ? entry.savingsActivity : entry.kind;
    const total = (bucket.totals[key] ?? 0) + Math.round(entry.amount * 100);
    bucket.totals[key] = total;
    visibleSeries.add(key);
    peak = Math.max(peak, total);
  }

  const target = Math.max(1, peak / intervals);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = Math.ceil(([1, 2, 2.5, 5, 10].find((multiple) => multiple * magnitude >= target) ?? 10) * magnitude);
  return { grain, buckets: [...buckets.values()], visibleSeries: seriesKeys.filter((key) => visibleSeries.has(key)), step };
}

export function AnalyticsTrend({ transactions, from, to, days, months }: {
  transactions: AnalyticsTransaction[];
  from: string;
  to: string;
  days: number;
  months: number;
}) {
  const { grain, buckets, visibleSeries, step } = useMemo(
    () => buildTrend(transactions, from, to, days, months), [transactions, from, to, days, months],
  );
  const [selected, setSelected] = useState('');
  const active = buckets.find(({ key }) => key === selected) ?? [...buckets].reverse().find(({ totals }) => Object.keys(totals).length);
  const totalFor = (bucket: Bucket, key: Series) => bucket.totals[key] ?? 0;
  const maximum = step * intervals;
  const bucketWidth = Math.max(grain === 'day' ? 45 : 62, visibleSeries.length * 12 + 8);

  return (
    <section className="surface-card analytics-trend" aria-labelledby="analytics-trend-heading">
      <div className="card-title-row">
        <div>
          <h3 id="analytics-trend-heading">Transaction trend</h3>
          <p>Amounts by {grain}</p>
        </div>
        {visibleSeries.length ? <ul className="analytics-chart-legend" aria-label="Chart legend">
          {visibleSeries.map((key) => <li key={key}><span className={`analytics-series analytics-series-${key}`} />{series[key]}</li>)}
        </ul> : null}
      </div>
      {active ? <>
        <div className="analytics-chart-frame">
          <div className="analytics-chart-axis" aria-hidden="true">
            {Array.from({ length: intervals + 1 }, (_, index) => (
              <span key={index} style={{ top: `${100 * index / intervals}%` }}>{amountAxis.format(step * (intervals - index) / 100)}</span>
            ))}
          </div>
          <div className="analytics-chart-scroll">
            <div className="analytics-chart-buckets" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(${bucketWidth}px, 1fr))` }}>
              <div className="analytics-chart-gridlines" aria-hidden="true" />
              {buckets.map((bucket) => {
                const date = bucketLabel(bucket.key, grain, true);
                const description = visibleSeries.map((key) => series[key] + ' ' + formatMoney(totalFor(bucket, key) / 100)).join(', ');
                return <button key={bucket.key} type="button" className="analytics-chart-bucket" aria-label={date + ', ' + description}
                  aria-pressed={active.key === bucket.key} onPointerEnter={() => setSelected(bucket.key)}
                  onFocus={() => setSelected(bucket.key)} onClick={() => setSelected(bucket.key)}>
                  <span className="analytics-chart-bar-group" aria-hidden="true">
                    {visibleSeries.map((key) => <span key={key} className={`analytics-series analytics-series-${key}`}
                      style={{ height: `${totalFor(bucket, key) * 100 / maximum}%` }} />)}
                  </span>
                  <small>{bucketLabel(bucket.key, grain)}</small>
                </button>;
              })}
            </div>
          </div>
        </div>
        <div className="analytics-chart-details">
          <strong>{bucketLabel(active.key, grain, true)}</strong>
          {visibleSeries.map((key) => <span key={key}>{series[key]} <b>{formatMoney(totalFor(active, key) / 100)}</b></span>)}
        </div>
      </> : <p className="card-note">No transaction activity in this view.</p>}
    </section>
  );
}
