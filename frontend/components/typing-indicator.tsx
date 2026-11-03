'use client';

interface TypingIndicatorProps {
  stage?: string;
}

export function TypingIndicator({ stage }: TypingIndicatorProps) {
  return (
    <div className="flex justify-start animate-fade-in-up">
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />
          <span className="text-xs font-semibold text-surface-500">ADU Advisor</span>
        </div>

        <div className="bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-dot-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-dot-bounce"
              style={{ animationDelay: '160ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-dot-bounce"
              style={{ animationDelay: '320ms' }}
            />
          </div>
          {stage && (
            <span className="text-[12px] text-surface-400 leading-none">
              {stage.replace(/\.+$/, '')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
