'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { PRICING_ENABLED } from '@/lib/utils/constants';
import { Button } from '@/components/ui/button';
import { Bookmark, Gauge, Home, LogIn, Menu, ShieldCheck, UserPlus, X } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { requestChatExit } from '@/lib/chatExitGuard';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';
import { LogoMark } from '@/components/layout/LogoMark';

function getInitials(name?: string): string {
  const parts = (name ?? '').trim().split(' ').filter(Boolean);
  if (parts.length === 0) return 'U';
  return parts
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

export function Header() {
  const { user, isLoggedIn, isAdmin, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'signin' | 'signup'>('signin');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const openAuthModal = (tab: 'signin' | 'signup') => {
    setAuthModalTab(tab);
    setIsAuthModalOpen(true);
    setIsMobileMenuOpen(false);
  };

  const handleLogoutClick = () => {
    setIsMobileMenuOpen(false);
    requestChatExit({
      reason: 'logout',
      proceed: logout,
    });
  };

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname, isLoggedIn]);

  const isMarketplaceActive = pathname === '/marketplace' || pathname.startsWith('/marketplace/');
  const isFeasibilityActive = pathname === '/onboarding' || pathname === '/map';
  const isPricingActive = pathname === '/pricing';
  const shouldShowGuestActions = !isLoggedIn;
  const shouldShowUserMenu = isLoggedIn;
  const accountLabel = isLoading && !isLoggedIn ? 'Checking account...' : user?.name || 'User';

  return (
    <>
      <header className="sticky top-0 z-50 w-full h-16 bg-surface-0 border-b border-surface-200 shadow-sm transition-all duration-200">
        <div className="container h-full mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="flex items-center justify-center group-hover:bg-brand-50 transition-colors p-1 rounded-lg">
                <LogoMark className="transform scale-110" />
              </div>
              <span className="font-extrabold text-2xl tracking-tighter text-surface-900 group-hover:text-brand-600 transition-colors font-[family-name:var(--font-outfit)] leading-none mt-1">
                ADUalign
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6">
              {ENABLE_LISTING_MARKETPLACE && (
                <Link
                  href="/marketplace"
                  className={`font-semibold text-sm transition-colors ${isMarketplaceActive ? 'text-brand-600 border-b-2 border-brand-600 pb-[22px] -mb-[24px]' : 'text-surface-600 hover:text-surface-900 border-b-2 border-transparent pb-[22px] -mb-[24px] hover:border-surface-300'}`}
                >
                  Browse ADUs
                </Link>
              )}
              <Link
                href="/map"
                className={`font-semibold text-sm transition-colors ${isFeasibilityActive ? 'text-brand-600 border-b-2 border-brand-600 pb-[22px] -mb-[24px]' : 'text-surface-600 hover:text-surface-900 border-b-2 border-transparent pb-[22px] -mb-[24px] hover:border-surface-300'}`}
              >
                Check My Lot
              </Link>
              {PRICING_ENABLED && shouldShowGuestActions && (
                <Link
                  href="/pricing"
                  className={`font-semibold text-sm transition-colors ${isPricingActive ? 'text-brand-600 border-b-2 border-brand-600 pb-[22px] -mb-[24px]' : 'text-surface-600 hover:text-surface-900 border-b-2 border-transparent pb-[22px] -mb-[24px] hover:border-surface-300'}`}
                >
                  Pricing
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {shouldShowGuestActions ? (
              <>
                <Button
                  variant="ghost"
                  className="hidden md:flex text-surface-600 hover:text-surface-900 font-semibold rounded-lg px-4"
                  onClick={() => openAuthModal('signin')}
                >
                  Sign In
                </Button>
                <Button
                  className="bg-brand-600 hover:bg-brand-700 text-surface-0 font-semibold rounded-lg shadow-sm border border-brand-700/50"
                  onClick={() => openAuthModal('signup')}
                >
                  Get Started
                </Button>
              </>
            ) : shouldShowUserMenu ? (
              <div className="flex items-center gap-4">
                {ENABLE_LISTING_MARKETPLACE && (
                  <Button
                    asChild
                    variant="ghost"
                    className="text-surface-600 hover:text-surface-900 font-semibold hidden md:flex"
                  >
                    <Link href="/dashboard/saved">Saved Homes</Link>
                  </Button>
                )}
                <Button
                  asChild
                  variant="ghost"
                  className="text-surface-600 hover:text-surface-900 font-semibold hidden md:flex"
                >
                  <Link href="/projects">My Projects</Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="text-surface-600 hover:text-surface-900 font-semibold hidden md:flex"
                >
                  <Link href="/dashboard/usage">Usage</Link>
                </Button>
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg border border-surface-300 bg-surface-50 text-surface-600 hover:bg-surface-900 hover:text-surface-0 hover:border-surface-900 transition-all duration-150"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Admin
                  </Link>
                )}

                <div className="h-8 w-px bg-surface-200 hidden md:block"></div>

                <button
                  type="button"
                  className="flex items-center gap-3 rounded-full border border-surface-200 bg-surface-50 p-1 pr-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-colors hover:border-surface-300 group"
                  onClick={handleLogoutClick}
                >
                  <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 shadow-sm border border-brand-200/50">
                    <span className="text-xs font-bold leading-none">
                      {getInitials(user?.name)}
                    </span>
                  </div>
                  <div className="hidden sm:flex flex-col">
                    <span className="text-xs font-bold text-surface-900 leading-tight">
                      {accountLabel}
                    </span>
                    <span className="text-[10px] uppercase font-bold text-surface-500 tracking-wider leading-tight group-hover:text-red-500 transition-colors">
                      Logout
                    </span>
                  </div>
                </button>
              </div>
            ) : null}

            <button
              type="button"
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-surface-200 bg-surface-50 text-surface-700 shadow-sm transition-colors hover:border-surface-300 hover:text-surface-900"
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setIsMobileMenuOpen((open) => !open)}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen ? (
          <div className="md:hidden border-t border-surface-200 bg-surface-0 shadow-lg">
            <div className="container mx-auto px-4 py-4 space-y-2">
              {ENABLE_LISTING_MARKETPLACE && (
                <Link
                  href="/marketplace"
                  className={`block rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    isMarketplaceActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-surface-700 hover:bg-surface-50 hover:text-surface-900'
                  }`}
                >
                  Browse ADUs
                </Link>
              )}

              <Link
                href="/map"
                className={`block rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                  isFeasibilityActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-surface-700 hover:bg-surface-50 hover:text-surface-900'
                }`}
              >
                Check My Lot
              </Link>

              {PRICING_ENABLED && shouldShowGuestActions && (
                <Link
                  href="/pricing"
                  className={`block rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    isPricingActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-surface-700 hover:bg-surface-50 hover:text-surface-900'
                  }`}
                >
                  Pricing
                </Link>
              )}

              {shouldShowUserMenu ? (
                <>
                  {ENABLE_LISTING_MARKETPLACE && (
                    <Link
                      href="/dashboard/saved"
                      className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-surface-700 transition-colors hover:bg-surface-50 hover:text-surface-900"
                    >
                      <Bookmark className="h-4 w-4" />
                      Saved Homes
                    </Link>
                  )}

                  <Link
                    href="/projects"
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-surface-700 transition-colors hover:bg-surface-50 hover:text-surface-900"
                  >
                    <Home className="h-4 w-4" />
                    My Projects
                  </Link>

                  <Link
                    href="/dashboard/usage"
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-surface-700 transition-colors hover:bg-surface-50 hover:text-surface-900"
                  >
                    <Gauge className="h-4 w-4" />
                    Usage
                  </Link>

                  {isAdmin && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Admin
                    </Link>
                  )}

                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                    onClick={handleLogoutClick}
                  >
                    <X className="h-4 w-4" />
                    Logout
                  </button>
                </>
              ) : (
                <div className="space-y-2 pt-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-start rounded-xl px-4 text-surface-700 hover:text-surface-900"
                    onClick={() => openAuthModal('signin')}
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign In
                  </Button>
                  <Button
                    className="w-full justify-start rounded-xl bg-brand-600 text-surface-0 shadow-sm hover:bg-brand-700"
                    onClick={() => openAuthModal('signup')}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Get Started
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultTab={authModalTab}
        oauthNext="/projects"
        onSuccess={() => {
          setIsAuthModalOpen(false);
          router.push('/projects');
        }}
      />
    </>
  );
}
