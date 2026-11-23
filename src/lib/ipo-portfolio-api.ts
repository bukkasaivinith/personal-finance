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
  amount: string;
  account_id: string;
  demat_id: string;
  holder_name: string;
  designation?: 'self' | 'friend';
};

const setupPending = 'Apply the IPO Portfolio SQL update in Supabase, then try again.';

export async function loadIpoPortfolio(): Promise<IpoPortfolioData> {
  const { data, error } = await supabase.rpc('get_ipo_portfolio');
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
  return data as IpoPortfolioData;
}

export async function saveIpoApplication(draft: IpoApplicationDraft, requestId: string): Promise<void> {
  const { error } = await supabase.rpc('save_ipo_portfolio_application', {
    p_request_id: requestId,
    p_draft: draft,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? setupPending : error.message);
}
