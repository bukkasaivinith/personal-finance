const categoryEmojiOptions = [
  ['🍽️', 'Food'],
  ['🛒', 'Shopping'],
  ['🏠', 'Home'],
  ['🚗', 'Transport'],
  ['💡', 'Bills'],
  ['☕', 'Coffee'],
  ['🎬', 'Entertainment'],
  ['🩺', 'Health'],
  ['📚', 'Education'],
  ['🐾', 'Pets'],
  ['🎁', 'Gifts'],
  ['✈️', 'Travel'],
  ['💳', 'Payments'],
  ['📦', 'Other'],
  ['💼', 'Work'],
  ['💰', 'Savings'],
] as const;

export function CategoryEmojiPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="category-emoji-picker full-field">
      <legend>Category emoji <span>(optional)</span></legend>
      <div className="emoji-options" aria-label="Popular category emojis">
        {categoryEmojiOptions.map(([emoji, label]) => (
          <button
            className={`emoji-option ${value === emoji ? 'selected' : ''}`}
            type="button"
            key={emoji}
            aria-label={label}
            aria-pressed={value === emoji}
            title={label}
            onClick={() => onChange(value === emoji ? '' : emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <label className="emoji-custom-input">
        Or enter your own
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={16}
          placeholder="e.g. 🍽️"
          aria-label="Custom category emoji"
        />
      </label>
    </fieldset>
  );
}
