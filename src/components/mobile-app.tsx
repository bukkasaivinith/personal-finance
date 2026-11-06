import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Check, ChevronDown, CircleDollarSign, LogOut, Settings2 } from 'lucide-react';
import { signOut } from '@/lib/auth-api';
import { createFinanceActions } from '@/lib/finance-actions';
import { categoriesFor, currentTimeKey, parseAmount, todayKey, type TransactionKind } from '@/lib/finance';
import { useFinanceData } from '@/lib/use-finance-data';

const kinds: { value: TransactionKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

export function MobileApp() {
  const finance = useFinanceData();
  const actions = createFinanceActions(finance.refresh);
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState(currentTimeKey());
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const types = useMemo(() => finance.data?.transactionTypes.filter((type) => type.isActive && type.kind === kind) ?? [], [finance.data, kind]);
  const accounts = useMemo(() => finance.data?.accounts.filter((account) => account.isActive) ?? [], [finance.data]);
  const categories = useMemo(() => {
    const selectedType = finance.data?.transactionTypes.find((type) => type.id === typeId);
    return selectedType ? categoriesFor(finance.data?.categories.filter((category) => category.isActive) ?? [], selectedType.id) : [];
  }, [finance.data, typeId]);
  const destinationAccounts = accounts.filter((account) => account.id !== accountId);

  const changeKind = (next: TransactionKind) => { setKind(next); setTypeId(''); setCategoryId(''); setToAccountId(''); setSaved(false); setError(''); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const value = parseAmount(amount);
    const selectedType = types.find((type) => type.id === typeId);
    if (!selectedType) return setError('Choose a transaction type.');
    if (!Number.isFinite(value) || value <= 0) return setError('Enter an amount greater than zero.');
    if (!name.trim()) return setError('Add a description.');
    if (!accountId) return setError('Choose an account.');
    if (kind !== 'transfer' && !categoryId) return setError('Choose a category.');
    if (kind === 'transfer' && !toAccountId) return setError('Choose the destination account.');
    setSaving(true); setError(''); setSaved(false);
    try {
      await actions.addTransaction({ name: name.trim(), typeId: selectedType.id, categoryId: kind === 'transfer' ? null : categoryId, amount: value, date, time: time || null, accountId, toAccountId: kind === 'transfer' ? toAccountId : null });
      setAmount(''); setName(''); setCategoryId(''); setToAccountId(''); setTime(currentTimeKey()); setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The transaction could not be saved.');
    } finally { setSaving(false); }
  };

  if (!finance.data) return <div className="mobile-shell"><div className="mobile-loading">{finance.loadError || 'Loading your workspace...'}</div></div>;

  return <div className="mobile-shell"><header className="mobile-header"><div className="mobile-brand"><span><CircleDollarSign size={21} /></span><strong>Personal Financing</strong></div><button className="mobile-icon-button" type="button" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={19} /></button></header><main className="mobile-content"><div className="mobile-title-row"><div><p className="mobile-kicker">Quick entry</p><h1>New transaction</h1></div><Settings2 size={20} aria-hidden="true" /></div><div className="mobile-kind-tabs">{kinds.map((choice) => <button type="button" key={choice.value} className={kind === choice.value ? 'active' : ''} onClick={() => changeKind(choice.value)}>{choice.label}</button>)}</div><form className="mobile-form" onSubmit={submit}><section className="mobile-amount-card"><label htmlFor="mobile-amount">Amount (₹)</label><strong>₹{amount ? Number(amount).toLocaleString('en-IN') : '0.00'}</strong><input id="mobile-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Enter amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></section><label className="mobile-field"><span>Transaction type</span><select value={typeId} onChange={(event) => { setTypeId(event.target.value); setCategoryId(''); }}><option value="">Select type</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select><ChevronDown size={17} /></label>{kind !== 'transfer' ? <label className="mobile-field"><span>Category</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={!typeId}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.emoji ? `${category.emoji} ` : ''}{category.name}</option>)}</select><ChevronDown size={17} /></label> : null}<label className="mobile-field"><span>{kind === 'transfer' ? 'From account' : 'Account'}</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={17} /></label>{kind === 'transfer' ? <label className="mobile-field"><span>To account</span><select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}><option value="">Select account</option>{destinationAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={17} /></label> : null}<label className="mobile-field"><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="mobile-field"><span>Time</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><label className="mobile-field mobile-description"><span>Description / notes</span><input value={name} maxLength={60} placeholder="e.g. Grocery run" onChange={(event) => setName(event.target.value)} /></label>{error ? <p className="mobile-error" role="alert">{error}</p> : null}{saved ? <p className="mobile-success" role="status"><Check size={17} /> Transaction saved</p> : null}<button className="mobile-save" type="submit" disabled={saving}>{saving ? 'Saving transaction...' : <><ArrowLeftRight size={18} /> Save transaction</>}</button></form></main></div>;
}
