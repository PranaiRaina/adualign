import Link from 'next/link';
import { ENABLE_LISTING_MARKETPLACE, PRICING_ENABLED } from '@/lib/utils/constants';
import { LogoMark } from '@/components/layout/LogoMark';

export function Footer() {
  return (
    <footer className="bg-surface-0 border-t border-surface-200 py-16">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row md:flex-wrap gap-12 md:gap-20">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2 mb-6 h-8">
              <LogoMark />
              <span className="text-xl font-extrabold text-surface-900 tracking-tight">
                ADUalign
              </span>
            </Link>
            <p className="text-surface-500 text-sm leading-relaxed max-w-xs">
              Instant ADU feasibility for any California property. Get a lot verdict, a project cost
              estimate, and an AI advisor for regulation and financing questions, grounded in state
              HCD code.
            </p>
          </div>

          <div>
            <h4 className="flex items-center h-8 font-bold text-surface-900 mb-6 uppercase text-xs tracking-widest">
              Platform
            </h4>
            <ul className="space-y-4">
              {ENABLE_LISTING_MARKETPLACE && (
                <li>
                  <Link
                    href="/marketplace"
                    className="text-sm text-surface-600 hover:text-brand-600 font-medium transition-colors"
                  >
                    Browse ADUs
                  </Link>
                </li>
              )}
              <li>
                <Link
                  href="/map"
                  className="text-sm text-surface-600 hover:text-brand-600 font-medium transition-colors"
                >
                  Check My Lot
                </Link>
              </li>
              <li>
                <Link
                  href="/projects"
                  className="text-sm text-surface-600 hover:text-brand-600 font-medium transition-colors"
                >
                  My Projects
                </Link>
              </li>
              {ENABLE_LISTING_MARKETPLACE && (
                <li>
                  <Link
                    href="/onboarding"
                    className="text-sm text-surface-600 hover:text-brand-600 font-medium transition-colors"
                  >
                    List Your Property
                  </Link>
                </li>
              )}
              {PRICING_ENABLED && (
                <li>
                  <Link
                    href="/pricing"
                    className="text-sm text-surface-600 hover:text-brand-600 font-medium transition-colors"
                  >
                    Pricing
                  </Link>
                </li>
              )}
            </ul>
          </div>

          <div>
            <h4 className="flex items-center h-8 font-bold text-surface-900 mb-6 uppercase text-xs tracking-widest">
              Company
            </h4>
            <ul className="space-y-4">
              <li>
                <Link
                  href="#"
                  className="text-sm text-surface-600 hover:text-brand-600 font-medium transition-colors"
                >
                  About
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="text-sm text-surface-600 hover:text-brand-600 font-medium transition-colors"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-surface-200 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-surface-400 text-sm">
            © {new Date().getFullYear()} ADUalign. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link
              href="/terms"
              className="text-sm text-surface-400 hover:text-surface-900 transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-sm text-surface-400 hover:text-surface-900 transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/disclaimer"
              className="text-sm text-surface-400 hover:text-surface-900 transition-colors"
            >
              Disclaimer
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
