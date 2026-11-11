import { useMemo, useState, type FormEvent } from 'react';
import { BriefcaseBusiness, CircleDollarSign, Plus, TrendingUp } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { EmptyPanel, Metric, ModalShell, SectionHeading } from '@/components/ui';
import type { FinanceActions } from '@/lib/finance-actions';
import { formatDate, formatMoney, isUsable, parseAmount, todayKey, type Account, type Investment, type InvestmentDraft } from '@/lib/finance';

const investmentTypes = ['Stocks', 'Mutual fund', 'ETF', 'Gold', 'Fixed deposit', 'Crypto', 'Property', 'Small business', 'Loan to a friend', 'Business finance', 'Other'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function InvestmentModal({ accounts, onClose, onSubmit }: { accounts: Account[]; onClose: () => void; onSubmit: (draft: InvestmentDraft) => Promise<void> }) {
  const usableAccounts = accounts.filter(isUsable);
  const [name, setName] = useState('');
  const [investmentType, setInvestmentType] = useState('Stocks');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [fundingAccountId, setFundingAccountId] = useState(usableAccounts[0]?.id ?? '');
  const [investedOn, setInvestedOn] = useState(todayKey());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const principalAmount = parseAmount(amount);
    if (!name.trim()) { setError('Give this investment a name.'); return; }
    if (!investmentType.trim()) { setError('Choose or enter an investment type.'); return; }
    if (!Number.isFinite(principalAmount) || principalAmount <= 0) { setError('Enter an investment amount greater than zero.'); return; }
    if (!fundingAccountId) { setError('Choose the account you invested from.'); return; }
    if (!investedOn) { setError('Choose the investment date.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), investmentType: investmentType.trim(), notes: notes.trim(), fundingAccountId, principalAmount, investedOn });
    } catch (caught) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  };

  return <ModalShell eyebrow="Investments" title="Add investment" labelId="investment-modal-title" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <p className="modal-description">Record any money you commit: stocks, funds, gold, a small business, money lent to a friend, or another opportunity. Capital leaves the account below; the full return comes back into that same account.</p>
      <div className="form-grid">
        <label className="full-field">Investment name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Nifty index fund" maxLength={80} autoFocus /></label>
        <label className="full-field">Investment type<input value={investmentType} onChange={(event) => setInvestmentType(event.target.value)} list="investment-types" maxLength={40} /><datalist id="investment-types">{investmentTypes.map((type) => <option key={type} value={type} />)}</datalist></label>
        <label>Capital invested (₹)<input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 15000" /></label>
        <div><DatePicker label="Investment date" value={investedOn} onChange={setInvestedOn} /></div>
        <label className="full-field">Invested from account<select value={fundingAccountId} onChange={(event) => setFundingAccountId(event.target.value)}><option value="">Choose an account</option>{usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className="full-field">Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. Long-term investment" maxLength={300} /></label>
      </div>
      <p className="form-hint">When you settle it, enter the total amount received. The app will create a return transaction into this same account and calculate profit or loss automatically.</p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || usableAccounts.length === 0}>{saving ? 'Saving...' : 'Record investment'}</button></div>
    </form>
  </ModalShell>;
}

function SettleInvestmentModal({ investment, onClose, onSubmit }: { investment: Investment; onClose: () => void; onSubmit: (input: { finalAmount: number; settledOn: string }) => Promise<void> }) {
  const [finalValue, setFinalValue] = useState('');
  const [settledOn, setSettledOn] = useState(todayKey());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const value = parseAmount(finalValue);
  const difference = Number.isFinite(value) ? value - investment.principalAmount : null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Number.isFinite(value) || value < 0) { setError('Enter the total current value, zero or more.'); return; }
    if (!settledOn || settledOn < investment.investedOn) { setError('Choose a settlement date on or after the investment date.'); return; }
    setSaving(true);
    setError('');
    try { await onSubmit({ finalAmount: value, settledOn }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };
  return <ModalShell eyebrow="Investments" title="Settle investment" labelId="settle-investment-title" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <p className="modal-description">Enter the total amount you received: original capital plus profit, or less if there was a loss. This full return is credited to the same account used for the investment.</p>
      <div className="investment-settlement-summary"><span>Original capital <b>{formatMoney(investment.principalAmount)}</b></span><span>Calculated {difference === null ? 'profit / loss' : difference >= 0 ? 'profit' : 'loss'} <b className={difference !== null && difference < 0 ? 'negative' : 'positive'}>{difference === null ? '—' : formatMoney(difference)}</b></span></div>
      <div className="form-grid"><label className="full-field">Total value: capital + profit/loss (₹)<input type="number" inputMode="decimal" min="0" step="0.01" value={finalValue} onChange={(event) => setFinalValue(event.target.value)} placeholder="e.g. 18000" autoFocus /></label><div className="full-field"><DatePicker label="Settlement date" value={settledOn} onChange={setSettledOn} /></div></div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Record result'}</button></div>
    </form>
  </ModalShell>;
}

export function InvestmentsView({ investments, accounts, actions, onNotify }: { investments: Investment[]; accounts: Account[]; actions: FinanceActions; onNotify: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<Investment | null>(null);
  const active = investments.filter((investment) => investment.status === 'active');
  const activeCapital = active.reduce((sum, investment) => sum + investment.principalAmount, 0);
  const realisedProfit = investments.filter((investment) => investment.status === 'settled').reduce((sum, investment) => sum + (investment.profitAmount ?? 0), 0);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const recordInvestment = async (draft: InvestmentDraft) => { await actions.createInvestment(draft); setAdding(false); onNotify('Investment recorded. Capital outflow added to transactions.'); };
  const recordResult = async (input: { finalAmount: number; settledOn: string }) => {
    if (!settling) return;
    await actions.settleInvestment({ id: settling.id, ...input });
    const profit = input.finalAmount - settling.principalAmount;
    setSettling(null);
    onNotify(profit === 0 ? 'Investment settled. The full capital return was credited to your account.' : `Investment settled. Return credited; ${profit > 0 ? 'profit' : 'loss'}: ${formatMoney(Math.abs(profit))}.`);
  };
  return <>
    <SectionHeading title="Investments" description="Track stocks, funds, gold, a business, money lent to friends, or any money you commit." action={<button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add investment</button>} />
    <div className="metrics-grid investment-metrics"><Metric label="Active capital" value={formatMoney(activeCapital)} foot={`${active.length} active ${active.length === 1 ? 'investment' : 'investments'}`} icon={<BriefcaseBusiness size={16} />} /><Metric label="Realised profit / loss" value={formatMoney(realisedProfit)} foot="From settled investments" icon={<TrendingUp size={16} />} /><Metric label="Total investments" value={String(investments.length)} foot="Active and settled history" icon={<CircleDollarSign size={16} />} /></div>
    {investments.length === 0 ? <div className="surface-card"><EmptyPanel icon={<BriefcaseBusiness size={20} />} title="No investments yet" description="Record a stock, fund, gold, small business, loan to a friend, or any money you commit. Capital and the final return are both recorded in your account history." action={<button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add investment</button>} /></div> : <div className="investment-list">{investments.map((investment) => { const profit = investment.profitAmount; const fundingAccount = accountById.get(investment.fundingAccountId); return <article className={`surface-card investment-card ${investment.status}`} key={investment.id}><div className="investment-card-icon"><TrendingUp size={18} /></div><div className="investment-main"><div className="investment-title-row"><h3>{investment.name}</h3><span className={`status-tag ${investment.status === 'active' ? 'active' : 'inactive'}`}>{investment.status === 'active' ? 'Active' : 'Settled'}</span></div><p>{investment.investmentType} · {formatMoney(investment.principalAmount)} invested {formatDate(investment.investedOn)}</p><small>{investment.accountingMode === 'return_to_funding' ? `Return goes to: ${fundingAccount?.name ?? 'Archived account'}` : `Legacy capital account: ${accountById.get(investment.capitalAccountId)?.name ?? 'Archived account'}`}</small>{investment.notes ? <small className="investment-notes">{investment.notes}</small> : null}</div><div className="investment-result">{investment.status === 'settled' ? <><strong className={(profit ?? 0) < 0 ? 'negative' : 'positive'}>{formatMoney(profit ?? 0)}</strong><span>Profit / loss · {investment.settledOn ? formatDate(investment.settledOn) : ''}</span></> : <><strong>{formatMoney(investment.principalAmount)}</strong><span>Capital at work</span></>}</div>{investment.status === 'active' ? <button className="primary-button compact-primary" type="button" onClick={() => setSettling(investment)}>Record result</button> : null}</article>; })}</div>}
    {adding ? <InvestmentModal accounts={accounts} onClose={() => setAdding(false)} onSubmit={recordInvestment} /> : null}
    {settling ? <SettleInvestmentModal investment={settling} onClose={() => setSettling(null)} onSubmit={recordResult} /> : null}
  </>;
}
