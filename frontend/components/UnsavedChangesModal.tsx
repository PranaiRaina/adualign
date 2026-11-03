'use client';

import { AlertTriangle } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  isSaving?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  saveLabel?: string;
  onStay: () => void;
  onLeave: () => void;
  onSaveAndLeave?: () => void;
}

export function UnsavedChangesModal({
  isOpen,
  isSaving = false,
  title,
  description,
  confirmLabel,
  saveLabel = 'Save and leave',
  onStay,
  onLeave,
  onSaveAndLeave,
}: UnsavedChangesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
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

        <div className="mt-7 flex gap-3">
          <button
            type="button"
            onClick={onStay}
            disabled={isSaving}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Stay here
          </button>
          {onSaveAndLeave && (
            <button
              type="button"
              onClick={onSaveAndLeave}
              disabled={isSaving}
              className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-400"
            >
              {isSaving ? 'Saving…' : saveLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onLeave}
            disabled={isSaving}
            className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-rose-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
