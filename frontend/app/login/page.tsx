'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/auth/AuthModal';
import { useAuth } from '@/lib/hooks/useAuth';
import { normalizeNextPath } from '@/lib/utils/authRedirect';

// Errors handed back by the /auth/callback redirect (Google OAuth path).
const CALLBACK_ERRORS: Record<string, string> = {
  oauth_error: "Google sign-in didn't complete. Please try again.",
  account_setup_failed: "We couldn't finish setting up your account. Try again or contact us.",
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, isLoading } = useAuth();
  const nextPath = normalizeNextPath(searchParams.get('next'));
  const errorParam = searchParams.get('error');
  const initialError = errorParam
    ? (CALLBACK_ERRORS[errorParam] ?? 'Something went wrong signing you in. Please try again.')
    : undefined;

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      router.replace(nextPath);
    }
  }, [isLoading, isLoggedIn, nextPath, router]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AuthModal
        isOpen
        initialError={initialError}
        onClose={() => router.replace(nextPath)}
        onSuccess={() => router.replace(nextPath)}
      />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
