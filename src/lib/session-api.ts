import { supabase } from '@/lib/supabase';

export const SESSION_REPLACED_NOTICE = 'You have been logged out because your account was accessed from another device.';

type RpcFailure = { code?: string; message: string };

function messageOf(error: RpcFailure): string {
  return error.message || 'We could not verify your session.';
}

function isInactiveSessionFailure(error: RpcFailure): boolean {
  return error.code === '28000'
    || /session (?:is no longer active|was replaced|has expired)|sign in again/i.test(error.message);
}

export async function activateCurrentSingleDeviceSession(): Promise<void> {
  const { error } = await supabase.rpc('activate_current_single_device_session');
  if (error) throw new Error(messageOf(error));
}

export async function validateCurrentSingleDeviceSession(): Promise<boolean> {
  const { data, error } = await supabase.rpc('validate_current_single_device_session');
  if (!error) return data === true;
  if (isInactiveSessionFailure(error)) return false;
  throw new Error(messageOf(error));
}

export async function endCurrentSingleDeviceSession(): Promise<void> {
  const { error } = await supabase.rpc('end_current_single_device_session');
  if (error && !isInactiveSessionFailure(error)) throw new Error(messageOf(error));
}
