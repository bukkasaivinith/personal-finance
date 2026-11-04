import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { AuthShell, ForgotPasswordForm, NewPasswordForm, SignInForm } from '@/components/auth-forms';
import { claimWorkspace } from '@/lib/auth-api';
import { supabase } from '@/lib/supabase';

const PASSWORD_UPDATED_NOTICE = 'Your password has been updated. Sign in with your new password.';

export function AuthGate({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');

  const userId = session?.user.id ?? null;

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setChecked(true);
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setWorkspaceReady(false);
    setWorkspaceError('');
    if (!userId) {
      setNotice('');
      return;
    }
    if (recovering) return;
    let active = true;
    claimWorkspace()
      .then(() => {
        if (active) setWorkspaceReady(true);
      })
      .catch((caught: unknown) => {
        if (active) setWorkspaceError(caught instanceof Error ? caught.message : 'Please try again.');
      });
    return () => {
      active = false;
    };
  }, [userId, recovering]);

  if (!checked) {
    return (
      <AuthShell>
        <p className="auth-status">
          <Loader2 size={18} className="auth-spin" aria-hidden="true" />
          Checking your session
        </p>
      </AuthShell>
    );
  }

  if (recovering) {
    return (
      <NewPasswordForm
        onComplete={() => {
          setRecovering(false);
          setNotice(PASSWORD_UPDATED_NOTICE);
        }}
      />
    );
  }

  if (!session) {
    return forgotOpen ? (
      <ForgotPasswordForm onBack={() => setForgotOpen(false)} />
    ) : (
      <SignInForm notice={notice} onForgotPassword={() => setForgotOpen(true)} />
    );
  }

  if (workspaceError) {
    return (
      <AuthShell>
        <div className="auth-heading">
          <h1>Workspace unavailable</h1>
          <p>{workspaceError}</p>
        </div>
        <button className="auth-button" type="button" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </AuthShell>
    );
  }

  if (!workspaceReady) {
    return (
      <AuthShell>
        <p className="auth-status">
          <Loader2 size={18} className="auth-spin" aria-hidden="true" />
          Opening your workspace
        </p>
      </AuthShell>
    );
  }

  return <>{children}</>;
}
