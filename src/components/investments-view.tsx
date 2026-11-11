import { useMemo, useState, type FormEvent } from 'react';
import { BriefcaseBusiness, CircleDollarSign, Pencil, Plus, Tag, Trash2, TrendingUp } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { EmptyPanel, Metric, ModalShell, SectionHeading } from '@/components/ui';
import type { FinanceActions } from '@/lib/finance-actions';
import { formatDate, formatMoney, isUsable, parseAmount, todayKey, type Account, type Investment, type InvestmentDraft, type InvestmentType } from '@/lib/finance';

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
}: {
  investmentTypes: InvestmentType[];
  selectedTypeId?: string;
  onSelectedTypeIdChange?: (id: string) => void;
  onCreate: (name: string) => Promise<string>;
  onUpdate: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
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
    <div className="investment-type-manager-heading"><span><Tag size={14} /> Investment types</span><small>Create reusable types for stocks, a business, loans to friends, or anything else.</small></div>
    <div className="investment-type-create"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Real estate" maxLength={40} disabled={busy} /><button className="secondary-button" type="button" onClick={() => void createType()} disabled={busy}>{busy ? 'Saving...' : 'Add type'}</button></div>
    {investmentTypes.length ? <div className="investment-type-list">{investmentTypes.map((type) => editingId === type.id ? <div className="investment-type-row editing" key={type.id}><input value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={40} autoFocus disabled={busy} /><div><button className="ghost-button" type="button" onClick={() => void saveType()} disabled={busy}>Save</button><button className="ghost-button" type="button" onClick={() => { setEditingId(''); setEditingName(''); }}>Cancel</button></div></div> : <div className="investment-type-row" key={type.id}><span>{type.name}</span><div><button className="ghost-button" type="button" aria-label={`Edit ${type.name}`} onClick={() => { setEditingId(type.id); setEditingName(type.name); setError(''); }} disabled={busy}><Pencil size={14} /></button><button className="ghost-button danger" type="button" aria-label={`Delete ${type.name}`} onClick={() => void removeType(type)} disabled={busy}><Trash2 size={14} /></button></div></div>)}</div> : <p className="form-hint">Create your first investment type to continue.</p>}
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
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [amount, setAmount] = useState(entry ? String(entry.principalAmount) : '');
  const [fundingAccountId, setFundingAccountId] = useState(entry?.fundingAccountId ?? usableAccounts[0]?.id ?? '');
  const [investedOn, setInvestedOn] = useState(entry?.investedOn ?? todayKey());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
        <label className="full-field">Investment type<select value={investmentTypeId} onChange={(event) => setInvestmentTypeId(event.target.value)}><option value="">Choose an investment type</option>{investmentTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <div className="full-field"><InvestmentTypeManager investmentTypes={investmentTypes} selectedTypeId={investmentTypeId} onSelectedTypeIdChange={setInvestmentTypeId} onCreate={onCreateType} onUpdate={onUpdateType} onDelete={onDeleteType} /></div>
        <label>Capital invested (₹)<input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 15000" disabled={settled} /></label>
        <div><DatePicker label="Investment date" value={investedOn} onChange={setInvestedOn} disabled={settled} /></div>
        <label className="full-field">Invested from account<select value={fundingAccountId} onChange={(event) => setFundingAccountId(event.target.value)} disabled={settled}><option value="">Choose an account</option>{usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
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
      <div className="form-grid"><label className="full-field">Total value: capital + profit/loss (₹)<input type="number" inputMode="decimal" min="0" step="0.01" value={finalValue} onChange={(event) => setFinalValue(event.target.value)} placeholder="e.g. 18000" autoFocus /></label><div className="full-field"><DatePicker label="Settlement date" value={settledOn} onChange={setSettledOn} /></div></div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Record result'}</button></div>
    </form>
  </ModalShell>;
}

export function InvestmentsView({ investments, investmentTypes, accounts, actions, onNotify }: { investments: Investment[]; investmentTypes: InvestmentType[]; accounts: Account[]; actions: FinanceActions; onNotify: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Investment | null>(null);
  const [settling, setSettling] = useState<Investment | null>(null);
  const [busyId, setBusyId] = useState('');
  const active = investments.filter((investment) => investment.status === 'active');
  const activeCapital = active.reduce((sum, investment) => sum + investment.principalAmount, 0);
  const realisedProfit = investments.filter((investment) => investment.status === 'settled').reduce((sum, investment) => sum + (investment.profitAmount ?? 0), 0);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

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
  const removeInvestment = async (investment: Investment) => {
    if (!window.confirm(`Delete “${investment.name}” and every linked investment transaction? This cannot be undone.`)) return;
    setBusyId(investment.id);
    try { await actions.deleteInvestment(investment.id); onNotify('Investment and its linked transaction entries were deleted.'); } catch (caught) { onNotify(errorMessage(caught)); } finally { setBusyId(''); }
  };

  return <>
    <SectionHeading title="Investments" description="Track stocks, funds, gold, a business, money lent to friends, or any money you commit." action={<button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add investment</button>} />
    <div className="metrics-grid investment-metrics"><Metric label="Active capital" value={formatMoney(activeCapital)} foot={`${active.length} active ${active.length === 1 ? 'investment' : 'investments'}`} icon={<BriefcaseBusiness size={16} />} /><Metric label="Realised profit / loss" value={formatMoney(realisedProfit)} foot="From settled investments" icon={<TrendingUp size={16} />} /><Metric label="Total investments" value={String(investments.length)} foot="Active and settled history" icon={<CircleDollarSign size={16} />} /></div>
    {investments.length === 0 ? <div className="surface-card"><EmptyPanel icon={<BriefcaseBusiness size={20} />} title="No investments yet" description="Record any investment and create the types that make sense for you. Capital, capital return and profit are kept in your transaction history." action={<button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add investment</button>} /></div> : <div className="investment-list">{investments.map((investment) => { const profit = investment.profitAmount; const fundingAccount = accountById.get(investment.fundingAccountId); return <article className={`surface-card investment-card ${investment.status}`} key={investment.id}><div className="investment-card-icon"><TrendingUp size={18} /></div><div className="investment-main"><div className="investment-title-row"><h3>{investment.name}</h3><span className={`status-tag ${investment.status === 'active' ? 'active' : 'inactive'}`}>{investment.status === 'active' ? 'Active' : 'Settled'}</span></div><p>{investment.investmentType} · {formatMoney(investment.principalAmount)} invested {formatDate(investment.investedOn)}</p><small>{investment.accountingMode === 'return_to_funding' ? `Return goes to: ${fundingAccount?.name ?? 'Archived account'}` : `Legacy capital account: ${accountById.get(investment.capitalAccountId)?.name ?? 'Archived account'}`}</small>{investment.notes ? <small className="investment-notes">{investment.notes}</small> : null}</div><div className="investment-result">{investment.status === 'settled' ? <><strong className={(profit ?? 0) < 0 ? 'negative' : 'positive'}>{formatMoney(profit ?? 0)}</strong><span>Profit / loss · {investment.settledOn ? formatDate(investment.settledOn) : ''}</span></> : <><strong>{formatMoney(investment.principalAmount)}</strong><span>Capital at work</span></>}</div><div className="item-actions investment-actions">{investment.status === 'active' ? <button className="primary-button compact-primary" type="button" onClick={() => setSettling(investment)}>Record result</button> : null}<button className="ghost-button" type="button" onClick={() => setEditing(investment)} disabled={busyId === investment.id}><Pencil size={15} /> Edit</button><button className="ghost-button danger" type="button" onClick={() => void removeInvestment(investment)} disabled={busyId === investment.id}><Trash2 size={15} /> Delete</button></div></article>; })}</div>}
    {adding ? <InvestmentModal accounts={accounts} investmentTypes={investmentTypes} onClose={() => setAdding(false)} onSubmit={saveInvestment} onCreateType={createType} onUpdateType={updateType} onDeleteType={removeType} /> : null}
    {editing ? <InvestmentModal accounts={accounts} investmentTypes={investmentTypes} entry={editing} onClose={() => setEditing(null)} onSubmit={saveInvestment} onCreateType={createType} onUpdateType={updateType} onDeleteType={removeType} /> : null}
    {settling ? <SettleInvestmentModal investment={settling} onClose={() => setSettling(null)} onSubmit={recordResult} /> : null}
  </>;
}
