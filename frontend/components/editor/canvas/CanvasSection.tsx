'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface CanvasSectionProps {
  icon: React.ElementType;
  title: string;
  completedCount: number;
  totalCount: number;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function CanvasSection({
  icon: Icon,
  title,
  completedCount,
  totalCount,
  defaultExpanded = true,
  children,
}: CanvasSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const allComplete = completedCount === totalCount;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div
      className={`bg-white rounded-2xl border overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-300 ${
        allComplete ? 'border-brand-200' : 'border-surface-200 hover:border-surface-300'
      }`}
    >
      <button
        className="w-full px-6 py-4 flex items-center justify-between focus:outline-none group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
              allComplete ? 'bg-brand-50 border-brand-200' : 'bg-surface-50 border-surface-200'
            }`}
          >
            <Icon
              className={`w-4.5 h-4.5 ${allComplete ? 'text-brand-600' : 'text-surface-600'}`}
            />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-surface-900 tracking-tight">{title}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="w-16 h-1 bg-surface-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    allComplete ? 'bg-brand-500' : 'bg-surface-400'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-surface-400">
                {completedCount}/{totalCount}
              </span>
            </div>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-surface-400 transition-transform duration-300 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      <div
        className={`transition-all duration-300 ease-out overflow-hidden ${
          expanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-6 pb-5 pt-1 space-y-2">{children}</div>
      </div>
    </div>
  );
}
