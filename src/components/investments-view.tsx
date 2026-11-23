import { Select } from '@/components/select';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { BriefcaseBusiness, CalendarClock, ChartNoAxesCombined, CircleDollarSign, HandCoins, Pencil, Plus, Tag, Target, Trash2, TrendingUp, WalletCards } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { RupeeInput } from '@/components/rupee-input';
import { EmptyPanel, Metric, ModalShell } from '@/components/ui';
import type { FinanceActions } from '@/lib/finance-actions';
import { formatDate, formatMoney, isUsable, parseAmount, todayKey, type Account, type Investment, type InvestmentDraft, type InvestmentType } from '@/lib/finance';
import { loadIpoPortfolio } from '@/lib/ipo-portfolio-api';
import { summarizeIpoPortfolio } from '@/lib/ipo-portfolio-summary';
import './investment-overview.css';

const CREATE_INVESTMENT_TYPE = '__create_investment_type__';
const MANAGE_INVESTMENT_TYPES = '__manage_investment_types__';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function InvestmentTypeManager({
  investmentTypes,
  selectedTypeId,
  onSelectedTypeIdChange,
  onCreate,
  onUpdate,
  onDelete,
  mode,
  onClose,
}: {
  investmentTypes: InvestmentType[];
  selectedTypeId?: string;
  onSelectedTypeIdChange?: (id: string) => void;
  onCreate: (name: string) => Promise<string>;
  onUpdate: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  mode: 'create' | 'manage';
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createType = async () => {
    if (!newName.trim()) { setError('Enter a type name first.'); return; }
    setBusy(true); setError('');
    try {
      const id = await onCreate(newName.trim());
      onSelectedTypeIdChange?.(id);
      setNewName('');
      onClose();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };
  const saveType = async () => {
    if (!editingId || !editingName.trim()) { setError('Enter a type name first.'); return; }
    setBusy(true); setError('');
    try { await onUpdate(editingId, editingName.trim()); setEditingId(''); setEditingName(''); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };
  const removeType = async (type: InvestmentType) => {
    if (!window.confirm(`Delete investment type “${type.name}”?`)) return;
    setBusy(true); setError('');
    try {
      await onDelete(type.id);
      if (selectedTypeId === type.id) onSelectedTypeIdChange?.('');
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };

  return <section className="investment-type-manager">
    <div className="investment-type-manager-heading"><span><Tag size={14} /> {mode === 'create' ? 'New investment type' : 'Manage investment types'}</span><small>{mode === 'create' ? 'Create a reusable type for stocks, a business, loans to friends, or anything else.' : 'Correct the names of your existing types or remove a type you no longer use.'}</small></div>
    {mode === 'create' ? <div className="investment-type-create"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Real estate" maxLength={40} autoFocus disabled={busy} /><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" type="button" onClick={() => void createType()} disabled={busy}>{busy ? 'Saving...' : 'Add type'}</button></div> : null}
    {mode === 'manage' ? (investmentTypes.length ? <div className="investment-type-list">{investmentTypes.map((type) => editingId === type.id ? <div className="investment-type-row editing" key={type.id}><input value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={40} autoFocus disabled={busy} /><div><button className="ghost-button" type="button" onClick={() => void saveType()} disabled={busy}>Save</button><button className="ghost-button" type="button" onClick={() => { setEditingId(''); setEditingName(''); }}>Cancel</button></div></div> : <div className="investment-type-row" key={type.id}><span>{type.name}</span><div><button className="ghost-button" type="button" aria-label={`Edit ${type.name}`} onClick={() => { setEditingId(type.id); setEditingName(type.name); setError(''); }} disabled={busy}><Pencil size={14} /></button><button className="ghost-button danger" type="button" aria-label={`Delete ${type.name}`} onClick={() => void removeType(type)} disabled={busy}><Trash2 size={14} /></button></div></div>)}</div> : <p className="form-hint">Create your first investment type to continue.</p>) : null}
    {error ? <p className="form-error">{error}</p> : null}
  </section>;
}

function InvestmentModal({
  accounts,
  investmentTypes,
  entry,
  onClose,
  onSubmit,
  onCreateType,
  onUpdateType,
  onDeleteType,
}: {
  accounts: Account[];
  investmentTypes: InvestmentType[];
  entry?: Investment | null;
  onClose: () => void;
  onSubmit: (draft: InvestmentDraft) => Promise<void>;
  onCreateType: (name: string) => Promise<string>;
  onUpdateType: (id: string, name: string) => Promise<void>;
  onDeleteType: (id: string) => Promise<void>;
}) {
  const usableAccounts = accounts.filter(isUsable);
  const settled = entry?.status === 'settled';
  const [name, setName] = useState(entry?.name ?? '');
  const [investmentTypeId, setInvestmentTypeId] = useState(entry?.investmentTypeId ?? investmentTypes[0]?.id ?? '');
  const [typePanel, setTypePanel] = useState<'create' | 'manage' | null>(investmentTypes.length === 0 ? 'create' : null);
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [amount, setAmount] = useState(entry ? String(entry.principalAmount) : '');
  const [fundingAccountId, setFundingAccountId] = useState(entry?.fundingAccountId ?? usableAccounts[0]?.id ?? '');
  const [investedOn, setInvestedOn] = useState(entry?.investedOn ?? todayKey());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const chooseType = (value: string) => {
    if (value === CREATE_INVESTMENT_TYPE) {
      setTypePanel('create');
      return;
    }
    if (value === MANAGE_INVESTMENT_TYPES) {
      setTypePanel('manage');
      return;
    }
    setTypePanel(null);
    setInvestmentTypeId(value);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const principalAmount = parseAmount(amount);
    if (!name.trim()) { setError('Give this investment a name.'); return; }
    if (!investmentTypeId) { setError('Create or choose an investment type.'); return; }
    if (!Number.isFinite(principalAmount) || principalAmount <= 0) { setError('Enter an investment amount greater than zero.'); return; }
    if (!fundingAccountId) { setError('Choose the account you invested from.'); return; }
    if (!investedOn) { setError('Choose the investment date.'); return; }
    setSaving(true); setError('');
    try { await onSubmit({ name: name.trim(), investmentTypeId, notes: notes.trim(), fundingAccountId, principalAmount, investedOn }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };

  return <ModalShell eyebrow="Investments" title={entry ? 'Edit investment' : 'Add investment'} labelId="investment-modal-title" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <p className="modal-description">{settled ? 'A settled investment keeps its account, capital and investment date to protect the recorded return. You can still correct its name, type and notes.' : 'Record any money you commit. Capital leaves the selected account. At settlement, capital return and profit are added back as separate transaction entries.'}</p>
      <div className="form-grid">
        <label className="full-field">Investment name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Nifty index fund" maxLength={80} autoFocus /></label>
        <label className="full-field">Investment type<Select value={investmentTypeId} onChange={(event) => chooseType(event.target.value)}><option value="">Choose an investment type</option>{investmentTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}<option value={CREATE_INVESTMENT_TYPE}>+ Create investment type</option>{investmentTypes.length ? <option value={MANAGE_INVESTMENT_TYPES}>Manage investment types</option> : null}</Select></label>
        {typePanel ? <div className="full-field"><InvestmentTypeManager investmentTypes={investmentTypes} selectedTypeId={investmentTypeId} onSelectedTypeIdChange={setInvestmentTypeId} onCreate={onCreateType} onUpdate={onUpdateType} onDelete={onDeleteType} mode={typePanel} onClose={() => setTypePanel(null)} /></div> : null}
        <label>Capital invested (₹)<RupeeInput value={amount} onValueChange={setAmount} placeholder="e.g. 15,000" disabled={settled} /></label>
        <div><DatePicker label="Investment date" value={investedOn} onChange={setInvestedOn} disabled={settled} /></div>
        <label className="full-field">Invested from account<Select value={fundingAccountId} onChange={(event) => setFundingAccountId(event.target.value)} disabled={settled}><option value="">Choose an account</option>{usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></label>
        <label className="full-field">Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. Long-term investment" maxLength={300} /></label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || usableAccounts.length === 0 || investmentTypes.length === 0}>{saving ? 'Saving...' : entry ? 'Save changes' : 'Record investment'}</button></div>
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
    setSaving(true); setError('');
    try { await onSubmit({ finalAmount: value, settledOn }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };
  return <ModalShell eyebrow="Investments" title="Settle investment" labelId="settle-investment-title" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <p className="modal-description">Enter the total amount you received. When there is profit, the transaction history records capital return and profit as two separate credits to the account used for this investment.</p>
      <div className="investment-settlement-summary"><span>Original capital <b>{formatMoney(investment.principalAmount)}</b></span><span>Calculated {difference === null ? 'profit / loss' : difference >= 0 ? 'profit' : 'loss'} <b className={difference !== null && difference < 0 ? 'negative' : 'positive'}>{difference === null ? '—' : formatMoney(difference)}</b></span></div>
      <div className="form-grid"><label className="full-field">Total value: capital + profit/loss (₹)<RupeeInput value={finalValue} onValueChange={setFinalValue} placeholder="e.g. 18,000" autoFocus /></label><div className="full-field"><DatePicker label="Settlement date" value={settledOn} onChange={setSettledOn} /></div></div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Record result'}</button></div>
    </form>
  </ModalShell>;
}

function InvestmentTrackingModal({ investment, onClose, onSubmit }: { investment: Investment; onClose: () => void; onSubmit: (input: { currentEstimatedValue: number; valuedOn: string; targetAmount: number | null; maturityDate: string | null }) => Promise<void> }) {
  const [value, setValue] = useState(String(investment.currentEstimatedValue ?? investment.principalAmount));
  const [valuedOn, setValuedOn] = useState(investment.valueUpdatedOn ?? todayKey());
  const [targetAmount, setTargetAmount] = useState(investment.targetAmount?.toString() ?? '');
  const [maturityDate, setMaturityDate] = useState(investment.maturityDate ?? '');
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const current = parseAmount(value); const target = targetAmount.trim() ? parseAmount(targetAmount) : null;
  const change = Number.isFinite(current) ? current - investment.principalAmount + investment.withdrawnTotal : null;
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!Number.isFinite(current) || current < 0) { setError('Enter a current estimated value of zero or more.'); return; } if (target !== null && (!Number.isFinite(target) || target <= 0)) { setError('Target amount must be greater than zero.'); return; } if (!valuedOn || valuedOn < investment.investedOn || (maturityDate && maturityDate < investment.investedOn)) { setError('Check the value and maturity dates.'); return; } setSaving(true); try { await onSubmit({ currentEstimatedValue: current, valuedOn, targetAmount: target, maturityDate: maturityDate || null }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <ModalShell eyebrow="Investments" title="Update investment value" labelId="investment-tracking-title" onClose={onClose}><form className="modal-form" onSubmit={submit}><p className="modal-description">This is a private mark-to-market estimate. It does not create a money transaction or change your account balance.</p><div className="investment-settlement-summary"><span>Capital still in this investment <b>{formatMoney(Math.max(0, investment.principalAmount - investment.withdrawnCapital))}</b></span><span>Estimated gain / loss <b className={change !== null && change < 0 ? 'negative' : 'positive'}>{change === null ? '—' : formatMoney(change)}</b></span></div><div className="form-grid"><label className="full-field">Current estimated value (₹)<RupeeInput autoFocus value={value} onValueChange={setValue} /></label><div className="full-field"><DatePicker label="Value date" value={valuedOn} onChange={setValuedOn} min={investment.investedOn} /></div><label>Target value (optional)<RupeeInput value={targetAmount} onValueChange={setTargetAmount} placeholder="e.g. 25,000" /></label><div><DatePicker label="Maturity / review date" value={maturityDate} onChange={setMaturityDate} min={investment.investedOn} clearable placeholder="No date" /></div></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save value'}</button></div></form></ModalShell>;
}

function WithdrawalModal({ investment, onClose, onSubmit }: { investment: Investment; onClose: () => void; onSubmit: (input: { amountReceived: number; withdrawnOn: string }) => Promise<void> }) {
  const [amount, setAmount] = useState(''); const [withdrawnOn, setWithdrawnOn] = useState(todayKey()); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const value = parseAmount(amount); const remainingCapital = Math.max(0, investment.principalAmount - investment.withdrawnCapital);
  const capitalPart = Number.isFinite(value) ? Math.min(value, remainingCapital) : null; const profitPart = Number.isFinite(value) ? Math.max(0, value - remainingCapital) : null;
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!Number.isFinite(value) || value <= 0 || !withdrawnOn || withdrawnOn < investment.investedOn) { setError('Enter a positive amount and a valid return date.'); return; } setSaving(true); try { await onSubmit({ amountReceived: value, withdrawnOn }); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <ModalShell eyebrow="Investments" title="Record partial return" labelId="investment-withdrawal-title" onClose={onClose}><form className="modal-form" onSubmit={submit}><p className="modal-description">Record money that came back while the investment remains active. The website automatically creates a capital-return credit first, then a separate profit credit if the received amount exceeds outstanding capital.</p><div className="investment-settlement-summary"><span>Outstanding capital <b>{formatMoney(remainingCapital)}</b></span><span>In this return <b>{capitalPart === null ? '—' : `${formatMoney(capitalPart)} capital${profitPart ? ` + ${formatMoney(profitPart)} profit` : ''}`}</b></span></div><div className="form-grid"><label className="full-field">Amount received (₹)<RupeeInput autoFocus value={amount} onValueChange={setAmount} placeholder="e.g. 5,000" /></label><div className="full-field"><DatePicker label="Return date" value={withdrawnOn} onChange={setWithdrawnOn} min={investment.investedOn} /></div></div>{error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Record return'}</button></div></form></ModalShell>;
}

export function InvestmentsView({ investments, investmentTypes, accounts, actions, onNotify, navigation }: {
  investments: Investment[];
  investmentTypes: InvestmentType[];
  accounts: Account[];
  actions: FinanceActions;
  onNotify: (message: string) => void;
  navigation: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Investment | null>(null);
  const [settling, setSettling] = useState<Investment | null>(null);
  const [tracking, setTracking] = useState<Investment | null>(null);
  const [withdrawing, setWithdrawing] = useState<Investment | null>(null);
  const [insightRange, setInsightRange] = useState<'week' | 'month' | 'year' | 'all' | 'custom'>('month');
  const [customInsightStart, setCustomInsightStart] = useState(() => { const date = new Date(`${todayKey()}T12:00:00`); date.setDate(date.getDate() - 29); return date.toISOString().slice(0, 10); });
  const [customInsightEnd, setCustomInsightEnd] = useState(todayKey());
  const [busyId, setBusyId] = useState('');
  const [ipoTotals, setIpoTotals] = useState<ReturnType<typeof summarizeIpoPortfolio>>();
  const [ipoError, setIpoError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadIpoPortfolio().then((portfolio) => {
      if (active) setIpoTotals(summarizeIpoPortfolio(portfolio.applications, { from: '', to: '' }));
    }).catch(() => {
      if (active) setIpoError(true);
    });
    return () => { active = false; };
  }, []);
  const active = investments.filter((investment) => investment.status === 'active');
  const activeCapital = active.reduce((sum, investment) => sum + investment.principalAmount, 0);
  const activeMarkedValue = active.reduce((sum, investment) => sum + (investment.currentEstimatedValue ?? investment.principalAmount), 0);
  const realisedProfit = investments.filter((investment) => investment.status === 'settled').reduce((sum, investment) => sum + (investment.profitAmount ?? 0), 0) + active.reduce((sum, investment) => sum + investment.withdrawnProfit, 0);
  const regularPrincipalPaise = investments.reduce((sum, investment) => sum + Math.round(investment.principalAmount * 100), 0);
  const grandTotalInvested = ipoTotals ? (regularPrincipalPaise + Math.round(ipoTotals.invested * 100)) / 100 : null;
  const grandNetResult = ipoTotals ? (Math.round(realisedProfit * 100) + Math.round(ipoTotals.netResult * 100)) / 100 : null;
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const insightStart = useMemo(() => {
    const today = todayKey();
    if (insightRange === 'all') return '2000-01-01';
    if (insightRange === 'custom') return customInsightStart;
    if (insightRange === 'year') return `${today.slice(0, 4)}-01-01`;
    if (insightRange === 'week') { const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() - 6); return date.toISOString().slice(0, 10); }
    return `${today.slice(0, 7)}-01`;
  }, [customInsightStart, insightRange]);
  const insightEnd = insightRange === 'custom' ? customInsightEnd : todayKey();
  const investedInRange = investments.filter((investment) => investment.investedOn >= insightStart && investment.investedOn <= insightEnd).reduce((sum, investment) => sum + investment.principalAmount, 0);
  const settledInRange = investments.filter((investment) => investment.settledOn && investment.settledOn >= insightStart && investment.settledOn <= insightEnd).reduce((sum, investment) => sum + (investment.finalAmount ?? 0), 0);

  const createType = async (name: string) => { const id = await actions.createInvestmentType({ name }); onNotify('Investment type created.'); return id; };
  const updateType = async (id: string, name: string) => { await actions.updateInvestmentType(id, { name }); onNotify('Investment type updated across your investments.'); };
  const removeType = async (id: string) => { await actions.deleteInvestmentType(id); onNotify('Investment type deleted.'); };
  const saveInvestment = async (draft: InvestmentDraft) => {
    if (editing) { await actions.updateInvestment(editing.id, draft); setEditing(null); onNotify('Investment and its linked capital entry updated.'); }
    else { await actions.createInvestment(draft); setAdding(false); onNotify('Investment recorded. Capital outflow added to transactions.'); }
  };
  const recordResult = async (input: { finalAmount: number; settledOn: string }) => {
    if (!settling) return;
    await actions.settleInvestment({ id: settling.id, ...input });
    const profit = input.finalAmount - settling.principalAmount;
    setSettling(null);
    onNotify(profit > 0 ? `Investment settled. Capital return and ${formatMoney(profit)} profit were credited separately.` : 'Investment settled. The actual returned capital was credited to your account.');
  };
  const saveTracking = async (input: { currentEstimatedValue: number; valuedOn: string; targetAmount: number | null; maturityDate: string | null }) => {
    if (!tracking) return;
    await actions.updateInvestmentTracking({ id: tracking.id, ...input });
    setTracking(null); onNotify('Current investment value and timeline updated.');
  };
  const recordWithdrawal = async (input: { amountReceived: number; withdrawnOn: string }) => {
    if (!withdrawing) return;
    await actions.recordInvestmentWithdrawal({ id: withdrawing.id, ...input });
    setWithdrawing(null); onNotify('Partial return recorded. Capital and profit were credited separately where applicable.');
  };
  const removeInvestment = async (investment: Investment) => {
    if (!window.confirm(`Delete “${investment.name}” and every linked investment transaction? This cannot be undone.`)) return;
    setBusyId(investment.id);
    try { await actions.deleteInvestment(investment.id); onNotify('Investment and its linked transaction entries were deleted.'); } catch (caught) { onNotify(errorMessage(caught)); } finally { setBusyId(''); }
  };

  return <>
    <div className="investment-toolbar">
      {navigation}
      <button className="primary-button" type="button" onClick={() => setAdding(true)}>
        <Plus size={16} /> Add investment
      </button>
    </div>
    <div className="investment-overview-metrics">
      <div className="investment-overview-row investment-overview-primary">
        <Metric label="Grand total invested" value={grandTotalInvested === null ? '—' : formatMoney(grandTotalInvested)}
          foot={ipoError ? 'IPO totals unavailable' : 'Investment principal and IPO allotment costs'} icon={<WalletCards size={16} />} />
        <Metric label="Grand total net profit / loss" value={grandNetResult === null ? '—' : formatMoney(grandNetResult)}
          foot="Realised results across investments and IPOs" icon={<TrendingUp size={16} />} />
        <Metric label="Capital committed" value={formatMoney(activeCapital)} foot={`${active.length} active ${active.length === 1 ? 'investment' : 'investments'}`} icon={<BriefcaseBusiness size={16} />} />
        <Metric label="Current estimated value" value={formatMoney(activeMarkedValue)} foot="Private mark-to-market on active investments" icon={<ChartNoAxesCombined size={16} />} />
      </div>
      <div className="investment-overview-row">
        <Metric label="Realised profit / loss" value={formatMoney(realisedProfit)} foot="Settlements and partial returns" icon={<TrendingUp size={16} />} />
        <Metric label="Total investments" value={String(investments.length)} foot="Active and settled history" icon={<CircleDollarSign size={16} />} />
        <Metric label="IPO net profit / loss" value={ipoTotals ? formatMoney(ipoTotals.netResult) : '—'} foot="Total profit minus total losses" icon={<TrendingUp size={16} />} />
        <Metric label="IPO amount applied" value={ipoTotals ? formatMoney(ipoTotals.applied) : '—'} foot="Combined application amounts" icon={<WalletCards size={16} />} />
      </div>
    </div>
    {investments.length ? <section className="surface-card investment-insight-card"><div className="card-title-row"><div><h3>Investment activity</h3><p>Capital committed and returns recorded in the selected period.</p></div><Select className="compact-select" value={insightRange} onChange={(event) => setInsightRange(event.target.value as 'week' | 'month' | 'year' | 'all' | 'custom')}><option value="week">Last 7 days</option><option value="month">This month</option><option value="year">This year</option><option value="all">All time</option><option value="custom">Custom range</option></Select></div>{insightRange === 'custom' ? <div className="investment-custom-range"><DatePicker label="From" value={customInsightStart} onChange={setCustomInsightStart} max={customInsightEnd} /><DatePicker label="To" value={customInsightEnd} onChange={setCustomInsightEnd} min={customInsightStart} /></div> : null}<div className="investment-insight-metrics"><div><WalletCards size={17} /><span>Capital invested<b>{formatMoney(investedInRange)}</b></span></div><div><HandCoins size={17} /><span>Settled / returned<b>{formatMoney(settledInRange)}</b></span></div><div><CalendarClock size={17} /><span>Active days<b>{active.length ? String(Math.round(active.reduce((sum, investment) => sum + Math.max(0, Math.ceil((new Date(`${todayKey()}T12:00:00`).getTime() - new Date(`${investment.investedOn}T12:00:00`).getTime()) / 86_400_000)), 0) / active.length)) : '0'}</b></span></div></div></section> : null}
    {investments.length === 0 ? <div className="surface-card"><EmptyPanel icon={<BriefcaseBusiness size={20} />} title="No investments yet" description="Record any investment and create the types that make sense for you. Capital, capital return and profit are kept in your transaction history." action={<button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add investment</button>} /></div> : <div className="investment-list">{investments.map((investment) => { const profit = investment.profitAmount; const fundingAccount = accountById.get(investment.fundingAccountId); const daysHeld = Math.max(0, Math.ceil(((investment.settledOn ? new Date(`${investment.settledOn}T12:00:00`) : new Date(`${todayKey()}T12:00:00`)).getTime() - new Date(`${investment.investedOn}T12:00:00`).getTime()) / 86_400_000)); const estimatedGain = (investment.currentEstimatedValue ?? investment.principalAmount) + investment.withdrawnTotal - investment.principalAmount; const targetProgress = investment.targetAmount ? Math.min(100, ((investment.currentEstimatedValue ?? 0) / investment.targetAmount) * 100) : null; return <article className={`surface-card investment-card ${investment.status}`} key={investment.id}><div className="investment-card-icon"><TrendingUp size={18} /></div><div className="investment-main"><div className="investment-title-row"><h3>{investment.name}</h3><span className={`status-tag ${investment.status === 'active' ? 'active' : 'inactive'}`}>{investment.status === 'active' ? 'Active' : 'Settled'}</span></div><p>{investment.investmentType} · {formatMoney(investment.principalAmount)} invested {formatDate(investment.investedOn)}</p><small>{investment.accountingMode === 'return_to_funding' ? `Returns go to: ${fundingAccount?.name ?? 'Archived account'}` : `Legacy capital account: ${accountById.get(investment.capitalAccountId)?.name ?? 'Archived account'}`} · {daysHeld} day{daysHeld === 1 ? '' : 's'} held</small>{investment.status === 'active' ? <div className="investment-tracking-line"><span>Estimated value <b>{formatMoney(investment.currentEstimatedValue ?? investment.principalAmount)}</b></span><span className={estimatedGain < 0 ? 'negative' : 'positive'}>{estimatedGain >= 0 ? '+' : ''}{formatMoney(estimatedGain)} estimated</span>{investment.withdrawnTotal ? <span>{formatMoney(investment.withdrawnTotal)} returned</span> : null}{investment.maturityDate ? <span>Review {formatDate(investment.maturityDate)}</span> : null}</div> : null}{targetProgress !== null ? <div className="investment-target-progress"><span style={{ width: `${targetProgress}%` }} /></div> : null}{investment.notes ? <small className="investment-notes">{investment.notes}</small> : null}</div><div className="investment-result">{investment.status === 'settled' ? <><strong className={(profit ?? 0) < 0 ? 'negative' : 'positive'}>{formatMoney(profit ?? 0)}</strong><span>Profit / loss · {investment.settledOn ? formatDate(investment.settledOn) : ''}</span></> : <><strong>{formatMoney(investment.currentEstimatedValue ?? investment.principalAmount)}</strong><span>Current value</span></>}</div><div className="item-actions investment-actions">{investment.status === 'active' ? <><button className="primary-button compact-primary" type="button" onClick={() => setSettling(investment)}>Record result</button><button className="ghost-button" type="button" onClick={() => setWithdrawing(investment)}><HandCoins size={15} /> Return</button><button className="ghost-button" type="button" onClick={() => setTracking(investment)}><Target size={15} /> Value</button></> : null}<button className="ghost-button" type="button" onClick={() => setEditing(investment)} disabled={busyId === investment.id}><Pencil size={15} /> Edit</button><button className="ghost-button danger" type="button" onClick={() => void removeInvestment(investment)} disabled={busyId === investment.id}><Trash2 size={15} /> Delete</button></div></article>; })}</div>}
    {adding ? <InvestmentModal accounts={accounts} investmentTypes={investmentTypes} onClose={() => setAdding(false)} onSubmit={saveInvestment} onCreateType={createType} onUpdateType={updateType} onDeleteType={removeType} /> : null}
    {editing ? <InvestmentModal accounts={accounts} investmentTypes={investmentTypes} entry={editing} onClose={() => setEditing(null)} onSubmit={saveInvestment} onCreateType={createType} onUpdateType={updateType} onDeleteType={removeType} /> : null}
    {settling ? <SettleInvestmentModal investment={settling} onClose={() => setSettling(null)} onSubmit={recordResult} /> : null}
    {tracking ? <InvestmentTrackingModal investment={tracking} onClose={() => setTracking(null)} onSubmit={saveTracking} /> : null}
    {withdrawing ? <WithdrawalModal investment={withdrawing} onClose={() => setWithdrawing(null)} onSubmit={recordWithdrawal} /> : null}
  </>;
}
