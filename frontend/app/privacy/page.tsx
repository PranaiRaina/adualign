import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Privacy Policy | ADUalign',
  description: 'What data ADUalign collects, how it is used, and your California privacy rights.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-0">
      <Header />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-surface-900">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-surface-400">Last updated: July 5, 2026</p>

          <div className="prose prose-slate mt-10 max-w-none prose-headings:font-bold prose-headings:text-surface-900 prose-p:text-surface-600 prose-li:text-surface-600 prose-a:text-brand-600">
            <p>
              This policy describes what ADUalign (&ldquo;we&rdquo;) collects when you use
              adualign.com, how we use it, and the rights you have over it. The short version: we
              collect what the product needs to work, we share it only with the service providers
              that run the product, and we do not sell it or use it for advertising.
            </p>

            <h2>1. What we collect</h2>
            <ul>
              <li>
                <strong>Account information</strong> — your email address and login credentials
                (managed by Supabase, our authentication provider).
              </li>
              <li>
                <strong>Property searches</strong> — the addresses and parcels you look up, and the
                projects and ADU designs you save.
              </li>
              <li>
                <strong>AI chat messages</strong> — the questions you ask the AI assistant and the
                parcel context needed to answer them.
              </li>
              <li>
                <strong>Purchase and credit history</strong> — what credits you bought and used.
                Payment card details go directly to Stripe; they never touch our servers.
              </li>
              <li>
                <strong>Messages you send us</strong> — anything submitted through the contact form.
              </li>
              <li>
                <strong>Basic technical logs</strong> — IP address, browser type, and request logs
                used for security and debugging.
              </li>
            </ul>

            <h2>2. How we use it</h2>
            <p>
              To provide and operate the Service (run feasibility analyses, save your projects,
              answer your chat questions), process payments, respond to your messages, keep the
              Service secure, and improve it. We do not sell your personal information, we do not
              share it for advertising, and we do not run third-party ad trackers.
            </p>

            <h2>3. Who we share it with</h2>
            <p>Only the service providers that run the product:</p>
            <ul>
              <li>
                <strong>Supabase</strong> — hosting, authentication, and database (account data,
                projects, chat history, credit ledger).
              </li>
              <li>
                <strong>Mapbox</strong> — map rendering and address search (the addresses you search
                and map interactions).
              </li>
              <li>
                <strong>OpenAI</strong> — powers the AI assistant (your chat messages and related
                parcel context are processed to generate answers).
              </li>
              <li>
                <strong>Stripe</strong> — payment processing (your payment details are handled
                entirely by Stripe).
              </li>
            </ul>
            <p>
              Beyond these providers, we disclose personal information only if required by law or to
              protect the Service and its users.
            </p>

            <h2>4. Cookies</h2>
            <p>
              We use only essential cookies — the session cookies that keep you signed in. No
              advertising or cross-site tracking cookies.
            </p>

            <h2>5. Retention and deletion</h2>
            <p>
              We keep your data while your account is active. To delete your account and personal
              information, send a request through our <Link href="/contact">contact form</Link> from
              the email on your account — we honor deletion requests within 45 days, except records
              we must keep for legal or accounting reasons (such as payment records).
            </p>

            <h2>6. Your California privacy rights</h2>
            <p>
              California residents have the right to know what personal information we hold about
              them, to ask us to correct it, and to ask us to delete it, without being discriminated
              against for exercising those rights. We do not sell or share personal information as
              defined by the CCPA/CPRA, so there is nothing to opt out of. To exercise any of these
              rights, send a request through our <Link href="/contact">contact form</Link> from the
              email on your account — we will respond within 45 days.
            </p>

            <h2>7. Security</h2>
            <p>
              We use reasonable technical and organizational measures to protect your data,
              including encrypted connections and access controls. No system is perfectly secure,
              and we cannot guarantee absolute security.
            </p>

            <h2>8. Children</h2>
            <p>
              The Service is not directed to anyone under 18, and we do not knowingly collect
              personal information from children.
            </p>

            <h2>9. Changes to this policy</h2>
            <p>
              If we change this policy, we will update the date at the top of this page and, for
              material changes, make reasonable efforts to notify you.
            </p>

            <h2>10. Contact</h2>
            <p>
              Privacy questions or requests: our <Link href="/contact">contact form</Link>.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
