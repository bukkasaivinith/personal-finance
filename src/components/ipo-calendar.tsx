import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { formatDate, formatMoney, formatMonth, todayKey, toDateKey } from '@/lib/finance';
import { indexIpo, ipoCalendar, type CalendarEvent, type IpoData } from '@/lib/ipo';

export function IpoCalendar({ data, onCompany }: { data: IpoData; onCompany: (id: string) => void }) {
 const [month,setMonth]=useState(todayKey().slice(0,7)); const [day,setDay]=useState(''); const [hover,setHover]=useState('');
 const [person,setPerson]=useState(''); const [kind,setKind]=useState('');
 const events=useMemo(()=>ipoCalendar(data),[data]);
 const indexed=useMemo(()=>indexIpo(data),[data]);
 const visible=events.filter(e=>(!person||e.personId===person)&&(!kind||e.label===kind));
 const days=useMemo(()=>{const start=new Date(`${month}-01T12:00:00`); start.setDate(1-start.getDay()); return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return toDateKey(d);});},[month]);
 const move=(n:number)=>{const d=new Date(`${month}-01T12:00:00`);d.setMonth(d.getMonth()+n);setMonth(toDateKey(d).slice(0,7));setDay('');};
 const label=(companyId:string|null)=>data.companies.find(c=>c.id===companyId)?.name??'Applicant funds';
 const detail=visible.filter(e=>e.date===day);
 const context=(event:CalendarEvent)=>{
  const row=indexed.rows.find(r=>r.id===event.applicationId);
  return row?`${row.label} · Applied ${formatMoney(row.amount)} · Currently blocked ${formatMoney(row.blocked)} · Allotted ${row.allotment?.shares??0} shares / ${formatMoney(row.allotment?.cost??0)} · Refund due ${formatMoney(row.refund_due)} · Sales ${formatMoney(row.proceeds)} · Realised P/L ${formatMoney(row.profit)} · Applicant custody ${formatMoney(indexed.friendBalances.get(row.person.id)??0)}`:'';
 };
 return <section className="surface-card ipo-calendar"><div className="card-title-row"><div><h3>IPO calendar</h3><p>Applications, funds and share activity. Expected dates do not post money.</p></div><div className="ipo-calendar-nav"><button className="icon-button" aria-label="Previous month" onClick={()=>move(-1)}><ChevronLeft size={16}/></button><strong>{formatMonth(month)}</strong><button className="icon-button" aria-label="Next month" onClick={()=>move(1)}><ChevronRight size={16}/></button><button className="text-button" onClick={()=>{setMonth(todayKey().slice(0,7));setDay(todayKey());}}>Today</button></div></div>
 <div className="ipo-calendar-filters"><DatePicker label="Jump to month" value={`${month}-01`} onChange={d=>{if(d)setMonth(d.slice(0,7));}}/><label>Applicant<Select value={person} onChange={e=>setPerson(e.target.value)}><option value="">All applicants</option>{data.applicants.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label><label>Event<Select value={kind} onChange={e=>setKind(e.target.value)}><option value="">All events</option>{[...new Set(events.map(e=>e.label))].sort().map(l=><option key={l}>{l}</option>)}</Select></label></div>
 <div className="ipo-calendar-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div className="ipo-weekday" key={d}>{d}</div>)}{days.map(date=>{const entries=visible.filter(e=>e.date===date);return <div key={date} className={`ipo-day ${date.slice(0,7)!==month?'outside':''}`} onMouseEnter={()=>setHover(date)} onMouseLeave={()=>setHover('')}><button aria-label={`${formatDate(date)}, ${entries.length} events`} aria-pressed={day===date} className={date===todayKey()?'today':''} onClick={()=>setDay(date)} onFocus={()=>setHover(date)} onBlur={()=>setHover('')}><span>{Number(date.slice(8))}</span>{entries.length?<small>{entries.length} <span className="ipo-event-word">event{entries.length===1?'':'s'}</span></small>:null}</button>{hover===date&&entries.length?<div className="ipo-calendar-popover" role="tooltip"><b>{formatDate(date)}</b>{entries.slice(0,4).map(e=><p key={e.id}>{label(e.companyId)}<br/><span>{e.label}{e.personId?' · '+data.applicants.find(p=>p.id===e.personId)?.name:''}{e.expected?' · Expected':''}{e.amount?` · ${formatMoney(e.amount)}`:''}</span></p>)}<small>Select the date for all details.</small></div>:null}</div>;})}</div>
 {day?<div className="ipo-day-detail" aria-live="polite"><h4>{formatDate(day)}</h4>{detail.length?detail.map(e=><button key={e.id} className="ipo-event-row" disabled={!e.companyId} onClick={()=>e.companyId&&onCompany(e.companyId)}><span><b>{label(e.companyId)}</b><small>{e.label} · {e.expected?'Expected':'Recorded'}{e.personId?` · ${data.applicants.find(p=>p.id===e.personId)?.name}`:''}</small>{e.event?.details.shares!==undefined?<small>{String(e.event.details.shares)} shares{e.event.details.profit!==undefined?` · P/L ${formatMoney(Number(e.event.details.profit))}`:''}</small>:null}{context(e)?<small className="ipo-calendar-context">Current application position: {context(e)}</small>:null}</span><strong>{e.amount?formatMoney(e.amount):'View details'}</strong></button>):<p>No recorded events on this date.</p>}</div>:<p className="form-hint">Hover or select a date to inspect its IPO activity.</p>}</section>;
}
