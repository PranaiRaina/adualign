import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Disclaimer | ADUalign',
  description:
    'ADUalign outputs are informational estimates, not legal, financial, or construction advice.',
};

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-0">
      <Header />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-surface-900">
            Disclaimer
          </h1>
          <p className="mt-3 text-sm text-surface-400">Last updated: July 5, 2026</p>

          <div className="prose prose-slate mt-10 max-w-none prose-headings:font-bold prose-headings:text-surface-900 prose-p:text-surface-600 prose-a:text-brand-600">
            <h2>Estimates, not advice</h2>
            <p>
              Everything ADUalign produces — feasibility verdicts, buildable-area maps, setback
              figures, cost estimates, and AI assistant answers — is an informational estimate
              generated from public records and automated analysis.{' '}
              <strong>
                It is not legal, financial, tax, construction, architectural, or engineering advice,
                and it is not a guarantee that any project can be permitted or built.
              </strong>
            </p>

            <h2>Public data has limits</h2>
            <p>
              Our analysis relies on parcel records, zoning data, and regulations published by
              government sources. That data can be outdated, incomplete, or simply wrong, and local
              rules change frequently. A verdict that is accurate today may not be tomorrow.
            </p>

            <h2>AI can be wrong</h2>
            <p>
              The AI assistant generates answers automatically. It can be inaccurate or out of date
              even when it sounds confident. Double-check important details.
            </p>

            <h2>Verify before you act</h2>
            <p>
              Before making any real decision — buying a property, hiring a contractor, applying for
              a permit — confirm the facts with your city or county planning department and consult
              licensed professionals. If you spot data that looks wrong, please tell us via the{' '}
              <Link href="/contact">contact form</Link>.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
