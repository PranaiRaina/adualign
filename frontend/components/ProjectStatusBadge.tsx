'use client';

import { type ReactNode, useState } from 'react';
import { FolderOpen, FolderPlus, Loader2 } from 'lucide-react';
import type { WorkflowState } from '@/lib/hooks/useProjectStatus';

function InstantTooltip({
  tip,
  className,
  children,
}: {
  tip: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex shrink-0 max-w-full">
      <span
        className={className}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute top-full left-0 z-[200] mt-1 w-max max-w-[240px] whitespace-normal rounded-[3px] bg-[#4a4a4a] px-[6px] py-[3px] text-[11px] leading-tight text-white shadow"
        >
          {tip}
        </span>
      )}
    </span>
  );
}

interface ProjectStatusBadgeProps {
  workflowState: WorkflowState;
  /** Address of the saved project (populated when editing an existing project). */
  savedAddress?: string | null;
  /** Address the user is currently analyzing (shown when creating a new project). */
  currentAddress?: string | null;
  compact?: boolean;
}

const EXISTING_CONFIG = {
  icon: FolderOpen,
  label: 'Editing existing',
  bg: 'bg-emerald-50 border-emerald-200',
  text: 'text-emerald-700',
  dot: 'bg-emerald-400',
} as const;

const NEW_CONFIG = {
  icon: FolderPlus,
  label: 'Creating new',
  bg: 'bg-blue-50 border-blue-200',
  text: 'text-blue-700',
  dot: 'bg-blue-400',
} as const;

function isExistingProject(state: WorkflowState): boolean {
  return state === 'saved' || state === 'has_report' || state === 'has_draft';
}

export function ProjectStatusBadge({
  workflowState,
  savedAddress,
  currentAddress,
  compact = false,
}: ProjectStatusBadgeProps) {
  if (workflowState === 'loading') {
    if (compact) {
      return (
        <InstantTooltip
          tip="Loading…"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-400 select-none"
        >
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
        </InstantTooltip>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-400 animate-pulse select-none">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        Loading…
      </span>
    );
  }

  if (workflowState === 'error') {
    return null;
  }

  const existing = isExistingProject(workflowState);
  const config = existing ? EXISTING_CONFIG : NEW_CONFIG;
  const Icon = config.icon;

  const displayAddress = existing ? savedAddress : currentAddress;
  const truncatedAddress =
    displayAddress && displayAddress.length > 26
      ? `${displayAddress.slice(0, 24)}…`
      : displayAddress;

  const tooltipBase = existing ? 'Editing existing project' : 'Creating new project';
  const tooltip = displayAddress ? `${tooltipBase} — ${displayAddress}` : tooltipBase;

  return (
    <InstantTooltip
      tip={tooltip}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium select-none transition-colors cursor-default ${config.bg} ${config.text}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {compact ? (
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      ) : (
        <>
          {config.label}
          {truncatedAddress && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate max-w-[160px] opacity-75">{truncatedAddress}</span>
            </>
          )}
        </>
      )}
    </InstantTooltip>
  );
}
