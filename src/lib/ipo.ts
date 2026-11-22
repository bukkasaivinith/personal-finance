export type IpoApplicant = { id: string; name: string; designation: 'self' | 'friend'; relationship: string; notes: string; archived: boolean };
export type IpoDemat = { id: string; applicant_id: string; nickname: string; broker: string; demat_label: string; bank_nickname: string; notes: string; archived: boolean };
export type IpoCompany = { id: string; name: string; symbol: string; classification: 'Mainboard' | 'SME'; issue_price: number; lot_size: number; minimum_lots: number; dates: Record<string, string>; notes: string; archived: boolean };
export type IpoApplication = { id: string; company_id: string; applicant_account_id: string; application_date: string; lots: number; lot_size: number; issue_price: number; adjustment: number; adjustment_reason: string; amount: number; funding_method: 'direct' | 'friend'; funding_account_id: string; reference: string; mandate: string; status: string; blocked: number; prepaid: number; refund_due: number; notes: string };
export type IpoEvent = { id: string; command: string; application_id: string | null; company_id: string | null; applicant_id: string | null; event_date: string; amount: number; expected: boolean; memo: boolean; reversed: boolean; reversal_of: string | null; created_at: string; details: Record<string, unknown>; payload: Record<string, unknown> };
export type IpoAllotment = { id: string; application_id: string; event_id: string; result: string; shares: number; purchase_charges: number; cost: number; allotted_on: string; investment_id: string | null; voided: boolean };
export type IpoSale = { id: string; application_id: string; event_id: string; shares: number; price: number; charges: number; gross: number; net: number; cost_basis: number; profit: number; sold_on: string; voided: boolean };
export type IpoSettlement = { id: string; event_id: string; sale_id: string | null; applicant_id: string | null; amount: number; received_on: string; receiving_account_id: string; kind: 'receipt' | 'repayment' | 'refund' | 'funding'; voided: boolean };
export type IpoCash = { id: string; purpose: string; applicant_id: string | null; account_id: string };
export type IpoData = { applicants: IpoApplicant[]; applicant_accounts: IpoDemat[]; companies: IpoCompany[]; applications: IpoApplication[]; events: IpoEvent[]; allotments: IpoAllotment[]; sales: IpoSale[]; settlements: IpoSettlement[]; cash_accounts: IpoCash[] };
export type IpoMemo = { id: string; name: string; amount: number; date: string; application_id: string; account_id: string; reversed: boolean };
export type IpoBalances = { applications: number; invested: number; applicant_custody: number; awaiting_receipt: number; refund_due: number; prepaid_pending: number; blocked: number };
export type IpoFinanceLinks = {
 balances?: IpoBalances;
 investments?: { id: string; application_id: string; name: string; voided: boolean; sold_cost: number; proceeds: number; profit: number; remaining_shares: number }[];
 accounts?: { id: string; custody: string | null; blocked: number }[];
 memos?: IpoMemo[];
};
export const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = <T,>(rows: T[], value: (row: T) => number) => money(rows.reduce((s, r) => s + value(r), 0));
export const eventLabel = (event: Pick<IpoEvent, 'command' | 'details' | 'payload'>) => ({ application: 'Application submitted', edit_application: 'Application corrected', block: 'Funds blocked', unblock: 'Funds released', prepay: 'Application prepaid', fund_friend: 'Funds sent to applicant', repay: 'Applicant repayment', allot: 'Allotment recorded', refund: 'Refund received', sale: 'Shares sold', receipt: 'Sale proceeds received', reverse: 'Correction / reversal', mandate: `Mandate ${String(event.payload.status ?? '')}`, event: String(event.details.kind ?? 'Event').replace(/_/g, ' ') }[event.command] ?? event.command);

export function indexIpo(data: IpoData) {
 const companies = new Map(data.companies.map(x => [x.id, x]));
 const people = new Map(data.applicants.map(x => [x.id, x]));
 const demats = new Map(data.applicant_accounts.map(x => [x.id, x]));
 const allotments = new Map(data.allotments.filter(x => !x.voided).map(x => [x.application_id, x]));
 const sales = new Map<string, IpoSale[]>();
 data.sales.filter(x => !x.voided).forEach(x => sales.set(x.application_id, [...(sales.get(x.application_id) ?? []), x]));
 const receipts = new Map<string, number>();
 data.settlements.filter(x => !x.voided && x.kind === 'receipt' && x.sale_id).forEach(x => receipts.set(x.sale_id!, money((receipts.get(x.sale_id!) ?? 0) + x.amount)));
 const rows = data.applications.map(app => {
  const account = demats.get(app.applicant_account_id)!; const person = people.get(account.applicant_id)!; const company = companies.get(app.company_id)!;
  const allotment = allotments.get(app.id); const sold = sales.get(app.id) ?? [];
  return { ...app, account, person, company, allotment, sales: sold, label: `${person.name} / ${account.nickname}`, remainingShares: (allotment?.shares ?? 0) - sum(sold, s => s.shares), remainingCost: money((allotment?.cost ?? 0) - sum(sold, s => s.cost_basis)), proceeds: sum(sold, s => s.net), profit: sum(sold, s => s.profit), unsettled: sum(sold, s => s.net - (receipts.get(s.id) ?? 0)) };
 });
 const friendBalances = new Map(data.applicants.map(p => {
  const settlements = data.settlements.filter(s => s.applicant_id === p.id && !s.voided);
  const added = sum(settlements.filter(s => s.kind === 'funding' || s.kind === 'receipt'), s => s.amount);
  const repaid = sum(settlements.filter(s => s.kind === 'repayment'), s => s.amount);
  const consumed = sum(rows.filter(r => r.person.id === p.id && r.funding_method === 'friend'), r => r.allotment?.cost ?? 0);
  return [p.id, money(added - repaid - consumed)] as const;
 }));
 return { rows, companies, people, demats, receipts, friendBalances };
}
export type IpoRow = ReturnType<typeof indexIpo>['rows'][number];
export type IpoFilters = { search: string; applicant: string; start: string; end: string; classification: string; status: string; result: string; funding: string; holding: string };
export const emptyFilters: IpoFilters = { search: '', applicant: '', start: '', end: '', classification: '', status: '', result: '', funding: '', holding: '' };
export function filterIpo(rows: IpoRow[], filters: IpoFilters, friends: Map<string, number>) {
 return rows.filter(r => (!filters.search || `${r.company.name} ${r.company.symbol} ${r.label} ${r.reference}`.toLowerCase().includes(filters.search.toLowerCase())) && (!filters.applicant || r.person.id === filters.applicant) && (!filters.start || r.application_date >= filters.start) && (!filters.end || r.application_date <= filters.end) && (!filters.classification || r.company.classification === filters.classification) && (!filters.status || r.status === filters.status) && (!filters.result || (r.allotment?.result ?? 'pending') === filters.result) && (!filters.funding || r.funding_method === filters.funding) && (!filters.holding || (filters.holding === 'open' ? r.remainingShares > 0 : filters.holding === 'sold' ? Boolean(r.allotment?.shares && !r.remainingShares) : filters.holding === 'refund' ? r.refund_due > 0 : (friends.get(r.person.id) ?? 0) > 0)));
}
export function summaryIpo(rows: IpoRow[]) {
 return { companies: new Set(rows.map(x => x.company_id)).size, applications: rows.length, applied: sum(rows, r => r.amount), blocked: sum(rows, r => r.blocked), allotted: rows.filter(r => (r.allotment?.shares ?? 0) > 0).length, unsuccessful: rows.filter(r => r.allotment && !r.allotment.shares).length, invested: sum(rows, r => r.remainingCost), profit: sum(rows, r => r.profit), proceeds: sum(rows, r => r.proceeds), unsettled: sum(rows, r => r.unsettled), originalCost: sum(rows, r => r.allotment?.cost ?? 0), shares: sum(rows, r => r.remainingShares), refund: sum(rows, r => r.refund_due) };
}
export type CalendarEvent = { id: string; date: string; companyId: string | null; applicationId: string | null; personId: string | null; label: string; amount: number; expected: boolean; event?: IpoEvent };
export function ipoCalendar(data: IpoData): CalendarEvent[] {
 const history: CalendarEvent[] = data.events.filter(e => !e.reversed && !['applicant','demat','company'].includes(e.command)).map(e => ({ id: e.id, date: e.event_date, companyId: e.company_id, applicationId: e.application_id, personId: e.applicant_id, label: eventLabel(e), amount: e.amount, expected: e.expected, event: e }));
 return history.concat(data.companies.flatMap(c => Object.entries(c.dates).filter(([, date]) => Boolean(date)).map(([kind, date]) => ({ id: `${c.id}:${kind}`, date, companyId: c.id, applicationId: null, personId: null, label: kind.replace(/_/g, ' '), amount: 0, expected: !kind.startsWith('actual_') }))));
}
export type CsvCell = string | number | null | undefined;
export function ipoCsv(rows: CsvCell[][]) {
 return '\uFEFF' + rows.map(row => row.map(value => {
  let text = String(value ?? '');
  const firstVisible = [...text].find(c => c.charCodeAt(0) > 32);
  if (typeof value !== 'number' && firstVisible && '=+@-'.includes(firstVisible)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
 }).join(',')).join('\r\n');
}
