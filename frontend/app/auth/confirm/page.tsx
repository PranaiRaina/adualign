'use client';

import { MailCheck, ShieldCheck } from 'lucide-react';
import { Suspense, useContext, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/utils/supabase/client';
import { AuthContext } from '@/lib/context/AuthContext';
import { authErrorMessage } from '@/lib/utils/authErrorMessage';

// Interstitial confirmation page (token-hash flow). We deliberately do NOT
// verify on load: email security scanners (Microsoft Defender/Safe Links,
// Proofpoint, etc.) pre-fetch links and would consume the single-use token
// before the human clicks. verifyOtp runs only on the button press, which
// scanners don't perform. Replaces the old GET route that auto-verified.
function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useContext(AuthContext);
  const supabase = createClient();

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/projects';
  // Same-app paths only (open-redirect guard); '//' would be protocol-relative.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/projects';

  const isRecovery = type === 'recovery';
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!tokenHash || !type) {
      setError('This link is missing its confirmation token. Request a new email.');
      setStatus('error');
      return;
    }
    setStatus('verifying');
    const { error: verifyError } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (verifyError) {
      setError(authErrorMessage(verifyError));
      setStatus('error');
      return;
    }
    // Provision/refresh the backend user for the new session before leaving.
    // Verification already succeeded here, so a backend failure must not read
    // as a bad link — and must not strand the button on "Confirming…".
    try {
      await auth?.bootstrapSession();
    } catch {
      setError(
        "Your email is verified, but we couldn't finish setting up your account. Try signing in.",
      );
      setStatus('error');
      return;
    }
    router.replace(safeNext);
  };

  const missingToken = !tokenHash || !type;

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-[440px] p-8">
        <div className="flex flex-col items-center text-center pt-2">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50">
            {isRecovery ? (
              <ShieldCheck className="h-6 w-6 text-emerald-600" />
            ) : (
              <MailCheck className="h-6 w-6 text-emerald-600" />
            )}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-2">
            {isRecovery ? 'Confirm password reset' : 'Confirm your email'}
          </h1>
          <p className="text-sm font-medium leading-relaxed text-slate-500">
            {isRecovery
              ? 'Click below to continue and choose a new password.'
              : 'Click below to finish verifying your email and sign in.'}
          </p>

          {status === 'error' && (
            <div className="mt-5 w-full rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
              {error}
            </div>
          )}

          {status === 'error' ? (
            <button
              type="button"
              onClick={() => router.replace('/login')}
              className="mt-6 w-full h-12 rounded-xl bg-emerald-600 font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              Back to sign in
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={status === 'verifying' || missingToken}
              className="mt-6 w-full h-12 rounded-xl bg-emerald-600 font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'verifying' ? 'Confirming...' : isRecovery ? 'Continue' : 'Confirm email'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmContent />
    </Suspense>
  );
}
