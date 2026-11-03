'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CHAT_EXIT_REQUEST_EVENT, type ChatExitRequestDetail } from '@/lib/chatExitGuard';
import { registerExitDraftCleanup } from '@/lib/exitDraftCleanup';

const HISTORY_GUARD_STATE_KEY = '__aduChatUnsavedGuard';

type UseChatExitGuardArgs = {
  activeProjectId?: string;
  clearStoredChatState: (reason: string) => void;
  initialized: boolean;
  isDirty: boolean;
  onSaveBeforeLeave?: () => Promise<boolean>;
  resetKey: string;
};

function isPlainLeftClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isGuardedLink(anchor: HTMLAnchorElement) {
  if (!anchor.href) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  return true;
}

function stripHistoryGuardState(state: unknown) {
  if (!state || typeof state !== 'object') return state;

  const nextState = { ...(state as Record<string, unknown>) };
  delete nextState[HISTORY_GUARD_STATE_KEY];
  return nextState;
}

function ensureProjectIdInUrl(activeProjectId: string | undefined) {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  const currentProjectId = url.searchParams.get('projectId') ?? undefined;

  if (activeProjectId && currentProjectId !== activeProjectId) {
    url.searchParams.set('projectId', activeProjectId);
    window.history.replaceState(window.history.state, '', url.toString());
  }
}

export function useChatExitGuard({
  activeProjectId,
  clearStoredChatState,
  initialized,
  isDirty,
  onSaveBeforeLeave,
  resetKey,
}: UseChatExitGuardArgs) {
  const router = useRouter();

  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const clearStoredChatStateRef = useRef(clearStoredChatState);
  clearStoredChatStateRef.current = clearStoredChatState;

  const shouldBypassPopStateRef = useRef(false);
  const isHistoryGuardArmedRef = useRef(false);
  const isHistoryCleanupRef = useRef(false);
  const shouldSkipInitialHistoryCleanupRef = useRef(false);
  // Guards against re-entrancy while an autosave is already in flight.
  const isAutosavingRef = useRef(false);
  // Set while a caller (e.g. Back to map) is saving then navigating away.
  // Prevents the isDirty→false effect from calling history.back() over the
  // intended router.push.
  const pendingProgrammaticExitRef = useRef(false);

  const clearCurrentHistoryGuard = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!window.history.state?.[HISTORY_GUARD_STATE_KEY]) {
      return;
    }

    window.history.replaceState(
      stripHistoryGuardState(window.history.state),
      '',
      window.location.href,
    );
  }, []);

  const pushHistoryGuardEntry = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    ensureProjectIdInUrl(activeProjectIdRef.current);
    window.history.pushState(
      {
        ...(window.history.state ?? {}),
        [HISTORY_GUARD_STATE_KEY]: true,
      },
      '',
      window.location.href,
    );
    isHistoryGuardArmedRef.current = true;
  }, []);

  const ensureHistoryGuardEntry = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (window.history.state?.[HISTORY_GUARD_STATE_KEY] === true) {
      isHistoryGuardArmedRef.current = true;
      return;
    }

    pushHistoryGuardEntry();
  }, [pushHistoryGuardEntry]);

  const prepareConfirmedExit = useCallback(() => {
    shouldBypassPopStateRef.current = true;
    isHistoryGuardArmedRef.current = false;
    isHistoryCleanupRef.current = false;
    clearCurrentHistoryGuard();
  }, [clearCurrentHistoryGuard]);

  const beginProgrammaticExit = useCallback(() => {
    pendingProgrammaticExitRef.current = true;
  }, []);

  const cancelProgrammaticExit = useCallback(() => {
    pendingProgrammaticExitRef.current = false;
  }, []);

  // Autosaves the current draft, then continues the navigation that was
  // intercepted. If the save can't complete (e.g. the user needs to sign in),
  // `onCannotSave` runs instead so we keep them on the page. The draft itself is
  // always persisted to localStorage by useChatDraftState, so nothing is lost.
  const autosaveThenLeave = useCallback(
    async ({
      proceed,
      onCannotSave,
      cleanupReason,
    }: {
      proceed: () => void;
      onCannotSave?: () => void;
      cleanupReason: string;
    }) => {
      if (isAutosavingRef.current) {
        return;
      }

      isAutosavingRef.current = true;
      try {
        if (onSaveBeforeLeave) {
          const saved = await onSaveBeforeLeave();
          if (!saved) {
            onCannotSave?.();
            return;
          }
        }

        prepareConfirmedExit();
        clearStoredChatState(cleanupReason);
        proceed();
      } finally {
        isAutosavingRef.current = false;
      }
    },
    [clearStoredChatState, onSaveBeforeLeave, prepareConfirmedExit],
  );

  useEffect(() => {
    shouldBypassPopStateRef.current = false;
    isHistoryGuardArmedRef.current = false;
    isHistoryCleanupRef.current = false;
    shouldSkipInitialHistoryCleanupRef.current = false;
    isAutosavingRef.current = false;
    pendingProgrammaticExitRef.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const hasHistoryGuard = window.history.state?.[HISTORY_GUARD_STATE_KEY] === true;
    isHistoryGuardArmedRef.current = hasHistoryGuard;
    shouldSkipInitialHistoryCleanupRef.current = hasHistoryGuard;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !initialized) {
      return;
    }

    if (isDirty) {
      if (shouldBypassPopStateRef.current) {
        return;
      }

      if (!isHistoryGuardArmedRef.current) {
        pushHistoryGuardEntry();
      }
      return;
    }

    if (pendingProgrammaticExitRef.current) {
      pendingProgrammaticExitRef.current = false;
      prepareConfirmedExit();
      return;
    }

    if (!isHistoryGuardArmedRef.current) {
      return;
    }

    if (shouldSkipInitialHistoryCleanupRef.current) {
      shouldSkipInitialHistoryCleanupRef.current = false;
      return;
    }

    isHistoryCleanupRef.current = true;
    isHistoryGuardArmedRef.current = false;
    window.history.back();
  }, [initialized, isDirty, prepareConfirmedExit, pushHistoryGuardEntry]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (isAutosavingRef.current || !isPlainLeftClick(event) || event.defaultPrevented) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !isGuardedLink(anchor)) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      const isSameDestination =
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash;

      if (isSameDestination) {
        return;
      }

      event.preventDefault();
      const proceed = () => {
        if (nextUrl.origin === currentUrl.origin) {
          router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
          return;
        }
        window.location.assign(nextUrl.toString());
      };

      if (!isDirtyRef.current) {
        prepareConfirmedExit();
        clearStoredChatState('flow-exit-link');
        proceed();
        return;
      }

      void autosaveThenLeave({
        proceed,
        cleanupReason: 'flow-exit-link',
      });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [autosaveThenLeave, clearStoredChatState, prepareConfirmedExit, router]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePopState = () => {
      if (isHistoryCleanupRef.current) {
        isHistoryCleanupRef.current = false;
        ensureProjectIdInUrl(activeProjectIdRef.current);
        window.history.replaceState(
          stripHistoryGuardState(window.history.state),
          '',
          window.location.href,
        );
        return;
      }

      if (shouldBypassPopStateRef.current) {
        shouldBypassPopStateRef.current = false;
        isHistoryGuardArmedRef.current = window.history.state?.[HISTORY_GUARD_STATE_KEY] === true;
        return;
      }

      if (!isDirtyRef.current) {
        clearStoredChatState('flow-exit-popstate');
        isHistoryGuardArmedRef.current = window.history.state?.[HISTORY_GUARD_STATE_KEY] === true;
        return;
      }

      // Re-arm the guard so the back navigation doesn't actually leave while the
      // autosave runs. On success we navigate home; otherwise we stay put.
      ensureHistoryGuardEntry();
      void autosaveThenLeave({
        proceed: () => {
          window.location.replace('/');
        },
        cleanupReason: 'flow-exit-popstate',
        onCannotSave: () => {
          ensureHistoryGuardEntry();
        },
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [autosaveThenLeave, clearStoredChatState, ensureHistoryGuardEntry]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePageHide = () => {
      // popstate doesn't fire on cross-document back/forward; clear here instead.
      // Skip if an in-app action already confirmed the exit (handoff/link/logout)
      // or if there are unsaved changes.
      if (shouldBypassPopStateRef.current || isDirtyRef.current) {
        return;
      }
      clearStoredChatState('flow-exit-pagehide');
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [clearStoredChatState]);

  useEffect(() => {
    // Browser back/forward that leaves /adu-chat unmounts this component before
    // its own popstate listener fires, so cleanup must live at module scope.
    registerExitDraftCleanup(() => {
      if (shouldBypassPopStateRef.current || isDirtyRef.current) {
        return;
      }
      clearStoredChatStateRef.current('flow-exit-back');
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleExitRequest = (event: Event) => {
      const { detail } = event as CustomEvent<ChatExitRequestDetail>;
      if (detail.reason !== 'logout') {
        return;
      }

      detail.handled = true;

      if (!isDirtyRef.current) {
        clearStoredChatState('flow-exit-logout');
        detail.proceed();
        return;
      }

      void autosaveThenLeave({
        proceed: () => {
          detail.proceed();
        },
        cleanupReason: 'flow-exit-logout',
      });
    };

    window.addEventListener(CHAT_EXIT_REQUEST_EVENT, handleExitRequest);
    return () => window.removeEventListener(CHAT_EXIT_REQUEST_EVENT, handleExitRequest);
  }, [autosaveThenLeave, clearStoredChatState]);

  return {
    beginProgrammaticExit,
    cancelProgrammaticExit,
  };
}
