import { ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { FaqSection } from '@/components/FaqSection';
import { HeroLotPreviewClient } from '@/components/HeroLotPreviewClient';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';

const GAP_ITEMS = [
  {
    title: 'Buried in PDFs',
    desc: 'Zoning, setback, and other rules live in PDFs written for planners, not homeowners.',
  },
  {
    title: 'Guess or Pay Up',
    desc: 'Your options: work out feasibility by hand, or pay hundreds for an on-site assessment.',
  },
  {
    title: 'Blind Budgeting',
    desc: 'No real sense of what your build costs until contractors start quoting you.',
  },
];

const FEATURES = [
  {
    title: 'Feasibility Engine',
    desc: 'Type any California address. Get your lot boundaries, buildable area, and maximum ADU size in under 60 seconds.',
    href: '/map',
  },
  {
    title: 'ADU Advisor Chat',
    desc: 'Grounded in your parcel, not generic California guidance. The advisor knows your setbacks, buildable area, and placement, and answers permit and zoning questions straight from HCD code. Comes with a cost estimator: toggle site complications and watch your build cost update live.',
    href: '/map',
  },
  {
    title: 'ADU Report',
    desc: 'Save your session and get a structured report: executive summary, zoning analysis, financial snapshot, and next steps—ready to review, print, or pick up later from My Projects.',
    href: '/map',
  },
  {
    title: 'ADU Marketplace',
    desc: 'Filter by ADU type, permit status, and private entrance. Find exactly what you need, without scrolling past millions of unrelated listings.',
    href: '/marketplace',
    requiresListingMarketplace: true,
  },
  {
    title: 'AI Listing Builder',
    desc: 'Upload a walkthrough video. AI writes the copy, selects the best frames, and builds the full listing campaign in 5 minutes.',
    href: '/onboarding',
    requiresListingMarketplace: true,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-0 font-sans">
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative pt-10 md:pt-14 pb-20 overflow-hidden border-b border-surface-100">
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at center, #ffffff 0%, #f8fafc 100%)' }}
          />

          <div className="relative max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-start">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold tracking-wide mb-8">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Grounded in California HCD code</span>
              </div>

              <h1 className="font-display text-5xl md:text-7xl font-normal tracking-[-0.02em] text-surface-900 leading-[1.05] mb-6">
                Your Backyard.
                <br />
                Your Potential.
                <br />
                <span className="italic text-brand-600">Your ADU.</span>
              </h1>

              <p className="text-lg text-surface-600 mb-8 max-w-[480px] leading-relaxed">
                Type your address. Get an instant feasibility verdict, a cost estimate, and an AI
                advisor for the rest.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <Link
                  href="/map"
                  className="group bg-brand-600 text-surface-0 px-8 py-4 rounded-xl text-base font-semibold hover:bg-brand-700 transition-all hover:scale-[1.02] shadow-sm flex items-center gap-2 border border-brand-700/50"
                >
                  Check My Lot
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <a
                  href="#how-it-works"
                  className="bg-surface-0 border border-surface-200 text-surface-700 px-8 py-4 rounded-xl text-base font-semibold hover:bg-surface-50 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex items-center gap-2"
                >
                  How It Works
                </a>
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <HeroLotPreviewClient />
            </div>
          </div>
        </section>

        {/* The Gap */}
        <section className="bg-surface-900 py-20 text-white">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-4xl md:text-5xl font-bold mb-16 tracking-tight leading-[1.15]">
              The rules for your backyard exist.
              <br />
              <span className="text-brand-400">Good luck finding them.</span>
            </h2>

            <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-surface-700">
              {GAP_ITEMS.map((item, i) => (
                <div key={i} className="py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0">
                  <div className="text-red-400 text-base font-bold mb-4 font-mono">✕</div>
                  <h3 className="text-base font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-surface-400 text-sm leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="how-it-works" className="py-20 px-6 bg-surface-50">
          <div className="max-w-5xl mx-auto">
            <div className="mb-14">
              <h2 className="text-3xl md:text-4xl font-bold text-surface-900 tracking-tight mb-3">
                Built specifically for backyards
              </h2>
              <p className="text-surface-500 text-base max-w-md leading-relaxed">
                Check your lot, talk through the details with AI, and walk away with a report—all
                tied to your specific property.
              </p>
            </div>

            <div className="divide-y divide-surface-200">
              {FEATURES.filter(
                (f) => ENABLE_LISTING_MARKETPLACE || !f.requiresListingMarketplace,
              ).map((f, index) => (
                <div
                  key={f.title}
                  className="group flex items-start gap-8 py-8 hover:bg-surface-100 -mx-6 px-6 transition-colors rounded-xl"
                >
                  <span className="text-xs font-mono text-surface-400 w-6 shrink-0 pt-1">
                    {(index + 1).toString().padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-base font-semibold text-surface-900">{f.title}</h3>
                      <ArrowRight className="w-3.5 h-3.5 text-surface-400 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-all opacity-0 group-hover:opacity-100" />
                    </div>
                    <p className="text-surface-500 text-sm leading-relaxed max-w-lg">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <FaqSection />

        {/* Closing CTA */}
        <section className="bg-brand-50 border-t border-brand-100 py-20 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-surface-900 tracking-tight mb-4">
              Know in 60 seconds.
            </h2>
            <p className="text-surface-600 text-lg mb-10 max-w-sm mx-auto leading-relaxed">
              Type your address. Get the verdict, the lot boundaries, and a full cost estimate.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/map"
                className="group bg-brand-600 text-surface-0 px-8 py-4 rounded-xl text-base font-semibold hover:bg-brand-700 transition-all hover:scale-[1.02] shadow-sm flex items-center justify-center gap-2 border border-brand-700/50"
              >
                Check My Lot
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              {ENABLE_LISTING_MARKETPLACE && (
                <Link
                  href="/marketplace"
                  className="bg-surface-0 border border-surface-200 text-surface-700 px-8 py-4 rounded-xl text-base font-semibold hover:bg-surface-50 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex items-center justify-center gap-2"
                >
                  Browse ADUs
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
