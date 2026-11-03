// ponytail: module-scoped popstate cleanup. A listener registered *inside* the
// map/chat React tree is removed by React's synchronous unmount during a
// route-changing browser back/forward BEFORE the popstate dispatch reaches it,
// so component-level cleanup never runs when back actually leaves the page
// (verified in-browser: window popstate fires, the component's own listener does
// not). A single module-scoped listener survives the unmount and runs the last
// registered cleanup. It only fires for same-document back/forward (popstate),
// never for in-app router.push handoffs, so the map<->chat draft handoff is safe.

type ExitCleanup = { pathname: string; run: () => void };

let active: ExitCleanup | null = null;
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;
  window.addEventListener('popstate', () => {
    // On popstate the URL already reflects the destination. Only clear when the
    // navigation actually left the registered page — this skips the dirty
    // history-guard and post-save back() hops, which stay on the same path.
    if (active && window.location.pathname !== active.pathname) {
      active.run();
    }
  });
}

// Registered on mount and intentionally NOT cleared on unmount: the unmount runs
// during the same synchronous popstate dispatch, so clearing here would race the
// listener and lose the cleanup. The next guarded page overwrites `active`.
export function registerExitDraftCleanup(run: () => void): void {
  if (typeof window === 'undefined') {
    return;
  }
  install();
  active = { pathname: window.location.pathname, run };
}
