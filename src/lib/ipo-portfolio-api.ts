import { supabase } from '@/lib/supabase';

export type IpoDematAccount = {
  id: string;
  holder: string;
  demat: string;
  designation: 'self' | 'friend';
};

type IpoApplication = {
  id: string;
  company_id: string;
  company: string;
  application_date: string;
  listing_date: string | null;
  holder: string;
  demat: string;
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

export function formatDematAccount(holder: string, demat: string) {
  return demat === 'Demat' || demat.toLocaleLowerCase() === holder.toLocaleLowerCase() ? holder : `${holder} / ${demat}`;
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

export async function saveIpoDematAccount(holder: string, nickname: string, designation: IpoDematAccount['designation']): Promise<void> {
  const { error } = await supabase.rpc('save_ipo_demat_account', {
    p_holder_name: holder, p_nickname: nickname, p_designation: designation,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}

export async function removeIpoDematAccount(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_ipo_demat_account', { p_demat_id: id });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}
