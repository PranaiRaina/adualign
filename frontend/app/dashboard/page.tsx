'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardIndex() {
  const router = useRouter();

  // Guests are handled by DashboardAuthGate (layout); only logged-in users reach here.
  useEffect(() => {
    router.replace('/projects');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-pulse flex items-center gap-2 text-slate-500">
        <div className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
        Loading dashboard...
      </div>
    </div>
  );
}
