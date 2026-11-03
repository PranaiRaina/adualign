import { ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';

type Plan = {
  name: string;
  positioning: string;
  price: string;
  cadence: string;
  features: string[];
  cta: { label: string; href: string };
  featured?: boolean;
};

const PLANS: Plan[] = [
  {
    name: 'Explore',
    positioning: 'See if your lot qualifies.',
    price: '$0',
    cadence: 'free, no card',
    features: [
      'Feasibility verdict on any California address',
      'Lot boundaries & buildable zone on the map',
      'Maximum ADU size for your parcel',
      '$10 of AI advisor credit, included',
    ],
    cta: { label: 'Check My Lot', href: '/map' },
  },
  {
    name: 'Plan',
    positioning: 'Everything to take one ADU from idea to permit-ready.',
    price: '$29',
    cadence: 'one-time',
    features: [
      'Everything in Explore',
      'Full ADU report: zoning, financials, next steps',
      'Interactive ADU placement on your lot',
      'Save projects and pick up where you left off',
      'Priority AI advisor grounded in your parcel',
    ],
    cta: { label: 'Start Planning', href: '/map' },
    featured: true,
  },
  {
    name: 'Portfolio',
    positioning: 'For investors and contractors scanning at scale.',
    price: '$99',
    cadence: 'per month',
    features: [
      'Everything in Plan',
      'Unlimited reports and saved projects',
      'Batch feasibility across multiple parcels',
      'Export reports to PDF and CSV',
      'Expanded AI advisor budget',
    ],
    cta: { label: 'Get Started', href: '/map' },
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="bg-surface-0 border-t border-surface-100 py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-16 max-w-2xl">
          <h2 className="font-display text-4xl md:text-5xl font-normal tracking-[-0.02em] text-surface-900 leading-[1.1] mb-4">
            Start free.
            <br />
            Pay when it <span className="italic text-brand-600">pencils out.</span>
          </h2>
          <p className="text-surface-500 text-base leading-relaxed max-w-md">
            Check any California lot for nothing. Upgrade when you&apos;re ready to model the
            numbers and take a real plan to a contractor.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan) =>
            plan.featured ? (
              <div
                key={plan.name}
                className="relative rounded-2xl bg-surface-900 p-8 lg:p-9 lg:-mt-5 shadow-[0_12px_40px_rgba(15,23,42,0.20),0_2px_8px_rgba(15,23,42,0.12)]"
              >
                <div className="absolute -top-3 left-8 inline-flex items-center rounded-full bg-brand-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-surface-900">
                  Most chosen
                </div>

                <h3 className="text-lg font-semibold text-surface-0">{plan.name}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-surface-400 min-h-[40px]">
                  {plan.positioning}
                </p>

                <div className="mt-6 flex items-baseline gap-2">
                  <span className="font-display text-6xl leading-none text-surface-0">
                    {plan.price}
                  </span>
                  <span className="text-sm text-surface-400">{plan.cadence}</span>
                </div>

                <Link
                  href={plan.cta.href}
                  className="group mt-7 flex items-center justify-center gap-2 rounded-xl border border-brand-700/50 bg-brand-600 px-6 py-3.5 text-sm font-semibold text-surface-0 shadow-sm transition-all hover:scale-[1.02] hover:bg-brand-700"
                >
                  {plan.cta.label}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>

                <ul className="mt-8 space-y-3.5 border-t border-surface-700 pt-7">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" strokeWidth={2.5} />
                      <span className="text-sm leading-snug text-surface-300">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div
                key={plan.name}
                className="group rounded-2xl border border-surface-200 bg-surface-0 p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:border-surface-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08),0_2px_6px_rgba(0,0,0,0.04)]"
              >
                <h3 className="text-lg font-semibold text-surface-900">{plan.name}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-surface-500 min-h-[40px]">
                  {plan.positioning}
                </p>

                <div className="mt-6 flex items-baseline gap-2">
                  <span className="font-display text-6xl leading-none text-surface-900">
                    {plan.price}
                  </span>
                  <span className="text-sm text-surface-500">{plan.cadence}</span>
                </div>

                <Link
                  href={plan.cta.href}
                  className={`group/cta mt-7 flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold transition-all ${
                    plan.name === 'Portfolio'
                      ? 'bg-surface-900 text-surface-0 hover:bg-surface-800'
                      : 'border border-surface-200 bg-surface-0 text-surface-700 hover:bg-surface-50'
                  }`}
                >
                  {plan.cta.label}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-0.5" />
                </Link>

                <ul className="mt-8 space-y-3.5 border-t border-surface-200 pt-7">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" strokeWidth={2.5} />
                      <span className="text-sm leading-snug text-surface-600">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>

        <p className="mt-10 text-sm text-surface-400">
          Every account starts with $10 of AI advisor credit. No subscription required to check your
          lot.
        </p>
      </div>
    </section>
  );
}
