import { supabase } from '@/lib/supabase';
import { publicApiError } from '@/lib/public-api-error';

export type IpoDematAccount = {
  id: string;
  holder: string;
  demat: string;
  broker?: string;
  designation: 'self' | 'friend';
};

export type IpoApplicationResult = {
  realized_profit_loss: number | null;
  invested_amount: number | null;
  present_total_value: number | null;
  not_allotted: boolean;
};

export type IpoApplication = Partial<IpoApplicationResult> & {
  id: string;
  company_id: string;
  company: string;
  application_date: string;
  allotment_date?: string | null;
  listing_date: string | null;
  holder: string;
  demat: string;
  broker?: string;
  demat_account_id?: string;
  funding_account_id?: string;
  funding_account_name?: string;
  classification?: 'Mainboard' | 'SME';
  adjustment?: number;
  can_change?: boolean;
  issue_price: number;
  amount: number;
  lot_size: number;
  lots: number;
};

export type IpoPortfolioData = {
  applications: IpoApplication[];
  demat_accounts: IpoDematAccount[];
  allotment_date_supported?: boolean;
};

export type IpoApplicationDraft = {
  company_name: string;
  classification: 'Mainboard' | 'SME';
  application_date: string;
  allotment_date: string;
  listing_date: string;
  issue_price: string;
  lot_size: string;
  account_id: string;
};

export type IpoLotAllocation = { demat_id: string; lots: number };

const setupPending = 'Apply the latest IPO Portfolio SQL update in Supabase, then try again.';

export function formatDematAccount(holder: string, demat: string, broker?: string) {
  const labels = new Map<string, string>();
  for (const value of [holder, demat === 'Demat' ? '' : demat, broker ?? '']) {
    const label = value.trim();
    if (label && !labels.has(label.toLocaleLowerCase())) labels.set(label.toLocaleLowerCase(), label);
  }
  return [...labels.values()].join(' / ');
}

export async function loadIpoPortfolio(): Promise<IpoPortfolioData> {
  const { data, error } = await supabase.rpc('get_ipo_portfolio');
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
  return data as IpoPortfolioData;
}

export async function saveIpoApplications(draft: IpoApplicationDraft, allocations: IpoLotAllocation[], totalLots: number, requestId: string): Promise<void> {
  const { error } = await supabase.rpc('save_ipo_portfolio_applications', {
    p_request_id: requestId,
    p_draft: draft,
    p_allocations: allocations,
    p_total_lots: totalLots,
  });
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
}

export async function updateIpoApplication(id: string, draft: IpoApplicationDraft, allocation: IpoLotAllocation, requestId: string): Promise<void> {
  const { error } = await supabase.rpc('update_ipo_portfolio_application', {
    p_application_id: id,
    p_request_id: requestId,
    p_draft: { ...draft, ...allocation },
  });
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
}

export async function removeIpoApplication(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_ipo_portfolio_application', { p_application_id: id });
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
}

export async function saveIpoApplicationResult(id: string, profitLoss: number | null, presentTotalValue: number | null, notAllotted: boolean): Promise<IpoApplicationResult> {
  const { data, error } = await supabase.rpc('save_ipo_portfolio_result', {
    p_application_id: id, p_profit_loss: profitLoss, p_present_total_value: presentTotalValue, p_not_allotted: notAllotted,
  });
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
  return data as IpoApplicationResult;
}

export async function saveIpoDematAccount(holder: string, nickname: string, designation: IpoDematAccount['designation'], broker: string): Promise<void> {
  const { error } = await supabase.rpc('save_ipo_demat_account', {
    p_holder_name: holder, p_nickname: nickname, p_designation: designation, p_broker: broker,
  });
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
}

export async function updateIpoDematAccount(id: string, holder: string, nickname: string, designation: IpoDematAccount['designation'], broker: string): Promise<void> {
  const { error } = await supabase.rpc('update_ipo_demat_account', {
    p_demat_id: id, p_holder_name: holder, p_nickname: nickname, p_designation: designation, p_broker: broker,
  });
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
}

export async function removeIpoDematAccount(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_ipo_demat_account', { p_demat_id: id });
  if (error) throw error.code === 'PGRST202' ? new Error(setupPending) : publicApiError(error, 'Could not complete the IPO request. Please try again.');
}
