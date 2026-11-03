'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { useAuth } from '@/lib/hooks/useAuth';
import { cn } from '@/components/ui/button';

const ADMIN_NAV = [
  { href: '/admin', label: 'Users' },
  { href: '/admin/feedback', label: 'Feedback' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // isAdmin is server-derived (set from GET /admin/me), so it is the source of
  // truth for rendering. Admin API endpoints remain independently enforced by
  // the backend on every request.
  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.replace('/');
    }
  }, [isLoading, isAdmin, router]);

  return (
    <div className="min-h-screen flex flex-col bg-surface-50">
      <Header />
      <div className="flex-1 flex container mx-auto px-4 max-w-7xl">
        <main className="flex-1 py-8 min-w-0">
          {isLoading || !isAdmin ? (
            <div className="flex h-[400px] items-center justify-center">
              <div className="text-surface-400 text-sm">
                {isLoading ? 'Loading...' : 'Redirecting...'}
              </div>
            </div>
          ) : (
            <>
              <nav className="mb-6 flex gap-1 border-b border-surface-200">
                {ADMIN_NAV.map((item) => {
                  const active =
                    item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'border-brand-600 text-brand-700'
                          : 'border-transparent text-surface-500 hover:text-surface-800',
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              {children}
            </>
          )}
        </main>
      </div>
      <Footer />
    </div>
  );
}
