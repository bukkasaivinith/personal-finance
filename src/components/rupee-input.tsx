import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { formatRupeeInput, parseRupeeInput } from '@/lib/rupee-input';

function caretForFormattedAmount(value: string, offset: number): number {
  let caret = 0;
  for (let characters = 0; caret < value.length && characters < offset; caret++) {
    if (value[caret] !== ',') characters++;
  }
  return caret;
}

type RupeeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function RupeeInput({ value, onValueChange, ...props }: RupeeInputProps) {
  function change(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const typed = input.value;
    const parsed = parseRupeeInput(typed);
    const next = parsed ?? value;
    const formatted = formatRupeeInput(next);
    const typedBeforeCaret = typed.slice(0, input.selectionStart ?? typed.length).replace(/,/g, '').trimStart();
    const leadingZero = parsed !== null && typedBeforeCaret.startsWith('.') ? 1 : 0;
    let caret = caretForFormattedAmount(formatted, typedBeforeCaret.length + leadingZero);
    if (next === value && formatted[caret] === ',' && (event.nativeEvent as InputEvent).inputType === 'deleteContentForward') {
      caret++;
    }
    input.value = formatted;
    input.setSelectionRange(caret, caret);
    if (next !== value) onValueChange(next);
  }

  return <input {...props} type="text" inputMode="decimal" value={formatRupeeInput(value)} onChange={change} />;
}
