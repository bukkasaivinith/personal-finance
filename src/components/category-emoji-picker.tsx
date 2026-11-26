import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { CategoryEmoji } from '@/lib/category-emojis';
import './category-emoji-picker.css';

const popularChoices: CategoryEmoji[] = [
  ['🍽️', 'Food, meals and restaurants', 3], ['🛒', 'Shopping and groceries', 6],
  ['🏠', 'Home and rent', 4], ['🚗', 'Car and transport', 4],
  ['💡', 'Bills and electricity', 6], ['☕', 'Coffee and drinks', 3],
  ['🎬', 'Entertainment and movies', 6], ['🩺', 'Health and medical', 6],
  ['📚', 'Education and books', 6], ['🐾', 'Pets and animals', 2],
  ['🎁', 'Gifts and celebrations', 5], ['✈️', 'Travel and flights', 4],
  ['💳', 'Payments and bank cards', 6], ['📦', 'Packages and delivery', 6],
  ['💼', 'Work and business', 6], ['💰', 'Savings and money', 6],
];

const groups = [
  { id: -2, label: 'Popular' }, { id: -1, label: 'All' },
  { id: 0, label: 'Faces' }, { id: 1, label: 'People' },
  { id: 2, label: 'Nature' }, { id: 3, label: 'Food' },
  { id: 4, label: 'Travel' }, { id: 5, label: 'Activities' },
  { id: 6, label: 'Objects' }, { id: 7, label: 'Symbols' },
  { id: 8, label: 'Flags' },
];

const pageSize = 96;
const groupSearchTerms = [
  'faces smileys emotions', 'people body gestures skin tones', 'nature animals plants',
  'food drinks', 'travel transport vehicles places weather', 'activities sports games celebrations',
  'objects tools', 'symbols signs', 'flags countries',
];

export function CategoryEmojiPicker({ value, onChange, label = 'Category emoji' }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [catalog, setCatalog] = useState<CategoryEmoji[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(-2);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const resultsId = useId();
  const resultArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoadError(false);
    import('@/lib/category-emojis').then((module) => {
      if (active) setCatalog(module.categoryEmojis);
    }).catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, [loadAttempt]);

  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return group === -2 ? popularChoices : catalog.filter((emoji) => group === -1 || emoji[2] === group);
    const words = search.split(/\s+/);
    // Search the whole collection, including familiar finance terms in Popular.
    const popularNames = new Map(popularChoices.map(([emoji, name]) => [emoji, name]));
    return catalog.filter(([emoji, name, emojiGroup]) => {
      const searchable = `${emoji} ${name} ${groupSearchTerms[emojiGroup]} ${popularNames.get(emoji) ?? ''}`.toLocaleLowerCase();
      return words.every((word) => searchable.includes(word));
    });
  }, [catalog, group, query]);

  useEffect(() => {
    setVisibleCount(pageSize);
    resultArea.current?.scrollTo({ top: 0 });
  }, [group, query]);

  const selectedName = catalog.find(([emoji]) => emoji === value)?.[1]
    ?? popularChoices.find(([emoji]) => emoji === value)?.[1]
    ?? 'Custom emoji';
  const browsingCatalog = group !== -2 || Boolean(query.trim());
  const waiting = browsingCatalog && catalog.length === 0;
  const visible = matches.slice(0, visibleCount);

  return (
    <fieldset className="category-emoji-picker category-emoji-browser full-field">
      <legend>{label} <span>(optional)</span></legend>
      <div className="category-emoji-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emojis, e.g. food, running, money"
          aria-label={`Search all ${label.toLowerCase()}s`}
          aria-controls={resultsId}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        />
      </div>
      <div className="category-emoji-groups" role="group" aria-label="Emoji groups">
        {groups.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={!query.trim() && group === item.id}
            onClick={() => { setGroup(item.id); setQuery(''); }}
          >{item.label}</button>
        ))}
      </div>
      <div className="category-emoji-results" id={resultsId} ref={resultArea}>
        {waiting ? (
          <p className="category-emoji-empty" role="status">
            {loadError ? <>Unable to load the full collection. <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></> : 'Loading emojis…'}
          </p>
        ) : visible.length ? (
          <>
            <div className="emoji-options" role="group" aria-label={query.trim() ? 'Matching emojis' : `${groups.find((item) => item.id === group)?.label} emojis`}>
              {visible.map(([emoji, label]) => (
                <button
                  className={`emoji-option ${value === emoji ? 'selected' : ''}`}
                  type="button"
                  key={emoji}
                  aria-label={label}
                  aria-pressed={value === emoji}
                  title={label}
                  onClick={() => onChange(value === emoji ? '' : emoji)}
                >{emoji}</button>
              ))}
            </div>
            {matches.length > visibleCount ? <button type="button" className="category-emoji-more" onClick={() => setVisibleCount((count) => count + pageSize)}>Show more emojis ({matches.length - visibleCount} remaining)</button> : null}
          </>
        ) : <p className="category-emoji-empty" role="status">No matching emojis. Try another word or paste your own below.</p>}
      </div>
      <div className="category-emoji-selection" aria-live="polite">
        {value ? <><span className="category-emoji-preview" aria-hidden="true">{value}</span><span>{selectedName}</span><button type="button" aria-label={`Remove ${label.toLowerCase()}`} title="Remove emoji" onClick={() => onChange('')}><X size={15} /></button></> : <span>{query.trim() ? `${matches.length.toLocaleString()} matching emojis` : catalog.length ? `${catalog.length.toLocaleString()} emojis available. Choose a group or search.` : 'Choose an emoji or leave it empty.'}</span>}
      </div>
      <label className="emoji-custom-input">
        Or paste your own emoji
        <input
          value={value}
          onChange={(event) => onChange(Array.from(event.target.value).slice(0, 16).join(''))}
          placeholder="e.g. 🍽️"
          aria-label={`Custom ${label.toLowerCase()}`}
        />
      </label>
    </fieldset>
  );
}
