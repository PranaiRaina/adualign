'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/ui/button';
import { useAuth } from '@/lib/hooks/useAuth';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const TOPICS: { value: string; label: string }[] = [
  { value: 'feedback', label: 'General feedback' },
  { value: 'bug', label: 'Report a bug' },
  { value: 'question', label: 'Ask a question' },
  { value: 'other', label: 'Something else' },
];

interface FeedbackPanelProps {
  open: boolean;
  onClose: () => void;
}

export function FeedbackPanel({ open, onClose }: FeedbackPanelProps) {
  const { user } = useAuth();
  const [topic, setTopic] = useState('feedback');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && user?.email) {
      setEmail((prev) => prev || user.email);
    }
  }, [open, user?.email]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const resetForm = () => {
    setTopic('feedback');
    setMessage('');
    setWebsite('');
    setStatus('idle');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setError(null);

    try {
      const res = await fetch(`${API_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ email: email.trim(), topic, message: message.trim(), website }),
      });

      if (!res.ok) {
        const detail =
          res.status === 429
            ? 'Too many messages. Please try again later.'
            : 'Could not send your feedback. Please check your details and try again.';
        setError(detail);
        setStatus('error');
        return;
      }

      setStatus('success');
    } catch {
      setError('Network error. Please try again.');
      setStatus('error');
    }
  };

  const close = () => {
    onClose();
    // Give the panel time to animate out before clearing state.
    window.setTimeout(resetForm, 250);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-slate-900/30 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Send feedback"
            className="fixed right-0 top-0 z-[61] flex h-full w-full max-w-md flex-col bg-surface-0 shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="flex items-center justify-between border-b border-surface-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-surface-900">Send us feedback</h2>
                <p className="text-sm text-surface-500">
                  Found a bug or have an idea? We read everything.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close feedback panel"
                className="rounded-md p-2 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {status === 'success' ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-brand-500" />
                <div>
                  <p className="text-lg font-semibold text-surface-900">Thanks for the feedback!</p>
                  <p className="text-sm text-surface-500">We appreciate you taking the time.</p>
                </div>
                <Button variant="outline" onClick={close}>
                  Done
                </Button>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
              >
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-surface-700">Topic</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TOPICS.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setTopic(t.value)}
                        className={cn(
                          'rounded-md border px-3 py-2 text-sm transition-colors',
                          topic === t.value
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-surface-200 bg-surface-0 text-surface-600 hover:border-surface-300',
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="feedback-email" className="text-sm font-medium text-surface-700">
                    Email
                  </label>
                  <Input
                    id="feedback-email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="feedback-message"
                    className="text-sm font-medium text-surface-700"
                  >
                    Message
                  </label>
                  <textarea
                    id="feedback-message"
                    required
                    maxLength={2000}
                    placeholder="Tell us what's on your mind..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-h-[140px] flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <span className="self-end text-xs text-surface-400">{message.length}/2000</span>
                </div>

                {/* Honeypot: hidden from humans, bots tend to fill it. */}
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="hidden"
                />

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button
                  type="submit"
                  disabled={status === 'submitting' || !message.trim() || !email.trim()}
                  className="w-full"
                >
                  {status === 'submitting' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...
                    </>
                  ) : (
                    'Send feedback'
                  )}
                </Button>
              </form>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
