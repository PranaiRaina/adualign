'use client';

import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, PanelLeftClose, PanelLeft } from 'lucide-react';
import { ChatMessage } from '@/components/chat-message';
import { ChatInput } from '@/components/chat-input';
import { TypingIndicator } from '@/components/typing-indicator';
import { WelcomeScreen } from '@/components/welcome-screen';
import { FeasibilitySidebar } from '@/components/feasibility-sidebar';
import { SourceDrawer, type SourceRef } from '@/components/source-drawer';
import { UsageMeter } from '@/components/UsageMeter';
import { useBudget } from '@/lib/context/UsageBudgetContext';
import type { AduClearance, AduType, FinanceStateSnapshot, PropertyContext } from '@/types';
import { useRouter } from 'next/navigation';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import { AuthModal } from '@/components/auth/AuthModal';
import { BlockingSessionEntryModal } from '@/components/BlockingSessionEntryModal';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  buildPlanningDraftScopeKey,
  clearPlanningDraftMapReturnBaseline,
  readPlanningDraft,
  updatePlanningDraft,
} from '@/lib/planningDraft';
import {
  EMPTY_PLANNING_DIRTY_SNAPSHOT,
  buildPlanningSessionDirtySnapshot,
} from '@/lib/planningDirtyState';
import { resolveEffectiveProjectId } from '@/lib/planningProjectLifecycle';
import { formatSqft } from '@/lib/utils/formatting';
import { useProjectStatus } from '@/lib/hooks/useProjectStatus';
import { DEFAULT_PROJECT_PREFERENCES, type ChatEntryMode, type ProjectPreferences } from './types';
import { isResumeBootstrapMessage, useChatDraftState } from './hooks/useChatDraftState';
import { useChatExitGuard } from './hooks/useChatExitGuard';
import { useCalculatorState } from './hooks/useCalculatorState';
import { useChatProjectHydration } from './hooks/useChatProjectHydration';
import { useProjectSave } from './hooks/useProjectSave';
import { useChatStreaming } from './hooks/useChatStreaming';
import { getUserFacingErrorMessage } from './api';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const RAG_API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const INVALID_PROJECT_MODAL_TITLE = 'This project is no longer available';
const INVALID_PROJECT_MODAL_DESCRIPTION =
  'This project no longer exists or is no longer available. Leave now to avoid stale project state.';
const MANUAL_FIRE_HAZARD_ZONE_TYPE = 'Manual';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function generateId() {
  return Math.random().toString(36).substring(2, 12);
}

const ADU_TYPE_TEXT: Record<string, string> = {
  detached: 'a detached ADU',
  attached: 'an attached ADU',
  garage_conversion: 'a garage conversion ADU',
  jadu: 'a junior ADU',
  unsure: 'an ADU',
};

function getAduTypeText(aduType?: AduType): string {
  if (!aduType) return 'an ADU';
  return ADU_TYPE_TEXT[aduType] ?? 'an ADU';
}

function buildMapResumeUrl(context: PropertyContext | undefined, projectId?: string): string {
  if (!context?.address) {
    return '/map';
  }

  const params = new URLSearchParams({
    fromChat: '1',
    address: context.address,
  });

  if (context.lat !== undefined) {
    params.set('lat', String(context.lat));
  }

  if (context.lng !== undefined) {
    params.set('lng', String(context.lng));
  }

  params.set('name', context.address);

  if (context.county) params.set('county', context.county);
  if (context.aduType) params.set('aduType', context.aduType);
  if (context.aduSize !== undefined) params.set('aduSize', String(context.aduSize));
  if (context.aduWidthFt !== undefined) params.set('aduWidthFt', String(context.aduWidthFt));
  if (context.aduLengthFt !== undefined) params.set('aduLengthFt', String(context.aduLengthFt));
  if (context.aduShape) params.set('aduShape', context.aduShape);
  if (context.setback !== undefined) params.set('setback', String(context.setback));
  if (context.propertyArea !== undefined) params.set('propertyArea', String(context.propertyArea));
  if (context.buildableArea !== undefined)
    params.set('buildableArea', String(context.buildableArea));
  if (context.maxAduSqft !== undefined) params.set('maxAduSqft', String(context.maxAduSqft));
  if (context.apn) params.set('apn', context.apn);
  if (context.fireHazardSeverity) params.set('fireHazardSeverity', context.fireHazardSeverity);
  if (context.fireHazardZoneType) params.set('fireHazardZoneType', context.fireHazardZoneType);
  if (context.currentYardZone) params.set('currentYardZone', context.currentYardZone);
  if (context.aduClearances?.length) {
    params.set('aduClearances', JSON.stringify(context.aduClearances));
  }

  if (projectId) {
    params.set('projectId', projectId);
  }

  return `/map?${params.toString()}`;
}

function formatAduTypeLabel(aduType?: AduType) {
  if (!aduType) return null;
  return aduType.replace('_', ' ');
}

function formatContextValue(value: string | undefined) {
  return value && value.trim() ? value : null;
}

const MAP_RETURN_CLEARANCE_DIRECTIONS: AduClearance['direction'][] = [
  'top',
  'right',
  'bottom',
  'left',
];

function formatMapReturnLabel(value: string | undefined) {
  return formatContextValue(value)?.replace(/[_-]/g, ' ') ?? null;
}

function formatMapReturnNumber(value: number | undefined, fractionDigits = 0) {
  if (value === undefined) return null;
  return value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function formatMapReturnDimensions(context: PropertyContext | undefined) {
  const width = formatMapReturnNumber(context?.aduWidthFt, 1);
  const length = formatMapReturnNumber(context?.aduLengthFt, 1);
  return width && length ? `${width} x ${length} ft` : null;
}

function formatMapReturnFireHazard(context: PropertyContext | undefined) {
  const severity = formatMapReturnLabel(context?.fireHazardSeverity);
  if (!severity || severity.toLowerCase() === 'unknown') {
    return 'Unknown - **set it in the Requirements tab**';
  }

  return severity;
}

function formatClearanceTarget(clearance: AduClearance) {
  return clearance.targetKind === 'active-structure' ? 'nearby structure' : 'parcel boundary';
}

function formatMapReturnClearance(
  context: PropertyContext | undefined,
  direction: AduClearance['direction'],
) {
  const clearance = context?.aduClearances?.find((item) => item.direction === direction);
  const distance = formatMapReturnNumber(clearance?.distanceFeet, 1);
  return clearance && distance ? `${distance} ft to ${formatClearanceTarget(clearance)}` : null;
}

function appendMapReturnChange(currentValue: string | null, previousValue: string | null) {
  const displayValue = currentValue ?? 'Not available';
  if (!previousValue || previousValue === currentValue) return displayValue;
  return `${displayValue} (changed from ${previousValue})`;
}

function buildMapReturnDetailBullet(
  label: string,
  currentValue: string | null,
  previousValue: string | null,
) {
  return `- ${label}: ${appendMapReturnChange(currentValue, previousValue)}`;
}

function buildContextDetailBullet(label: string, currentValue: string | null) {
  return `- ${label}: ${currentValue ?? 'Not available'}`;
}

function formatClearanceDirectionLabel(direction: AduClearance['direction']) {
  return `${direction[0].toUpperCase()}${direction.slice(1)} setback`;
}

function appendCurrentClearanceBullets(bullets: string[], current: PropertyContext | undefined) {
  for (const direction of MAP_RETURN_CLEARANCE_DIRECTIONS) {
    bullets.push(
      buildContextDetailBullet(
        formatClearanceDirectionLabel(direction),
        formatMapReturnClearance(current, direction),
      ),
    );
  }
}

function buildContextDetailBullets(current: PropertyContext | undefined) {
  const bullets = [
    buildContextDetailBullet('ADU size', current?.aduSize ? formatSqft(current.aduSize) : null),
    buildContextDetailBullet('Shape', formatMapReturnLabel(current?.aduShape)),
    buildContextDetailBullet('Type', formatAduTypeLabel(current?.aduType)),
    buildContextDetailBullet('Yard zone', formatMapReturnLabel(current?.currentYardZone)),
    buildContextDetailBullet('Dimensions', formatMapReturnDimensions(current)),
    buildContextDetailBullet('Fire hazard zone', formatMapReturnFireHazard(current)),
  ];

  appendCurrentClearanceBullets(bullets, current);
  return bullets;
}

function buildMapReturnDetailBullets(
  previous: PropertyContext | null,
  current: PropertyContext | undefined,
) {
  const previousSize = previous?.aduSize ? formatSqft(previous.aduSize) : null;
  const currentSize = current?.aduSize ? formatSqft(current.aduSize) : null;
  const bullets = [
    buildMapReturnDetailBullet('ADU size', currentSize, previousSize),
    buildMapReturnDetailBullet(
      'Shape',
      formatMapReturnLabel(current?.aduShape),
      formatMapReturnLabel(previous?.aduShape),
    ),
    buildMapReturnDetailBullet(
      'Type',
      formatAduTypeLabel(current?.aduType),
      formatAduTypeLabel(previous?.aduType),
    ),
    buildMapReturnDetailBullet(
      'Yard zone',
      formatMapReturnLabel(current?.currentYardZone),
      formatMapReturnLabel(previous?.currentYardZone),
    ),
    buildMapReturnDetailBullet(
      'Dimensions',
      formatMapReturnDimensions(current),
      formatMapReturnDimensions(previous ?? undefined),
    ),
    `- Fire hazard zone: ${formatMapReturnFireHazard(current)}`,
  ];

  for (const direction of MAP_RETURN_CLEARANCE_DIRECTIONS) {
    bullets.push(
      buildMapReturnDetailBullet(
        formatClearanceDirectionLabel(direction),
        formatMapReturnClearance(current, direction),
        formatMapReturnClearance(previous ?? undefined, direction),
      ),
    );
  }

  return bullets;
}

function buildMapReturnSummary(
  currentContext: PropertyContext | undefined,
  previousContext: PropertyContext | null,
) {
  const address = currentContext?.address ?? 'this property';
  const details = buildMapReturnDetailBullets(previousContext, currentContext).join('\n');

  return `You're back in planning for ${address}. I loaded your latest map configuration with:\n${details}\n\nMost homeowners after adjusting their layout have questions about how those changes affect their overall costs, what complications might apply to their updated configuration, or how to keep the build financeable. What's on your mind?`;
}

function buildMapEntrySummary(context: PropertyContext | undefined) {
  const address = context?.address ?? 'this property';
  const details = buildContextDetailBullets(context).join('\n');

  return `You're ready to plan an ADU for ${address}. I loaded this map configuration with:\n${details}\n\nMost homeowners at this stage have questions about how to reduce their overall costs, how to navigate permits in their city, or what financing options are available to them. What's on your mind?`;
}

function buildProjectResumeSummary(context: PropertyContext | undefined) {
  const address = context?.address ?? 'this saved project';
  const details = buildContextDetailBullets(context).join('\n');

  return `Welcome back to planning for ${address}. I loaded this saved project with:\n${details}\n\nMost homeowners picking back up on a project have questions about next steps, how to bring costs down before committing to a budget, or what the permitting process looks like from here. What's on your mind?`;
}

function buildIntroSuggestions(args: {
  context: PropertyContext | undefined;
  financeState: FinanceStateSnapshot | null;
  preferences: ProjectPreferences;
}) {
  const suggestions: string[] = [];
  if (args.context?.fireHazardSeverity) {
    suggestions.push('What are my mitigation strategies for the fire zone?');
  }
  if (!hasFinanceEstimate(args.financeState)) {
    suggestions.push('Help me calculate my project budget.');
  }
  if (args.preferences.blockerTypes.length > 0) {
    suggestions.push(`How should I handle ${args.preferences.blockerTypes[0]}?`);
  }
  if (args.context?.currentYardZone || args.context?.aduClearances?.length) {
    suggestions.push('What does this placement mean for my layout?');
  }
  suggestions.push('What are the next steps to get permit-ready?');
  return Array.from(new Set(suggestions)).slice(0, 4);
}

function hasFinanceEstimate(financeState: FinanceStateSnapshot | null) {
  return Boolean(financeState?.base_estimate_range || financeState?.complication_adjusted_range);
}

function buildPlanningContextSummary(context: PropertyContext | undefined): string | undefined {
  if (!context) return undefined;

  const summaryParts = [
    context.address,
    context.aduType ? getAduTypeText(context.aduType) : null,
    context.aduSize ? formatSqft(context.aduSize) : null,
  ].filter(Boolean);

  return summaryParts.length > 0 ? summaryParts.join(' • ') : undefined;
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

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

interface RAGChatProps {
  propertyContext?: PropertyContext;
  projectId?: string;
  entryMode?: ChatEntryMode;
}

export function RAGChat({ propertyContext, projectId, entryMode = 'default' }: RAGChatProps) {
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(projectId);
  const [initialized, setInitialized] = useState(false);
  const [localContext, setLocalContext] = useState<PropertyContext | undefined>(propertyContext);
  const [planningMapSnapshot, setPlanningMapSnapshot] = useState(
    () => readPlanningDraft(buildPlanningDraftScopeKey(projectId))?.mapSnapshot ?? null,
  );
  const [projectPreferences, setProjectPreferences] = useState<ProjectPreferences>(
    DEFAULT_PROJECT_PREFERENCES,
  );
  const [financeState, setFinanceState] = useState<FinanceStateSnapshot | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  // Below lg the side panels overlay the chat instead of sharing its width.
  // Sidebar visibility is derived per mode: the desktop preference survives
  // resizes (a breakpoint change never overwrites what the user chose), while
  // the mobile overlay is transient and always starts closed.
  const [isDesktop, setIsDesktop] = useState(true);
  const [desktopSidebarPref, setDesktopSidebarPref] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarOpen = isDesktop ? desktopSidebarPref : mobileSidebarOpen;
  const setSidebarOpen = useCallback(
    (open: boolean) => {
      if (isDesktop) {
        setDesktopSidebarPref(open);
      } else {
        setMobileSidebarOpen(open);
      }
    },
    [isDesktop],
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      setIsDesktop(mq.matches);
      if (!mq.matches) setMobileSidebarOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingRequirements, setIsUpdatingRequirements] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<{
    active: SourceRef;
    all: SourceRef[];
  } | null>(null);

  const router = useRouter();
  const budget = useBudget();
  const refreshBudget = budget.refresh;
  const isBudgetBlocked = budget.isExhausted || isRateLimited;
  const propertyContextSnapshot = propertyContext ? JSON.stringify(propertyContext) : '';

  const mapReturnBaselineContextRef = useRef<PropertyContext | null>(null);
  const autoResumedRef = useRef(false);
  const autoStartedMapSummaryRef = useRef(false);
  const hasDismissedAuthGateRef = useRef(false);
  const hasSeededMapReturnSummaryRef = useRef(false);
  const pendingHydrationDirtyBaselineRef = useRef<{
    financeState: FinanceStateSnapshot | null;
    mapSnapshot: typeof planningMapSnapshot;
    projectPreferences: ProjectPreferences;
    propertyContext?: PropertyContext;
  } | null>(null);

  const buildHydrationBaselineSnapshot = useCallback(
    (args: {
      financeState: FinanceStateSnapshot | null;
      mapSnapshot: typeof planningMapSnapshot;
      projectPreferences: ProjectPreferences;
      propertyContext?: PropertyContext;
    }) =>
      buildPlanningSessionDirtySnapshot({
        financeState: args.financeState,
        mapSnapshot: args.mapSnapshot,
        propertyContext: args.propertyContext,
      }),
    [],
  );

  const markAutoResumed = useCallback(() => {
    autoResumedRef.current = true;
  }, []);

  const replaceChatUrl = useCallback(
    (url: string) => {
      router.replace(url);
    },
    [router],
  );

  const setMapReturnBaselineContext = useCallback((context: PropertyContext | null) => {
    mapReturnBaselineContextRef.current = context;
  }, []);

  const openPlanningAuthModal = useCallback(() => {
    hasDismissedAuthGateRef.current = false;
    setIsAuthModalOpen(true);
  }, []);

  const {
    messages,
    replaceSuggestions,
    replaceMessages,
    resetStreamingState,
    sendMessage,
    streamingContent,
    streamingSources,
    streamingStage,
    suggestions,
  } = useChatStreaming({
    activeProjectId,
    apiBaseUrl: RAG_API_URL,
    createMessageId: generateId,
    financeState,
    getProtectedAuthHeaders: getAuthHeaders,
    isAuthLoading,
    isBudgetBlocked,
    isLoading,
    isLoggedIn,
    localContext,
    openPlanningAuthModal,
    projectPreferences,
    refreshBudget,
    setError,
    setFinanceState,
    setInput,
    setIsLoading,
    setIsRateLimited,
  });

  const { applyDirtyBaseline, clearStoredChatState, isDirty, resetDirtyTracking } =
    useChatDraftState({
      activeProjectId,
      financeState,
      initialized,
      mapSnapshot: planningMapSnapshot,
      projectId,
      propertyContext: localContext,
    });

  const commitDirtyBaseline = useCallback(
    (snapshot: string) => {
      pendingHydrationDirtyBaselineRef.current = null;
      applyDirtyBaseline(snapshot);
    },
    [applyDirtyBaseline],
  );

  const queueHydrationDirtyBaseline = useCallback(
    (args: {
      financeState: FinanceStateSnapshot | null;
      mapSnapshot: typeof planningMapSnapshot;
      projectPreferences: ProjectPreferences;
      propertyContext?: PropertyContext;
    }) => {
      pendingHydrationDirtyBaselineRef.current = args;
    },
    [],
  );

  const flushQueuedHydrationDirtyBaseline = useCallback(
    (nextFinanceState: FinanceStateSnapshot | null) => {
      const pendingBaseline = pendingHydrationDirtyBaselineRef.current;
      if (!pendingBaseline) {
        return;
      }

      commitDirtyBaseline(
        buildHydrationBaselineSnapshot({
          ...pendingBaseline,
          financeState: nextFinanceState ?? pendingBaseline.financeState,
        }),
      );
    },
    [buildHydrationBaselineSnapshot, commitDirtyBaseline],
  );

  const {
    hasHydratedMapSnapshotRef,
    hydratedMapSnapshotRef,
    invalidProjectId,
    markProjectHydrated,
    resetHydrationState,
  } = useChatProjectHydration({
    activeProjectId,
    apiBaseUrl: RAG_API_URL,
    applyDirtyBaseline: commitDirtyBaseline,
    buildHydrationBaselineSnapshot,
    defaultProjectPreferences: DEFAULT_PROJECT_PREFERENCES,
    emptyPlanningDirtySnapshot: EMPTY_PLANNING_DIRTY_SNAPSHOT,
    entryMode,
    getAuthHeaders,
    initialized,
    isAuthLoading,
    isLoggedIn,
    isSaving: isSaving || isUpdatingRequirements,
    localContext,
    markAutoResumed,
    projectId,
    propertyContextSnapshot,
    queueHydrationDirtyBaseline,
    replaceUrl: replaceChatUrl,
    resetDirtyTracking,
    setActiveProjectId,
    setError,
    setFinanceState,
    setInitialized,
    setLocalContext,
    setPlanningMapSnapshot,
    setMapReturnBaselineContext,
    setProjectPreferences,
  });

  const {
    calculatorError,
    calculatorPresentation,
    isCalculatorLoading,
    refreshCalculator,
    resetCalculatorState,
  } = useCalculatorState({
    activeProjectId,
    apiBaseUrl: RAG_API_URL,
    financeState,
    getProtectedAuthHeaders: getAuthHeaders,
    initialized,
    isAuthLoading,
    isLoggedIn,
    isSaving,
    suppressAutoRefresh: isUpdatingRequirements,
    localContext,
    onAutoRefreshSettled: flushQueuedHydrationDirtyBaseline,
    openPlanningAuthModal,
    setFinanceState,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const propertyContextRef = useRef(localContext);
  propertyContextRef.current = localContext;
  const financeStateRef = useRef(financeState);
  financeStateRef.current = financeState;

  const effectiveProjectId = resolveEffectiveProjectId({
    sessionProjectId: activeProjectId,
    routeProjectId: projectId,
  });
  const projectStatusInfo = useProjectStatus(effectiveProjectId);

  const planningContextSummary = buildPlanningContextSummary(localContext);
  const planningDraftScopeKey = buildPlanningDraftScopeKey(effectiveProjectId);
  const exitGuardResetKey = `${entryMode}|${projectId ?? ''}|${propertyContextSnapshot}`;

  const { handleSaveProject } = useProjectSave({
    activeProjectId: effectiveProjectId,
    apiBaseUrl: RAG_API_URL,
    applyDirtyBaseline: commitDirtyBaseline,
    ensureProjectIdInUrl,
    getAuthHeaders,
    hasHydratedMapSnapshotRef,
    hydratedMapSnapshotRef,
    isAuthLoading,
    isLoggedIn,
    localContext,
    markProjectHydrated,
    openPlanningAuthModal,
    planningDraftScopeKey,
    planningMapSnapshot,
    projectPreferences,
    refreshCalculator: () => refreshCalculator(),
    resetHydrationState,
    setActiveProjectId,
    setError,
    setIsSaving,
    setPlanningMapSnapshot,
  });

  const { beginProgrammaticExit, cancelProgrammaticExit } = useChatExitGuard({
    activeProjectId: effectiveProjectId,
    clearStoredChatState,
    initialized,
    isDirty,
    onSaveBeforeLeave: async () => {
      const savedProjectId = await handleSaveProject();
      return Boolean(savedProjectId);
    },
    resetKey: exitGuardResetKey,
  });

  useEffect(() => {
    autoResumedRef.current = false;
    autoStartedMapSummaryRef.current = false;
    mapReturnBaselineContextRef.current = null;
    hasSeededMapReturnSummaryRef.current = false;
    pendingHydrationDirtyBaselineRef.current = null;
    resetCalculatorState();
    replaceMessages([]);
    resetStreamingState();
    setInput('');
    setError(null);
    setIsRateLimited(false);
  }, [
    entryMode,
    projectId,
    propertyContextSnapshot,
    replaceMessages,
    resetCalculatorState,
    resetStreamingState,
  ]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (isLoggedIn) {
      hasDismissedAuthGateRef.current = false;
      setIsAuthModalOpen(false);
      return;
    }
    if (!initialized || hasDismissedAuthGateRef.current) {
      return;
    }
    setIsAuthModalOpen(true);
  }, [initialized, isAuthLoading, isLoggedIn]);

  /* ---- Auto-scroll: pinned to bottom until the user scrolls up ---- */
  // Programmatic scrolls are always instant and downward, so any upward scroll
  // movement is the user's — that alone unpins. Re-pin only at the bottom.
  const isPinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    isPinnedRef.current = true;
    setShowJumpToBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // On the JSX div (not addEventListener in a mount effect) because the chat
  // container doesn't exist yet while the welcome screen is up.
  const handleChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    if (el.scrollHeight - top - el.clientHeight < 40) {
      isPinnedRef.current = true;
      setShowJumpToBottom(false);
    } else if (top < lastScrollTopRef.current - 1) {
      isPinnedRef.current = false;
    }
    lastScrollTopRef.current = top;
  }, []);

  useEffect(() => {
    if (!isPinnedRef.current) {
      if (isLoading) setShowJumpToBottom(true);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    });
  }, [streamingContent, streamingStage, messages.length, isLoading]);

  /* ---- Auto-send resume message when loading a project ---- */
  useEffect(() => {
    if (entryMode !== 'map-return' || !initialized || hasSeededMapReturnSummaryRef.current) {
      return;
    }
    if (messages.length > 0 || !localContext) {
      return;
    }

    hasSeededMapReturnSummaryRef.current = true;
    replaceMessages([
      {
        id: generateId(),
        role: 'assistant',
        content: buildMapReturnSummary(localContext, mapReturnBaselineContextRef.current),
      },
    ]);
    replaceSuggestions(
      buildIntroSuggestions({
        context: localContext,
        financeState,
        preferences: projectPreferences,
      }),
    );
    clearPlanningDraftMapReturnBaseline(planningDraftScopeKey);
  }, [
    entryMode,
    financeState,
    initialized,
    localContext,
    messages.length,
    planningDraftScopeKey,
    projectPreferences,
    replaceMessages,
    replaceSuggestions,
  ]);

  useEffect(() => {
    if (
      entryMode === 'map-return' ||
      !initialized ||
      !activeProjectId ||
      localContext?.fromMap ||
      autoResumedRef.current ||
      messages.length > 0
    ) {
      return;
    }
    autoResumedRef.current = true;
    replaceMessages([
      {
        id: generateId(),
        role: 'assistant',
        content: buildProjectResumeSummary(localContext),
      },
    ]);
    replaceSuggestions(
      buildIntroSuggestions({
        context: localContext,
        financeState,
        preferences: projectPreferences,
      }),
    );
  }, [
    activeProjectId,
    entryMode,
    financeState,
    initialized,
    localContext,
    messages.length,
    projectPreferences,
    replaceMessages,
    replaceSuggestions,
  ]);

  useEffect(() => {
    if (
      entryMode === 'map-return' ||
      !initialized ||
      autoStartedMapSummaryRef.current ||
      messages.length > 0
    ) {
      return;
    }
    if (!localContext?.fromMap) return;

    autoStartedMapSummaryRef.current = true;
    replaceMessages([
      {
        id: generateId(),
        role: 'assistant',
        content: buildMapEntrySummary(localContext),
      },
    ]);
    replaceSuggestions(
      buildIntroSuggestions({
        context: localContext,
        financeState,
        preferences: projectPreferences,
      }),
    );
  }, [
    entryMode,
    financeState,
    initialized,
    localContext?.fromMap,
    localContext,
    messages.length,
    projectPreferences,
    replaceMessages,
    replaceSuggestions,
  ]);

  /* ---------------------------------------------------------------- */
  /*  Regular chat handlers                                           */
  /* ---------------------------------------------------------------- */

  const ensureProjectForChatTurn = useCallback(async () => {
    if (activeProjectId) {
      return activeProjectId;
    }
    if (isAuthLoading || !isLoggedIn) {
      return undefined;
    }
    return handleSaveProject();
  }, [activeProjectId, handleSaveProject, isAuthLoading, isLoggedIn]);

  const sendSavedMessage = useCallback(
    async (text: string) => {
      scrollToBottom();
      if (activeProjectId) {
        await sendMessage(text);
        return;
      }
      if (isAuthLoading || !isLoggedIn) {
        await sendMessage(text);
        return;
      }

      const savedProjectId = await ensureProjectForChatTurn();
      if (!savedProjectId) {
        return;
      }

      await sendMessage(text, { projectIdOverride: savedProjectId });
    },
    [
      activeProjectId,
      ensureProjectForChatTurn,
      isAuthLoading,
      isLoggedIn,
      scrollToBottom,
      sendMessage,
    ],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      await sendSavedMessage(input);
    },
    [input, sendSavedMessage],
  );

  const handleToggleManualAddon = useCallback(
    async (key: string, nextValue: boolean) => {
      const nextFinanceState: FinanceStateSnapshot = {
        ...(financeStateRef.current ?? {}),
        complication_flags: {
          ...(financeStateRef.current?.complication_flags ?? {}),
          [key]: nextValue,
        },
      };
      try {
        await refreshCalculator(nextFinanceState);
      } catch {
        return;
      }
    },
    [refreshCalculator],
  );

  const handleFireHazardChange = useCallback(
    async (severity: string) => {
      const nextContext: PropertyContext = {
        ...(propertyContextRef.current ?? {}),
        fireHazardSeverity: severity,
        fireHazardZoneType: MANUAL_FIRE_HAZARD_ZONE_TYPE,
      };
      const nextFinanceState: FinanceStateSnapshot = {
        ...(financeStateRef.current ?? {}),
        fire_hazard_severity: severity,
        fire_hazard_zone_type: MANUAL_FIRE_HAZARD_ZONE_TYPE,
      };

      setLocalContext(nextContext);
      setIsUpdatingRequirements(true);
      setError(null);

      try {
        const calculatorResponse = await refreshCalculator(nextFinanceState, {
          propertyContext: nextContext,
        });
        if (!calculatorResponse) return;

        updatePlanningDraft(planningDraftScopeKey, {
          financeState: calculatorResponse.finance_state,
          mapSnapshot: planningMapSnapshot,
          propertyContext: nextContext,
        });
      } catch (error) {
        console.error('Failed to update fire hazard status:', error);
        setError(getUserFacingErrorMessage('updateProject', error));
      } finally {
        setIsUpdatingRequirements(false);
      }
    },
    [planningDraftScopeKey, planningMapSnapshot, refreshCalculator, setError],
  );

  const handleSaveButtonClick = useCallback(async () => {
    if (!isDirty && activeProjectId) {
      clearStoredChatState('flow-exit-button');
      router.push('/projects');
      return;
    }

    await handleSaveProject();
  }, [activeProjectId, clearStoredChatState, handleSaveProject, isDirty, router]);

  const handleBackToMapClick = useCallback(async () => {
    const resumeContext = propertyContextRef.current;
    if (!resumeContext?.address) {
      return;
    }

    if (isAuthLoading) {
      return;
    }

    if (!isLoggedIn) {
      openPlanningAuthModal();
      return;
    }

    // Save always (even when clean) so chat and map share the same server state.
    // Flag a programmatic exit first so the dirty-exit guard does not call
    // history.back() when the save clears isDirty.
    beginProgrammaticExit();

    try {
      const savedProjectId = await handleSaveProject();
      if (!savedProjectId) {
        cancelProgrammaticExit();
        return;
      }

      clearStoredChatState('flow-back-to-map');
      router.push(buildMapResumeUrl(resumeContext, savedProjectId));
    } catch {
      cancelProgrammaticExit();
    }
  }, [
    beginProgrammaticExit,
    cancelProgrammaticExit,
    clearStoredChatState,
    handleSaveProject,
    isAuthLoading,
    isLoggedIn,
    openPlanningAuthModal,
    router,
  ]);
  const handleInvalidProjectLeave = useCallback(() => {
    router.replace('/projects');
  }, [router]);

  /* ---------------------------------------------------------------- */
  /*  Derived state                                                   */
  /* ---------------------------------------------------------------- */

  if (invalidProjectId) {
    return (
      <BlockingSessionEntryModal
        title={INVALID_PROJECT_MODAL_TITLE}
        description={INVALID_PROJECT_MODAL_DESCRIPTION}
        onLeave={handleInvalidProjectLeave}
      />
    );
  }

  if (!initialized) return <div className="relative flex h-dvh" />;

  const hasMessages = messages.length > 0;
  const showWelcomeScreen =
    !hasMessages && !isLoading && !localContext?.fromMap && !activeProjectId;
  const canReturnToMap = Boolean(localContext?.address);
  const isSaveButtonBusy = isSaving || isCalculatorLoading;
  const isUnsavedProject = !activeProjectId;
  const isSaveButtonDisabled = isSaveButtonBusy;
  const saveButtonLabel = isSaveButtonBusy
    ? isSaving
      ? 'Saving Project…'
      : 'Preparing Estimate…'
    : isUnsavedProject || isDirty
      ? 'Save Project'
      : 'Exit';

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Sidebar: shares the row on desktop, overlays the chat below lg */}
      <div
        className={`shrink-0 border-r border-surface-200 bg-surface-0 transition-[width] duration-300 ease-out overflow-hidden max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:shadow-2xl ${
          !sidebarOpen ? 'w-0' : selectedSource ? 'w-[60px] max-lg:w-0' : 'w-[320px]'
        }`}
      >
        <div
          className={`${selectedSource && sidebarOpen ? 'w-[60px]' : 'w-[320px]'} h-full transition-[width] duration-300 ease-out`}
        >
          <FeasibilitySidebar
            propertyContext={localContext}
            calculatorPresentation={calculatorPresentation}
            isCalculatorLoading={isCalculatorLoading}
            calculatorError={calculatorError}
            onToggleManualAddon={handleToggleManualAddon}
            onFireHazardChange={handleFireHazardChange}
            collapsed={!!selectedSource}
          />
        </div>
      </div>

      {/* Backdrop for overlaid panels below lg */}
      {(sidebarOpen || selectedSource) && (
        <div
          className="lg:hidden absolute inset-0 z-20 bg-slate-900/30"
          onClick={() => {
            setSelectedSource(null);
            setSidebarOpen(false);
          }}
        />
      )}

      {/* Main chat panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3.5 shrink-0 border-b border-surface-100 bg-surface-0 overflow-visible relative z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-surface-500 hover:text-surface-800 hover:bg-surface-100 transition-colors duration-200 cursor-pointer"
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeft className="w-4 h-4" />
              )}
            </button>
            <div className="h-5 w-px bg-surface-200" />
            <div className="min-w-0">
              <h1
                className="text-sm font-semibold text-surface-900 tracking-tight leading-none truncate max-w-[140px] sm:max-w-[360px]"
                title={localContext?.address || 'ADU Advisor'}
              >
                {localContext?.address
                  ? localContext.address.split(',').slice(0, 2).join(',')
                  : 'ADU Advisor'}
              </h1>
              <p className="text-[11px] text-surface-500 mt-0.5">
                {!localContext?.address
                  ? 'California HCD Handbook'
                  : projectStatusInfo.workflowState === 'loading'
                    ? 'Loading project…'
                    : ['saved', 'has_report', 'has_draft'].includes(projectStatusInfo.workflowState)
                      ? 'Editing saved project · ADU Advisor'
                      : 'Creating new project · ADU Advisor'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="max-sm:hidden">
              <UsageMeter />
            </div>
            {canReturnToMap && (
              <button
                type="button"
                disabled={isSaveButtonBusy || isAuthLoading}
                onClick={() => {
                  void handleBackToMapClick();
                }}
                className="flex items-center gap-2 rounded-lg border border-surface-200 px-3.5 py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 cursor-pointer disabled:cursor-wait disabled:opacity-60"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={2} />
                <span className="max-sm:hidden">Back to map</span>
              </button>
            )}
            <button
              disabled={isSaveButtonDisabled}
              onClick={() => {
                void handleSaveButtonClick();
              }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm flex items-center gap-2 whitespace-nowrap ${
                isSaveButtonBusy
                  ? 'bg-surface-400 text-white cursor-wait'
                  : 'bg-surface-900 hover:bg-surface-800 text-white cursor-pointer'
              }`}
            >
              {isSaveButtonBusy ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {saveButtonLabel}
                </>
              ) : (
                saveButtonLabel
              )}
            </button>
          </div>
        </header>

        {/* Chat area */}
        {!showWelcomeScreen ? (
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div
              ref={scrollRef}
              onScroll={handleChatScroll}
              className="flex-1 overflow-y-auto chat-scrollbar px-5 py-5"
            >
              <div className="flex flex-col gap-5 max-w-3xl mx-auto pb-2">
                {messages.map((msg, i) => {
                  if (msg.isHidden || isResumeBootstrapMessage(msg.content)) return null;
                  return (
                    <ChatMessage
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      sources={msg.sources}
                      isLatest={i === messages.length - 1}
                      onSourceClick={(active, all) => setSelectedSource({ active, all })}
                    />
                  );
                })}

                {isLoading && (
                  <div className="flex flex-col gap-5 animate-fade-in-up">
                    {!streamingContent ? (
                      streamingStage ? (
                        <TypingIndicator stage={streamingStage} />
                      ) : null
                    ) : (
                      <ChatMessage
                        role="assistant"
                        content={streamingContent}
                        sources={streamingSources}
                        isStreaming={true}
                        isLatest={true}
                        onSourceClick={(active, all) => setSelectedSource({ active, all })}
                      />
                    )}
                  </div>
                )}

                {error && (
                  <div
                    className={`rounded-xl border px-4 py-3 animate-fade-in-up ${
                      isRateLimited ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50'
                    }`}
                  >
                    <p className="text-sm text-surface-800">{error}</p>
                  </div>
                )}
              </div>
            </div>
            {showJumpToBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-surface-200 bg-surface-0 px-3 py-1.5 text-xs font-medium text-surface-700 shadow-md hover:bg-surface-100 transition-colors cursor-pointer"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                Jump to latest
              </button>
            )}
          </div>
        ) : (
          <WelcomeScreen />
        )}

        {/* Input dock */}
        <div className="max-w-3xl mx-auto w-full px-5">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            suggestions={suggestions}
            onSuggestionClick={(q) => {
              void sendSavedMessage(q);
            }}
            budgetExhausted={budget.isLoaded && isBudgetBlocked}
          />
        </div>
      </div>

      {/* Right panel Source Viewer: shares the row on desktop, overlays below lg */}
      <div
        className={`shrink-0 border-l border-surface-200 bg-surface-0 transition-[width,opacity] duration-300 ease-out overflow-hidden max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-2xl ${
          selectedSource ? 'w-[35vw] max-lg:w-[min(420px,100%)] opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <div className="w-[35vw] max-lg:w-[min(420px,100vw)] h-full">
          <SourceDrawer
            activeSource={selectedSource?.active ?? null}
            allSources={selectedSource?.all ?? []}
            onSelectSource={(source) =>
              setSelectedSource((prev) => (prev ? { ...prev, active: source } : null))
            }
            onClose={() => {
              setSelectedSource(null);
              if (isDesktop) setSidebarOpen(true);
            }}
          />
        </div>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          hasDismissedAuthGateRef.current = true;
          setIsAuthModalOpen(false);
        }}
        onSuccess={() => {
          hasDismissedAuthGateRef.current = false;
          setIsAuthModalOpen(false);
        }}
        defaultTab="signin"
        title={
          localContext?.fromMap
            ? 'Sign in to plan this ADU'
            : 'Sign in to use the ADU planning assistant'
        }
        variant={localContext?.fromMap ? 'planning' : 'default'}
        description={
          localContext?.fromMap
            ? 'Save this property, use the planning chatbot, refresh your cost estimate, and generate a report for this exact layout.'
            : 'Your planning chat, cost estimate, saved projects, and reports live in your account.'
        }
        highlights={[
          'Save this parcel and placement',
          'Ask the ADU planning chatbot',
          'Generate a report from this design',
        ]}
        contextSummary={planningContextSummary}
      />
    </div>
  );
}
