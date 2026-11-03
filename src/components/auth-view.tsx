import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, IndianRupee, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type AuthMode = 'signIn' | 'forgot' | 'reset';

function authMessage(error: unknown): string {
  if (error instanceof Error && error.message.toLowerCase().includes('invalid login credentials')) {
    return 'Unable to sign in with those details.';
  }
  return 'We could not complete that request. Please try again.';
}

export function AuthView({ mode, onModeChange }: { mode: AuthMode; onModeChange: (mode: AuthMode) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      if (mode === 'forgot') {
        const value = email.trim().toLowerCase();
        if (!value || value.length > 254) throw new Error('Enter a valid email address.');
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(value, {
          redirectTo: window.location.origin,
        });
        if (resetError) throw resetError;
        setNotice('If that email is registered, a password reset link is on its way.');
      } else if (mode === 'reset') {
        if (newPassword.length < 8) throw new Error('Your new password must be at least 8 characters.');
        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
        if (updateError) throw updateError;
        setNotice('Your password has been updated. You can sign in with it now.');
        setNewPassword('');
        onModeChange('signIn');
      } else {
        const value = email.trim().toLowerCase();
        if (!value || value.length > 254 || !value.includes('@')) throw new Error('Enter a valid email address.');
        if (!password) throw new Error('Enter your password.');
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: value, password });
        if (signInError) throw signInError;
      }
    } catch (cause) {
      setError(cause instanceof Error && ['Enter a valid email address.', 'Enter your password.', 'Your new password must be at least 8 characters.'].includes(cause.message) ? cause.message : authMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const isReset = mode === 'reset';
  const isForgot = mode === 'forgot';
  const title = isReset ? 'Choose a new password' : isForgot ? 'Reset your password' : 'Welcome back';
  const description = isReset
    ? 'Create a new password for your personal financial workspace.'
    : isForgot
      ? 'Enter your email and we will send a secure reset link if the account exists.'
      : 'Sign in to access your personal financial workspace.';

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true"><IndianRupee size={21} strokeWidth={2} /></span>
          <div>
            <strong>Personal Financing</strong>
            <small>PERSONAL FINANCE</small>
          </div>
        </div>
        <div className="auth-heading">
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        <form className="auth-form" onSubmit={submit} noValidate>
          {!isReset ? (
            <label>
              Email address
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="you@example.com" autoFocus />
            </label>
          ) : null}
          {isReset ? (
            <label>
              New password
              <span className="password-field">
                <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" placeholder="Enter a new password" autoFocus />
                <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          ) : null}
          {!isForgot && !isReset ? (
            <label>
              Password
              <span className="password-field">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} autoComplete="current-password" placeholder="Enter your password" />
                <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          ) : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
          <button className="auth-submit" type="submit" disabled={saving}>
            {saving ? 'Please wait…' : isReset ? 'Update password' : isForgot ? 'Send reset link' : 'Sign in'}
            {!saving && !isForgot ? <ArrowRight size={17} strokeWidth={1.8} /> : null}
          </button>
        </form>
        <div className="auth-links">
          {mode === 'signIn' ? <button type="button" onClick={() => { setError(''); setNotice(''); onModeChange('forgot'); }}>Forgot password?</button> : <button type="button" onClick={() => { setError(''); setNotice(''); onModeChange('signIn'); }}>Back to sign in</button>}
        </div>
        <div className="auth-footer"><ShieldCheck size={17} strokeWidth={1.8} /><span>Your personal finances, securely in one place.</span></div>
      </section>
    </main>
  );
}

export type { AuthMode };
