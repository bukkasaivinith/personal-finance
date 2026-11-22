import { supabase } from '@/lib/supabase';
import type { IpoData, IpoFinanceLinks } from '@/lib/ipo';

export async function loadIpo(): Promise<IpoData> {
 const { data, error } = await supabase.rpc('ipo_dashboard');
 if (error) throw new Error(error.code === 'PGRST202' ? 'IPO setup is pending. Apply the three IPO migrations supplied with this update, then refresh.' : error.message);
 return data as IpoData;
}
export async function commandIpo(command: string, input: Record<string, unknown>, requestId: string) {
 const { data, error } = await supabase.rpc('ipo_command', { p_request_id: requestId, p_command: command, p_data: input });
 if (error) throw new Error(error.message);
 return data as { id: string | null; event_id: string };
}
export async function loadIpoLinks(owner: string): Promise<IpoFinanceLinks> {
 const { data, error } = await supabase.rpc('ipo_finance_links', { p_owner_id: owner });
 // Older deployments remain usable until the additive migrations are installed.
 if (error?.code === 'PGRST202') return {};
 if (error) throw new Error(error.message);
 return data as IpoFinanceLinks;
}
