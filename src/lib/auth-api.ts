import { supabase } from '@/lib/supabase';
import { activateCurrentSingleDeviceSession, endCurrentSingleDeviceSession } from '@/lib/session-api';

export const PASSWORD_MIN_LENGTH = 12;
export const PROFILE_NAME_MAX_LENGTH = 80;

export type CurrentFinanceProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthEmailRateLimitError extends Error {
  constructor() {
    super('Confirmation emails are temporarily limited. Wait up to one hour, then submit this form once.');
    this.name = 'AuthEmailRateLimitError';
  }
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function isValidProfileName(value: string): boolean {
  const name = value.trim();
  return name.length > 0
    && name.length <= PROFILE_NAME_MAX_LENGTH
    && [...name].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    });
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

export async function createAccount(email: string, password: string, firstName: string, lastName: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } },
  });
  if (!error) {
    return Boolean(data.session);
  }
  if (error.status === 429) throw new AuthEmailRateLimitError();
  if (error.message.toLowerCase().includes('password')) throw new Error('Choose a stronger password with at least 12 characters.');
  throw new Error('We could not create that account. Please check your details and try again.');
}

export async function loadCurrentFinanceProfile(): Promise<CurrentFinanceProfile> {
  const { data, error } = await supabase.rpc('get_current_finance_profile');
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('We could not load your profile.');
  const profile = row as { id?: string; email?: string; first_name?: string | null; last_name?: string | null };
  if (!profile.id || !profile.email) throw new Error('We could not load your profile.');
  return {
    id: profile.id,
    email: profile.email,
    firstName: profile.first_name?.trim() || null,
    lastName: profile.last_name?.trim() || null,
  };
}

export async function saveCurrentFinanceProfileName(firstName: string, lastName: string): Promise<void> {
  const { error } = await supabase.rpc('set_current_finance_profile_name', {
    p_first_name: firstName.trim(),
    p_last_name: lastName.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) {
    try {
      await requireFinanceOwner();
      await activateCurrentSingleDeviceSession();
      // Supabase revokes every older refresh token while the database guard
      // immediately blocks old access tokens from finance data.
      // If this best-effort Auth request is temporarily unavailable, the RLS
      // session gate still makes the newly activated session the only one
      // allowed to access the finance workspace.
      await supabase.auth.signOut({ scope: 'others' });
      await recordAuthenticatedActivity('signed_in');
    } catch (caught) {
      await supabase.auth.signOut({ scope: 'local' });
      throw caught;
    }
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
  try {
    await endCurrentSingleDeviceSession();
  } finally {
    await supabase.auth.signOut({ scope: 'local' });
  }
}

export async function claimWorkspace(): Promise<void> {
  const { error } = await supabase.rpc('open_finance_workspace');
  if (error) throw new Error(error.message);
}

export async function requireFinanceOwner(): Promise<void> {
  const { data, error } = await supabase.rpc('is_finance_workspace_owner');
  if (error?.code === 'PGRST202') throw new Error('The single-owner workspace setup is pending in Supabase.');
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error('Only the owner can open this finance workspace.');
}

export async function deleteCurrentFinanceAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_finance_account');
  if (error) throw new Error(error.message);
  await supabase.auth.signOut({ scope: 'local' });
}
