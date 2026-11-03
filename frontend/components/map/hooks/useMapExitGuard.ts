'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CHAT_EXIT_REQUEST_EVENT, type ChatExitRequestDetail } from '@/lib/chatExitGuard';
import { registerExitDraftCleanup } from '@/lib/exitDraftCleanup';

const HISTORY_GUARD_STATE_KEY = '__aduMapUnsavedGuard';
const MAP_EXIT_FALLBACK_PATH = '/projects';

export type MapExitModalMode = 'unsaved' | 'invalid_placement';

type PendingExitAction = {
  proceed: () => void;
  stay?: () => void;
  isInPageAction?: boolean;
  mode: MapExitModalMode;
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

export function useMapExitGuard(
  hasInvalidPlacement: boolean,
  isDirty: boolean,
  onExitCleanup: (reason: string, cleanupScopeKey?: string) => void,
  onSaveBeforeLeave?: () => Promise<string | undefined>,
  activeProjectId?: string,
) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<MapExitModalMode>('unsaved');

  const hasInvalidPlacementRef = useRef(hasInvalidPlacement);
  hasInvalidPlacementRef.current = hasInvalidPlacement;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const isModalOpenRef = useRef(isModalOpen);
  isModalOpenRef.current = isModalOpen;
  const onExitCleanupRef = useRef(onExitCleanup);
  onExitCleanupRef.current = onExitCleanup;
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;

  const pendingExitActionRef = useRef<PendingExitAction | null>(null);
  const shouldBypassPopStateRef = useRef(false);
  const shouldBypassBeforeUnloadRef = useRef(false);
  const isHistoryGuardArmedRef = useRef(false);
  const isHistoryCleanupRef = useRef(false);
  const shouldSkipInitialHistoryCleanupRef = useRef(false);
  const isAutosavingRef = useRef(false);

  const closeModal = useCallback(() => {
    pendingExitActionRef.current = null;
    setModalMode('unsaved');
    setIsModalOpen(false);
  }, []);

  const openModal = useCallback((action: PendingExitAction) => {
    pendingExitActionRef.current = action;
    setModalMode(action.mode);
    setIsModalOpen(true);
  }, []);

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
    shouldBypassBeforeUnloadRef.current = true;
    shouldBypassPopStateRef.current = true;
    isHistoryGuardArmedRef.current = false;
    isHistoryCleanupRef.current = false;
    clearCurrentHistoryGuard();
  }, [clearCurrentHistoryGuard]);

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
          const cleanupScopeKey = await onSaveBeforeLeave();
          if (!cleanupScopeKey) {
            onCannotSave?.();
            return;
          }

          prepareConfirmedExit();
          onExitCleanup(cleanupReason, cleanupScopeKey);
          proceed();
          return;
        }

        prepareConfirmedExit();
        onExitCleanup(cleanupReason);
        proceed();
      } finally {
        isAutosavingRef.current = false;
      }
    },
    [onExitCleanup, onSaveBeforeLeave, prepareConfirmedExit],
  );

  const guardAction = useCallback(
    (action: () => void) => {
      if (!isDirtyRef.current) {
        action();
        return;
      }

      openModal({
        proceed: () => {
          closeModal();
          action();
        },
        isInPageAction: true,
        mode: 'unsaved',
      });
    },
    [closeModal, openModal],
  );

  const guardInvalidPlacementAction = useCallback(
    (action: () => void) => {
      openModal({
        proceed: () => {
          closeModal();
          action();
        },
        isInPageAction: true,
        mode: 'invalid_placement',
      });
    },
    [closeModal, openModal],
  );

  const handleStay = useCallback(() => {
    const stay = pendingExitActionRef.current?.stay;
    closeModal();
    stay?.();
  }, [closeModal]);

  const handleLeave = useCallback(() => {
    const action = pendingExitActionRef.current;
    pendingExitActionRef.current = null;

    if (action?.isInPageAction) {
      isHistoryGuardArmedRef.current = false;
      isHistoryCleanupRef.current = false;
      clearCurrentHistoryGuard();
    } else {
      prepareConfirmedExit();
    }

    setIsModalOpen(false);
    action?.proceed();
  }, [clearCurrentHistoryGuard, prepareConfirmedExit]);

  const bypassGuard = useCallback(
    (action: () => void) => {
      prepareConfirmedExit();
      closeModal();
      action();
    },
    [closeModal, prepareConfirmedExit],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const hasHistoryGuard = window.history.state?.[HISTORY_GUARD_STATE_KEY] === true;
    isHistoryGuardArmedRef.current = hasHistoryGuard;
    shouldSkipInitialHistoryCleanupRef.current = hasHistoryGuard;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (isDirty) {
      if (isModalOpen || shouldBypassPopStateRef.current) {
        return;
      }

      if (!isHistoryGuardArmedRef.current) {
        pushHistoryGuardEntry();
      }
      return;
    }

    if (!isHistoryGuardArmedRef.current || isModalOpen) {
      return;
    }

    if (shouldSkipInitialHistoryCleanupRef.current) {
      shouldSkipInitialHistoryCleanupRef.current = false;
      return;
    }

    isHistoryCleanupRef.current = true;
    isHistoryGuardArmedRef.current = false;
    window.history.back();
  }, [isDirty, isModalOpen, pushHistoryGuardEntry]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current || shouldBypassBeforeUnloadRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        isAutosavingRef.current ||
        isModalOpen ||
        !isPlainLeftClick(event) ||
        event.defaultPrevented
      ) {
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
        closeModal();
        if (nextUrl.origin === currentUrl.origin) {
          if (nextUrl.pathname === '/map') {
            window.location.assign(nextUrl.toString());
            return;
          }
          router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
          return;
        }
        window.location.assign(nextUrl.toString());
      };

      if (hasInvalidPlacementRef.current) {
        openModal({
          proceed: () => {
            prepareConfirmedExit();
            onExitCleanup('flow-exit-link');
            proceed();
          },
          mode: 'invalid_placement',
        });
        return;
      }

      if (!isDirtyRef.current) {
        prepareConfirmedExit();
        onExitCleanup('flow-exit-link');
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
  }, [
    autosaveThenLeave,
    closeModal,
    isModalOpen,
    onExitCleanup,
    openModal,
    prepareConfirmedExit,
    router,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePopState = () => {
      if (isHistoryCleanupRef.current) {
        isHistoryCleanupRef.current = false;
        // The guard-cleanup back() lands on the page's base history entry, which
        // for a freshly-saved (previously new) project never had projectId in its
        // URL — restore it so save-in-place doesn't strip the URL down to /map.
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

      if (hasInvalidPlacementRef.current) {
        ensureHistoryGuardEntry();
        if (isModalOpenRef.current) {
          return;
        }

        openModal({
          proceed: () => {
            prepareConfirmedExit();
            onExitCleanup('flow-exit-popstate');
            window.location.replace(MAP_EXIT_FALLBACK_PATH);
          },
          stay: () => {
            ensureHistoryGuardEntry();
          },
          mode: 'invalid_placement',
        });
        return;
      }

      if (!isDirtyRef.current) {
        onExitCleanup('flow-exit-popstate');
        isHistoryGuardArmedRef.current = window.history.state?.[HISTORY_GUARD_STATE_KEY] === true;
        return;
      }

      ensureHistoryGuardEntry();
      if (isModalOpenRef.current) {
        return;
      }

      void autosaveThenLeave({
        proceed: () => {
          window.location.replace(MAP_EXIT_FALLBACK_PATH);
        },
        cleanupReason: 'flow-exit-popstate',
        onCannotSave: () => {
          ensureHistoryGuardEntry();
        },
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [autosaveThenLeave, ensureHistoryGuardEntry, onExitCleanup, openModal, prepareConfirmedExit]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePageHide = () => {
      // popstate doesn't fire on cross-document back/forward; clear here instead.
      // Skip if an in-app action already confirmed the exit (handoff/link/logout),
      // if there are unsaved changes, or if placement is invalid (matches popstate).
      if (shouldBypassPopStateRef.current || isDirtyRef.current || hasInvalidPlacementRef.current) {
        return;
      }
      onExitCleanup('flow-exit-pagehide');
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [onExitCleanup]);

  useEffect(() => {
    // Browser back/forward that leaves /map unmounts this component before its
    // own popstate listener fires, so cleanup must live at module scope.
    registerExitDraftCleanup(() => {
      if (shouldBypassPopStateRef.current || isDirtyRef.current || hasInvalidPlacementRef.current) {
        return;
      }
      onExitCleanupRef.current('flow-exit-back');
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

      if (hasInvalidPlacementRef.current) {
        openModal({
          proceed: () => {
            closeModal();
            onExitCleanup('flow-exit-logout');
            detail.proceed();
          },
          mode: 'invalid_placement',
        });
        return;
      }

      if (!isDirtyRef.current) {
        onExitCleanup('flow-exit-logout');
        detail.proceed();
        return;
      }

      void autosaveThenLeave({
        proceed: () => {
          closeModal();
          detail.proceed();
        },
        cleanupReason: 'flow-exit-logout',
      });
    };

    window.addEventListener(CHAT_EXIT_REQUEST_EVENT, handleExitRequest);
    return () => window.removeEventListener(CHAT_EXIT_REQUEST_EVENT, handleExitRequest);
  }, [autosaveThenLeave, closeModal, onExitCleanup, openModal]);

  return {
    bypassGuard,
    guardAction,
    guardInvalidPlacementAction,
    modalMode,
    isModalOpen,
    handleStay,
    handleLeave,
  };
}
