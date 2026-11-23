import { supabase } from '@/lib/supabase';

export type IpoDematAccount = {
  id: string;
  holder: string;
  demat: string;
  broker?: string;
  designation: 'self' | 'friend';
};

export type IpoApplication = {
  id: string;
  company_id: string;
  company: string;
  application_date: string;
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
};

export type IpoApplicationDraft = {
  company_name: string;
  classification: 'Mainboard' | 'SME';
  application_date: string;
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
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
  return data as IpoPortfolioData;
}

export async function saveIpoApplications(draft: IpoApplicationDraft, allocations: IpoLotAllocation[], totalLots: number, requestId: string): Promise<void> {
  const { error } = await supabase.rpc('save_ipo_portfolio_applications', {
    p_request_id: requestId,
    p_draft: draft,
    p_allocations: allocations,
    p_total_lots: totalLots,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}

export async function updateIpoApplication(id: string, draft: IpoApplicationDraft, allocation: IpoLotAllocation, requestId: string): Promise<void> {
  const { error } = await supabase.rpc('update_ipo_portfolio_application', {
    p_application_id: id,
    p_request_id: requestId,
    p_draft: { ...draft, ...allocation },
  });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}

export async function removeIpoApplication(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_ipo_portfolio_application', { p_application_id: id });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}

export async function saveIpoDematAccount(holder: string, nickname: string, designation: IpoDematAccount['designation'], broker: string): Promise<void> {
  const { error } = await supabase.rpc('save_ipo_demat_account', {
    p_holder_name: holder, p_nickname: nickname, p_designation: designation, p_broker: broker,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}

export async function updateIpoDematAccount(id: string, holder: string, nickname: string, designation: IpoDematAccount['designation'], broker: string): Promise<void> {
  const { error } = await supabase.rpc('update_ipo_demat_account', {
    p_demat_id: id, p_holder_name: holder, p_nickname: nickname, p_designation: designation, p_broker: broker,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}

export async function removeIpoDematAccount(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_ipo_demat_account', { p_demat_id: id });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}
