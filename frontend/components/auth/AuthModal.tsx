'use client';
import { MailCheck, X } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/utils/supabase/client';
import { AuthContext } from '@/lib/context/AuthContext';
import { authErrorMessage } from '@/lib/utils/authErrorMessage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Signup bonus credits, served by the backend so the copy can't drift from the
// amount actually granted. Cached module-level: repeated modal opens don't refetch.
// null (loading/unreachable) degrades the copy to a numberless version.
let signupCreditsPromise: Promise<number | null> | null = null;
function fetchSignupCredits(): Promise<number | null> {
  signupCreditsPromise ??= fetch(`${API_URL}/public-config`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) =>
      typeof data?.signup_address_credits === 'number' ? data.signup_address_credits : null,
    )
    .catch(() => null);
  return signupCreditsPromise;
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'signin' | 'signup';
  onSuccess?: () => void;
  title?: string;
  description?: string;
  highlights?: string[];
  contextSummary?: string;
  variant?: 'default' | 'planning';
  /** Path to land on after OAuth (Google) returns via /auth/callback. */
  oauthNext?: string;
  /** Pre-filled error banner (e.g. mapped from /login?error=). */
  initialError?: string;
}

export function AuthModal({
  isOpen,
  onClose,
  defaultTab = 'signin',
  onSuccess,
  title,
  description,
  highlights = [],
  contextSummary,
  variant = 'default',
  oauthNext,
  initialError,
}: AuthModalProps) {
  const auth = useContext(AuthContext);
  const [tab, setTab] = useState<'signin' | 'signup'>(defaultTab);
  const [signupCredits, setSignupCredits] = useState<number | null>(null);
  const isPlanningVariant = variant === 'planning';
  const displayTitle = title ?? (tab === 'signup' ? 'Create your account' : 'Welcome back');
  const displayDescription =
    description ??
    (tab === 'signup'
      ? 'Analyze any California property and save your projects.'
      : 'Sign in to analyze properties and save your projects.');

  useEffect(() => {
    if (isOpen) {
      let cancelled = false;
      fetchSignupCredits().then((n) => {
        if (!cancelled) setSignupCredits(n);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTab(defaultTab);
      setVerifySentTo(null);
      setSentKind('signup');
      setResendError('');
      setError(initialError ?? '');
    }
  }, [isOpen, defaultTab, initialError]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  // Email-verification wait state: set to the address we mailed a link to.
  // Replaces the modal body until the user verifies or goes back. `sentKind`
  // picks the copy and which resend API to call ('signup' confirmation vs
  // 'recovery' password reset).
  const [verifySentTo, setVerifySentTo] = useState<string | null>(null);
  const [sentKind, setSentKind] = useState<'signup' | 'recovery'>('signup');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendError, setResendError] = useState('');

  const supabase = createClient();

  // Google OAuth: PKCE code flow via /auth/callback, honoring `next`.
  const buildCallbackUrl = () =>
    oauthNext
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(oauthNext)}`
      : `${window.location.origin}/auth/callback`;

  // Email signup/resend: token-hash flow via /auth/confirm. The email template
  // appends `&token_hash=...&type=email` to this URL, so it must always carry
  // a `?next=` query. Unlike PKCE, the link works in any browser.
  const buildConfirmRedirect = () =>
    `${window.location.origin}/auth/confirm?next=${encodeURIComponent(oauthNext || '/projects')}`;

  // Password recovery: same token-hash machinery as signup confirmation, but the
  // link lands on /auth/reset to set a new password. Also the escape hatch for
  // Google-only accounts to add a password (resetting one just attaches it).
  const buildRecoveryRedirect = () =>
    `${window.location.origin}/auth/confirm?next=${encodeURIComponent('/auth/reset')}`;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: buildCallbackUrl(),
      },
    });
    if (error) setError(authErrorMessage(error));
  };

  const handleForgotPassword = async () => {
    setError('');
    if (!email) {
      setError('Enter your email address first, then tap "Forgot password?".');
      return;
    }
    // Supabase returns no error even when the email doesn't exist (anti-
    // enumeration), so we always advance to the wait state.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildRecoveryRedirect(),
    });
    setSentKind('recovery');
    setVerifySentTo(email);
    setResendCooldown(60);
  };

  const handleResend = async () => {
    if (!verifySentTo) return;
    setResendError('');
    const { error } =
      sentKind === 'recovery'
        ? await supabase.auth.resetPasswordForEmail(verifySentTo, {
            redirectTo: buildRecoveryRedirect(),
          })
        : await supabase.auth.resend({
            type: 'signup',
            email: verifySentTo,
            options: { emailRedirectTo: buildConfirmRedirect() },
          });
    if (error) {
      setResendError(authErrorMessage(error));
    } else {
      setResendCooldown(60);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      if (tab === 'signup') {
        // Native Supabase Registration
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: name,
            },
            emailRedirectTo: buildConfirmRedirect(),
          },
        });

        if (signUpError) throw signUpError;
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          throw new Error('This email is already registered. Please sign in instead.');
        }
        if (!data.session) {
          // Email confirmation required: Supabase created the user and mailed a
          // verification link but returned no session. Show the wait state; the
          // link itself signs them in via /auth/callback.
          setSentKind('signup');
          setVerifySentTo(email);
          setResendCooldown(60); // an email was just sent
          return;
        }
        await auth?.bootstrapSession();
      } else {
        // Native Supabase Login
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          // Unverified account: route to the same wait state instead of a dead-end
          // error. No email was just sent, so resend is available immediately.
          if (
            signInError.code === 'email_not_confirmed' ||
            /not confirmed/i.test(signInError.message)
          ) {
            setSentKind('signup');
            setVerifySentTo(email);
            setResendCooldown(0);
            return;
          }
          throw signInError;
        }
        if (!data.session) {
          throw new Error('Sign-in completed without an active session.');
        }
        await auth?.bootstrapSession();
      }

      // Reset form
      setEmail('');
      setPassword('');
      setName('');

      if (onSuccess) {
        onSuccess();
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(authErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-[440px] max-h-[calc(100dvh-2rem)] overflow-y-auto p-8 animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-5 top-5 text-slate-400 hover:text-slate-900 rounded-full p-2 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {verifySentTo ? (
          <div className="flex flex-col items-center text-center pt-2">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50">
              <MailCheck className="h-6 w-6 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-2">
              Check your inbox
            </h2>
            <p className="text-sm font-medium leading-relaxed text-slate-500">
              {sentKind === 'recovery' ? (
                <>
                  We sent a password reset link to{' '}
                  <span className="font-bold text-slate-900">{verifySentTo}</span>. Opening it lets
                  you set a new password in that tab — you can close this one.
                </>
              ) : (
                <>
                  We sent a verification link to{' '}
                  <span className="font-bold text-slate-900">{verifySentTo}</span>. Opening it signs
                  you in and takes you to your plan in that tab, you can close this one.
                </>
              )}
            </p>

            {resendError && (
              <div className="mt-5 w-full rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
                {resendError}
              </div>
            )}

            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0}
              className="mt-6 w-full h-12 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resendCooldown > 0 ? `Resend email in ${resendCooldown}s` : 'Resend email'}
            </button>
            <p className="mt-3 text-xs font-medium text-slate-400">
              Not seeing it? Check your spam folder.
            </p>

            <button
              type="button"
              onClick={() => {
                setVerifySentTo(null);
                setTab('signin');
              }}
              className="mt-6 text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-900 transition-colors"
            >
              Already verified or wrong email? Back to sign in
            </button>
          </div>
        ) : (
          <>
            <div className={`flex flex-col items-center ${isPlanningVariant ? 'mb-6' : 'mb-8'}`}>
              <h2
                className={`text-2xl font-extrabold text-slate-900 tracking-tight ${
                  isPlanningVariant ? '' : 'mb-2'
                }`}
              >
                {displayTitle}
              </h2>
              {!isPlanningVariant && displayDescription ? (
                <p className="text-slate-500 text-center text-sm font-medium">
                  {displayDescription}
                </p>
              ) : null}
            </div>

            {isPlanningVariant && contextSummary ? (
              <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
                  Current plan
                </p>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-700">
                  {contextSummary}
                </p>
              </div>
            ) : !isPlanningVariant && contextSummary ? (
              <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
                  Current plan
                </p>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-700">
                  {contextSummary}
                </p>
              </div>
            ) : null}

            {isPlanningVariant && highlights.length > 0 ? (
              <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-2.5">
                  Sign in to unlock
                </p>
                <div className="space-y-2">
                  {highlights.map((highlight) => (
                    <div
                      key={highlight}
                      className="flex items-center gap-2.5 text-sm font-medium text-slate-500"
                    >
                      <svg
                        className="w-4 h-4 text-slate-300 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                        />
                      </svg>
                      <span>{highlight}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!isPlanningVariant && highlights.length > 0 ? (
              <div className="mb-6 grid gap-2">
                {highlights.map((highlight) => (
                  <div
                    key={highlight}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700"
                  >
                    {highlight}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex w-full mb-8 border-b border-slate-100">
              <button
                onClick={() => setTab('signin')}
                className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-colors ${tab === 'signin' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}
              >
                Sign In
              </button>
              <button
                onClick={() => setTab('signup')}
                className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-colors ${tab === 'signup' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}
              >
                Create Account
              </button>
            </div>

            {tab === 'signup' && (
              <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-center">
                <p className="text-base font-extrabold text-emerald-800">
                  {signupCredits !== null
                    ? `${signupCredits} free addresses included`
                    : 'Free addresses included'}
                </p>
                <p className="mt-0.5 text-xs font-medium text-emerald-700">
                  Sign up and plan ADUs at no cost.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 h-12 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors font-semibold text-slate-700 shadow-sm mb-5"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                />
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-xs font-medium text-slate-400">or</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              {error && (
                <div className="p-3 bg-red-50 text-red-600 text-sm font-medium rounded-xl border border-red-100">
                  {error}
                </div>
              )}
              {tab === 'signup' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                    placeholder="Jane Doe"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                  placeholder="••••••••"
                />
              </div>

              <button
                disabled={isLoading}
                className="w-full bg-emerald-600 text-white rounded-xl h-12 font-bold hover:bg-emerald-700 transition-colors mt-4 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Please wait...' : tab === 'signin' ? 'Sign In' : 'Create Account'}
              </button>

              {tab === 'signin' && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="w-full text-center text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-900 transition-colors"
                >
                  Forgot password?
                </button>
              )}
            </form>

            <p className="mt-8 text-center text-xs text-slate-400 font-medium">
              By continuing you agree to our{' '}
              <a href="/terms" target="_blank" className="underline hover:text-slate-600">
                Terms
              </a>{' '}
              and{' '}
              <a href="/privacy" target="_blank" className="underline hover:text-slate-600">
                Privacy Policy
              </a>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
