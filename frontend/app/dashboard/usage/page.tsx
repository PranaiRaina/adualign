'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useBudget } from '@/lib/context/UsageBudgetContext';
import { Activity, Cpu, Lock, MapPin, MessageSquare, RefreshCw, Wallet, Zap } from 'lucide-react';
import Link from 'next/link';

function formatUsd(micros: number): string {
  return `$${(Math.max(0, micros) / 1_000_000).toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString();
}

type MeterState = 'healthy' | 'warning' | 'exhausted' | 'locked';

function getMeterState(percentUsed: number, isExhausted: boolean): MeterState {
  if (percentUsed > 100) return 'locked';
  if (isExhausted) return 'exhausted';
  if (percentUsed >= 75) return 'warning';
  return 'healthy';
}

const BAR_COLORS: Record<MeterState, string> = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  exhausted: 'bg-red-500',
  locked: 'bg-slate-400',
};

const STATUS_BADGES: Record<MeterState, { label: string; classes: string }> = {
  healthy: {
    label: 'Healthy',
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  warning: {
    label: 'Approaching limit',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  exhausted: {
    label: 'Limit reached',
    classes: 'bg-red-50 text-red-700 border-red-200',
  },
  locked: {
    label: 'Limit reached',
    classes: 'bg-slate-50 text-slate-600 border-slate-200',
  },
};

const PERIOD_LABELS: Record<string, string> = {
  lifetime: 'Lifetime',
};

function renderUsageUnavailableState(addressCreditsRemaining: number) {
  return (
    <div className="space-y-6 animate-fade-in">
      <UsageHeader />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <StatCard
          icon={MapPin}
          label="Address Credits Remaining"
          value={addressCreditsRemaining.toLocaleString()}
        />
      </div>
      <div className="flex flex-col items-center justify-center py-20 bg-surface-0 rounded-2xl border border-dashed border-surface-200 text-center">
        <div className="w-14 h-14 bg-surface-50 border border-surface-200 rounded-2xl flex items-center justify-center mb-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <Activity className="w-6 h-6 text-surface-400" />
        </div>
        <p className="text-base font-bold text-surface-900 mb-1.5">AI usage data unavailable</p>
        <p className="text-sm text-surface-500 max-w-xs leading-relaxed">
          Address credits are still tracked. Start a chat to initialize AI usage tracking for this
          account.
        </p>
      </div>
    </div>
  );
}

export default function UsagePage() {
  const { user, isLoading } = useAuth();
  const budget = useBudget();

  if (isLoading || !user) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-surface-400 text-sm">
          {isLoading ? 'Loading...' : 'Redirecting...'}
        </div>
      </div>
    );
  }

  if (!budget.isLoaded) {
    return <UsageSkeleton />;
  }

  if (budget.costBudgetMicros === 0) {
    return renderUsageUnavailableState(budget.addressCreditsRemaining);
  }

  const state = getMeterState(budget.percentUsed, budget.isExhausted);
  const displayPercent = Math.round(budget.percentUsed);
  const barWidth = Math.min(budget.percentUsed, 100);
  const periodLabel = PERIOD_LABELS[budget.budgetPeriod] || 'Lifetime';
  const badge = STATUS_BADGES[state];
  // Dynamic dollar figures (reflect any admin +$5/-$5 budget change after refresh).
  const usedLabel = formatUsd(budget.costUsedMicros);
  const budgetLabel = formatUsd(budget.costBudgetMicros);
  const remainingLabel = formatUsd(budget.costBudgetMicros - budget.costUsedMicros);

  return (
    <div className="space-y-6 animate-fade-in">
      <UsageHeader />

      {/* Usage overview card */}
      <div className="bg-surface-0 rounded-2xl border border-surface-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6 sm:p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center">
              <Activity className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-surface-900 tracking-tight">AI Usage Budget</p>
              <p className="text-xs text-surface-500">
                {usedLabel} of {budgetLabel} used · {periodLabel.toLowerCase()} limit
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${badge.classes}`}
            >
              {state === 'locked' && <Lock className="w-3 h-3" />}
              {badge.label}
            </span>
            <button
              type="button"
              onClick={() => budget.refresh()}
              className="p-2 text-surface-400 hover:text-surface-700 hover:bg-surface-100 rounded-lg transition-colors cursor-pointer"
              aria-label="Refresh usage"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Large usage bar */}
        <div className="mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-3xl font-bold text-surface-900 tabular-nums tracking-tight">
              {displayPercent}%
            </span>
            <span className="text-sm text-surface-500">
              {formatTokens(budget.totalTokensUsed)} tokens used
            </span>
          </div>
          <div className="w-full h-3 rounded-full bg-surface-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${BAR_COLORS[state]}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>

        {(state === 'exhausted' || state === 'locked') && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
            <p className="text-sm text-red-700 font-medium">
              You have reached your {budgetLabel} lifetime AI service budget. Contact support to
              continue.
            </p>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <StatCard icon={Zap} label="Total Tokens" value={formatTokens(budget.totalTokensUsed)} />
        <StatCard
          icon={MessageSquare}
          label="Prompt Tokens"
          value={formatTokens(budget.promptTokensUsed)}
        />
        <StatCard
          icon={Cpu}
          label="Completion Tokens"
          value={formatTokens(budget.completionTokensUsed)}
        />
        <StatCard
          icon={Wallet}
          label="Budget Remaining"
          value={`${remainingLabel} / ${budgetLabel}`}
          small
        />
        <StatCard
          icon={MapPin}
          label="Address Credits Remaining"
          value={budget.addressCreditsRemaining.toLocaleString()}
        />
      </div>

      {/* Token breakdown */}
      {(budget.promptTokensUsed > 0 ||
        budget.completionTokensUsed > 0 ||
        budget.mapSearchCount > 0) && (
        <div className="bg-surface-0 rounded-2xl border border-surface-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6 sm:p-8">
          <p className="text-base font-bold text-surface-900 tracking-tight mb-4">
            Token Breakdown
          </p>
          <div className="space-y-4">
            <TokenRow
              label="Prompt tokens"
              value={budget.promptTokensUsed}
              total={budget.totalTokensUsed}
              color="bg-blue-500"
            />
            <TokenRow
              label="Completion tokens"
              value={budget.completionTokensUsed}
              total={budget.totalTokensUsed}
              color="bg-violet-500"
            />
          </div>
          <PropertySearchRow count={budget.mapSearchCount} />
        </div>
      )}
    </div>
  );
}

function UsageHeader() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-surface-400 mb-2">
          Account
        </p>
        <p className="text-2xl font-bold text-surface-900 tracking-tight">Usage</p>
        <p className="text-sm text-surface-500 mt-1">Track your AI token consumption and limits.</p>
      </div>
      <Link
        href="/projects"
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-surface-700 border border-surface-200 bg-surface-0 rounded-lg hover:bg-surface-50 transition-colors shadow-sm shrink-0"
      >
        My Projects
      </Link>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  small,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="bg-surface-0 px-5 py-4 rounded-xl border border-surface-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-center gap-4">
      <div className="w-9 h-9 rounded-lg bg-surface-50 border border-surface-100 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-surface-500" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400 leading-none mb-1">
          {label}
        </p>
        <span
          className={`font-bold text-surface-900 tracking-tight tabular-nums ${small ? 'text-sm' : 'text-xl'}`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function TokenRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-surface-700">{label}</span>
        <span className="text-sm tabular-nums text-surface-500">{formatTokens(value)}</span>
      </div>
      <div className="w-full h-2 rounded-full bg-surface-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PropertySearchRow({ count }: { count: number }) {
  return (
    <div className="mt-4 pt-4 border-t border-surface-100 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
          <MapPin className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-surface-700 leading-none">Property searches</p>
          <p className="text-xs text-surface-400 mt-1">Billed per property searched</p>
        </div>
      </div>
      <span className="text-lg font-bold text-surface-900 tabular-nums tracking-tight">
        {count.toLocaleString()}
      </span>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-3 w-16 bg-surface-200 rounded" />
          <div className="h-7 w-24 bg-surface-200 rounded" />
          <div className="h-4 w-48 bg-surface-100 rounded" />
        </div>
        <div className="h-9 w-28 bg-surface-200 rounded-lg" />
      </div>
      <div className="bg-surface-0 rounded-2xl border border-surface-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-surface-100" />
          <div className="space-y-1.5">
            <div className="h-5 w-32 bg-surface-200 rounded" />
            <div className="h-3 w-20 bg-surface-100 rounded" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between">
            <div className="h-8 w-16 bg-surface-200 rounded" />
            <div className="h-4 w-32 bg-surface-100 rounded" />
          </div>
          <div className="h-3 w-full bg-surface-100 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface-0 px-5 py-4 rounded-xl border border-surface-200">
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-surface-100" />
              <div className="space-y-1.5">
                <div className="h-3 w-16 bg-surface-100 rounded" />
                <div className="h-5 w-20 bg-surface-200 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
