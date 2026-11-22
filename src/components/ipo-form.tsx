import { useRef, useState, type FormEvent } from 'react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { ModalShell } from '@/components/ui';
import { formatMoney, isUsable, todayKey, type Account } from '@/lib/finance';
import { commandIpo } from '@/lib/ipo-api';
import type { IpoData } from '@/lib/ipo';

export type IpoFormSpec = { command: string; title: string; seed?: Record<string, unknown> };
type Field = { key: string; label: string; type?: 'number' | 'date' | 'text' | 'textarea' | 'select'; optional?: boolean; options?: [string,string][]; step?: string; min?: number; max?: number };
const option = (values: string[]): [string,string][] => values.map(x => [x, x.replace(/_/g,' ')]);
const notes: Field = { key: 'notes', label: 'Notes (optional)', type: 'textarea', optional: true };
const amount: Field = { key: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01 };
const date: Field = { key: 'date', label: 'Date', type: 'date' };
export function IpoForm({ spec, data, accounts, onClose, onSaved }: { spec: IpoFormSpec; data: IpoData; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
 const { command, seed = {} } = spec;
 const company = data.companies.find(c => c.id === seed.company_id);
 const application = data.applications.find(a => a.id === seed.application_id);
 const [values, setValues] = useState<Record<string, unknown>>({ date: todayKey(), designation: 'self', classification: 'Mainboard', minimum_lots: 1, lots: company?.minimum_lots ?? 1, lot_size: company?.lot_size ?? '', issue_price: company?.issue_price ?? '', adjustment: 0, funding_method: 'direct', result: 'full', shares: application ? application.lots * application.lot_size : '', purchase_charges: 0, charges: 0, status: 'requested', destination: 'bank', kind: 'shares_credited', expected: false, ...seed });
 const [busy, setBusy] = useState(false); const [error, setError] = useState('');
 const inFlight = useRef(false); const retry = useRef({ payload: '', id: '' });
 const set = (key: string, value: unknown) => setValues(v => ({ ...v, [key]: value }));
 const bank: Field = { key: 'account_id', label: 'Your financial account', type: 'select', options: accounts.filter(a => isUsable(a) && !a.isLiability).map(a => [a.id, a.name]) };
 const applicant: Field = { key: 'applicant_id', label: 'Applicant', type: 'select', options: data.applicants.filter(a => !a.archived || a.id === values.applicant_id).map(a => [a.id, a.name]) };
 const archive: Field = { key: 'archived', label: 'Profile status', type: 'select', options: [['false','Active'],['true','Archived']] };
 let fields: Field[] = [];
 if (command === 'applicant') fields = [{ key:'name',label:'Applicant name' },{ key:'designation',label:'Whose demat account?',type:'select',options:[['self','My account'],['friend',"Friend’s account"]] },{key:'relationship',label:'Relationship / description (optional)',optional:true},notes,...(seed.id ? [archive] : [])];
 if (command === 'demat') fields = [applicant,{key:'nickname',label:'Account nickname'},{key:'broker',label:'Broker / platform (optional)',optional:true},{key:'demat_label',label:'Demat label (optional)',optional:true},{key:'bank_nickname',label:'Funding bank nickname (optional)',optional:true},notes,...(seed.id ? [archive] : [])];
 if (command === 'company') fields = [{key:'name',label:'Company name'},{key:'symbol',label:'Symbol (optional)',optional:true},{key:'classification',label:'Classification',type:'select',options:option(['Mainboard','SME'])},{key:'issue_price',label:'Issue price per share (₹)',type:'number',min:0.01},{key:'lot_size',label:'Shares per lot',type:'number',min:1,step:'1'},{key:'minimum_lots',label:'Minimum lots',type:'number',min:1,step:'1'},...['opening','closing','actual_allotment','actual_refund','actual_listing'].map(key => ({key:`dates.${key}`,label:`${key.replace(/_/g,' ')} (optional)`,type:'date' as const,optional:true})),notes,...(seed.id ? [archive] : [])];
 if (command === 'application' || command === 'edit_application') fields = [{key:'applicant_account_id',label:'Applicant / demat account',type:'select',options:data.applicant_accounts.filter(a => !a.archived).map(a=>[a.id,`${data.applicants.find(p=>p.id===a.applicant_id)?.name} / ${a.nickname}`])},date,{key:'lots',label:'Lots applied',type:'number',min:1,step:'1'},{key:'lot_size',label:'Shares per lot',type:'number',min:1,step:'1'},{key:'issue_price',label:'Issue price per share (₹)',type:'number',min:0.01},{key:'adjustment',label:'Amount adjustment (₹)',type:'number',optional:true},{key:'adjustment_reason',label:'Adjustment reason',optional:!Number(values.adjustment)},{key:'funding_method',label:'How is this funded?',type:'select',options:[['direct','Directly from my account'],['friend','From money already held by applicant']]},bank,{key:'reference',label:'Application reference (optional)',optional:true},notes];
 if (['block','unblock','prepay'].includes(command)) fields = [amount,date];
 if (['fund_friend','repay'].includes(command)) fields = [applicant,bank,amount,date,notes];
 if (command === 'refund') fields = [bank,amount,date,notes];
 if (command === 'allot') fields = [{key:'result',label:'Allotment result',type:'select',options:[['full','Fully allotted'],['partial','Partially allotted'],['none','Not allotted'],['rejected','Rejected'],['cancelled','Cancelled']]},{key:'shares',label:'Shares allotted (0 if unsuccessful)',type:'number',min:0,step:'1'},{key:'purchase_charges',label:'Purchase charges (₹)',type:'number',min:0},date];
 if (command === 'sale') fields = [{key:'shares',label:'Shares sold',type:'number',min:1,step:'1'},{key:'price',label:'Sale price per share (₹)',type:'number',min:0},{key:'charges',label:'Total sale charges (₹)',type:'number',min:0},date,notes];
 if (command === 'receipt') fields = [{key:'destination',label:'Where did the proceeds arrive?',type:'select',options:[['bank','My financial account'],['friend','Applicant’s custody account']]},...(values.destination==='bank'?[bank]:[]),amount,date,notes];
 if (command === 'mandate') fields = [{key:'status',label:'Mandate status',type:'select',options:option(['not_requested','requested','approved','rejected'])},date];
 if (command === 'event') fields = [{key:'kind',label:'Event',type:'select',options:option(['shares_credited','listing','expected_refund','expected_allotment','expected_listing','note'])},date,{key:'expected',label:'Confirmation',type:'select',options:[['false','Confirmed / actually occurred'],['true','Expected / forecast only']]},{key:'reference_price',label:'Reference listing price (optional, ₹)',type:'number',min:0,optional:true},notes];
 if (command === 'reverse') fields = [{key:'reason',label:'Reason for correction',type:'textarea'},date];
 const text = (field: Field) => String(field.key.startsWith('dates.') ? (values.dates as Record<string,string> | undefined)?.[field.key.slice(6)] ?? '' : values[field.key] ?? '');
 const change = (field: Field, value: string) => {
  if (field.key.startsWith('dates.')) set('dates',{ ...(values.dates as object ?? {}),[field.key.slice(6)]:value });
  else set(field.key,value);
  if (field.key==='result' && ['none','rejected','cancelled'].includes(value)) { set('shares',0); set('purchase_charges',0); }
 };
 const submit = async (event: FormEvent) => {
  event.preventDefault(); if (inFlight.current) return;
  const missing = fields.find(f=>!f.optional && !text(f)); if (missing) { setError(`Enter ${missing.label.toLowerCase()}.`); return; }
  const payload: Record<string,unknown>={};
  for (const key of ['id','application_id','company_id','applicant_id','sale_id','event_id']) {
   if (seed[key] !== undefined) payload[key]=seed[key];
  }
  for (const field of fields) {
   if (field.key.startsWith('dates.')) payload.dates={...(payload.dates as object ?? {}),[field.key.slice(6)]:text(field)};
   else payload[field.key]=values[field.key]??'';
  }
  for (const field of fields) if (field.type==='number') payload[field.key]=text(field)===''?null:Number(text(field));
  payload.archived=String(values.archived)==='true'; payload.expected=String(values.expected)==='true';
  const serialized=JSON.stringify(payload);
  if (retry.current.payload!==serialized) retry.current={payload:serialized,id:crypto.randomUUID()};
  inFlight.current=true; setBusy(true); setError('');
  try { await commandIpo(command,payload,retry.current.id); onSaved(); }
  catch(caught) { setError(caught instanceof Error ? caught.message : 'Could not save. Retry with the same details.'); inFlight.current=false; setBusy(false); }
 };
 const hint: Record<string,string> = { application:'This creates an immediate memo in Transactions. Record a block or an actual payment separately.', edit_application:'Amounts and references can be corrected before allotment once any reserved or prepaid funds have been released.', block:'Money stays in its account. This records the portion currently unavailable to spend.', unblock:'Releasing a block never credits cash to your account.', prepay:'Use only when money actually left your bank. ASBA blocking is recorded with “Block funds”.', fund_friend:'One actual transfer can fund several applications. It moves money to applicant custody, not an expense.', allot:'An allotted holding and its capital debit are created together, exactly once. Any unused block remains until you record its release.', sale:'Profit or loss is realised now. Proceeds remain awaiting settlement until you record where they arrived.', receipt:'This moves already-recorded proceeds and does not count profit again.', repay:'Only unreserved money held by the applicant can be returned.', refund:'Only an actual prepayment can be refunded. Use “Release block” for blocked funds.', reverse:'The original record is retained. A reversing ledger entry corrects its effect. Newer dependent events must be reversed first.', applicant:'Use display names only. No PAN, passwords or complete account numbers are needed.' };
 const preview=command==='application'||command==='edit_application' ? `${Number(values.lots)*Number(values.lot_size)} shares · ${formatMoney(Number(values.lots)*Number(values.lot_size)*Number(values.issue_price)+Number(values.adjustment||0))} applied` : command==='allot' ? `${formatMoney(Number(values.shares)*(application?.issue_price??0)+Number(values.purchase_charges))} allotted cost including charges` : command==='sale' ? `${formatMoney(Number(values.shares)*Number(values.price||0)-Number(values.charges))} net sale proceeds` : '';
 return <ModalShell eyebrow="IPO portfolio" title={spec.title} labelId="ipo-form-title" onClose={()=>{if(!busy)onClose();}}><form className="modal-form" onSubmit={submit}><p className="modal-description">{hint[command]??'Record the details you know. Optional dates can remain blank.'}</p><div className="form-grid">{fields.map(f=><div key={f.key} className={f.type==='textarea'?'full-field':''}>{f.type==='date'?<DatePicker label={f.label} value={text(f)} onChange={v=>change(f,v)} clearable={f.optional} disabled={busy}/>:<label>{f.label}{f.type==='select'?<Select value={text(f)} onChange={e=>change(f,e.target.value)} disabled={busy||Boolean(seed.id&&f.key==='applicant_id')} required={!f.optional}><option value="">Choose an option</option>{f.options?.map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select>:f.type==='textarea'?<textarea value={text(f)} onChange={e=>change(f,e.target.value)} maxLength={1500} disabled={busy} required={!f.optional}/>:<input value={text(f)} onChange={e=>change(f,e.target.value)} type={f.type==='number'?'number':'text'} min={f.min} max={f.max} step={f.step??'0.01'} maxLength={f.key==='name'&&command==='company'?120:80} disabled={busy} required={!f.optional}/>}</label>}</div>)}</div>{preview?<p className="ipo-preview">{preview}</p>:null}{error?<p role="alert" className="form-error">{error}</p>:null}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save record'}</button></div></form></ModalShell>;
}
