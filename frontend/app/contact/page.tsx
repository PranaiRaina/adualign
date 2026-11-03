'use client';

/**
 * /contact — public "Get in touch" outreach page. Posts to the backend
 * /feedback endpoint (stored in the feedback table) with a fixed
 * topic="outreach", keeping general outreach separate from the in-app product
 * feedback captured by the feedback tab/panel. Works logged out; when logged in
 * the email field is prefilled and locked.
 */

import { useEffect, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { useAuth } from '@/lib/hooks/useAuth';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// This page is purely a get-in-touch channel. Product feedback (bug/feedback/
// question/other) is handled by the in-app feedback tab, so everything sent
// here is filed under a single "outreach" topic.
const OUTREACH_TOPIC = 'outreach';

export default function ContactPage() {
  const { user, isLoggedIn } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot, humans never see it
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user?.email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch(`${API_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ email, topic: OUTREACH_TOPIC, message, website }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-0">
      <Header />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-16">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-surface-900">
                Get in touch
              </h1>
              <p className="mt-4 text-surface-600 leading-relaxed max-w-md">
                Questions about your lot, partnerships, press, or anything else? Send us a message
                and we&apos;ll get back to you at the email you leave here.
              </p>
              <p className="mt-4 text-sm text-surface-400">
                We read every message. No newsletters, no spam.
              </p>
              <p className="mt-4 text-sm text-surface-500">
                Hit a bug or have product feedback? Use the{' '}
                <span className="font-medium text-surface-700">Feedback</span> tab on the right of
                any page.
              </p>
            </div>

            <div className="rounded-2xl border border-surface-200 bg-white p-6 md:p-8 shadow-sm">
              {status === 'sent' ? (
                <div className="flex flex-col items-center text-center py-10">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-emerald-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="mt-4 font-semibold text-surface-900">Message sent</p>
                  <p className="mt-1 text-sm text-surface-600">
                    Thanks for writing in. We read every message.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label
                      htmlFor="contact-email"
                      className="block text-sm font-semibold text-surface-900 mb-2"
                    >
                      Email
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      required
                      maxLength={320}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      readOnly={isLoggedIn}
                      placeholder="you@example.com"
                      className={`w-full rounded-lg border border-surface-200 px-3.5 py-2.5 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 ${
                        isLoggedIn ? 'bg-surface-50 text-surface-500' : 'bg-white'
                      }`}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="contact-message"
                      className="block text-sm font-semibold text-surface-900 mb-2"
                    >
                      Message
                    </label>
                    <textarea
                      id="contact-message"
                      required
                      rows={5}
                      maxLength={2000}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Tell us what's on your mind…"
                      className="w-full rounded-lg border border-surface-200 bg-white px-3.5 py-2.5 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 resize-y"
                    />
                  </div>

                  {/* Honeypot: visually hidden, bots fill it, backend drops those. */}
                  <input
                    type="text"
                    name="website"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="absolute -left-[9999px] h-0 w-0 opacity-0"
                  />

                  {status === 'error' && (
                    <p className="text-sm font-medium text-red-600">
                      Something went wrong sending your message. Please try again.
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={status === 'sending'}
                    className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {status === 'sending' && (
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    )}
                    {status === 'sending' ? 'Sending…' : 'Send message'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
