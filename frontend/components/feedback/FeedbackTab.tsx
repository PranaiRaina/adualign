'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import { FeedbackPanel } from './FeedbackPanel';

export function FeedbackTab() {
  const [open, setOpen] = useState(false);
  // On the map the right edge is taken by the ADU Designer card; dock the tab
  // on the left, ~60% down, in the gap between the feasibility card and legend.
  const onMap = usePathname() === '/map';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className={`group fixed z-40 flex -translate-y-1/2 items-center gap-1.5 bg-brand-600 px-2 py-4 text-sm font-medium text-white shadow-lg transition-all duration-200 [writing-mode:vertical-rl] hover:bg-brand-700 hover:px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
          onMap ? 'left-0 top-[60%] rounded-r-lg' : 'right-0 top-1/2 rounded-l-lg'
        }`}
      >
        <MessageSquarePlus className="h-4 w-4 rotate-90" />
        Feedback
      </button>

      <FeedbackPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
