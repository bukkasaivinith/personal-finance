import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DatePicker } from '@/components/date-picker';
import { Select } from '@/components/select';
import { formatDate, formatMonth, todayKey, toDateKey } from '@/lib/finance';
import { ipoCalendar, type CalendarEvent, type IpoData } from '@/lib/ipo';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function IpoCalendar({ data, onCompany }: { data: IpoData; onCompany: (id: string) => void }) {
 const today = todayKey();
 const [month, setMonth] = useState(today.slice(0, 7));
 const [day, setDay] = useState('');
 const [person, setPerson] = useState('');
 const [kind, setKind] = useState('');
 const events = useMemo(() => ipoCalendar(data), [data]);
 const companies = useMemo(() => new Map(data.companies.map(company => [company.id, company.name])), [data.companies]);
 const applicants = useMemo(() => new Map(data.applicants.map(applicant => [applicant.id, applicant.name])), [data.applicants]);
 const days = useMemo(() => {
  const start = new Date(`${month}-01T12:00:00`);
  start.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, offset) => {
   const date = new Date(start);
   date.setDate(start.getDate() + offset);
   return toDateKey(date);
  });
 }, [month]);

 const eventsByDay = new Map<string, CalendarEvent[]>();
 const selectedAccounts = new Set(data.applicant_accounts.filter(account => account.applicant_id === person).map(account => account.id));
 const selectedCompanies = new Set(data.applications.filter(application => selectedAccounts.has(application.applicant_account_id)).map(application => application.company_id));
 for (const event of events) {
  if (kind && event.label !== kind) continue;
  if (person && (event.personId ? event.personId !== person : !selectedCompanies.has(event.companyId))) continue;
  const entries = eventsByDay.get(event.date) ?? [];
  entries.push(event);
  eventsByDay.set(event.date, entries);
 }

 const move = (offset: number) => {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  setMonth(toDateKey(date).slice(0, 7));
  setDay('');
 };
 const selected = eventsByDay.get(day) ?? [];

 return (
  <section className="surface-card ipo-calendar">
   <div className="card-title-row">
    <div><h3>IPO calendar</h3><p>Application, allotment and listing dates.</p></div>
    <div className="ipo-calendar-nav">
     <button type="button" className="icon-button" aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
     <strong>{formatMonth(month)}</strong>
     <button type="button" className="icon-button" aria-label="Next month" onClick={() => move(1)}><ChevronRight size={16} /></button>
     <button type="button" className="text-button" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>Today</button>
    </div>
   </div>
   <div className="ipo-calendar-filters">
    <DatePicker label="Jump to month" value={`${month}-01`} onChange={date => { setMonth(date.slice(0, 7)); setDay(''); }} />
    <label>Applicant
     <Select value={person} onChange={event => setPerson(event.target.value)}>
      <option value="">All applicants</option>
      {data.applicants.map(applicant => <option key={applicant.id} value={applicant.id}>{applicant.name}</option>)}
     </Select>
    </label>
    <label>Event
     <Select value={kind} onChange={event => setKind(event.target.value)}>
      <option value="">All dates</option>
      <option value="Applied">Applications</option>
      <option value="Allotment">Allotments</option>
      <option value="Listing">Listings</option>
     </Select>
    </label>
   </div>
   <div className="ipo-calendar-grid">
    {weekdays.map(weekday => <div className="ipo-weekday" key={weekday}>{weekday}</div>)}
    {days.map(date => {
     const entries = eventsByDay.get(date) ?? [];
     return (
      <div key={date} className={`ipo-day ${date.slice(0, 7) !== month ? 'outside' : ''}`}>
       <button type="button" aria-label={`${formatDate(date)}, ${entries.length} IPO dates`} aria-pressed={day === date}
        className={date === today ? 'today' : ''} onClick={() => setDay(date)}>
        <span>{Number(date.slice(8))}</span>
        {entries.slice(0, 2).map(event => (
         <small key={event.id} className="ipo-calendar-entry" title={`${event.label} · ${companies.get(event.companyId)}`}>
          {event.label}<span className="ipo-event-word"> · {companies.get(event.companyId)}</span>
         </small>
        ))}
        {entries.length > 2 ? <small>+{entries.length - 2}</small> : null}
       </button>
      </div>
     );
    })}
   </div>
   {day ? (
    <div className="ipo-day-detail" aria-live="polite">
     <h4>{formatDate(day)}</h4>
     {selected.length ? selected.map(event => (
      <button type="button" key={event.id} className="ipo-event-row" onClick={() => onCompany(event.companyId)}>
       <span><b>{companies.get(event.companyId)}</b><small>{event.label}{event.personId ? ` · ${applicants.get(event.personId)}` : ''}</small></span>
      </button>
     )) : <p>No IPO dates recorded on this day.</p>}
    </div>
   ) : <p className="form-hint">Select a date to see the companies.</p>}
  </section>
 );
}
