import { supabase } from '@/lib/supabase';

export const PASSWORD_MIN_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

async function recordAuthenticatedActivity(action: 'signed_in' | 'signed_out'): Promise<void> {
  try {
    // Wait until Supabase has made the access token available to the client.
    // A background request immediately after sign-in can otherwise reach the
    // RPC without a JWT, which is why a sign-out could be logged while the
    // matching sign-in was missing.
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.rpc('record_auth_activity', { p_action: action });
  } catch {
    // Authentication itself must always work even if its optional audit event
    // cannot be saved.
  }
}

export async function createAccount(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (!error) {
    if (data.session) await recordAuthenticatedActivity('signed_in');
    return Boolean(data.session);
  }
  if (error.status === 429) throw new Error('Too many attempts. Please wait and try again.');
  if (error.message.toLowerCase().includes('password')) throw new Error('Choose a stronger password with at least 12 characters.');
  throw new Error('We could not create that account. Please check your details and try again.');
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) {
    await recordAuthenticatedActivity('signed_in');
    return;
  }
  if (error.status === 429) throw new Error('Too many attempts. Please wait and try again.');
  if (!error.status || error.status >= 500) throw new Error('The sign-in service is unavailable. Please try again.');
  throw new Error('Email or password is incorrect.');
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error?.status === 429) throw new Error('Please wait before requesting another link.');
  if (error) throw new Error('We could not send the reset link. Please try again.');
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error('We could not update your password. Request a new reset link and try again.');
}

export async function signOut(): Promise<void> {
  await recordAuthenticatedActivity('signed_out');
  await supabase.auth.signOut({ scope: 'local' });
}

export async function claimWorkspace(): Promise<void> {
  const { error } = await supabase.rpc('claim_unowned_finance_data');
  if (error) throw new Error('We could not open your workspace. Please try again.');
}
