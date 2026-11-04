import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CircleDollarSign, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isValidEmail,
  requestPasswordReset,
  signInWithPassword,
  signOut,
  updatePassword,
} from '@/lib/auth-api';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <main className="auth-panel">
        <div className="auth-brand">
          <span className="brand-mark">
            <CircleDollarSign size={22} aria-hidden="true" />
          </span>
          <p className="auth-brand-name">Personal Financing</p>
          <p className="auth-brand-tag">Personal finance</p>
        </div>
        {children}
        <p className="auth-footer">
          <ShieldCheck size={16} aria-hidden="true" />
          Your personal finances, securely in one place.
        </p>
      </main>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder: string;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>
        {label}
      </label>
      <div className="auth-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="auth-input-toggle"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

export function SignInForm({ notice, onForgotPassword }: { notice: string; onForgotPassword: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await signInWithPassword(trimmedEmail, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed. Please try again.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-heading">
        <h1>Welcome back</h1>
        <p>Sign in to access your personal financial workspace.</p>
      </div>
      {notice ? (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      ) : null}
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-email">
            Email address
          </label>
          <div className="auth-input">
            <input
              id="auth-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={EMAIL_MAX_LENGTH}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <PasswordField
          id="auth-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="Enter your password"
          disabled={submitting}
        />
        <div className="auth-meta">
          <button type="button" className="auth-link" onClick={onForgotPassword}>
            Forgot password?
          </button>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="auth-button" type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 size={18} className="auth-spin" aria-hidden="true" />
              Signing in
            </>
          ) : (
            <>
              Sign in
              <ArrowRight size={18} aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await requestPasswordReset(trimmedEmail);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not send the link. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-heading">
        <h1>Reset your password</h1>
        <p>Enter your email and we will send you a secure link to choose a new password.</p>
      </div>
      {sent ? (
        <p className="auth-notice" role="status">
          If that email is registered, a reset link is on its way. Check your inbox and spam folder.
        </p>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-reset-email">
              Email address
            </label>
            <div className="auth-input">
              <input
                id="auth-reset-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={EMAIL_MAX_LENGTH}
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="auth-button" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={18} className="auth-spin" aria-hidden="true" />
                Sending link
              </>
            ) : (
              'Send reset link'
            )}
          </button>
        </form>
      )}
      <div className="auth-center">
        <button type="button" className="auth-link" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </AuthShell>
  );
}

export function NewPasswordForm({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= PASSWORD_MIN_LENGTH && password === confirm;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await updatePassword(password);
      await signOut('global');
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not update your password. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-heading">
        <h1>Choose a new password</h1>
        <p>Use at least {PASSWORD_MIN_LENGTH} characters. A longer passphrase is stronger than a complex password.</p>
      </div>
      <form className="auth-form" onSubmit={submit} noValidate>
        <PasswordField
          id="auth-new-password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="At least 12 characters"
          disabled={submitting}
        />
        <PasswordField
          id="auth-confirm-password"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          disabled={submitting}
        />
        {tooShort ? (
          <p className="auth-hint">Your password needs at least {PASSWORD_MIN_LENGTH} characters.</p>
        ) : null}
        {mismatch ? <p className="form-error" role="alert">The passwords do not match.</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="auth-button" type="submit" disabled={submitting || !canSubmit}>
          {submitting ? (
            <>
              <Loader2 size={18} className="auth-spin" aria-hidden="true" />
              Updating password
            </>
          ) : (
            'Update password'
          )}
        </button>
      </form>
    </AuthShell>
  );
}
