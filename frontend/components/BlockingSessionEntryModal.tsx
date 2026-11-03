'use client';

import { AlertTriangle } from 'lucide-react';

interface BlockingSessionEntryModalProps {
  description: string;
  onLeave: () => void;
  title: string;
}

export function BlockingSessionEntryModal({
  description,
  onLeave,
  title,
}: BlockingSessionEntryModalProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-7 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{description}</p>
          </div>
        </div>

        <div className="mt-7">
          <button
            type="button"
            onClick={onLeave}
            className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-rose-700"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
