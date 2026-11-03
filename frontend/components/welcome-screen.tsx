'use client';

export function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 animate-fade-in">
      <p className="text-lg font-semibold text-surface-900 text-balance text-center mb-2.5 tracking-tight">
        ADU Advisor
      </p>
      <p className="text-sm text-surface-500 text-center max-w-[340px] leading-relaxed">
        Ask about California ADU regulations, setback requirements, permitting timelines, and what
        your planned design means for feasibility and cost.
      </p>
    </div>
  );
}
