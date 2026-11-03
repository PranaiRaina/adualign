import { LucideIcon } from 'lucide-react';

interface Stat {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
}

interface StatsBarProps {
  stats: Stat[];
}

export function StatsBar({ stats }: StatsBarProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <div
          key={i}
          className="bg-surface-0 px-5 py-4 rounded-xl border border-surface-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-center gap-4"
        >
          <div className="w-9 h-9 rounded-lg bg-surface-50 border border-surface-100 flex items-center justify-center shrink-0">
            <stat.icon className="w-4 h-4 text-surface-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400 leading-none mb-1">
              {stat.label}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-surface-900 tracking-tight tabular-nums">
                {stat.value}
              </span>
              {stat.trend && (
                <span
                  className={`text-xs font-semibold ${
                    stat.trendUp ? 'text-brand-600' : 'text-red-500'
                  }`}
                >
                  {stat.trendUp ? '+' : ''}
                  {stat.trend}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
