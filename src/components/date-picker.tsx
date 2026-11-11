import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { todayKey } from '@/lib/finance';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2000, month, 1)),
);
const calendarHeight = 352;

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameDay(first: Date, second: Date): boolean {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate();
}

function valueLabel(value: string, placeholder: string): string {
  if (!value) return placeholder;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(dateFromKey(value));
}

type DatePickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  clearable?: boolean;
  placeholder?: string;
};

export function DatePicker({
  label,
  value,
  onChange,
  disabled = false,
  min,
  max,
  clearable = false,
  placeholder = 'Choose a date',
}: DatePickerProps) {
  const selected = dateFromKey(value || todayKey());
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1, 12));
  const [position, setPosition] = useState({ top: 16, left: 16, width: 296 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const today = dateFromKey(todayKey());
  const currentYear = today.getFullYear();
  const earliestYear = Math.min(2000, selected.getFullYear(), visibleMonth.getFullYear());
  const latestYear = Math.max(currentYear + 10, selected.getFullYear(), visibleMonth.getFullYear());
  const years = Array.from({ length: latestYear - earliestYear + 1 }, (_, index) => earliestYear + index);

  useEffect(() => {
    const date = dateFromKey(value || todayKey());
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  }, [value]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !popover.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const positionPopover = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewportPadding = 16;
      const width = Math.min(Math.max(bounds.width, 296), window.innerWidth - viewportPadding * 2);
      const height = popover.current?.getBoundingClientRect().height || calendarHeight;
      const roomBelow = window.innerHeight - bounds.bottom;
      const roomAbove = bounds.top;
      const shouldOpenAbove = roomBelow < height + 8 && roomAbove > roomBelow;
      const left = Math.max(viewportPadding, Math.min(bounds.left, window.innerWidth - width - viewportPadding));
      const top = shouldOpenAbove
        ? Math.max(viewportPadding, bounds.top - height - 8)
        : Math.min(bounds.bottom + 8, window.innerHeight - height - viewportPadding);
      setPosition({ top, left, width });
    };
    positionPopover();
    const frame = window.requestAnimationFrame(positionPopover);
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
  }, [open, visibleMonth]);

  const firstVisibleDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1 - visibleMonth.getDay(), 12);
  const days = Array.from({ length: 42 }, (_, index) => new Date(firstVisibleDay.getFullYear(), firstVisibleDay.getMonth(), firstVisibleDay.getDate() + index, 12));
  const isUnavailable = (date: Date) => {
    const key = dateKey(date);
    return Boolean((min && key < min) || (max && key > max));
  };

  const selectDate = (date: Date) => {
    if (isUnavailable(date)) return;
    onChange(dateKey(date));
    setOpen(false);
  };

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12));
  };

  const calendar = (
    <div ref={popover} className="date-picker-popover" role="dialog" aria-label={`${label} calendar`} style={{ top: position.top, left: position.left, minWidth: position.width }}>
      <div className="calendar-header">
        <button type="button" className="calendar-nav" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button>
        <div className="calendar-period-controls">
          <select aria-label="Calendar month" value={visibleMonth.getMonth()} onChange={(event) => setVisibleMonth((current) => new Date(current.getFullYear(), Number(event.target.value), 1, 12))}>
            {monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
          <select aria-label="Calendar year" value={visibleMonth.getFullYear()} onChange={(event) => setVisibleMonth((current) => new Date(Number(event.target.value), current.getMonth(), 1, 12))}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <button type="button" className="calendar-nav" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-days">
        {days.map((day) => {
          const inMonth = day.getMonth() === visibleMonth.getMonth();
          const isSelected = Boolean(value) && sameDay(day, selected);
          const isToday = sameDay(day, today);
          const unavailable = isUnavailable(day);
          return <button type="button" key={dateKey(day)} disabled={unavailable} className={`calendar-day ${inMonth ? '' : 'outside'} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`} aria-label={new Intl.DateTimeFormat('en-IN', { dateStyle: 'full' }).format(day)} aria-pressed={isSelected} onClick={() => selectDate(day)}>{day.getDate()}</button>;
        })}
      </div>
      <div className="calendar-footer">
        {clearable ? <button type="button" onClick={() => { onChange(''); setOpen(false); }}>Clear</button> : <span />}
        <button type="button" disabled={isUnavailable(today)} onClick={() => selectDate(today)}>Today</button>
        <button type="button" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>
  );

  return (
    <div className="date-picker" ref={root}>
      <span className="date-picker-label">{label}</span>
      <button ref={trigger} className="date-picker-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span>{valueLabel(value, placeholder)}</span>
        <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' ? createPortal(calendar, document.body) : null}
    </div>
  );
}
