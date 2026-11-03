'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/utils/supabase/client';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  Coins,
  DollarSign,
  MapPin,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Users,
  XCircle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface AdminUserUsage {
  id: string;
  email: string;
  name: string;
  cost_used_micros: number;
  cost_budget_micros: number;
  total_tokens_used: number;
  map_search_count: number;
  address_credit_balance: number;
  is_exhausted: boolean;
  created_at: string;
}

interface AdminUsageSettings {
  chat_budget_micros: number;
  usage_reset_interval_days: number | null;
}

interface ServiceCreditTransaction {
  transaction_id: string;
  delta: number;
  reason: string;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}

interface ServiceCreditHistory {
  balance: number;
  transactions: ServiceCreditTransaction[];
}

const BUDGET_ADJUSTMENT_STEP_MICROS = 5_000_000;

type UserStatus = 'healthy' | 'warning' | 'exhausted' | 'none';
type StatusFilter = 'all' | 'healthy' | 'warning' | 'exhausted';

function getUserStatus(u: AdminUserUsage): UserStatus {
  if (!u.cost_budget_micros) return 'none';
  if (u.is_exhausted || u.cost_used_micros >= u.cost_budget_micros) return 'exhausted';
  if (u.cost_used_micros / u.cost_budget_micros >= 0.75) return 'warning';
  return 'healthy';
}

function getPercent(u: AdminUserUsage): number {
  if (!u.cost_budget_micros) return 0;
  return Math.min((u.cost_used_micros / u.cost_budget_micros) * 100, 100);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatUsd(micros: number): string {
  const dollars = Math.max(0, micros) / 1_000_000;
  if (dollars >= 100) return `$${Math.round(dollars).toLocaleString()}`;
  return `$${dollars.toFixed(2)}`;
}

function microsToDollarInput(micros: number): string {
  return (Math.max(0, micros) / 1_000_000).toFixed(2);
}

function dollarsToMicros(value: string): number | null {
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 1_000_000);
}

function formatTransactionReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

const AVATAR_PALETTES = [
  'bg-sky-50 text-sky-700 border-sky-100',
  'bg-violet-50 text-violet-700 border-violet-100',
  'bg-rose-50 text-rose-600 border-rose-100',
  'bg-teal-50 text-teal-700 border-teal-100',
  'bg-orange-50 text-orange-600 border-orange-100',
];

function avatarPalette(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

const STATUS_META: Record<
  UserStatus,
  {
    label: string;
    chipCls: string;
    bar: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  healthy: {
    label: 'Healthy',
    chipCls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'bg-emerald-500',
    Icon: CheckCircle2,
  },
  warning: {
    label: 'At 75%+',
    chipCls: 'bg-amber-50 text-amber-700 border-amber-200',
    bar: 'bg-amber-500',
    Icon: AlertTriangle,
  },
  exhausted: {
    label: 'Exhausted',
    chipCls: 'bg-red-50 text-red-700 border-red-200',
    bar: 'bg-red-500',
    Icon: XCircle,
  },
  none: {
    label: 'No data',
    chipCls: 'bg-surface-50 text-surface-400 border-surface-200',
    bar: 'bg-surface-200',
    Icon: Activity,
  },
};

export default function AdminDashboardPage() {
  const supabaseRef = useRef(createClient());
  const [users, setUsers] = useState<AdminUserUsage[]>([]);
  const [globalSettings, setGlobalSettings] = useState<AdminUsageSettings | null>(null);
  const [globalBudgetDollars, setGlobalBudgetDollars] = useState('');
  const [globalResetIntervalDays, setGlobalResetIntervalDays] = useState('');
  const [isSavingGlobalSettings, setIsSavingGlobalSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetOk, setResetOk] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [expandedCreditUserId, setExpandedCreditUserId] = useState<string | null>(null);
  const [creditHistory, setCreditHistory] = useState<Record<string, ServiceCreditHistory>>({});
  const [creditHistoryLoadingId, setCreditHistoryLoadingId] = useState<string | null>(null);
  const [creditGrantAmounts, setCreditGrantAmounts] = useState<Record<string, string>>({});
  const [creditGrantLoadingId, setCreditGrantLoadingId] = useState<string | null>(null);
  const [grantAllAmount, setGrantAllAmount] = useState('');
  const [isGrantingAll, setIsGrantingAll] = useState(false);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabaseRef.current.auth.getSession();
      if (!session?.access_token) {
        setError('Session expired. Please refresh the page.');
        return;
      }
      const res = await fetch(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setError(`Failed to load users (${res.status}).`);
        return;
      }
      const data = await res.json();
      setUsers(data.users ?? data ?? []);
      if (data.global_settings) {
        setGlobalSettings(data.global_settings);
        setGlobalBudgetDollars(microsToDollarInput(data.global_settings.chat_budget_micros ?? 0));
        setGlobalResetIntervalDays(
          data.global_settings.usage_reset_interval_days == null
            ? ''
            : String(data.global_settings.usage_reset_interval_days),
        );
      }
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleReset = async (userId: string) => {
    setConfirmingId(null);
    setResettingId(userId);
    try {
      const res = await fetch(`${API_URL}/admin/users/${userId}/reset-usage`, {
        method: 'POST',
        headers: await getAuthHeaders(),
      });
      if (res.ok) {
        setResetOk(userId);
        setTimeout(() => setResetOk(null), 3000);
        void fetchUsers();
      } else {
        setError(`Reset failed (${res.status}).`);
      }
    } catch {
      setError('Reset request failed. Check your connection.');
    } finally {
      setResettingId(null);
    }
  };

  const handleAdjust = async (userId: string, deltaMicros: number) => {
    setAdjustingId(userId);
    try {
      const res = await fetch(`${API_URL}/admin/users/${userId}/adjust-budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ delta_micros: deltaMicros }),
      });
      if (res.ok) {
        void fetchUsers();
      } else {
        setError(`Budget adjustment failed (${res.status}).`);
      }
    } catch {
      setError('Budget adjustment request failed. Check your connection.');
    } finally {
      setAdjustingId(null);
    }
  };

  const handleGlobalSettingsSave = async () => {
    const chatBudgetMicros = dollarsToMicros(globalBudgetDollars);
    if (chatBudgetMicros == null) {
      setError('Global chat budget must be a non-negative dollar amount.');
      return;
    }

    const resetIntervalText = globalResetIntervalDays.trim();
    const usageResetIntervalDays = resetIntervalText === '' ? null : Number(resetIntervalText);
    if (
      usageResetIntervalDays !== null &&
      (!Number.isInteger(usageResetIntervalDays) || usageResetIntervalDays < 1)
    ) {
      setError('Reset interval must be a positive whole number, or blank to disable resets.');
      return;
    }

    setIsSavingGlobalSettings(true);
    try {
      const res = await fetch(`${API_URL}/admin/usage-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({
          chat_budget_micros: chatBudgetMicros,
          usage_reset_interval_days: usageResetIntervalDays,
        }),
      });
      if (!res.ok) {
        setError(`Global settings update failed (${res.status}).`);
        return;
      }

      const result = await res.json();
      setGlobalSettings(result.global_settings);
      await fetchUsers();
    } catch {
      setError('Global settings request failed. Check your connection.');
    } finally {
      setIsSavingGlobalSettings(false);
    }
  };

  const fetchCreditHistory = async (userId: string) => {
    setCreditHistoryLoadingId(userId);
    try {
      const res = await fetch(`${API_URL}/admin/users/${userId}/service-credits`, {
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        setError(`Credit history failed to load (${res.status}).`);
        return;
      }
      const history: ServiceCreditHistory = await res.json();
      setCreditHistory((current) => ({ ...current, [userId]: history }));
    } catch {
      setError('Credit history request failed. Check your connection.');
    } finally {
      setCreditHistoryLoadingId(null);
    }
  };

  const toggleCreditHistory = (userId: string) => {
    const isClosing = expandedCreditUserId === userId;
    setExpandedCreditUserId(isClosing ? null : userId);
    if (!isClosing && !creditHistory[userId]) void fetchCreditHistory(userId);
  };

  const handleCreditGrant = async (userId: string) => {
    const amount = Number(creditGrantAmounts[userId]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      setError('Credit grant must be a whole number between 1 and 1,000,000.');
      return;
    }

    setCreditGrantLoadingId(userId);
    try {
      const res = await fetch(`${API_URL}/admin/users/${userId}/service-credits/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ amount, idempotency_key: crypto.randomUUID() }),
      });
      if (!res.ok) {
        setError(`Credit grant failed (${res.status}).`);
        return;
      }
      setCreditGrantAmounts((current) => ({ ...current, [userId]: '' }));
      await Promise.all([fetchUsers(), fetchCreditHistory(userId)]);
    } catch {
      setError('Credit grant request failed. Check your connection.');
    } finally {
      setCreditGrantLoadingId(null);
    }
  };

  const handleGrantAll = async () => {
    const amount = Number(grantAllAmount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      setError('Credit grant must be a whole number between 1 and 1,000,000.');
      return;
    }
    if (!window.confirm(`Add ${amount} map credits to every account?`)) return;

    setIsGrantingAll(true);
    try {
      const res = await fetch(`${API_URL}/admin/service-credits/grant-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ amount, idempotency_key: crypto.randomUUID() }),
      });
      if (!res.ok) {
        setError(`Bulk credit grant failed (${res.status}).`);
        return;
      }
      setGrantAllAmount('');
      await fetchUsers();
    } catch {
      setError('Bulk credit grant request failed. Check your connection.');
    } finally {
      setIsGrantingAll(false);
    }
  };

  const totalUsers = users.length;
  const exhaustedCount = users.filter((u) => getUserStatus(u) === 'exhausted').length;
  const warningCount = users.filter((u) => getUserStatus(u) === 'warning').length;
  const totalSearches = users.reduce((sum, u) => sum + (u.map_search_count || 0), 0);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !search || (u.name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || getUserStatus(u) === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const FILTER_TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: totalUsers },
    {
      key: 'healthy',
      label: 'Healthy',
      count: users.filter((u) => getUserStatus(u) === 'healthy').length,
    },
    { key: 'warning', label: 'Warning', count: warningCount },
    { key: 'exhausted', label: 'Exhausted', count: exhaustedCount },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-surface-400 mb-2">
            Admin
          </p>
          <p className="text-2xl font-bold text-surface-900 tracking-tight">Users</p>
          <p className="text-sm text-surface-500 mt-1">
            Monitor AI budgets and address credits from one place.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchUsers()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-surface-700 border border-surface-200 bg-surface-0 rounded-lg hover:bg-surface-50 transition-colors shadow-sm shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-600 text-base leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Aggregate stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCell icon={Users} label="Total users" value={isLoading ? '—' : String(totalUsers)} />
        <StatCell
          icon={MapPin}
          label="Property searches"
          value={isLoading ? '—' : formatTokens(totalSearches)}
          accent="emerald"
        />
        <StatCell
          icon={XCircle}
          label="At limit"
          value={isLoading ? '—' : String(exhaustedCount)}
          accent="red"
        />
        <StatCell
          icon={AlertTriangle}
          label="75%+ used"
          value={isLoading ? '—' : String(warningCount)}
          accent="amber"
        />
      </div>

      <GlobalUsageSettingsPanel
        budgetDollars={globalBudgetDollars}
        resetIntervalDays={globalResetIntervalDays}
        isSaving={isSavingGlobalSettings}
        isDisabled={!globalSettings || isLoading}
        onBudgetDollarsChange={setGlobalBudgetDollars}
        onResetIntervalDaysChange={setGlobalResetIntervalDays}
        onSave={() => void handleGlobalSettingsSave()}
        grantAllAmount={grantAllAmount}
        isGrantingAll={isGrantingAll}
        onGrantAllAmountChange={setGrantAllAmount}
        onGrantAll={() => void handleGrantAll()}
      />

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm border border-surface-200 rounded-lg bg-surface-0 text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-surface-900 transition-shadow"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-lg">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                statusFilter === tab.key
                  ? 'bg-surface-0 text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-1.5 tabular-nums ${
                    statusFilter === tab.key ? 'text-surface-500' : 'text-surface-400'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Users list */}
      {isLoading ? (
        <UserListSkeleton />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-surface-0 rounded-2xl border border-dashed border-surface-200 text-center">
          <div className="w-12 h-12 bg-surface-50 border border-surface-200 rounded-xl flex items-center justify-center mb-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <Users className="w-5 h-5 text-surface-400" />
          </div>
          <p className="text-sm font-bold text-surface-900 mb-1">
            {search || statusFilter !== 'all' ? 'No users match your filters' : 'No users yet'}
          </p>
          {(search || statusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
              }}
              className="mt-3 text-sm text-brand-600 font-semibold hover:text-brand-700 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-surface-0 rounded-2xl border border-surface-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="divide-y divide-surface-100">
            {filtered.map((user) => {
              const status = getUserStatus(user);
              const pct = getPercent(user);
              const meta = STATUS_META[status];
              const isConfirming = confirmingId === user.id;
              const isResetting = resettingId === user.id;
              const wasReset = resetOk === user.id;
              const isAdjusting = adjustingId === user.id;
              const canDecreaseBudget = user.cost_budget_micros > 0;
              const avatarCls = avatarPalette(user.id);
              const usageAmountLabel = `${formatUsd(user.cost_used_micros)} / ${formatUsd(
                user.cost_budget_micros,
              )}`;

              return (
                <div
                  key={user.id}
                  className={`group transition-colors ${
                    isConfirming ? 'bg-amber-50/50' : 'hover:bg-surface-50/70'
                  }`}
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    {/* Avatar */}
                    <div
                      className={`w-9 h-9 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${avatarCls}`}
                    >
                      {getInitials(user.name || user.email)}
                    </div>

                    {/* Name / email */}
                    <div className="min-w-0 w-44 shrink-0">
                      <p className="text-sm font-semibold text-surface-900 truncate leading-none mb-0.5">
                        {user.name || '—'}
                      </p>
                      <p className="text-[11px] text-surface-400 truncate">{user.email}</p>
                    </div>

                    {/* Usage bar */}
                    <div className="flex-1 min-w-[100px]">
                      {user.cost_budget_micros > 0 ? (
                        <>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex min-w-0 items-baseline gap-2">
                              <span className="text-[11px] font-semibold text-surface-500 tabular-nums">
                                {Math.round(pct)}%
                              </span>
                              <span
                                className="truncate text-[11px] font-medium text-surface-400 tabular-nums"
                                title={usageAmountLabel}
                              >
                                {usageAmountLabel}
                              </span>
                            </div>
                            <span className="text-[11px] text-surface-400 tabular-nums">
                              {formatTokens(user.total_tokens_used)} tokens
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-surface-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${meta.bar}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <span className="text-[11px] text-surface-400">No usage data</span>
                      )}
                    </div>

                    {/* Property searches */}
                    <div className="w-20 shrink-0 hidden md:block">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-surface-400 mb-0.5">
                        Searches
                      </p>
                      <p className="text-xs font-semibold text-surface-700 tabular-nums flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-surface-400 shrink-0" />
                        {user.map_search_count.toLocaleString()}
                      </p>
                    </div>

                    {/* Address credits */}
                    <button
                      type="button"
                      onClick={() => toggleCreditHistory(user.id)}
                      className="w-20 md:w-24 shrink-0 flex items-center justify-between rounded-lg border border-surface-200 bg-surface-0 px-2.5 py-2 text-left hover:border-surface-300 hover:bg-surface-50"
                      aria-expanded={expandedCreditUserId === user.id}
                    >
                      <span>
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-surface-400">
                          Credits
                        </span>
                        <span className="flex items-center gap-1 text-xs font-semibold text-surface-700 tabular-nums">
                          <Coins className="h-3 w-3 text-emerald-500" />
                          {user.address_credit_balance.toLocaleString()}
                        </span>
                      </span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-surface-400 transition-transform ${
                          expandedCreditUserId === user.id ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {/* Budget adjustment */}
                    <div className="w-28 shrink-0 hidden lg:block">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-surface-400 mb-1">
                        Limit
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!canDecreaseBudget || isAdjusting}
                          onClick={() => void handleAdjust(user.id, -BUDGET_ADJUSTMENT_STEP_MICROS)}
                          title="Lower this user's lifetime limit by $5"
                          className="inline-flex items-center justify-center w-8 h-7 text-xs font-bold text-amber-700 border border-amber-200 bg-amber-50 rounded-md hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          −$5
                        </button>
                        <button
                          type="button"
                          disabled={isAdjusting}
                          onClick={() => void handleAdjust(user.id, BUDGET_ADJUSTMENT_STEP_MICROS)}
                          title="Raise this user's lifetime limit by $5"
                          className="inline-flex items-center justify-center w-8 h-7 text-xs font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-md hover:bg-emerald-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          +$5
                        </button>
                      </div>
                    </div>

                    {/* Status chip */}
                    <div className="shrink-0 hidden sm:block">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-full border ${meta.chipCls}`}
                      >
                        <meta.Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                    </div>

                    {/* Reset action */}
                    <div className="shrink-0 ml-2 min-w-[110px] flex justify-end">
                      {wasReset ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Reset
                        </span>
                      ) : isConfirming ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-surface-700 whitespace-nowrap">
                            Confirm?
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleReset(user.id)}
                            className="px-2.5 py-1.5 text-xs font-bold text-surface-0 bg-surface-900 border border-surface-900 rounded-lg hover:bg-surface-700 transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            className="px-2.5 py-1.5 text-xs font-bold text-surface-600 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : isResetting ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-surface-500 bg-surface-50 border border-surface-200 rounded-lg">
                          <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                          Resetting
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingId(user.id)}
                          className={`px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors ${
                            status === 'exhausted'
                              ? 'text-red-700 border-red-200 bg-red-50 hover:bg-red-100'
                              : 'text-surface-600 border-surface-200 bg-surface-0 hover:border-surface-300 hover:bg-surface-50 opacity-0 group-hover:opacity-100 focus:opacity-100'
                          }`}
                        >
                          Reset limit
                        </button>
                      )}
                    </div>
                  </div>
                  {expandedCreditUserId === user.id && (
                    <CreditHistoryPanel
                      history={creditHistory[user.id]}
                      isLoading={creditHistoryLoadingId === user.id}
                      grantAmount={creditGrantAmounts[user.id] ?? ''}
                      isGranting={creditGrantLoadingId === user.id}
                      onGrantAmountChange={(value) =>
                        setCreditGrantAmounts((current) => ({
                          ...current,
                          [user.id]: value,
                        }))
                      }
                      onGrant={() => void handleCreditGrant(user.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalUsageSettingsPanel({
  budgetDollars,
  resetIntervalDays,
  isSaving,
  isDisabled,
  onBudgetDollarsChange,
  onResetIntervalDaysChange,
  onSave,
  grantAllAmount,
  isGrantingAll,
  onGrantAllAmountChange,
  onGrantAll,
}: {
  budgetDollars: string;
  resetIntervalDays: string;
  isSaving: boolean;
  isDisabled: boolean;
  onBudgetDollarsChange: (value: string) => void;
  onResetIntervalDaysChange: (value: string) => void;
  onSave: () => void;
  grantAllAmount: string;
  isGrantingAll: boolean;
  onGrantAllAmountChange: (value: string) => void;
  onGrantAll: () => void;
}) {
  return (
    <div className="rounded-xl border border-surface-200 bg-surface-0 px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Settings className="h-4 w-4 text-surface-500" />
            <p className="text-sm font-bold text-surface-900">Global usage settings</p>
          </div>
          <p className="text-xs font-medium text-surface-500">
            Saving applies these values to all active users and future users.
          </p>
        </div>

        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(11rem,14rem)_minmax(12rem,16rem)_auto] lg:max-w-2xl">
          <label className="min-w-0">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-surface-400">
              Chat budget
            </span>
            <span className="relative block">
              <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
              <input
                type="number"
                min={0}
                step="0.01"
                value={budgetDollars}
                disabled={isDisabled || isSaving}
                onChange={(event) => onBudgetDollarsChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-surface-200 bg-surface-0 pl-9 pr-3 text-sm font-semibold tabular-nums text-surface-900 focus:outline-none focus:ring-1 focus:ring-surface-900 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </span>
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-surface-400">
              Reset interval
            </span>
            <span className="relative block">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
              <input
                type="number"
                min={1}
                step={1}
                value={resetIntervalDays}
                disabled={isDisabled || isSaving}
                onChange={(event) => onResetIntervalDaysChange(event.target.value)}
                placeholder="Disabled"
                className="h-10 w-full rounded-lg border border-surface-200 bg-surface-0 pl-9 pr-3 text-sm font-semibold tabular-nums text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-surface-900 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </span>
          </label>

          <button
            type="button"
            onClick={onSave}
            disabled={isDisabled || isSaving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-surface-900 px-4 text-sm font-bold text-surface-0 transition-colors hover:bg-surface-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-surface-100 pt-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-surface-500" />
            <p className="text-sm font-bold text-surface-900">Grant map credits to all users</p>
          </div>
          <p className="text-xs font-medium text-surface-500">
            Adds the amount to every account&apos;s address credit balance once.
          </p>
        </div>

        <div className="flex gap-3 lg:max-w-2xl">
          <input
            type="number"
            min={1}
            max={1_000_000}
            step={1}
            value={grantAllAmount}
            disabled={isDisabled || isGrantingAll}
            onChange={(event) => onGrantAllAmountChange(event.target.value)}
            placeholder="Amount"
            className="h-10 w-40 rounded-lg border border-surface-200 bg-surface-0 px-3 text-sm font-semibold tabular-nums text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-surface-900 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onGrantAll}
            disabled={isDisabled || isGrantingAll || !grantAllAmount}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-surface-900 px-4 text-sm font-bold text-surface-0 transition-colors hover:bg-surface-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGrantingAll ? 'Adding…' : 'Add to all'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreditHistoryPanel({
  history,
  isLoading,
  grantAmount,
  isGranting,
  onGrantAmountChange,
  onGrant,
}: {
  history: ServiceCreditHistory | undefined;
  isLoading: boolean;
  grantAmount: string;
  isGranting: boolean;
  onGrantAmountChange: (value: string) => void;
  onGrant: () => void;
}) {
  return (
    <div className="border-t border-surface-100 bg-surface-50/70 px-5 py-4">
      <div className="ml-0 md:ml-[13rem] grid gap-4 lg:grid-cols-[14rem_1fr]">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-surface-500">
            Grant address credits
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={1_000_000}
              step={1}
              value={grantAmount}
              onChange={(event) => onGrantAmountChange(event.target.value)}
              placeholder="Amount"
              className="h-9 min-w-0 flex-1 rounded-lg border border-surface-200 bg-surface-0 px-3 text-sm tabular-nums text-surface-900 focus:outline-none focus:ring-1 focus:ring-surface-900"
            />
            <button
              type="button"
              onClick={onGrant}
              disabled={isGranting || !grantAmount}
              className="h-9 rounded-lg bg-surface-900 px-3 text-xs font-bold text-surface-0 hover:bg-surface-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isGranting ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-surface-500">
              Recent transactions
            </p>
            {history && (
              <span className="text-xs font-semibold text-surface-600 tabular-nums">
                Balance: {history.balance.toLocaleString()}
              </span>
            )}
          </div>
          {isLoading ? (
            <p className="py-3 text-xs text-surface-400">Loading transactions…</p>
          ) : !history?.transactions.length ? (
            <p className="py-3 text-xs text-surface-400">No credit transactions yet.</p>
          ) : (
            <div className="max-h-44 divide-y divide-surface-100 overflow-y-auto rounded-lg border border-surface-200 bg-surface-0">
              {history.transactions.map((transaction) => (
                <div
                  key={transaction.transaction_id}
                  className="flex items-center gap-3 px-3 py-2 text-xs"
                >
                  <span
                    className={`w-10 font-bold tabular-nums ${
                      transaction.delta > 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {transaction.delta > 0 ? '+' : ''}
                    {transaction.delta}
                  </span>
                  <span className="min-w-0 flex-1 capitalize text-surface-700">
                    {formatTransactionReason(transaction.reason)}
                  </span>
                  <span className="hidden text-surface-400 sm:block">{transaction.actor_type}</span>
                  <time className="text-surface-400" dateTime={transaction.created_at}>
                    {new Date(transaction.created_at).toLocaleDateString()}
                  </time>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: 'red' | 'amber' | 'emerald';
}) {
  const iconCls =
    accent === 'red'
      ? 'text-red-500'
      : accent === 'amber'
        ? 'text-amber-500'
        : accent === 'emerald'
          ? 'text-emerald-500'
          : 'text-surface-500';

  return (
    <div className="bg-surface-0 px-5 py-4 rounded-xl border border-surface-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-center gap-4">
      <div className="w-9 h-9 rounded-lg bg-surface-50 border border-surface-100 flex items-center justify-center shrink-0">
        <Icon className={`w-4 h-4 ${iconCls}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-surface-400 leading-none mb-1">
          {label}
        </p>
        <p className="text-xl font-bold text-surface-900 tabular-nums tracking-tight">{value}</p>
      </div>
    </div>
  );
}

function UserListSkeleton() {
  return (
    <div className="bg-surface-0 rounded-2xl border border-surface-200 overflow-hidden animate-pulse">
      <div className="divide-y divide-surface-100">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="w-9 h-9 rounded-full bg-surface-100 shrink-0" />
            <div className="w-44 space-y-1.5 shrink-0">
              <div className="h-4 w-28 bg-surface-200 rounded" />
              <div className="h-3 w-36 bg-surface-100 rounded" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex justify-between">
                <div className="h-3 w-8 bg-surface-100 rounded" />
                <div className="h-3 w-16 bg-surface-100 rounded" />
              </div>
              <div className="h-1.5 w-full bg-surface-100 rounded-full" />
            </div>
            <div className="w-20 space-y-1.5 shrink-0 hidden md:block">
              <div className="h-3 w-12 bg-surface-100 rounded" />
              <div className="h-3 w-10 bg-surface-200 rounded" />
            </div>
            <div className="w-28 space-y-1.5 shrink-0 hidden lg:block">
              <div className="h-3 w-12 bg-surface-100 rounded" />
              <div className="h-3 w-20 bg-surface-200 rounded" />
            </div>
            <div className="h-5 w-16 bg-surface-100 rounded-full shrink-0 hidden sm:block" />
            <div className="h-7 w-24 bg-surface-100 rounded-lg shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
