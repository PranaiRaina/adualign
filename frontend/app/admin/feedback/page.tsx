'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import { cn } from '@/components/ui/button';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

type FeedbackStatus = 'new' | 'in_progress' | 'resolved';

interface FeedbackItem {
  id: string;
  user_id: string | null;
  email: string;
  topic: string;
  message: string;
  status: FeedbackStatus;
  overdue: boolean;
  created_at: string;
}

interface FeedbackListResponse {
  feedback: FeedbackItem[];
  total: number;
  overdue_count: number;
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
];

const TOPIC_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All topics' },
  { value: 'outreach', label: 'Outreach' },
  { value: 'bug', label: 'Bug' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
];

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  resolved: 'bg-brand-50 text-brand-700 border-brand-200',
};

const TOPIC_STYLES: Record<string, string> = {
  outreach: 'bg-sky-50 text-sky-700',
  bug: 'bg-red-50 text-red-700',
  feedback: 'bg-brand-50 text-brand-700',
  question: 'bg-purple-50 text-purple-700',
  other: 'bg-surface-100 text-surface-600',
};

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [topicFilter, setTopicFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (topicFilter !== 'all') params.set('topic', topicFilter);
      const query = params.toString();
      const res = await fetch(`${API_URL}/admin/feedback${query ? `?${query}` : ''}`, {
        headers: { ...(await getAuthHeaders()) },
      });
      if (!res.ok) {
        throw new Error('Failed to load feedback');
      }
      const data = (await res.json()) as FeedbackListResponse;
      setItems(data.feedback);
      setTotal(data.total);
      setOverdueCount(data.overdue_count);
    } catch {
      setError('Could not load feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, topicFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (id: string, status: FeedbackStatus) => {
    setUpdatingId(id);
    const previous = items;
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status, overdue: false } : it)));
    try {
      const res = await fetch(`${API_URL}/admin/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update');
      const updated = (await res.json()) as FeedbackItem;
      setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
      // Overdue count may have changed; refresh the header counts quietly.
      void load();
    } catch {
      setItems(previous);
      setError('Could not update status. Please try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-surface-900">Feedback</h1>
          <p className="text-sm text-surface-500">
            {total} total submission{total === 1 ? '' : 's'}
            {overdueCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                <AlertTriangle className="h-3 w-3" />
                {overdueCount} overdue
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-2 rounded-md border border-surface-200 bg-surface-0 px-3 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-50"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-surface-200 bg-surface-0 p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                statusFilter === f.value
                  ? 'bg-brand-600 text-white'
                  : 'text-surface-500 hover:text-surface-800',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {TOPIC_FILTERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-[300px] items-center justify-center text-surface-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading feedback...
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-[300px] items-center justify-center text-surface-400 text-sm">
          No feedback matches these filters.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                'rounded-lg border bg-surface-0 p-4 shadow-sm',
                item.overdue ? 'border-red-300' : 'border-surface-200',
              )}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                    TOPIC_STYLES[item.topic] || TOPIC_STYLES.other,
                  )}
                >
                  {item.topic}
                </span>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs font-medium',
                    STATUS_STYLES[item.status],
                  )}
                >
                  {STATUS_OPTIONS.find((s) => s.value === item.status)?.label ?? item.status}
                </span>
                {item.overdue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    <AlertTriangle className="h-3 w-3" />
                    Overdue
                  </span>
                )}
                <span className="ml-auto text-xs text-surface-400">
                  {formatDate(item.created_at)}
                </span>
              </div>

              <p className="whitespace-pre-wrap text-sm text-surface-800">{item.message}</p>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-surface-100 pt-3">
                <span className="text-xs text-surface-500">
                  {item.email}
                  {item.user_id ? ' (registered user)' : ' (anonymous)'}
                </span>
                <div className="flex items-center gap-2">
                  {updatingId === item.id && (
                    <Loader2 className="h-4 w-4 animate-spin text-surface-400" />
                  )}
                  <select
                    value={item.status}
                    disabled={updatingId === item.id}
                    onChange={(e) => updateStatus(item.id, e.target.value as FeedbackStatus)}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
