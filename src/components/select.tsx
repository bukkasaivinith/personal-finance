import { Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type SelectProps = Pick<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'value' | 'defaultValue' | 'onChange' | 'disabled' | 'id' | 'name' | 'required' | 'className' | 'title' | 'aria-label' | 'aria-labelledby' | 'aria-describedby'>;
type Choice = { value: string; label: string; disabled: boolean; group?: string };
type OptionProps = { children?: ReactNode; value?: string | number; label?: string; disabled?: boolean };

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child): string => isValidElement<OptionProps>(child) ? textContent(child.props.children) : String(child)).join('');
}

function choicesFrom(children: ReactNode, group?: string, disabled = false): Choice[] {
  return Children.toArray(children).flatMap((child): Choice[] => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type === 'option') {
      const label = child.props.label ?? textContent(child.props.children);
      return [{ value: String(child.props.value ?? label), label, disabled: disabled || Boolean(child.props.disabled), group }];
    }
    return choicesFrom(child.props.children, child.type === 'optgroup' ? child.props.label : group, disabled || Boolean(child.props.disabled));
  });
}

/** Styled single-select. The native backing control keeps real change events and form values. */
export function Select({ children, value, defaultValue, onChange, disabled, id, name, required, className = '', title, ...aria }: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-list`;
  const choices = useMemo(() => choicesFrom(children), [children]);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? choices[0]?.value ?? ''));
  const currentValue = value === undefined ? internalValue : String(value);
  const selectedIndex = choices.findIndex((choice) => choice.value === currentValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dark, setDark] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 180, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const nativeSelect = useRef<HTMLSelectElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });

  const show = (last = false) => {
    if (disabled) return;
    const enabled = choices.map((choice, index) => choice.disabled ? -1 : index).filter((index) => index >= 0);
    setActiveIndex(selectedIndex >= 0 && !choices[selectedIndex].disabled ? selectedIndex : (last ? enabled[enabled.length - 1] : enabled[0]) ?? -1);
    setDark(Boolean(trigger.current?.closest('.mobile-shell')));
    setOpen(true);
  };

  const choose = (index: number) => {
    const choice = choices[index];
    if (!choice || choice.disabled || disabled) return;
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    // Dispatch a real select change so existing create/edit option handlers keep their semantics.
    if (nativeSelect.current && choice.value !== currentValue) {
      nativeSelect.current.value = choice.value;
      nativeSelect.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const below = y + height - bounds.bottom - 14;
      const above = bounds.top - y - 14;
      const desiredHeight = Math.min(300, choices.length * 42 + 14);
      const up = below < desiredHeight && above > below;
      const maxHeight = Math.max(40, Math.min(300, up ? above : below, height - 16));
      const menuWidth = Math.min(Math.max(bounds.width, 180), width - 16);
      const actualHeight = Math.min(menu.current?.scrollHeight || desiredHeight, maxHeight);
      const next = {
        top: Math.max(y + 8, Math.min(up ? bounds.top - actualHeight - 6 : bounds.bottom + 6, y + height - actualHeight - 8)),
        left: Math.max(x + 8, Math.min(bounds.left, x + width - menuWidth - 8)),
        width: menuWidth,
        maxHeight,
      };
      setPosition((old) => Object.keys(next).every((key) => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
    };
    place();
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, choices]);

  useLayoutEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listId]);

  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    const enabled = choices.map((choice, index) => choice.disabled ? -1 : index).filter((index) => index >= 0);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show(event.key === 'ArrowUp');
        if (event.key === 'Home') setActiveIndex(enabled[0] ?? -1);
        if (event.key === 'End') setActiveIndex(enabled[enabled.length - 1] ?? -1);
        return;
      }
      const current = enabled.indexOf(activeIndex);
      const step = event.key === 'PageDown' ? 6 : event.key === 'PageUp' ? -6 : event.key === 'ArrowUp' ? -1 : 1;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : Math.max(0, Math.min(enabled.length - 1, current + step));
      setActiveIndex(enabled[next] ?? -1);
      return;
    }
    if (event.key === 'Enter' || (event.key === ' ' && (!search.current.text || Date.now() - search.current.time > 700))) {
      event.preventDefault();
      event.stopPropagation();
      if (open) choose(activeIndex); else show();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const query = (now - search.current.time < 700 ? search.current.text : '') + event.key.toLocaleLowerCase();
      search.current = { text: query, time: now };
      const repeated = [...query].every((letter) => letter === query[0]);
      const term = repeated ? query[0] : query;
      const start = repeated ? (open ? activeIndex : selectedIndex) + 1 : 0;
      const ordered = [...choices.keys()].slice(start).concat([...choices.keys()].slice(0, start));
      const match = ordered.find((index) => !choices[index].disabled && choices[index].label.toLocaleLowerCase().trim().startsWith(term));
      if (!open) show();
      if (match !== undefined) setActiveIndex(match);
    }
  };

  return <span className="ui-select">
    <button {...aria} ref={trigger} id={triggerId} type="button" className={`ui-select-trigger ${className}`} title={title} disabled={disabled}
      role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} aria-required={required || undefined}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={handleKey}>
      <span className="ui-select-value">{choices[selectedIndex]?.label ?? choices[0]?.label ?? 'Choose an option'}</span>
      <ChevronDown className="ui-select-chevron" size={15} aria-hidden="true" />
    </button>
    <select ref={nativeSelect} hidden aria-hidden="true" tabIndex={-1} name={name} value={currentValue} disabled={disabled} required={required}
      onInvalid={(event) => { event.preventDefault(); trigger.current?.focus(); show(); }}
      onChange={(event) => { setInternalValue(event.target.value); onChange?.(event); }}>
      {children}
    </select>
    {open ? createPortal(<div ref={menu} id={listId} role="listbox" aria-label={aria['aria-label']} aria-labelledby={aria['aria-label'] ? undefined : aria['aria-labelledby'] ?? triggerId}
      className={`ui-select-menu${dark ? ' ui-select-menu-dark' : ''}`} style={position} data-select-owner={triggerId}
      onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault(); }}>
      {choices.map((choice, index) => <div key={`${choice.value}-${index}`}>
        {choice.group && choice.group !== choices[index - 1]?.group ? <div className="ui-select-group">{choice.group}</div> : null}
        <div id={`${listId}-${index}`} role="option" aria-selected={index === selectedIndex} aria-disabled={choice.disabled || undefined}
          className={`ui-select-option${index === activeIndex ? ' is-highlighted' : ''}${choice.value.startsWith('__') ? ' is-action' : ''}`}
          onPointerMove={() => { if (!choice.disabled) setActiveIndex(index); }} onClick={() => choose(index)}>
          <span>{choice.label}</span>{index === selectedIndex ? <Check size={15} aria-hidden="true" /> : null}
        </div>
      </div>)}
      {!choices.length ? <div className="ui-select-empty">No options available</div> : null}
    </div>, document.body) : null}
  </span>;
}
