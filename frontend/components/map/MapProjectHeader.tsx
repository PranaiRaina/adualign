'use client';

interface MapProjectHeaderProps {
  actionLabel: string;
  isActionBusy: boolean;
  isActionDisabled: boolean;
  onActionClick: () => void;
}

export default function MapProjectHeader({
  actionLabel,
  isActionBusy,
  isActionDisabled,
  onActionClick,
}: MapProjectHeaderProps) {
  const actionClassName = isActionBusy
    ? 'bg-surface-400 text-white cursor-wait'
    : isActionDisabled
      ? 'bg-surface-200 text-surface-400 cursor-not-allowed shadow-none'
      : 'bg-surface-900 text-white hover:bg-surface-800 cursor-pointer';

  return (
    <header className="pointer-events-none absolute right-2 top-0 z-50 flex justify-end">
      <div className="pointer-events-auto flex items-center rounded-b-xl border border-t-0 border-surface-200 bg-surface-0/95 px-1.5 pb-1.5 pt-1.5 shadow-[0_6px_20px_rgba(15,23,42,0.08)] backdrop-blur">
        <button
          type="button"
          disabled={isActionDisabled}
          onClick={onActionClick}
          className={`flex min-w-[120px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-1 text-sm font-semibold transition-all ${actionClassName}`}
        >
          {isActionBusy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {actionLabel}
            </>
          ) : (
            actionLabel
          )}
        </button>
      </div>
    </header>
  );
}
