import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Terms of Service | ADUalign',
  description: 'The terms that govern your use of ADUalign.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-0">
      <Header />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-surface-900">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-surface-400">Last updated: July 5, 2026</p>

          <div className="prose prose-slate mt-10 max-w-none prose-headings:font-bold prose-headings:text-surface-900 prose-p:text-surface-600 prose-li:text-surface-600 prose-a:text-brand-600">
            <h2>1. Agreement to these Terms</h2>
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and ADUalign
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using adualign.com
              (the &ldquo;Service&rdquo;), you agree to these Terms. If you do not agree, do not use
              the Service.
            </p>

            <h2>2. The Service</h2>
            <p>
              ADUalign provides ADU (accessory dwelling unit) feasibility analysis for California
              properties: parcel lookup, buildable-area visualization, interactive ADU placement,
              cost estimates, and an AI assistant for zoning and financing questions. You must be at
              least 18 years old to use the Service.
            </p>

            <h2>3. Accounts</h2>
            <p>
              You must provide accurate information when creating an account, keep your credentials
              secure, and you are responsible for all activity under your account. Tell us promptly
              via our <Link href="/contact">contact form</Link> if you believe your account has been
              compromised.
            </p>

            <h2>4. Credits and payments</h2>
            <p>
              Certain features consume credits. Credits are purchased through our payment processor,
              Stripe; current prices are listed on the <Link href="/pricing">pricing page</Link> and
              may change (changes never affect credits you already hold). Credits have no cash
              value, are not transferable, and may only be used within the Service.
            </p>
            <p>
              <strong>Refunds:</strong> credits that have been consumed are non-refundable. If you
              purchased credits and have not used any of them, you may request a full refund within
              14 days of purchase via our <Link href="/contact">contact form</Link>. Promotional or
              free credits carry no refund value and may be adjusted or expired by us at any time.
            </p>

            <h2>5. Informational purposes only — not professional advice</h2>
            <p>
              <strong>
                Everything the Service produces — feasibility verdicts, buildable-area geometry,
                setback figures, cost estimates, and AI assistant answers — is an informational
                estimate generated from public data and automated analysis. It is not legal,
                financial, tax, construction, architectural, or engineering advice, and it is not a
                guarantee that any project can be permitted or built.
              </strong>{' '}
              Public records can be outdated, incomplete, or wrong, and local regulations change.
              Before making any decision — purchasing property, hiring a contractor, applying for a
              permit — verify the facts with your city or county and consult licensed professionals.
              See our <Link href="/disclaimer">Disclaimer</Link> for details.
            </p>

            <h2>6. AI features</h2>
            <p>
              The AI assistant generates answers automatically. It can be inaccurate, incomplete, or
              out of date, even when it sounds confident. Do not rely on it as your sole source for
              any important decision.
            </p>

            <h2>7. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>use the Service for anything unlawful;</li>
              <li>scrape, bulk-export, or systematically harvest data from the Service;</li>
              <li>resell, redistribute, or commercially exploit our data or analysis outputs;</li>
              <li>reverse engineer the Service or attempt to access non-public systems;</li>
              <li>circumvent credit limits, rate limits, or access controls;</li>
              <li>abuse the AI assistant, including attempts to extract other users&apos; data.</li>
            </ul>

            <h2>8. Your content and our property</h2>
            <p>
              You keep ownership of the projects and designs you create. You grant us the license
              needed to host, process, and display them back to you — that is, to operate the
              Service. The Service itself — software, design, data compilations, and the ADUalign
              brand — belongs to us, and these Terms grant you no rights in it beyond normal use.
            </p>

            <h2>9. Third-party services</h2>
            <p>
              The Service is built on third-party providers, including Supabase (hosting and
              authentication), Mapbox (maps and address search), OpenAI (AI assistant), and Stripe
              (payments). Their availability affects ours, and their terms may apply to their
              portions of the Service.
            </p>

            <h2>10. Disclaimer of warranties</h2>
            <p>
              <strong>
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
                warranties of any kind, express or implied, including accuracy, merchantability,
                fitness for a particular purpose, and non-infringement.
              </strong>{' '}
              We do not warrant that the Service will be uninterrupted, error-free, or that its
              outputs are accurate or complete.
            </p>

            <h2>11. Limitation of liability</h2>
            <p>
              <strong>
                To the maximum extent permitted by law, ADUalign will not be liable for any
                indirect, incidental, special, consequential, or punitive damages, or for any loss
                arising from decisions you make in reliance on the Service — including property
                purchases, construction projects, and permit applications. Our total liability for
                any claim relating to the Service is limited to the greater of $100 or the amount
                you paid us in the 12 months before the claim arose.
              </strong>
            </p>

            <h2>12. Termination</h2>
            <p>
              You may stop using the Service at any time, and you may request deletion of your
              account via our <Link href="/contact">contact form</Link>. We may suspend or terminate
              accounts that violate these Terms. Sections 5, 8, 10, 11, and 14 survive termination.
            </p>

            <h2>13. Changes to these Terms</h2>
            <p>
              We may update these Terms. We will update the date at the top of this page, and for
              material changes we will make reasonable efforts to notify you (for example, by email
              or an in-product notice). Continuing to use the Service after changes take effect
              means you accept them.
            </p>

            <h2>14. Governing law</h2>
            <p>
              These Terms are governed by the laws of the State of California, and disputes will be
              resolved in the state or federal courts located in California.
            </p>

            <h2>15. Contact</h2>
            <p>
              Questions about these Terms? Reach us through our{' '}
              <Link href="/contact">contact form</Link>.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
