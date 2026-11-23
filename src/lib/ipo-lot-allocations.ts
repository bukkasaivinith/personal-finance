import type { IpoLotAllocation } from '@/lib/ipo-portfolio-api';

export function groupIpoLots(totalLots: number, defaultAccount: string, selections: ReadonlyMap<number, string>): IpoLotAllocation[] {
  const counts = new Map<string, number>();
  if (defaultAccount) counts.set(defaultAccount, totalLots);
  for (const [index, account] of selections) {
    if (index < 0 || index >= totalLots || account === defaultAccount) continue;
    if (defaultAccount) counts.set(defaultAccount, (counts.get(defaultAccount) ?? 0) - 1);
    if (account) counts.set(account, (counts.get(account) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, lots]) => lots > 0)
    .map(([demat_id, lots]) => ({ demat_id, lots }));
}
