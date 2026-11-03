import { cn } from '@/lib/utils';

/**
 * Centralized disclaimer copy + presentation.
 *
 * Keeping the wording in one place stops the same caveat from drifting out of
 * sync across the chat footer, the cost popovers, and the calculator panel.
 */

export const AI_DISCLAIMER_TEXT =
  'AI-generated and can be inaccurate — double-check important details.';

const ESTIMATE_DISCLAIMER_TEXT =
  'These are rough, data-driven estimates, not professional construction quotes. ' +
  'Actual costs vary by site, design, and contractor.';

/**
 * Fine-print caveat that the calculator figures are estimates, not quotes.
 *
 * `asFooter` renders it as a divided footer for use at the bottom of the cost
 * popovers; the default form is a plain persistent line for the calculator panel.
 */
export function EstimateDisclaimer({ asFooter = false }: { asFooter?: boolean }) {
  return (
    <p
      className={cn(
        'text-[11px] leading-relaxed text-surface-500',
        asFooter ? 'border-t border-surface-200 px-3.5 py-2' : 'px-3.5 py-2',
      )}
    >
      {ESTIMATE_DISCLAIMER_TEXT}
    </p>
  );
}
