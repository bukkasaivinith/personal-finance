import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { formatMoney, isUsable, type Account } from '@/lib/finance';
import { ipoApplicationLots, sum, type IpoData } from '@/lib/ipo';

export type IpoApplicationDraft = {
 id: string;
 applicant_account_id: string;
 holder_name: string;
 nickname: string;
 designation: 'self' | 'friend';
 date: string;
 amount: string;
 funding_method: 'direct' | 'friend';
 account_id: string;
};

type Props = {
 drafts: IpoApplicationDraft[];
 data: IpoData;
 accounts: Account[];
 today: string;
 price: string;
 lotSize: string;
 minimumLots: string;
 busy: boolean;
 onChange: (drafts: IpoApplicationDraft[]) => void;
};

export function IpoSetupApplications({ drafts, data, accounts, today, price, lotSize, minimumLots, busy, onChange }: Props) {
 const activeHolders = new Map(data.applicants.filter(holder => !holder.archived).map(holder => [holder.id, holder.name]));
 const activeDemats = data.applicant_accounts.filter(account => !account.archived && activeHolders.has(account.applicant_id));
 const banks = accounts.filter(account => isUsable(account) && !account.isLiability);
 const totalLots = drafts.reduce((total, draft) => total + (ipoApplicationLots(draft.amount, price, lotSize, minimumLots) ?? 0), 0);
 const ready = drafts.length > 0 && drafts.every(draft => ipoApplicationLots(draft.amount, price, lotSize, minimumLots) !== null);

 function addDraft() {
  onChange([...drafts, {
   id: crypto.randomUUID(), applicant_account_id: activeDemats.length ? '' : 'new',
   holder_name: '', nickname: '', designation: 'self', date: today,
   amount: '', funding_method: 'direct', account_id: banks.length === 1 ? banks[0].id : '',
  }]);
 }

 return <section className="ipo-setup-applications">
  <div className="card-title-row">
   <div><h3>Demat applications</h3><p>Enter what you applied for through each account. You can also add applications later.</p></div>
   <button className="secondary-button" type="button" onClick={addDraft} disabled={busy || !banks.length || drafts.length >= 50}>Add demat application</button>
  </div>
  {!banks.length ? <p className="form-hint">Add an active bank or cash account to record an application.</p> : null}
  {drafts.map((draft, index) => {
   const lots = ipoApplicationLots(draft.amount, price, lotSize, minimumLots);
   const pricePerLot = Number(price) * Number(lotSize);
   const change = (patch: Partial<IpoApplicationDraft>) => onChange(drafts.map(row => row.id === draft.id ? { ...row, ...patch } : row));
   return <fieldset key={draft.id} className="ipo-setup-draft" disabled={busy}>
    <legend>Application {index + 1}</legend>
    <div className="form-grid">
     <label>Demat account holder
      <Select required value={draft.applicant_account_id} onChange={event => change({ applicant_account_id: event.target.value })}>
       <option value="">Choose a demat account</option>
       {activeDemats.map(account => <option key={account.id} value={account.id}>{activeHolders.get(account.applicant_id)} / {account.nickname}</option>)}
       <option value="new">Add a new holder and account</option>
      </Select>
     </label>
     <label>Amount applied (₹)
      <input required type="number" min="0.01" step="0.01" value={draft.amount} onChange={event => change({ amount: event.target.value })} />
     </label>
     {draft.applicant_account_id === 'new' ? <>
      <label>Holder name<input required maxLength={80} value={draft.holder_name} onChange={event => change({ holder_name: event.target.value })} /></label>
      <label>Demat account nickname<input required maxLength={80} value={draft.nickname} onChange={event => change({ nickname: event.target.value })} /></label>
      <label>Whose demat account?
       <Select value={draft.designation} onChange={event => change({ designation: event.target.value as IpoApplicationDraft['designation'] })}>
        <option value="self">My account</option><option value="friend">Someone else’s account</option>
       </Select>
      </label>
     </> : null}
     <DatePicker label="Application date" value={draft.date} max={today} onChange={date => change({ date })} disabled={busy} />
     <label>Funding account
      <Select required value={draft.account_id} onChange={event => change({ account_id: event.target.value })}>
       <option value="">Choose a bank or cash account</option>
       {banks.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </Select>
     </label>
     <label>Funding method
      <Select value={draft.funding_method} onChange={event => change({ funding_method: event.target.value as IpoApplicationDraft['funding_method'] })}>
       <option value="direct">Directly from my account</option><option value="friend">Money already held by the applicant</option>
      </Select>
     </label>
    </div>
    <div className="ipo-setup-footer">
     <small aria-live="polite">{lots !== null ? `${lots} ${lots === 1 ? 'lot' : 'lots'} · ${lots * Number(lotSize)} shares` : pricePerLot > 0 ? `${formatMoney(pricePerLot)} per lot` : 'Enter the issue price and shares per lot.'}</small>
     <button type="button" className="text-button danger" onClick={() => onChange(drafts.filter(row => row.id !== draft.id))}>Remove application {index + 1}</button>
    </div>
   </fieldset>;
  })}
  {ready ? <p className="ipo-preview" aria-live="polite">{totalLots} {totalLots === 1 ? 'lot' : 'lots'} · {formatMoney(sum(drafts, draft => Number(draft.amount)))} applied in total</p> : null}
 </section>;
}
