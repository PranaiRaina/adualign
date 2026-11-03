'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EstimateDisclaimer } from '@/components/disclaimers';

const EXPLANATION_PROSE_CLASS =
  'addon-explanation-prose px-3.5 py-3 pr-8 text-[12px] leading-relaxed text-surface-600 ' +
  '[&_h3]:mb-2 [&_h3]:mt-0 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:leading-snug [&_h3]:text-surface-900 ' +
  '[&_h3:not(:first-child)]:mt-3 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
  '[&_strong]:font-semibold [&_strong]:text-surface-800 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1.5 ' +
  '[&_ul]:pl-4 [&_li]:text-surface-600';

/**
 * A static explanation callout for a calculator add-on row.
 *
 * It floats out to the right of the anchored row (flipping left only when the
 * viewport edge forces it), with a caret pointing back at the row so it reads as
 * "this answers that question". Portaled to <body> so the sidebar's overflow
 * clipping never cuts it off; positioned with fixed coordinates that track the
 * row on scroll and resize.
 *
 * The parent always renders this and drives it with `open`. We own the
 * enter/exit transition: on open the box fades and scales up from the caret
 * (so it pops out of the Explain button); on close it fades and scales back
 * down before unmounting, instead of blinking out. Every close path (the
 * button toggle, the X, Escape, outside-click, or the row scrolling away)
 * runs through `onClose`, so they all animate the same way.
 */

const GAP = 10; // space between the row edge and the caret tip
const CARET_INSET = 16; // keep the caret this far from the box's top/bottom corners
const VIEWPORT_MARGIN = 8;
const EXIT_MS = 160; // keep mounted through the exit transition (>= duration-150)

interface PopoverPosition {
  left: number;
  top: number;
  caretTop: number;
  placement: 'right' | 'left';
}

interface Props {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** The trigger element, excluded from outside-click so its own toggle wins. */
  triggerRef: React.RefObject<HTMLElement | null>;
  label: string;
  explanation: string;
  autoFocusCloseButton?: boolean;
  panelClassName?: string;
  scrollViewportClassName?: string;
  children?: React.ReactNode;
  /** Render the "estimates, not quotes" footer. Defaults on for cost callouts. */
  showEstimateDisclaimer?: boolean;
  onClose: () => void;
}

export function AddonExplanationPopover({
  open,
  anchorRef,
  triggerRef,
  label,
  explanation,
  autoFocusCloseButton = true,
  panelClassName,
  scrollViewportClassName,
  children,
  showEstimateDisclaimer = true,
  onClose,
}: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const [mounted, setMounted] = useState(false); // is the portal in the DOM
  const [shown, setShown] = useState(false); // drives the enter/exit transition

  // Mount on open and flip `shown` on the next frame so the enter transition
  // runs; on close play the exit transition, then unmount after it finishes.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => {
      setMounted(false);
      setPos(null);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;

    const rect = anchor.getBoundingClientRect();

    // If the row has scrolled out of its own scroll container, close the popover
    // rather than leave it floating, detached, over the chat.
    const scroller = anchor.closest('[data-addon-scroll]');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
        onClose();
        return;
      }
    }

    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let placement: 'right' | 'left' = 'right';
    let left = rect.right + GAP;
    if (left + width > viewportW - VIEWPORT_MARGIN) {
      placement = 'left';
      left = rect.left - GAP - width;
    }
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - width - VIEWPORT_MARGIN));

    const anchorCenterY = rect.top + rect.height / 2;
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchorCenterY - 20, viewportH - height - VIEWPORT_MARGIN),
    );
    const caretTop = Math.max(CARET_INSET, Math.min(anchorCenterY - top, height - CARET_INSET));

    setPos({ left, top, caretTop, placement });
  }, [anchorRef, onClose]);

  // Position before paint so the box never flashes at the origin.
  useLayoutEffect(() => {
    if (mounted) reposition();
  }, [mounted, reposition, label, explanation, children]);

  // Keep the box pinned to the row as the sidebar scrolls or the window resizes.
  useEffect(() => {
    if (!mounted) return;
    const handler = () => reposition();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [mounted, reposition]);

  // Escape closes and returns focus to the trigger that opened it.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        triggerRef.current?.focus();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, triggerRef]);

  // Click anywhere outside the box (and outside its trigger) closes it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onClose, triggerRef]);

  // Move focus into the popover so keyboard users land on the dismiss control.
  useEffect(() => {
    if (autoFocusCloseButton && open && mounted) {
      closeBtnRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocusCloseButton, open, mounted]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={`${label} explanation`}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'fixed z-[200] w-[300px] max-h-[min(70vh,420px)] rounded-lg border border-surface-200 bg-surface-0',
        'shadow-[0_4px_16px_rgba(15,23,42,0.10),0_1px_4px_rgba(15,23,42,0.06)]',
        'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
        shown ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        panelClassName,
      )}
      style={
        pos
          ? {
              left: pos.left,
              top: pos.top,
              // Grow from the caret (the side facing the Explain button) so it
              // reads as popping out of the button rather than sliding in.
              transformOrigin:
                pos.placement === 'left' ? `right ${pos.caretTop}px` : `left ${pos.caretTop}px`,
            }
          : { left: 0, top: 0, visibility: 'hidden' }
      }
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute h-2.5 w-2.5 rotate-45 border-surface-200 bg-surface-0',
          pos?.placement === 'left'
            ? '-right-[5px] border-r border-t'
            : '-left-[5px] border-b border-l',
        )}
        style={{ top: pos ? pos.caretTop - 5 : 0 }}
      />

      <button
        ref={closeBtnRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close explanation"
        className="absolute right-2 top-2 rounded p-0.5 text-surface-400 transition-colors hover:text-surface-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div
        className={cn(
          'max-h-[min(70vh,420px)] overflow-y-auto overscroll-contain',
          scrollViewportClassName,
        )}
      >
        {children ?? (
          <div className={EXPLANATION_PROSE_CLASS}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{explanation}</ReactMarkdown>
          </div>
        )}
      </div>
      {showEstimateDisclaimer && <EstimateDisclaimer asFooter />}
    </div>,
    document.body,
  );
}
