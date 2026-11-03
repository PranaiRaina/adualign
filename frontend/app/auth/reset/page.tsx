'use client';

import { CheckCircle2, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/utils/supabase/client';
import { authErrorMessage } from '@/lib/utils/authErrorMessage';

// Landing page for the password-recovery email link. The link routes through
// /auth/confirm (token-hash, type=recovery), which signs the user in and sends
// them here with an active session. This page just sets the new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // A valid recovery session is what authorizes updateUser({ password }). Direct
  // navigation here (no session) lands on the invalid state instead of a form
  // that can't do anything.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? 'ready' : 'invalid');
    });
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setIsSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSaving(false);
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }
    setStatus('done');
    setTimeout(() => router.replace('/projects'), 1500);
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-[440px] p-8">
        {status === 'done' ? (
          <div className="flex flex-col items-center text-center pt-2">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-2">
              Password updated
            </h1>
            <p className="text-sm font-medium leading-relaxed text-slate-500">
              You are signed in. Taking you to your plan.
            </p>
          </div>
        ) : status === 'invalid' ? (
          <div className="flex flex-col items-center text-center pt-2">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-slate-50">
              <KeyRound className="h-6 w-6 text-slate-400" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-2">
              Link expired
            </h1>
            <p className="text-sm font-medium leading-relaxed text-slate-500">
              This password reset link is invalid or has already been used. Request a new one from
              the sign-in screen.
            </p>
            <button
              type="button"
              onClick={() => router.replace('/login')}
              className="mt-6 w-full h-12 rounded-xl bg-emerald-600 font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center mb-8">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50">
                <KeyRound className="h-6 w-6 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-2">
                Set a new password
              </h1>
              <p className="text-slate-500 text-center text-sm font-medium">
                Choose a new password for your account.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              {error && (
                <div className="p-3 bg-red-50 text-red-600 text-sm font-medium rounded-xl border border-red-100">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                  placeholder="••••••••"
                />
              </div>
              <button
                disabled={isSaving}
                className="w-full bg-emerald-600 text-white rounded-xl h-12 font-bold hover:bg-emerald-700 transition-colors mt-4 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
