import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ChevronDown } from 'lucide-react';

import type { AdvisoryWarning } from './advisoryWarnings';

interface AdvisoryChipProps {
  warnings: AdvisoryWarning[];
  visible: boolean;
}

// Amber sibling of ViolationBanner: same top-center slot, advisory severity.
// The caller hides it while ViolationBanner is visible (red outranks amber).
// The pill pings until the user opens it once, then rests; hover/tap morphs
// it into the full advisory card on a spring.
export default function AdvisoryChip({ warnings, visible }: AdvisoryChipProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);
  const prevCountRef = useRef(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (warnings.length > prevCountRef.current) {
      setHasUnseen(true);
    }
    prevCountRef.current = warnings.length;
  }, [warnings.length]);

  useEffect(() => {
    if (!visible) setIsExpanded(false);
  }, [visible]);

  const openPanel = () => {
    setIsExpanded(true);
    setHasUnseen(false);
  };

  const shown = visible && warnings.length > 0;
  const morphSpring = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 480, damping: 40 };
  const contentFade = reduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' as const };

  return (
    <div
      className={`absolute top-[58px] left-1/2 -translate-x-1/2 z-40 w-full max-w-[380px] flex flex-col items-center transition-all duration-200 ease-out
        ${shown ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 -translate-y-1 scale-95 pointer-events-none'}`}
      onMouseEnter={openPanel}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div className={`relative ${isExpanded ? 'w-full' : ''}`}>
        <motion.div
          layout
          transition={morphSpring}
          style={{ borderRadius: isExpanded ? 12 : 999 }}
          className={`relative isolate overflow-hidden backdrop-blur-sm border
          ${
            isExpanded
              ? 'w-full bg-surface-0/95 border-amber-300/70 shadow-[0_4px_16px_rgba(0,0,0,0.10),0_1px_4px_rgba(0,0,0,0.06)]'
              : `bg-amber-50/95 border-amber-300 shadow-[0_2px_8px_rgba(0,0,0,0.08)] ${
                  hasUnseen && !reduceMotion ? 'animate-advisory-flash' : ''
                }`
          }`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {isExpanded ? (
              <motion.div
                key="panel"
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={contentFade}
                className="px-5 py-2.5 flex flex-col gap-1"
                onClick={() => setIsExpanded(false)}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 leading-none">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Advisories — worth checking, nothing is blocked
                </span>
                <div className="space-y-1">
                  {warnings.map((warning) => (
                    <div
                      key={warning.id}
                      className="flex items-start gap-2.5 text-sm font-medium text-surface-700 leading-tight"
                    >
                      <span className="text-amber-500 mt-[5.5px] w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                      <span>{warning.message}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="pill"
                layout="position"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={contentFade}
                onClick={openPanel}
                className="flex items-center gap-2 px-3.5 py-1.5 cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                <span className="text-xs font-semibold text-amber-800 leading-none">
                  {warnings.length} advisor{warnings.length === 1 ? 'y' : 'ies'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-amber-500" />
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
