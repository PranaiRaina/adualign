'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { AuthModal } from '@/components/auth/AuthModal';

/**
 * Gates the dashboard for guests. Instead of bouncing them back to the homepage,
 * we keep them on the dashboard URL behind a masked shell and open the auth modal.
 * Signing in re-renders the real dashboard (AuthContext.user populates, so the
 * gate falls through to children); dismissing the modal sends them home.
 */
export function DashboardAuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="w-10 h-10 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {/* Masked dashboard placeholder behind the auth modal */}
        <div
          aria-hidden
          className="min-h-[60vh] w-full max-w-3xl space-y-4 blur-sm pointer-events-none select-none"
        >
          <div className="h-8 w-48 rounded-md bg-surface-200" />
          <div className="h-40 rounded-lg bg-surface-100" />
          <div className="h-40 rounded-lg bg-surface-100" />
        </div>
        <AuthModal
          isOpen
          onClose={() => router.replace('/')}
          oauthNext={pathname}
          title="Sign in to view your dashboard"
          description="Sign in to see your saved projects, listings, and usage."
        />
      </>
    );
  }

  return <>{children}</>;
}
