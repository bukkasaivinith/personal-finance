import { supabase } from '@/lib/supabase';

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(value);
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return;
  if (error.status === 429) throw new Error('Too many attempts. Please wait a few minutes and try again.');
  if (!error.status || error.status >= 500) {
    throw new Error('We could not reach the sign-in service. Please try again.');
  }
  throw new Error('Email or password is incorrect.');
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error?.status === 429) throw new Error('Please wait a few minutes before requesting another link.');
  if (error) throw new Error('We could not send the link right now. Please try again.');
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error('We could not update your password. Request a new reset link and try again.');
}

export async function signOut(scope: 'local' | 'global' = 'local'): Promise<void> {
  await supabase.auth.signOut({ scope });
}

export async function claimWorkspace(): Promise<void> {
  const { error } = await supabase.rpc('claim_unowned_finance_data');
  if (error) throw new Error(error.message);
}
