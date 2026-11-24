import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { CompleteProfileForm, ForgotPasswordForm, NewPasswordForm, SignInForm, AuthShell } from '@/components/auth-forms';
import { claimWorkspace, closeFinanceSession, loadCurrentFinanceProfile, requireFinanceOwner, type CurrentFinanceProfile } from '@/lib/auth-api';
import { CurrentFinanceProfileContext } from '@/lib/current-finance-profile';
import { activateCurrentSingleDeviceSession, endCurrentSingleDeviceSession, SESSION_REPLACED_NOTICE, validateCurrentSingleDeviceSession } from '@/lib/session-api';
import { supabase } from '@/lib/supabase';
import { browserSessionId } from '@/lib/session-identity';

function profileNeedsName(profile: CurrentFinanceProfile | null): boolean {
  return !profile?.firstName || !profile.lastName;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<CurrentFinanceProfile | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [verifiedSessionId, setVerifiedSessionId] = useState<string | null>(null);
  const sessionId = session ? browserSessionId(session.access_token) : null;
  const ready = sessionId !== null && verifiedSessionId === sessionId;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setChecked(true);
      }
    }).catch(() => {
      if (active) { setChecked(true); setNotice('Could not open the session. Please sign in again.'); }
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setChecked(true);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') {
        setRecovering(false);
        setVerifiedSessionId(null);
        setProfile(null);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOutReplacedSession = useCallback(async () => {
    setVerifiedSessionId(null);
    setProfile(null);
    setNotice(SESSION_REPLACED_NOTICE);
    await closeFinanceSession();
  }, []);

  useEffect(() => {
    if (!sessionId || recovering) {
      setVerifiedSessionId(null);
      return;
    }
    let active = true;
    setError('');
    (async () => {
      try {
        await requireFinanceOwner();
        if (!active) return;
        await activateCurrentSingleDeviceSession();
        await claimWorkspace();
        const nextProfile = await loadCurrentFinanceProfile();
        if (active) {
          setProfile(nextProfile);
          setVerifiedSessionId(sessionId);
        }
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
  }, [sessionId, recovering, signOutReplacedSession]);

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
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = window.setInterval(() => { void check(); }, 15_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session, recovering, ready, signOutReplacedSession]);

  if (!checked) return <AuthShell><p className="auth-status"><Loader2 size={18} className="auth-spin" /> Checking your session</p></AuthShell>;
  if (recovering) return <NewPasswordForm onComplete={async () => { try { await endCurrentSingleDeviceSession(); } finally { await closeFinanceSession('global'); } setRecovering(false); setNotice('Your password has been updated. Sign in with your new password.'); }} />;
  if (!session) {
    if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />;
    return <SignInForm notice={notice} onForgot={() => setForgot(true)} />;
  }
  if (error || !sessionId) return <AuthShell><BrandlessError message={error || 'Your session is unavailable. Please sign in again.'} /></AuthShell>;
  if (!ready || !profile || profile.id !== session.user.id) return <AuthShell><p className="auth-status"><Loader2 size={18} className="auth-spin" /> Opening your workspace</p></AuthShell>;
  if (profileNeedsName(profile)) return <CompleteProfileForm email={profile.email} onComplete={(firstName, lastName) => setProfile((current) => current ? { ...current, firstName, lastName } : current)} />;
  return <CurrentFinanceProfileContext.Provider key={sessionId} value={profile}>{children}</CurrentFinanceProfileContext.Provider>;
}

function BrandlessError({ message }: { message: string }) {
  return <><div className="auth-heading"><h1>Workspace unavailable</h1><p>{message}</p></div><button className="auth-button" type="button" onClick={() => void closeFinanceSession()}>Sign out</button></>;
}
