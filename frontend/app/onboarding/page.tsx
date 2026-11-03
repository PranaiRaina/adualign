'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Home, Key, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';

export default function OnboardingPage() {
  const { login } = useAuth();
  const router = useRouter();

  if (!ENABLE_LISTING_MARKETPLACE) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <Link href="/" className="inline-flex items-center gap-2 mb-8">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
              <Home className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-slate-900">ADUalign</span>
          </Link>
          <div className="bg-white py-8 px-6 shadow-xl sm:rounded-3xl border border-slate-200">
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Listing tools are paused
            </h2>
            <p className="mt-3 text-slate-600">
              Marketplace and listing flows are temporarily disconnected. You can still check ADU
              feasibility for a property.
            </p>
            <Button
              className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              onClick={() => router.push('/map')}
            >
              Check My Lot
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleRoleSelect = (role: 'buyer' | 'seller') => {
    // Mock login for the demo
    login('mock-token', {
      id: 'demo-user',
      name: 'Demo User',
      email: 'demo@adualign.com',
      role: role,
    });

    if (role === 'seller') {
      router.push('/projects');
    } else {
      router.push('/marketplace');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-8">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
            <Home className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-slate-900">ADUalign</span>
        </Link>
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
          Welcome to ADUalign
        </h2>
        <p className="mt-2 text-slate-600">How do you want to use the platform today?</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-2xl">
        <div className="bg-white py-8 px-4 shadow-xl sm:rounded-3xl sm:px-10 border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Renter Role */}
            <button
              onClick={() => handleRoleSelect('buyer')}
              className="relative group text-left p-8 rounded-2xl border-2 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              <div className="w-12 h-12 bg-slate-100 group-hover:bg-emerald-100 rounded-xl flex items-center justify-center mb-6 transition-colors">
                <Key className="w-6 h-6 text-slate-600 group-hover:text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">I want to rent an ADU</h3>
              <p className="text-slate-500 text-sm mb-6">
                Browse verified listings, filter by specific ADU types, and save your favorites.
              </p>
              <div className="text-emerald-600 font-semibold text-sm flex items-center group-hover:translate-x-1 transition-transform">
                Start renting <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </button>

            {/* Landlord Role */}
            <button
              onClick={() => handleRoleSelect('seller')}
              className="relative group text-left p-8 rounded-2xl border-2 border-slate-200 hover:border-slate-900 hover:bg-slate-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
            >
              <div className="absolute top-0 right-0 p-3">
                <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded">
                  HAS AI EDITOR
                </span>
              </div>
              <div className="w-12 h-12 bg-slate-100 group-hover:bg-slate-200 rounded-xl flex items-center justify-center mb-6 transition-colors">
                <Home className="w-6 h-6 text-slate-600 group-hover:text-slate-900" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">I own an ADU</h3>
              <p className="text-slate-500 text-sm mb-6">
                Use our AI campaign builder to create a stunning listing and reach verified tenants.
              </p>
              <div className="text-slate-900 font-semibold text-sm flex items-center group-hover:translate-x-1 transition-transform">
                Start listing <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </button>
          </div>
        </div>

        <p className="text-center text-sm text-slate-500 mt-8">
          This is a simulated authentication flow. <br /> Selecting a role will log you in with mock
          data.
        </p>
      </div>
    </div>
  );
}
