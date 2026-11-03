'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PROPERTY_LINE_DASH_ARRAY, YARD_DIVIDER_DASH_ARRAY } from './constants';

type MapLegendProps = {
  visible: boolean;
  isDraggingAdu: boolean;
};

const LEGEND_ITEMS = [
  {
    label: 'Property line',
    color: '#2563EB',
    dashArray: PROPERTY_LINE_DASH_ARRAY,
  },
  {
    label: 'Yard zone divider',
    color: '#FBBF24',
    dashArray: YARD_DIVIDER_DASH_ARRAY,
  },
  {
    label: 'Detected structures',
    color: '#DC2626',
    dashArray: undefined,
  },
  {
    label: "Buildable zone (4' property line, and 6' structure setbacks)",
    color: '#10B981',
    dashArray: undefined,
  },
] as const;

export default function MapLegend({ visible, isDraggingAdu }: MapLegendProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={`
        absolute bottom-2 left-2 z-50 flex max-w-[calc(100vw-1rem)] flex-col items-start
        transition-all duration-300 ease-in-out
        ${
          !visible
            ? 'pointer-events-none -translate-x-4 scale-95 opacity-0'
            : isDraggingAdu
              ? 'pointer-events-none opacity-[0.72]'
              : 'pointer-events-auto opacity-100'
        }
      `}
    >
      <div className="relative mb-2">
        <div
          aria-hidden={!isExpanded}
          className={`
            absolute bottom-full left-0 w-72 max-w-[calc(100vw-1rem)] origin-bottom-left transition-all duration-200 ease-out
            ${isExpanded ? 'pointer-events-auto opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2'}
          `}
        >
          <div className="rounded-xl bg-white/95 p-3 shadow-xl ring-1 ring-slate-900/5 backdrop-blur-sm">
            <div className="mb-3">
              <h3 className="text-base font-extrabold tracking-normal leading-tight text-slate-800">
                Map Legend
              </h3>
              <div className="mt-2 h-px w-full bg-slate-300/90" />
            </div>

            <div className="space-y-3">
              {LEGEND_ITEMS.map((item) => (
                <div key={item.label} className="flex w-full items-start gap-3">
                  <LegendSwatch color={item.color} dashArray={item.dashArray} />
                  <span className="min-w-0 flex-1 text-sm font-medium leading-tight text-slate-700">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-700 shadow-md ring-1 ring-slate-900/5 transition-all hover:bg-slate-50 active:scale-[0.98]"
      >
        Legend
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 ease-out ${isExpanded ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>
    </div>
  );
}

function LegendSwatch({ color, dashArray }: { color: string; dashArray?: readonly number[] }) {
  const lineEndX = dashArray ? 74 : 72;

  return (
    <svg
      width="76"
      height="12"
      viewBox="0 0 76 12"
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <line
        x1="2"
        y1="6"
        x2={lineEndX}
        y2="6"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        {...(dashArray ? { strokeDasharray: dashArray.join(' ') } : {})}
      />
    </svg>
  );
}
