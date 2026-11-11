import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { CreateAccountForm, ForgotPasswordForm, NewPasswordForm, SignInForm, AuthShell } from '@/components/auth-forms';
import { claimWorkspace } from '@/lib/auth-api';
import { activateCurrentSingleDeviceSession, endCurrentSingleDeviceSession, SESSION_REPLACED_NOTICE, validateCurrentSingleDeviceSession } from '@/lib/session-api';
import { supabase } from '@/lib/supabase';

export function AuthGate({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false); const [session, setSession] = useState<Session | null>(null); const [recovering, setRecovering] = useState(false); const [forgot, setForgot] = useState(false); const [creating, setCreating] = useState(false); const [ready, setReady] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { let active = true; supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setChecked(true); } }); const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); setChecked(true); if (event === 'PASSWORD_RECOVERY') setRecovering(true); if (event === 'SIGNED_OUT') { setRecovering(false); setReady(false); } }); return () => { active = false; data.subscription.unsubscribe(); }; }, []);
  const signOutReplacedSession = useCallback(async () => {
    setReady(false);
    setNotice(SESSION_REPLACED_NOTICE);
    await supabase.auth.signOut({ scope: 'local' });
  }, []);
  useEffect(() => {
    if (!session || recovering) { setReady(false); return; }
    let active = true;
    setError('');
    (async () => {
      try {
        // This is safe on a normal reload: only the same JWT session can touch
        // its existing record. An older session can never overtake a newer one.
        await activateCurrentSingleDeviceSession();
        await claimWorkspace();
        if (active) setReady(true);
      } catch (caught) {
        if (!active) return;
        const message = caught instanceof Error ? caught.message : 'Workspace unavailable.';
        if (/session (?:is no longer active|was replaced|has expired)|sign in again/i.test(message)) {
          await signOutReplacedSession();
          return;
        }
        setError(message);
      }
    })();
    return () => { active = false; };
  }, [session, recovering, signOutReplacedSession]);
  useEffect(() => {
    if (!session || recovering || !ready) return;
    let active = true;
    const check = async () => {
      try {
        const valid = await validateCurrentSingleDeviceSession();
        if (active && !valid) await signOutReplacedSession();
      } catch {
        // A short network failure must not log someone out. Every protected
        // database request remains guarded by RLS until validation succeeds.
      }
    };
    const onFocus = () => { void check(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = window.setInterval(() => { void check(); }, 15_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); };
  }, [session, recovering, ready, signOutReplacedSession]);
  if (!checked) return <AuthShell><p className="auth-status"><Loader2 size={18} className="auth-spin" /> Checking your session</p></AuthShell>;
  if (recovering) return <NewPasswordForm onComplete={async () => { try { await endCurrentSingleDeviceSession(); } finally { await supabase.auth.signOut({ scope: 'global' }); } setRecovering(false); setNotice('Your password has been updated. Sign in with your new password.'); }} />;
  if (!session) { if (creating) return <CreateAccountForm onBack={() => setCreating(false)} />; if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />; return <SignInForm notice={notice} onForgot={() => setForgot(true)} onCreateAccount={() => setCreating(true)} />; }
  if (error) return <AuthShell><BrandlessError message={error} /></AuthShell>;
  if (!ready) return <AuthShell><p className="auth-status"><Loader2 size={18} className="auth-spin" /> Opening your workspace</p></AuthShell>;
  return <>{children}</>;
}
function BrandlessError({ message }: { message: string }) { return <><div className="auth-heading"><h1>Workspace unavailable</h1><p>{message}</p></div><button className="auth-button" type="button" onClick={() => void supabase.auth.signOut()}>Sign out</button></>; }
