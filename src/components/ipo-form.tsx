import { useRef, useState, type FormEvent } from 'react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { ModalShell } from '@/components/ui';
import { formatMoney, isUsable, todayKey, type Account } from '@/lib/finance';
import { commandIpo } from '@/lib/ipo-api';
import type { IpoData } from '@/lib/ipo';

export type IpoFormSpec = { command: string; title: string; seed?: Record<string, unknown> };
type Field = { key: string; label: string; type?: 'number' | 'date' | 'text' | 'textarea' | 'select'; optional?: boolean; options?: [string,string][]; step?: string; min?: number; max?: number; minDate?: string; maxDate?: string };
const option = (values: string[]): [string,string][] => values.map(x => [x, x.replace(/_/g,' ')]);
const notes: Field = { key: 'notes', label: 'Notes (optional)', type: 'textarea', optional: true };
const amount: Field = { key: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01 };
const date: Field = { key: 'date', label: 'Date', type: 'date' };
export function IpoForm({ spec, data, accounts, onClose, onSaved }: { spec: IpoFormSpec; data: IpoData; accounts: Account[]; onClose: () => void; onSaved: (id: string | null) => void }) {
 const { command, seed = {} } = spec;
 const company = data.companies.find(c => c.id === seed.company_id);
 const application = data.applications.find(a => a.id === seed.application_id);
 const todayParts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
 const ipoToday = ['year', 'month', 'day'].map(part => todayParts.find(value => value.type === part)?.value).join('-');
 const [values, setValues] = useState<Record<string, unknown>>({
  date: command === 'allot' ? ipoToday : todayKey(),
  designation: 'self',
  classification: 'Mainboard',
  minimum_lots: 1,
  lots: company?.minimum_lots ?? 1,
  lot_size: company?.lot_size ?? '',
  issue_price: company?.issue_price ?? '',
  adjustment: 0,
  funding_method: 'direct',
  purchase_charges: 0,
  charges: 0,
  status: 'requested',
  destination: 'bank',
  kind: 'shares_credited',
  expected: false,
  ...seed,
 });
 const [busy, setBusy] = useState(false); const [error, setError] = useState('');
 const inFlight = useRef(false); const retry = useRef({ payload: '', id: '' });
 const set = (key: string, value: unknown) => setValues(v => ({ ...v, [key]: value }));
 const bank: Field = { key: 'account_id', label: 'Your financial account', type: 'select', options: accounts.filter(a => isUsable(a) && !a.isLiability).map(a => [a.id, a.name]) };
 const applicant: Field = { key: 'applicant_id', label: 'Applicant', type: 'select', options: data.applicants.filter(a => !a.archived || a.id === values.applicant_id).map(a => [a.id, a.name]) };
 const archive: Field = { key: 'archived', label: 'Profile status', type: 'select', options: [['false','Active'],['true','Archived']] };
 const appliedShares = application ? application.lots * application.lot_size : 0;
 const hasAllottedShares = values.result === 'full' || values.result === 'partial';
 const allottedShares = values.result === 'full' ? appliedShares : values.result === 'partial' ? Number(values.shares ?? 0) : 0;
 const purchaseCharges = hasAllottedShares ? Number(values.purchase_charges) : 0;
 let fields: Field[] = [];
 if (command === 'applicant') fields = [{ key:'name',label:'Applicant name' },{ key:'designation',label:'Whose demat account?',type:'select',options:[['self','My account'],['friend',"Friend’s account"]] },{key:'relationship',label:'Relationship / description (optional)',optional:true},notes,...(seed.id ? [archive] : [])];
 if (command === 'demat') fields = [applicant,{key:'nickname',label:'Account nickname'},{key:'broker',label:'Broker / platform (optional)',optional:true},{key:'demat_label',label:'Demat label (optional)',optional:true},{key:'bank_nickname',label:'Funding bank nickname (optional)',optional:true},notes,...(seed.id ? [archive] : [])];
 if (command === 'company') {
  fields = [
   { key: 'name', label: 'Company name' },
   { key: 'symbol', label: 'Symbol (optional)', optional: true },
   { key: 'classification', label: 'Classification', type: 'select', options: option(['Mainboard', 'SME']) },
   { key: 'issue_price', label: 'Issue price per share (₹)', type: 'number', min: 0.01 },
   { key: 'lot_size', label: 'Shares per lot', type: 'number', min: 1, step: '1' },
   { key: 'minimum_lots', label: 'Minimum lots', type: 'number', min: 1, step: '1' },
   { key: 'dates.opening', label: 'Opening date (optional)', type: 'date', optional: true },
   { key: 'dates.closing', label: 'Closing date (optional)', type: 'date', optional: true },
  ];
  if (seed.id) {
   fields.push(
    { key: 'dates.actual_allotment', label: 'Company allotment date (optional)', type: 'date', optional: true, maxDate: ipoToday },
    { key: 'dates.actual_refund', label: 'Company refund date (optional)', type: 'date', optional: true, maxDate: ipoToday },
    { key: 'dates.actual_listing', label: 'Actual listing date (optional)', type: 'date', optional: true, maxDate: ipoToday },
    archive,
   );
  }
  fields.push(notes);
 }
 if (command === 'application' || command === 'edit_application') fields = [{key:'applicant_account_id',label:'Applicant / demat account',type:'select',options:data.applicant_accounts.filter(a => !a.archived).map(a=>[a.id,`${data.applicants.find(p=>p.id===a.applicant_id)?.name} / ${a.nickname}`])},date,{key:'lots',label:'Lots applied',type:'number',min:1,step:'1'},{key:'lot_size',label:'Shares per lot',type:'number',min:1,step:'1'},{key:'issue_price',label:'Issue price per share (₹)',type:'number',min:0.01},{key:'adjustment',label:'Amount adjustment (₹)',type:'number',optional:true},{key:'adjustment_reason',label:'Adjustment reason',optional:!Number(values.adjustment)},{key:'funding_method',label:'How is this funded?',type:'select',options:[['direct','Directly from my account'],['friend','From money already held by applicant']]},bank,{key:'reference',label:'Application reference (optional)',optional:true},notes];
 if (['block','unblock','prepay'].includes(command)) fields = [amount,date];
 if (['fund_friend','repay'].includes(command)) fields = [applicant,bank,amount,date,notes];
 if (command === 'refund') fields = [bank,amount,date,notes];
 if (command === 'allot') {
  const results: [string, string][] = [['full', 'Fully allotted']];
  if (appliedShares > 1) results.push(['partial', 'Partially allotted']);
  results.push(['none', 'Not allotted'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']);
  fields = [
   { key: 'result', label: 'Allotment result', type: 'select', options: results },
   { ...date, label: 'Result date', minDate: application?.application_date, maxDate: ipoToday },
  ];
  if (values.result === 'partial') fields.push({ key: 'shares', label: 'Shares allotted', type: 'number', min: 1, max: appliedShares - 1, step: '1' });
  if (hasAllottedShares) fields.push({ key: 'purchase_charges', label: 'Purchase charges (₹)', type: 'number', min: 0 });
 }
 if (command === 'sale') fields = [{key:'shares',label:'Shares sold',type:'number',min:1,step:'1'},{key:'price',label:'Sale price per share (₹)',type:'number',min:0},{key:'charges',label:'Total sale charges (₹)',type:'number',min:0},date,notes];
 if (command === 'receipt') fields = [{key:'destination',label:'Where did the proceeds arrive?',type:'select',options:[['bank','My financial account'],['friend','Applicant’s custody account']]},...(values.destination==='bank'?[bank]:[]),amount,date,notes];
 if (command === 'mandate') fields = [{key:'status',label:'Mandate status',type:'select',options:option(['not_requested','requested','approved','rejected'])},date];
 if (command === 'event') fields = [{key:'kind',label:'Event',type:'select',options:option(['shares_credited','listing','expected_refund','expected_allotment','expected_listing','note'])},date,{key:'expected',label:'Confirmation',type:'select',options:[['false','Confirmed / actually occurred'],['true','Expected / forecast only']]},{key:'reference_price',label:'Reference listing price (optional, ₹)',type:'number',min:0,optional:true},notes];
 if (command === 'reverse') fields = [{key:'reason',label:'Reason for correction',type:'textarea'},date];
 const text = (field: Field) => String(field.key.startsWith('dates.') ? (values.dates as Record<string,string> | undefined)?.[field.key.slice(6)] ?? '' : values[field.key] ?? '');
 const change = (field: Field, value: string) => {
  setError('');
  if (field.key.startsWith('dates.')) set('dates',{ ...(values.dates as object ?? {}),[field.key.slice(6)]:value });
  else set(field.key,value);
 };
 const submit = async (event: FormEvent) => {
  event.preventDefault(); if (inFlight.current) return;
  const missing = fields.find(f=>!f.optional && !text(f)); if (missing) { setError(`Enter ${missing.label.toLowerCase()}.`); return; }
  if (fields.some(field => field.maxDate && text(field) > field.maxDate)) {
   setError('Choose today or an earlier date for an event that has already happened.');
   return;
  }
  if (fields.some(field => field.minDate && text(field) < field.minDate)) {
   setError('The result date cannot be before the application date.');
   return;
  }
  const payload: Record<string,unknown>={};
  for (const key of ['id','application_id','company_id','applicant_id','sale_id','event_id']) {
   if (seed[key] !== undefined) payload[key]=seed[key];
  }
  for (const field of fields) {
   if (field.key.startsWith('dates.')) payload.dates={...(payload.dates as object ?? {}),[field.key.slice(6)]:text(field)};
   else payload[field.key]=values[field.key]??'';
  }
  for (const field of fields) if (field.type==='number') payload[field.key]=text(field)===''?null:Number(text(field));
  if (command === 'allot') {
   payload.shares = allottedShares;
   payload.purchase_charges = purchaseCharges;
  }
  payload.archived=String(values.archived)==='true'; payload.expected=String(values.expected)==='true';
  const serialized=JSON.stringify(payload);
  if (retry.current.payload!==serialized) retry.current={payload:serialized,id:crypto.randomUUID()};
  inFlight.current=true; setBusy(true); setError('');
  try { const saved = await commandIpo(command,payload,retry.current.id); onSaved(saved.id); }
  catch(caught) { setError(caught instanceof Error ? caught.message : 'Could not save. Retry with the same details.'); inFlight.current=false; setBusy(false); }
 };
 const hint: Record<string,string> = {
  company: seed.id ? 'Company dates are for the calendar. Record each applicant’s result from their application.' : 'Save the company and issue details, then add your application. You can record the allotment result when it comes in.',
  application: 'Save your application now and return to it to record the result. Any block or payment is recorded separately.',
  edit_application: 'Amounts and references can be corrected before allotment once any reserved or prepaid funds have been released.',
  block: 'Money stays in its account. This records the portion currently unavailable to spend.',
  unblock: 'Releasing a block never credits cash to your account.',
  prepay: 'Use only when money actually left your bank. ASBA blocking is recorded with “Block funds”.',
  fund_friend: 'One actual transfer can fund several applications. It moves money to applicant custody, not an expense.',
  allot: 'Enter the confirmed result for this application. For allotted shares, saving records the cost and creates the linked investment.',
  sale: 'Profit or loss is realised now. Proceeds remain awaiting settlement until you record where they arrived.',
  receipt: 'This moves already-recorded proceeds and does not count profit again.',
  repay: 'Only unreserved money held by the applicant can be returned.',
  refund: 'Only an actual prepayment can be refunded. Use “Release block” for blocked funds.',
  reverse: 'The original record is retained. A reversing ledger entry corrects its effect. Newer dependent events must be reversed first.',
  applicant: 'Use display names only. No PAN, passwords or complete account numbers are needed.',
 };
 const preview=command==='application'||command==='edit_application' ? `${Number(values.lots)*Number(values.lot_size)} shares · ${formatMoney(Number(values.lots)*Number(values.lot_size)*Number(values.issue_price)+Number(values.adjustment||0))} applied` : command==='sale' ? `${formatMoney(Number(values.shares)*Number(values.price||0)-Number(values.charges))} net sale proceeds` : '';
 const saveLabel = command === 'company' && !seed.id ? 'Save IPO' : command === 'allot' ? 'Save result' : 'Save record';
 return (
  <ModalShell eyebrow="IPO portfolio" title={spec.title} labelId="ipo-form-title" onClose={() => { if (!busy) onClose(); }}>
   <form className="modal-form" onSubmit={submit}>
    <p className="modal-description">{hint[command] ?? 'Record the details you know. Optional dates can remain blank.'}</p>
    <div className="form-grid">
     {fields.map(field => (
      <div key={field.key} className={field.type === 'textarea' ? 'full-field' : ''}>
       {field.type === 'date' ? (
        <DatePicker label={field.label} value={text(field)} onChange={value => change(field, value)}
         min={field.minDate} max={field.maxDate} clearable={field.optional} disabled={busy} />
       ) : (
        <label>
         {field.label}
         {field.type === 'select' ? (
          <Select value={text(field)} onChange={event => change(field, event.target.value)}
           disabled={busy || Boolean(seed.id && field.key === 'applicant_id')} required={!field.optional}>
           <option value="">Choose an option</option>
           {field.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
         ) : field.type === 'textarea' ? (
          <textarea value={text(field)} onChange={event => change(field, event.target.value)}
           maxLength={1500} disabled={busy} required={!field.optional} />
         ) : (
          <input value={text(field)} onChange={event => change(field, event.target.value)}
           type={field.type === 'number' ? 'number' : 'text'} min={field.min} max={field.max} step={field.step ?? '0.01'}
           maxLength={field.key === 'name' && command === 'company' ? 120 : 80} disabled={busy} required={!field.optional} />
         )}
        </label>
       )}
      </div>
     ))}
    </div>
    {command === 'allot' && hasAllottedShares && allottedShares > 0 ? (
     <p className="ipo-preview">{allottedShares} shares · {formatMoney(allottedShares * (application?.issue_price ?? 0) + purchaseCharges)} allotted cost including charges</p>
    ) : null}
    {preview ? <p className="ipo-preview">{preview}</p> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="modal-actions">
     <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
     <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : saveLabel}</button>
    </div>
   </form>
  </ModalShell>
 );
}
