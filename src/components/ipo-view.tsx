import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/components/ipo.css';
import { Building2, ChevronRight, Download, Plus, RefreshCw } from 'lucide-react';
import { Select } from '@/components/select';
import { DatePicker } from '@/components/date-picker';
import { SectionHeading, EmptyPanel } from '@/components/ui';
import { IpoForm, type IpoFormSpec } from '@/components/ipo-form';
import { IpoCalendar } from '@/components/ipo-calendar';
import { formatDate, formatMoney, todayKey, type Account } from '@/lib/finance';
import { loadIpo } from '@/lib/ipo-api';
import { emptyFilters, eventLabel, filterIpo, indexIpo, ipoCalendar, ipoCsv, ipoDateKey, ipoPortfolioRange, ipoPortfolioSummary, money, sum, summaryIpo, type CsvCell, type IpoData, type IpoFilters, type IpoRow } from '@/lib/ipo';

const allotmentLabels: Record<string, string> = {
 applied: 'Awaiting result',
 full: 'Fully allotted',
 partial: 'Partially allotted',
 none: 'Not allotted',
 rejected: 'Rejected',
 cancelled: 'Cancelled',
};

function Table({ headings, rows }: { headings: string[]; rows: (string | number)[][] }) {
 return <div className="table-scroll"><table><thead><tr>{headings.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>):<tr><td colSpan={headings.length} className="table-empty">No matching records.</td></tr>}</tbody></table></div>;
}
function Stats({ items }: { items: [string,string,string][] }) {
 return <div className="ipo-stats">{items.map(([label,value,hint])=><div key={label} title={hint}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>;
}
function PortfolioSummary({ rows }: { rows: IpoRow[] }) {
 const [period, setPeriod] = useState<'all' | 'week' | 'month' | 'custom'>('all');
 const [custom, setCustom] = useState({ start: '', end: '' });
 const today = ipoDateKey();
 const range = ipoPortfolioRange(period, today, custom);
 const totals = ipoPortfolioSummary(rows, range);

 return <section className="surface-card ipo-portfolio-summary">
  <div className="card-title-row">
   <div><h3>Portfolio summary</h3><p>Applications, allotment results and realised returns by date.</p></div>
   <Select aria-label="IPO portfolio date range" value={period} onChange={event => setPeriod(event.target.value as typeof period)}>
    <option value="all">All time</option>
    <option value="week">This week</option>
    <option value="month">This month</option>
    <option value="custom">Custom range</option>
   </Select>
  </div>
  {period === 'custom' ? <div className="ipo-calendar-filters">
   <DatePicker label="From" value={custom.start} onChange={start => setCustom(current => ({ ...current, start }))} max={custom.end || today} clearable />
   <DatePicker label="To" value={custom.end} onChange={end => setCustom(current => ({ ...current, end }))} min={custom.start} max={today} clearable />
  </div> : null}
  <Stats items={[
   ['Companies applied', String(totals.companies), 'Distinct companies by application date'],
   ['Applications', String(totals.applications), 'Applications submitted'],
   ['Allotted', String(totals.allotted), 'Full or partial results by allotment date'],
   ['Not allotted', String(totals.notAllotted), 'Unsuccessful results by allotment date'],
   ['Total profit', formatMoney(totals.profit), 'Profitable sales in the period'],
   ['Total loss', formatMoney(totals.loss), 'Losses on sales in the period'],
   ['Net profit / loss', formatMoney(totals.net), 'Total profit less total loss'],
  ]} />
 </section>;
}

function Reports({ data, rows, friends, filters }: { data: IpoData; rows: IpoRow[]; friends: Map<string,number>; filters: IpoFilters }) {
 const [group,setGroup]=useState('company'); const [exportKind,setExportKind]=useState('applications');
 const ids=new Set(rows.map(r=>r.id)); const people=new Set(rows.map(r=>r.person.id)); const companyIds=new Set(rows.map(r=>r.company_id));
 // Unallocated funding is still owed, including before the first application.
 if (!Object.entries(filters).some(([key,value])=>key!=='applicant'&&Boolean(value))) {
  data.applicants.filter(p=>!filters.applicant||p.id===filters.applicant).forEach(p=>people.add(p.id));
 }
 const groups=new Map<string,IpoRow[]>(); rows.forEach(r=>{const key=group==='applicant'?r.applicant_account_id:group==='classification'?r.company.classification:group==='funding'?r.funding_method:r.company_id;groups.set(key,[...(groups.get(key)??[]),r]);});
 const groupRows=[...groups].map(([key,rs])=>{const label=group==='applicant'?rs[0].label:group==='company'?rs[0].company.name:key;const s=summaryIpo(rs);return [label,s.applications,s.applied,s.allotted,s.originalCost,s.proceeds,s.profit,`${money(s.allotted/Math.max(1,s.applications)*100)}%`];});
 const liveSales=data.sales.filter(s=>!s.voided&&ids.has(s.application_id));
 const [period,setPeriod]=useState('month'); const [start,setStart]=useState('');const [end,setEnd]=useState('');
 const periodSales=liveSales.filter(s=>(!start||s.sold_on>=start)&&(!end||s.sold_on<=end));
 const profitGroups=new Map<string,number>(); periodSales.forEach(s=>{const k=s.sold_on.slice(0,period==='day'?10:period==='month'?7:4);profitGroups.set(k,money((profitGroups.get(k)??0)+s.profit));});
 const max=Math.max(1,...[...profitGroups.values()].map(Math.abs));
 const outstanding=data.applicants.filter(p=>people.has(p.id)).map(p=>[p.name,friends.get(p.id)??0]);
 const rowFor=(id:string)=>rows.find(r=>r.id===id)!;
 const exportRows=():CsvCell[][]=>{
  if(exportKind==='applications')return [['Company','Applicant','Demat account','Application date','Lots','Shares applied','Issue price INR','Adjustment INR','Application INR','Funding','Status','Blocked INR','Refund due INR','Held shares','Reference'],...rows.map(r=>[r.company.name,r.person.name,r.account.nickname,r.application_date,r.lots,r.lots*r.lot_size,r.issue_price,r.adjustment,r.amount,r.funding_method,r.status,r.blocked,r.refund_due,r.remainingShares,r.reference])];
  if(exportKind==='companies'||exportKind==='applicants'){
   const buckets=new Map<string,IpoRow[]>();rows.forEach(r=>{const k=exportKind==='companies'?r.company_id:r.applicant_account_id;buckets.set(k,[...(buckets.get(k)??[]),r]);});
   return [['Name','Applications','Applied INR','Allotted accounts','Allotted INR','Proceeds INR','Realised profit INR','Success percent'],...[...buckets.values()].map(rs=>{const label=exportKind==='companies'?rs[0].company.name:rs[0].label;const s=summaryIpo(rs);return [label,s.applications,s.applied,s.allotted,s.originalCost,s.proceeds,s.profit,money(s.allotted/Math.max(1,s.applications)*100)];})];
  }
  if(exportKind==='allotments')return [['Company','Applicant','Date','Result','Shares','Cost INR','Purchase charges INR'],...data.allotments.filter(a=>!a.voided&&ids.has(a.application_id)).map(a=>[rowFor(a.application_id).company.name,rowFor(a.application_id).label,a.allotted_on,a.result,a.shares,a.cost,a.purchase_charges])];
  if(exportKind==='sales'||exportKind==='profit')return [['Company','Applicant','Sale date','Shares','Price INR','Charges INR','Gross INR','Net INR','Allocated cost INR','Realised profit INR','Unsettled INR'],...periodSales.map(s=>[rowFor(s.application_id).company.name,rowFor(s.application_id).label,s.sold_on,s.shares,s.price,s.charges,s.gross,s.net,s.cost_basis,s.profit,money(s.net-sum(data.settlements.filter(x=>!x.voided&&x.sale_id===s.id),x=>x.amount))])];
  if(exportKind==='outstanding')return [['Record','Applicant','Date','Amount INR','Note'],...outstanding.map(([p,n])=>['Custody balance',p,'',n,'Whole applicant pool; not allocated to a company']),...data.settlements.filter(s=>!s.voided&&s.applicant_id&&people.has(s.applicant_id)).map(s=>[s.kind,data.applicants.find(p=>p.id===s.applicant_id)?.name,s.received_on,s.amount,'Recorded movement'])];
  return [['Date','Company','Event','Applicant'],...ipoCalendar(data).filter(e=>!Object.values(filters).some(Boolean)||(e.applicationId?ids.has(e.applicationId):companyIds.has(e.companyId))).map(e=>[e.date,data.companies.find(c=>c.id===e.companyId)?.name,e.label,data.applicants.find(p=>p.id===e.personId)?.name])];
 };
 const download=()=>{const url=URL.createObjectURL(new Blob([ipoCsv(exportRows())],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`ipo-${exportKind}-${todayKey()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <><section className="surface-card"><div className="card-title-row"><div><h3>Portfolio reports</h3><p>Uses the application filters above. All amounts are INR.</p></div><Select value={group} onChange={e=>setGroup(e.target.value)} aria-label="Report grouping"><option value="company">By company</option><option value="applicant">By applicant account</option><option value="classification">Mainboard / SME</option><option value="funding">By funding method</option></Select></div><Table headings={['Group','Applications','Applied','Allotted','Allotted cost','Sale proceeds','Realised P/L','Success rate']} rows={groupRows.map(r=>r.map((v,i)=>[2,4,5,6].includes(i)?formatMoney(Number(v)):v))}/></section>
 <section className="surface-card"><div className="card-title-row"><div><h3>Realised profit over time</h3><p>Grouped by actual sale date, including partial sales.</p></div><Select value={period} onChange={e=>setPeriod(e.target.value)} aria-label="Profit period"><option value="day">Daily</option><option value="month">Monthly</option><option value="year">Yearly</option></Select></div><div className="ipo-calendar-filters"><DatePicker label="Sale dates from" value={start} onChange={setStart} clearable/><DatePicker label="Sale dates to" value={end} onChange={setEnd} min={start} clearable/></div><div className="ipo-profit-bars">{[...profitGroups].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=><div key={date}><span>{date}</span><div><i className={value<0?'loss':''} style={{width:`${Math.max(1,Math.abs(value)/max*100)}%`}}/></div><b className={value<0?'negative':'positive'}>{formatMoney(value)}</b></div>)}</div>{!profitGroups.size?<p>No share sales in this period.</p>:null}</section>
 <section className="surface-card"><h3>Outstanding funds</h3><p className="form-hint">Applicant balances are pooled across their IPOs. They are not bank cash or additional profit.</p><Table headings={['Applicant','Funds in custody']} rows={outstanding.map(([p,n])=>[String(p),formatMoney(Number(n))])}/><Table headings={['Company / applicant','Refund still due','Proceeds awaiting receipt']} rows={rows.filter(r=>r.refund_due||r.unsettled).map(r=>[`${r.company.name} / ${r.label}`,formatMoney(r.refund_due),formatMoney(r.unsettled)])}/></section>
 <section className="surface-card ipo-export"><div><h3>Export records</h3><p>Exports respect application filters; sales also use the sale-date range.</p></div><Select value={exportKind} onChange={e=>setExportKind(e.target.value)} aria-label="Export report">{['applications','companies','applicants','allotments','sales','profit','outstanding','calendar'].map(k=><option key={k}>{k}</option>)}</Select><button className="secondary-button" onClick={download}><Download size={16}/> Download CSV</button></section></>;
}

export function IpoView({ accounts, initialApplication, onUpdated, onNotify }: { accounts: Account[]; initialApplication?: string; onUpdated: () => Promise<void>; onNotify: (message:string)=>void }) {
 const [data,setData]=useState<IpoData|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const [tab,setTab]=useState('portfolio');const [companyId,setCompanyId]=useState('');const [appId,setAppId]=useState(initialApplication??'');
 const [form,setForm]=useState<IpoFormSpec|null>(null);const [filters,setFilters]=useState<IpoFilters>(emptyFilters);const [showFilters,setShowFilters]=useState(false);const [sort,setSort]=useState('recent');const [page,setPage]=useState(0);
 const refresh=useCallback(async()=>{setLoading(true);setError('');try{setData(await loadIpo());}catch(e){setError(e instanceof Error?e.message:'Could not load IPO records.');}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const indexed=useMemo(()=>data?indexIpo(data):null,[data]);
 const filtered=useMemo(()=>indexed?filterIpo(indexed.rows,filters,indexed.friendBalances):[],[indexed,filters]);
 const open=(command:string,title:string,seed:Record<string,unknown>={})=>setForm({command,title,seed});
 const saved = (id: string | null) => {
  if (id && form?.command === 'company' && !form.seed?.id) {
   setCompanyId(id);
   setAppId('');
   setTab('portfolio');
  }
  if (id && form?.command === 'application') {
   setAppId(id);
   setTab('portfolio');
  }
  onNotify(form?.command === 'allot' ? 'Allotment result saved.' : 'IPO record saved.');
  setForm(null);
  void Promise.all([refresh(), onUpdated()]).catch(() => onNotify('Saved, but refresh failed. Refresh the page to see updated totals.'));
 };
 const updateFilter=(key:keyof IpoFilters,value:string)=>{setFilters(f=>({...f,[key]:value}));setPage(0);};
 if(!data||!indexed)return <section className="surface-card"><EmptyPanel icon={<Building2 size={24}/>} title={loading?'Loading your IPO portfolio…':'IPO portfolio unavailable'} description={error||'Reading your private workspace records.'} action={!loading?<button className="secondary-button" onClick={()=>void refresh()}>Try again</button>:undefined}/></section>;
 const selectedApp=indexed.rows.find(a=>a.id===appId);const selectedCompany=indexed.companies.get(selectedApp?.company_id??companyId);
 const allotment = selectedApp?.allotment;
 const lotsReceived = allotment && selectedApp ? allotment.shares / selectedApp.lot_size : null;
 const resultDetails = [
  allotment ? allotmentLabels[allotment.result] : '',
  selectedApp && lotsReceived !== null && Number.isInteger(lotsReceived) ? `${lotsReceived} allotted · ${selectedApp.lots - lotsReceived} non-allotted` : '',
  allotment?.shares ? `${allotment.shares} shares · ${formatMoney(allotment.cost)}` : '',
  allotment ? formatDate(allotment.allotted_on) : '',
 ].filter(Boolean).join(' · ');
 const recordAllotment = (application: IpoRow) => open('allot', 'Enter results', {
  application_id: application.id,
  company_id: application.company_id,
  applicant_id: application.person.id,
 });
 const companyRows=selectedCompany?indexed.rows.filter(r=>r.company_id===selectedCompany.id):[];
 const history = data.events.filter(event => !event.expected && (
  selectedApp ? event.application_id === selectedApp.id : event.company_id === selectedCompany?.id
 )).sort((a, b) => b.created_at.localeCompare(a.created_at));
 const companyList=data.companies.filter(c=>filtered.some(r=>r.company_id===c.id)||(!filters.applicant&&!filters.start&&!filters.end&&!filters.status&&!filters.result&&!filters.funding&&!filters.holding&&(!filters.search||c.name.toLowerCase().includes(filters.search.toLowerCase()))&&(!filters.classification||c.classification===filters.classification))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='capital'?sum(filtered.filter(r=>r.company_id===b.id),r=>r.amount)-sum(filtered.filter(r=>r.company_id===a.id),r=>r.amount):(b.dates.opening??'').localeCompare(a.dates.opening??''));
 const maxPage=Math.max(0,Math.ceil(companyList.length/12)-1);const shownPage=Math.min(page,maxPage);
 return <div className="ipo-workspace"><SectionHeading title="IPO portfolio" description="Your capital, every applicant, one connected history." action={<><button className="secondary-button" onClick={()=>open('fund_friend','Send funds to applicant')} disabled={!data.applicants.length}>Send funds</button><button className="primary-button" onClick={()=>open('company','Add IPO company')}><Plus size={16}/> Add IPO</button></>}/>
 {error?<p role="alert" className="form-error">{error} <button className="text-button" onClick={()=>void refresh()}>Refresh</button></p>:null}
 <nav className="ipo-tabs" aria-label="IPO sections">{[['portfolio','Portfolio'],['calendar','Calendar'],['reports','Reports'],['applicants','Applicants']].map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setCompanyId('');setAppId('');}}>{label}</button>)}<button className="ipo-refresh" aria-label="Refresh IPO data" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={16}/></button></nav>
 {tab === 'portfolio' && !selectedCompany ? <PortfolioSummary rows={indexed.rows} /> : null}
 {(tab==='reports'||tab==='portfolio')&&!selectedCompany?<section className="surface-card ipo-filter-card"><div className="ipo-filter-top"><input aria-label="Search IPOs" placeholder="Search company, applicant or reference" value={filters.search} onChange={e=>updateFilter('search',e.target.value)}/><button className="secondary-button" onClick={()=>setShowFilters(!showFilters)} aria-expanded={showFilters}>Filters</button>{tab==='portfolio'?<Select aria-label="Sort IPOs" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Opening date</option><option value="name">Company name</option><option value="capital">Applied capital</option></Select>:null}</div>{showFilters?<div className="ipo-filters"><label>Applicant<Select value={filters.applicant} onChange={e=>updateFilter('applicant',e.target.value)}><option value="">All applicants</option>{data.applicants.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></label><DatePicker label="Application from" value={filters.start} onChange={v=>updateFilter('start',v)} clearable/><DatePicker label="Application to" value={filters.end} onChange={v=>updateFilter('end',v)} min={filters.start} clearable/>{([['classification','Classification',['Mainboard','SME']],['status','Application status',['applied','full','partial','none','rejected','cancelled']],['result','Allotment',['pending','full','partial','none','rejected','cancelled']],['funding','Funding',['direct','friend']],['holding','Outstanding / holdings',['open','sold','refund','friend']]] as [keyof IpoFilters,string,string[]][]).map(([key,label,opts])=><label key={key}>{label}<Select value={filters[key]} onChange={e=>updateFilter(key,e.target.value)}><option value="">All</option>{opts.map(o=><option key={o}>{o}</option>)}</Select></label>)}<button className="text-button" onClick={()=>{setFilters(emptyFilters);setPage(0);}}>Clear filters</button></div>:null}</section>:null}
 {tab === 'portfolio' && !selectedCompany ? <>
  <div className="ipo-company-list">
   {companyList.slice(shownPage * 12, shownPage * 12 + 12).map(company => {
    const sold = indexed.rows.filter(row => row.company_id === company.id && row.sales.length > 0);
    const profit = sum(sold, row => row.profit);
    return <button key={company.id} type="button" className="surface-card ipo-company-heading" onClick={() => setCompanyId(company.id)}>
     <span className="ipo-company-name">{company.name}</span>
     {sold.length ? <strong className={profit < 0 ? 'negative' : profit > 0 ? 'positive' : ''}>
      {formatMoney(profit)} {profit < 0 ? 'loss' : profit > 0 ? 'profit' : 'break-even'}
     </strong> : null}
     <ChevronRight size={16} aria-hidden="true" />
    </button>;
   })}
  </div>
  {!companyList.length ? <section className="surface-card">
   <EmptyPanel icon={<Building2 size={24} />} title={data.companies.length ? 'No matching IPOs' : 'Your IPO portfolio starts here'}
    description={data.companies.length ? 'Adjust your search or filters.' : 'Add a company to record applications and track results.'}
    action={!data.companies.length ? <button className="primary-button" onClick={() => open('company', 'Add IPO company')}><Plus size={16} /> Add IPO</button> : undefined} />
  </section> : null}
  {maxPage > 0 ? <div className="ipo-pagination">
   <button className="secondary-button" disabled={!shownPage} onClick={() => setPage(shownPage - 1)}>Previous</button>
   <span>{companyList.length} companies · Page {shownPage + 1} of {maxPage + 1}</span>
   <button className="secondary-button" disabled={shownPage >= maxPage} onClick={() => setPage(shownPage + 1)}>Next</button>
  </div> : null}
 </> : null}
 {tab==='portfolio'&&selectedCompany?<><button className="text-button" onClick={()=>{if(selectedApp){setCompanyId(selectedCompany.id);setAppId('');}else setCompanyId('');}}>{selectedApp?'Back to company':'Back to portfolio'}</button><SectionHeading title={selectedApp?selectedApp.label:selectedCompany.name} description={selectedApp?`${selectedCompany.name} · Applied ${formatDate(selectedApp.application_date)} · Reference ${selectedApp.reference||'not recorded'}`:`${selectedCompany.classification} · ${formatMoney(selectedCompany.issue_price)} per share · ${selectedCompany.lot_size} shares per lot`} action={<><button className="secondary-button" onClick={()=>open('company','Edit IPO company',{...selectedCompany})}>Edit company</button><button className="primary-button" disabled={selectedCompany.archived||!data.applicant_accounts.length} onClick={()=>open('application','Add application',{company_id:selectedCompany.id})}><Plus size={16}/> Add application</button></>}/>
 {selectedApp?<section className="surface-card">
  <div className="card-title-row">
   <div>
    <h3>{allotment ? 'Allotment recorded' : 'Awaiting allotment result'}</h3>
    <p>{resultDetails || 'Return here once you know the result.'}</p>
   </div>
   {!allotment ? (
    <button className="primary-button" type="button" onClick={() => recordAllotment(selectedApp)}>Enter results</button>
   ) : null}
  </div>
  <Stats items={[[ 'Applied',formatMoney(selectedApp.amount),`${selectedApp.lots*selectedApp.lot_size} shares`],['Blocked',formatMoney(selectedApp.blocked),'Release only after actual unblock'],['Held shares',String(selectedApp.remainingShares),`${formatMoney(selectedApp.remainingCost)} remaining cost`],['Realised P/L',formatMoney(selectedApp.profit),'Recorded share sales'],['Refund due',formatMoney(selectedApp.refund_due),'Actual prepaid funds'],['Awaiting proceeds',formatMoney(selectedApp.unsettled),'Sale settlement pending']]}/><p>{selectedApp.funding_method==='direct'?'Direct funding':'Applicant custody'} · {accounts.find(a=>a.id===selectedApp.funding_account_id)?.name??'Archived account'} · Mandate {selectedApp.mandate}</p>{selectedApp.notes?<p>{selectedApp.notes}</p>:null}<div className="ipo-record-actions"><Select value="" aria-label="Record application event" onChange={e=>{const k=e.target.value;if(k)open(k,k==='edit_application'?'Edit application':k.replace(/_/g,' '),{...(k==='edit_application'?{...selectedApp,account_id:selectedApp.funding_account_id,date:selectedApp.application_date}:{}),application_id:selectedApp.id,company_id:selectedCompany.id,applicant_id:selectedApp.person.id});}}><option value="">Record an event…</option>{[['mandate','Mandate status'],['block','Block funds'],['unblock','Release block'],['prepay','Actual prepayment'],['refund','Actual refund'],['sale','Sell shares'],['event','Share credit / listing / note'],['edit_application','Correct application']].map(([k,l])=><option key={k} value={k}>{l}</option>)}</Select><button className="secondary-button" onClick={()=>open('repay','Record applicant repayment',{applicant_id:selectedApp.person.id,company_id:selectedCompany.id})}>Applicant repayment</button></div><h4>Share sale history</h4>{selectedApp.sales.length?selectedApp.sales.map(s=>{const pending=money(s.net-(indexed.receipts.get(s.id)??0));return <div key={s.id} className="ipo-event-row"><span><b>{s.shares} shares · {formatDate(s.sold_on)}</b><small>Net {formatMoney(s.net)} · Cost {formatMoney(s.cost_basis)} · P/L {formatMoney(s.profit)}</small><small>{formatMoney(pending)} awaiting receipt</small></span>{pending>0?<button className="secondary-button" onClick={()=>open('receipt','Record sale proceeds receipt',{sale_id:s.id,application_id:selectedApp.id,amount:pending})}>Record receipt</button>:<small>Received</small>}</div>}):<p className="form-hint">No shares sold.</p>}</section> : (
  <section className="surface-card">
   <div className="card-title-row">
    <div><h3>Applications</h3><p>Select an applicant to view the application or enter the result.</p></div>
    <button className="text-button" type="button" onClick={() => open('event', 'Record IPO activity', { company_id: selectedCompany.id, kind: 'listing' })}>Record activity</button>
   </div>
   {companyRows.map(application => (
    <div className="ipo-company-application" key={application.id}>
     <button type="button" className="ipo-event-row" onClick={() => setAppId(application.id)}>
      <span>
       <b>{application.label}</b>
       <small>{application.lots} {application.lots === 1 ? 'lot' : 'lots'} applied · {allotmentLabels[application.status] ?? application.status}</small>
      </span>
      <strong>{formatMoney(application.amount)}</strong>
     </button>
     {!application.allotment ? (
      <button type="button" className="secondary-button" onClick={() => recordAllotment(application)}>Enter results</button>
     ) : null}
    </div>
   ))}
   {!companyRows.length ? <p className="form-hint">Add an application to enter its results.</p> : null}
  </section>
 )}
 <section className="surface-card"><h3>Recorded history</h3><p className="form-hint">Memo entries do not post cash. Corrections retain the original event and its reversal.</p>{history.map(e=><details key={e.id} className={`ipo-history ${e.reversed?'ipo-voided':''}`}><summary><span>{eventLabel(e)}<small>{formatDate(e.event_date)} · {e.reversed?'Reversed':e.memo?'Memo / no bank debit':'Posted movement'}</small></span><strong>{e.amount?formatMoney(e.amount):''}</strong></summary><dl className="ipo-history-details">{Object.entries({...e.payload,...e.details}).filter(([k,v])=>!k.endsWith('_id')&&!k.startsWith('before')&&k!=='dates'&&k!=='expected'&&v!==null&&typeof v!=='object').map(([k,v])=><div key={k}><dt>{k.replace(/_/g,' ')}</dt><dd>{String(v)}</dd></div>)}</dl>{!e.reversed&&!['company','applicant','demat','application','reverse'].includes(e.command)?<button className="text-button danger" onClick={()=>open('reverse','Correct this event',{event_id:e.id})}>Reverse with reason</button>:null}</details>)}</section></>:null}
 {tab==='calendar'?<IpoCalendar data={data} onCompany={id=>{setCompanyId(id);setAppId('');setTab('portfolio');}}/>:null}
 {tab==='reports'?<Reports data={data} rows={filtered} friends={indexed.friendBalances} filters={filters}/>:null}
 {tab==='applicants'?<><SectionHeading title="Applicant accounts" description="Reusable profiles. All capital and returns belong to your workspace." action={<button className="primary-button" onClick={()=>open('applicant','Add applicant')}><Plus size={16}/> Add applicant</button>}/>{!data.applicants.length?<section className="surface-card"><p>No applicant profiles yet. Add yourself or a friend, then add their demat accounts.</p></section>:data.applicants.map(p=><section key={p.id} className="surface-card"><div className="card-title-row"><div><h3>{p.name}</h3><p>{p.designation==='self'?'My account':p.relationship||'Friend'}{p.archived?' · Archived':''} · {formatMoney(indexed.friendBalances.get(p.id)??0)} held in custody</p></div><div className="heading-actions"><button className="text-button" onClick={()=>open('applicant','Edit applicant',{...p})}>Edit profile</button><button className="secondary-button" disabled={p.archived} onClick={()=>open('demat','Add demat account',{applicant_id:p.id})}>Add account</button><button className="secondary-button" onClick={()=>open('repay','Record repayment',{applicant_id:p.id})}>Record repayment</button></div></div>{data.applicant_accounts.filter(a=>a.applicant_id===p.id).map(a=><div key={a.id} className="ipo-event-row"><span><b>{a.nickname}{a.archived?' · Archived':''}</b><small>{[a.broker,a.demat_label,a.bank_nickname].filter(Boolean).join(' · ')||'No optional account labels'}</small></span><button className="text-button" onClick={()=>open('demat','Edit demat account',{...a})}>Edit</button></div>)}</section>)}</>:null}
 {form?<IpoForm spec={form} data={data} accounts={accounts} onClose={()=>setForm(null)} onSaved={saved}/>:null}
 </div>;
}
