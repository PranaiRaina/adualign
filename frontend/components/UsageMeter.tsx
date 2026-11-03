'use client';

import { useContext, useState } from 'react';
import { Lock } from 'lucide-react';
import { useBudget } from '@/lib/context/UsageBudgetContext';
import { AuthContext } from '@/lib/context/AuthContext';

function formatUsd(micros: number): string {
  return `$${(Math.max(0, micros) / 1_000_000).toFixed(2)}`;
}

type MeterState = 'healthy' | 'warning' | 'exhausted' | 'locked';

function getMeterState(percentUsed: number, isExhausted: boolean): MeterState {
  if (percentUsed > 100) return 'locked';
  if (isExhausted) return 'exhausted';
  if (percentUsed >= 75) return 'warning';
  return 'healthy';
}

const METER_STYLES: Record<MeterState, { bar: string; text: string; bg: string }> = {
  healthy: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50 border-emerald-200',
  },
  warning: {
    bar: 'bg-amber-500',
    text: 'text-amber-700',
    bg: 'bg-amber-50 border-amber-200',
  },
  exhausted: {
    bar: 'bg-red-500',
    text: 'text-red-700',
    bg: 'bg-red-50 border-red-200',
  },
  locked: {
    bar: 'bg-slate-400',
    text: 'text-slate-600',
    bg: 'bg-slate-50 border-slate-200',
  },
};

const METER_LABELS: Record<MeterState, (pct: number) => string> = {
  healthy: (pct) => `${pct}% used`,
  warning: (pct) => `${pct}% used`,
  exhausted: () => 'Service limit reached',
  locked: () => 'Service limit reached',
};

export function UsageMeter() {
  const auth = useContext(AuthContext);
  const budget = useBudget();
  const [showTooltip, setShowTooltip] = useState(false);

  if (!auth?.isLoggedIn) return null;

  if (!budget.isLoaded) {
    return (
      <span className="px-2 text-xs text-slate-400 animate-pulse select-none">Syncing usage…</span>
    );
  }

  if (budget.costBudgetMicros === 0) {
    return <span className="px-2 text-xs text-slate-400 select-none">Usage unavailable</span>;
  }

  const state = getMeterState(budget.percentUsed, budget.isExhausted);
  const styles = METER_STYLES[state];
  const displayPercent = Math.round(budget.percentUsed);
  const label = METER_LABELS[state](displayPercent);
  const barWidth = Math.min(budget.percentUsed, 100);
  // Dynamic figures: includes any admin +$5/-$5 budget change reflected in /usage/me.
  const usedLabel = formatUsd(budget.costUsedMicros);
  const budgetLabel = formatUsd(budget.costBudgetMicros);
  const remainingLabel = formatUsd(budget.costBudgetMicros - budget.costUsedMicros);

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {state === 'healthy' ? (
        <span className="flex items-center gap-2 px-2 text-[13px] font-medium text-surface-500 select-none cursor-default">
          <span className="w-10 h-1.5 rounded-full bg-surface-200 overflow-hidden">
            <span
              className="block h-full rounded-full bg-surface-400 transition-all duration-500"
              style={{ width: `${barWidth}%` }}
            />
          </span>
          {label}
        </span>
      ) : (
        <div
          className={`flex h-8 items-center gap-2.5 rounded-lg border px-3 text-xs font-semibold ${styles.bg} ${styles.text}`}
        >
          {state === 'locked' && <Lock className="w-3 h-3" />}
          <div className="w-14 h-1.5 rounded-full bg-black/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${styles.bar}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <span>{label}</span>
        </div>
      )}

      {showTooltip && (
        <div className="absolute left-1/2 top-full z-[9999] mt-2 -translate-x-1/2 rounded-md bg-[#4a4a4a] px-3 py-1.5 text-xs font-medium text-white shadow-lg pointer-events-none whitespace-nowrap">
          {displayPercent}% of your usage limit
        </div>
      )}
    </div>
  );
}
