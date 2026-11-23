export function formatRupeeInput(value: string): string {
  return value.replace(/^\d+/, (whole) => whole.replace(/\B(?=(?:\d{2})*\d{3}$)/g, ','));
}

export function parseRupeeInput(value: string): string | null {
  const raw = value.replace(/,/g, '').trim();
  if (!/^\d*(?:\.\d{0,2})?$/.test(raw)) return null;
  return raw.startsWith('.') ? `0${raw}` : raw;
}
