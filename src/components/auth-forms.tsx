import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, IndianRupee, Loader2, ShieldCheck } from 'lucide-react';
import { AuthEmailRateLimitError, PASSWORD_MIN_LENGTH, createAccount, isValidEmail, sendPasswordReset, signIn, updatePassword } from '@/lib/auth-api';

const SIGNUP_COOLDOWN_KEY = 'personal-financing-signup-cooldown-until';
const SIGNUP_COOLDOWN_MS = 60 * 60 * 1000;

function signupCooldownUntil(): number {
  const saved = Number(window.localStorage.getItem(SIGNUP_COOLDOWN_KEY) ?? 0);
  return Number.isFinite(saved) && saved > Date.now() ? saved : 0;
}

function formatWait(remainingSeconds: number): string {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

export function AuthShell({ children }: { children: ReactNode }) {
  return <main className="auth-page"><section className="auth-panel">{children}</section></main>;
}

function Brand() {
  return <div className="auth-brand"><span className="auth-brand-mark"><IndianRupee size={23} /></span><strong>Personal Financing</strong><small>Personal finance</small></div>;
}

function PasswordInput({ id, label, value, onChange, placeholder, autoComplete, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string; autoComplete: string; disabled: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-field"><label htmlFor={id}>{label}</label><div className="auth-input"><input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} maxLength={128} disabled={disabled} /><button type="button" className="auth-input-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>;
}

function Footer() { return <p className="auth-footer"><ShieldCheck size={16} /> Your personal finances, securely in one place.</p>; }

export function SignInForm({ notice, onForgot, onCreateAccount }: { notice: string; onForgot: () => void; onCreateAccount: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (loading) return; const value = email.trim(); if (!isValidEmail(value)) { setError('Enter a valid email address.'); return; } if (!password) { setError('Enter your password.'); return; } setLoading(true); setError(''); try { await signIn(value, password); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign in failed. Please try again.'); setPassword(''); } finally { setLoading(false); } };
  return <AuthShell><Brand /><div className="auth-heading"><h1>Welcome back</h1><p>Sign in to access your personal financial workspace.</p></div>{notice && <p className="auth-notice" role="status">{notice}</p>}<form className="auth-form" onSubmit={submit} noValidate><div className="auth-field"><label htmlFor="email">Email address</label><div className="auth-input"><input id="email" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} /></div></div><PasswordInput id="password" label="Password" value={password} onChange={setPassword} placeholder="Enter your password" autoComplete="current-password" disabled={loading} /><div className="auth-meta"><button type="button" className="auth-link" onClick={onForgot}>Forgot password?</button></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="auth-button" type="submit" disabled={loading}>{loading ? <><Loader2 size={18} className="auth-spin" /> Signing in</> : <>Sign in <ArrowRight size={18} /></>}</button></form><div className="auth-center auth-create-link"><span>New to Personal Financing?</span><button type="button" className="auth-link" onClick={onCreateAccount}>Create an account</button></div><Footer /></AuthShell>;
}

export function CreateAccountForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false); const [cooldownUntil, setCooldownUntil] = useState(signupCooldownUntil); const [now, setNow] = useState(Date.now());
  const remainingSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  useEffect(() => { if (!remainingSeconds) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [remainingSeconds]);
  const startCooldown = () => { const until = Date.now() + SIGNUP_COOLDOWN_MS; window.localStorage.setItem(SIGNUP_COOLDOWN_KEY, String(until)); setCooldownUntil(until); setNow(Date.now()); };
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (loading || remainingSeconds) return; const value = email.trim(); if (!isValidEmail(value)) { setError('Enter a valid email address.'); return; } if (password.length < PASSWORD_MIN_LENGTH) { setError(`Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`); return; } if (password !== confirm) { setError('The passwords do not match.'); return; } setLoading(true); setError(''); try { const signedIn = await createAccount(value, password); setMessage(signedIn ? 'Your account is ready. Opening your workspace.' : 'Account created. Check your email to confirm it, then return to sign in.'); } catch (caught) { if (caught instanceof AuthEmailRateLimitError) startCooldown(); setError(caught instanceof Error ? caught.message : 'We could not create your account.'); } finally { setLoading(false); } };
  return <AuthShell><Brand /><div className="auth-heading"><h1>Create your account</h1><p>Set up a private workspace for your personal finances.</p></div>{message ? <p className="auth-notice" role="status">{message}</p> : <form className="auth-form" onSubmit={submit} noValidate><div className="auth-field"><label htmlFor="create-email">Email address</label><div className="auth-input"><input id="create-email" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading || Boolean(remainingSeconds)} /></div></div><PasswordInput id="create-password" label="Password" value={password} onChange={setPassword} placeholder="At least 12 characters" autoComplete="new-password" disabled={loading || Boolean(remainingSeconds)} /><PasswordInput id="create-confirm" label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Re-enter your password" autoComplete="new-password" disabled={loading || Boolean(remainingSeconds)} />{error && <p className="form-error" role="alert">{error}</p>}{remainingSeconds ? <p className="auth-hint" role="status">You can try again in {formatWait(remainingSeconds)}. Please do not request another email before then.</p> : null}<button className="auth-button" type="submit" disabled={loading || Boolean(remainingSeconds)}>{loading ? 'Creating account' : remainingSeconds ? `Try again in ${formatWait(remainingSeconds)}` : 'Create account'}</button></form>}<div className="auth-center"><button type="button" className="auth-link" onClick={onBack}>Back to sign in</button></div><Footer /></AuthShell>;
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState(''); const [error, setError] = useState(''); const [sent, setSent] = useState(false); const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = email.trim(); if (!isValidEmail(value)) { setError('Enter a valid email address.'); return; } setLoading(true); setError(''); try { await sendPasswordReset(value); setSent(true); } catch (caught) { setError(caught instanceof Error ? caught.message : 'We could not send the reset link.'); } finally { setLoading(false); } };
  return <AuthShell><Brand /><div className="auth-heading"><h1>Reset your password</h1><p>Enter your email and we will send a secure reset link.</p></div>{sent ? <p className="auth-notice" role="status">If that email is registered, a reset link is on its way. Check your inbox and spam folder.</p> : <form className="auth-form" onSubmit={submit} noValidate><div className="auth-field"><label htmlFor="reset-email">Email address</label><div className="auth-input"><input id="reset-email" type="email" autoComplete="email" maxLength={254} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} /></div></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="auth-button" type="submit" disabled={loading}>{loading ? 'Sending link' : 'Send reset link'}</button></form>}<div className="auth-center"><button type="button" className="auth-link" onClick={onBack}>Back to sign in</button></div><Footer /></AuthShell>;
}

export function NewPasswordForm({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const valid = password.length >= PASSWORD_MIN_LENGTH && password === confirm;
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!valid || loading) return; setLoading(true); setError(''); try { await updatePassword(password); await onComplete(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'We could not update your password.'); setLoading(false); } };
  return <AuthShell><Brand /><div className="auth-heading"><h1>Choose a new password</h1><p>Use at least {PASSWORD_MIN_LENGTH} characters. Longer passphrases are stronger.</p></div><form className="auth-form" onSubmit={submit}><PasswordInput id="new-password" label="New password" value={password} onChange={setPassword} placeholder="At least 12 characters" autoComplete="new-password" disabled={loading} /><PasswordInput id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} placeholder="Re-enter your password" autoComplete="new-password" disabled={loading} />{password.length > 0 && password.length < PASSWORD_MIN_LENGTH && <p className="auth-hint">Your password needs at least {PASSWORD_MIN_LENGTH} characters.</p>}{confirm && confirm !== password && <p className="form-error" role="alert">The passwords do not match.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="auth-button" type="submit" disabled={!valid || loading}>{loading ? 'Updating password' : 'Update password'}</button></form><Footer /></AuthShell>;
}
