import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { CreateAccountForm, ForgotPasswordForm, NewPasswordForm, SignInForm, AuthShell } from '@/components/auth-forms';
import { claimWorkspace } from '@/lib/auth-api';
import { supabase } from '@/lib/supabase';

export function AuthGate({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false); const [session, setSession] = useState<Session | null>(null); const [recovering, setRecovering] = useState(false); const [forgot, setForgot] = useState(false); const [creating, setCreating] = useState(false); const [ready, setReady] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { let active = true; supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setChecked(true); } }); const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); setChecked(true); if (event === 'PASSWORD_RECOVERY') setRecovering(true); if (event === 'SIGNED_OUT') { setRecovering(false); setReady(false); } }); return () => { active = false; data.subscription.unsubscribe(); }; }, []);
  useEffect(() => { if (!session || recovering) { setReady(false); return; } let active = true; setError(''); claimWorkspace().then(() => { if (active) setReady(true); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Workspace unavailable.'); }); return () => { active = false; }; }, [session, recovering]);
  if (!checked) return <AuthShell><p className="auth-status"><Loader2 size={18} className="auth-spin" /> Checking your session</p></AuthShell>;
  if (recovering) return <NewPasswordForm onComplete={async () => { await supabase.auth.signOut({ scope: 'global' }); setRecovering(false); setNotice('Your password has been updated. Sign in with your new password.'); }} />;
  if (!session) { if (creating) return <CreateAccountForm onBack={() => setCreating(false)} />; if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />; return <SignInForm notice={notice} onForgot={() => setForgot(true)} onCreateAccount={() => setCreating(true)} />; }
  if (error) return <AuthShell><BrandlessError message={error} /></AuthShell>;
  if (!ready) return <AuthShell><p className="auth-status"><Loader2 size={18} className="auth-spin" /> Opening your workspace</p></AuthShell>;
  return <>{children}</>;
}
function BrandlessError({ message }: { message: string }) { return <><div className="auth-heading"><h1>Workspace unavailable</h1><p>{message}</p></div><button className="auth-button" type="button" onClick={() => void supabase.auth.signOut()}>Sign out</button></>; }
