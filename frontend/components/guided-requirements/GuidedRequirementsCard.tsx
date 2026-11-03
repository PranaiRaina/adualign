'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from 'react';
import { Loader2, CheckCircle2, RotateCcw, AlertTriangle, X, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/utils/supabase/client';
import { redirectToLogin } from '@/lib/utils/authRedirect';
import { useBudget } from '@/lib/context/UsageBudgetContext';
import { ApiRequestError, getUserFacingErrorMessage } from '@/components/rag-chat/api';
import { fetchRequirementQuestions, submitRequirementAnswer } from './api';
import type { RequirementQuestion, ReportData } from './types';

export type GuidedHandle = {
  submit: () => void;
  goBack: () => void;
  jumpTo: (questionIndex: number) => void;
  waitForDrain: () => Promise<{ ok: boolean }>;
};

export type GuidedClarificationInfo = {
  questionIndex: number;
  questionPrompt: string;
  clarificationPrompt: string;
};

export type GuidedActionState = {
  canSubmit: boolean;
  canGoBack: boolean;
  isSubmitting: boolean;
  submitLabel: string;
  pendingCount: number;
  needsClarification: GuidedClarificationInfo | null;
};

export type GuidedAnsweredPatch = {
  questionIndex: number;
  questionId: string;
  answer: string;
  selectedOptionId: string | null;
  status: 'answered' | 'needs_review';
};

interface GuidedRequirementsCardProps {
  projectId: string;
  reportVersion: number | null;
  /**
   * Ordered list of question indices that scope the current "turn".
   * Back/Next operate only inside this list. Omitted/empty → full sequence.
   */
  questionIndices?: number[] | null;
  /** @deprecated Single-question turn — pass `questionIndices` instead. */
  startAtIndex?: number | null;
  onReportUpdate: (report: ReportData) => void;
  onClose: () => void;
  /**
   * Fires when a single question is accepted by the backend so parents can
   * optimistically mark it as answered in their own sidebar/preview lists
   * without waiting for a refetch.
   */
  onAnswered?: (patch: GuidedAnsweredPatch) => void;
  customText?: string;
  onCustomTextChange?: (text: string) => void;
  onActionStateChange?: (state: GuidedActionState) => void;
  /**
   * 'bare' (default): no outer border/background — wrapped by parent (chat dock).
   * 'standalone': renders its own bordered container (report-page modal usage).
   */
  variant?: 'bare' | 'standalone';
  /**
   * Milliseconds the success-state lingers before auto-firing `onClose()`.
   * Defaults to 1200ms. Set to 0 to disable auto-close.
   */
  autoCloseDelayMs?: number;
}

type Phase = 'loading' | 'question' | 'complete' | 'error';

type QueueEntry = {
  localId: string;
  questionId: string;
  questionIndex: number;
  questionPrompt: string;
  selectedOptionId: string | null;
  customAnswer: string | null;
  status: 'pending' | 'in_flight' | 'accepted' | 'needs_clarification' | 'error' | 'aborted';
  clarificationPrompt?: string | null;
  errorMessage?: string;
  abortController?: AbortController;
};

let localIdCounter = 0;
const nextLocalId = () => `qe-${++localIdCounter}-${Date.now()}`;

function computeDisplayAnswer(
  question: RequirementQuestion | undefined,
  selectedOptionId: string | null,
  customAnswer: string | null,
): string {
  const trimmedCustom = (customAnswer ?? '').trim();
  if (trimmedCustom) return trimmedCustom;
  const option = question?.options.find((o) => o.id === selectedOptionId);
  if (!option) return '';
  return option.description ? `${option.label}: ${option.description}` : option.label;
}

export const GuidedRequirementsCard = forwardRef<GuidedHandle, GuidedRequirementsCardProps>(
  function GuidedRequirementsCard(
    {
      projectId,
      reportVersion,
      questionIndices,
      startAtIndex,
      onReportUpdate,
      onClose,
      onAnswered,
      customText,
      onCustomTextChange,
      onActionStateChange,
      variant = 'bare',
      autoCloseDelayMs = 1200,
    },
    ref,
  ) {
    const [phase, setPhase] = useState<Phase>('loading');
    const [allQuestions, setAllQuestions] = useState<RequirementQuestion[]>([]);
    const [cursor, setCursor] = useState(0);
    const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
    const [internalCustomText, setInternalCustomText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [hasPreloadedAnswers, setHasPreloadedAnswers] = useState(false);
    const [queue, setQueue] = useState<QueueEntry[]>([]);
    const budget = useBudget();

    const latestVersionRef = useRef<number | null>(reportVersion);
    const queueRef = useRef<QueueEntry[]>([]);
    const processingRef = useRef(false);
    const isMountedRef = useRef(true);
    const drainWaitersRef = useRef<Array<(r: { ok: boolean }) => void>>([]);
    const onAnsweredRef = useRef(onAnswered);
    const onCloseRef = useRef(onClose);
    const allQuestionsRef = useRef<RequirementQuestion[]>([]);
    useEffect(() => {
      onAnsweredRef.current = onAnswered;
    }, [onAnswered]);
    useEffect(() => {
      onCloseRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
      allQuestionsRef.current = allQuestions;
    }, [allQuestions]);

    const setQueueState = useCallback(
      (nextQueue: QueueEntry[] | ((current: QueueEntry[]) => QueueEntry[])) => {
        setQueue((current) => {
          const resolved =
            typeof nextQueue === 'function' ? nextQueue(queueRef.current) : nextQueue;
          queueRef.current = resolved;
          return resolved;
        });
      },
      [],
    );

    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
        for (const entry of queueRef.current) {
          if (entry.status === 'in_flight' || entry.status === 'pending') {
            entry.abortController?.abort();
          }
        }
        const waiters = drainWaitersRef.current;
        drainWaitersRef.current = [];
        for (const w of waiters) w({ ok: false });
      };
    }, []);

    const effectiveCustomText = customText ?? internalCustomText;
    const setEffectiveCustomText = useCallback(
      (text: string) => {
        if (onCustomTextChange) onCustomTextChange(text);
        else setInternalCustomText(text);
      },
      [onCustomTextChange],
    );

    const scopeIndices = useMemo<number[]>(() => {
      if (questionIndices && questionIndices.length > 0) return questionIndices;
      if (startAtIndex != null) return [startAtIndex];
      if (allQuestions.length > 0) return allQuestions.map((_, i) => i);
      return [];
    }, [questionIndices, startAtIndex, allQuestions]);

    const scopeKey = useMemo(() => scopeIndices.join(','), [scopeIndices]);

    const safeCursor = Math.min(cursor, Math.max(0, scopeIndices.length - 1));
    const globalIndex = scopeIndices[safeCursor] ?? null;
    const question = globalIndex != null ? (allQuestions[globalIndex] ?? null) : null;

    const canSubmit = selectedOptionId !== null || effectiveCustomText.trim().length > 0;
    const canGoBack = safeCursor > 0;
    const isLastInScope = safeCursor === scopeIndices.length - 1;
    const submitLabel = isLastInScope ? 'Finish' : 'Next question';
    const standaloneSubmitLabel = scopeIndices.length === 1 ? 'Save answer' : submitLabel;

    const pendingCount = queue.filter(
      (e) => e.status === 'pending' || e.status === 'in_flight',
    ).length;
    const needsClarificationEntry = queue.find((e) => e.status === 'needs_clarification') ?? null;
    const errorEntries = queue.filter((e) => e.status === 'error');

    const clarificationInfo: GuidedClarificationInfo | null = needsClarificationEntry
      ? {
          questionIndex: needsClarificationEntry.questionIndex,
          questionPrompt: needsClarificationEntry.questionPrompt,
          clarificationPrompt: needsClarificationEntry.clarificationPrompt ?? '',
        }
      : null;

    useEffect(() => {
      onActionStateChange?.({
        canSubmit: canSubmit && phase === 'question',
        canGoBack,
        isSubmitting: false,
        submitLabel,
        pendingCount,
        needsClarification: clarificationInfo,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      canSubmit,
      canGoBack,
      phase,
      submitLabel,
      pendingCount,
      clarificationInfo?.questionIndex,
      clarificationInfo?.clarificationPrompt,
      onActionStateChange,
    ]);

    // Resolve drain waiters when no pending/in-flight remain
    useEffect(() => {
      if (pendingCount === 0 && drainWaitersRef.current.length > 0) {
        const ok = !queueRef.current.some(
          (e) => e.status === 'error' || e.status === 'needs_clarification',
        );
        const waiters = drainWaitersRef.current;
        drainWaitersRef.current = [];
        for (const w of waiters) w({ ok });
      }
    }, [pendingCount]);

    // Auto-close once the success state has stabilized.
    const hasIssues = errorEntries.length > 0 || needsClarificationEntry != null;
    const shouldAutoClose =
      phase === 'complete' && pendingCount === 0 && !hasIssues && autoCloseDelayMs > 0;
    useEffect(() => {
      if (!shouldAutoClose) return;
      const handle = window.setTimeout(() => {
        if (isMountedRef.current) onCloseRef.current();
      }, autoCloseDelayMs);
      return () => window.clearTimeout(handle);
    }, [shouldAutoClose, autoCloseDelayMs]);

    const getHeaders = useCallback(async (): Promise<Record<string, string>> => {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      const token = session?.access_token;
      return token ? { Authorization: `Bearer ${token}` } : {};
    }, []);

    useEffect(() => {
      latestVersionRef.current = reportVersion;
    }, [reportVersion]);

    useEffect(() => {
      let cancelled = false;
      async function load() {
        try {
          const headers = await getHeaders();
          const data = await fetchRequirementQuestions(projectId, headers);
          if (cancelled || !isMountedRef.current) return;
          setAllQuestions(data.questions);
          if (data.questions.length === 0) {
            setPhase('complete');
          } else {
            setPhase('question');
          }
        } catch (err) {
          if (cancelled || !isMountedRef.current) return;
          if (err instanceof ApiRequestError && err.status === 401) {
            redirectToLogin();
            return;
          }
          setError(getUserFacingErrorMessage('hydrateProject', err));
          setPhase('error');
        }
      }
      load();
      return () => {
        cancelled = true;
      };
    }, [projectId, getHeaders]);

    // Reset cursor when the scope changes (new turn)
    useEffect(() => {
      setCursor(0);
      setSelectedOptionId(null);
      setError(null);
      setPhase((p) => (p === 'complete' ? 'question' : p));
    }, [scopeKey]);

    useEffect(() => {
      setSelectedOptionId(question?.selected_option_id ?? null);
      setEffectiveCustomText('');
    }, [question?.id, question?.selected_option_id, setEffectiveCustomText]);

    const closeWithPendingCheck = useCallback(() => {
      if (
        pendingCount > 0 &&
        !window.confirm(
          'Answers are still saving. Close anyway? Pending answers will be cancelled.',
        )
      ) {
        return;
      }
      onClose();
    }, [onClose, pendingCount]);

    const updateEntry = useCallback(
      (localId: string, patch: Partial<QueueEntry>) => {
        setQueueState((prev) => prev.map((e) => (e.localId === localId ? { ...e, ...patch } : e)));
      },
      [setQueueState],
    );

    const runEntry = useCallback(
      async (entry: QueueEntry): Promise<void> => {
        const controller = new AbortController();
        setQueueState((prev) =>
          prev.map((e) =>
            e.localId === entry.localId
              ? { ...e, status: 'in_flight', abortController: controller }
              : e,
          ),
        );
        try {
          const headers = await getHeaders();
          const result = await submitRequirementAnswer(
            projectId,
            {
              question_id: entry.questionId,
              selected_option_id: entry.selectedOptionId,
              custom_answer: entry.customAnswer,
              expected_version: latestVersionRef.current,
            },
            headers,
            controller.signal,
          );
          if (!isMountedRef.current) return;
          if (result.report) {
            latestVersionRef.current = result.report.version;
            onReportUpdate(result.report);
          }
          if (result.preloaded) {
            setHasPreloadedAnswers(true);
          }
          budget.refresh();
          if (result.status === 'needs_clarification') {
            updateEntry(entry.localId, {
              status: 'needs_clarification',
              clarificationPrompt: result.clarification_prompt,
              abortController: undefined,
            });
          } else {
            updateEntry(entry.localId, {
              status: 'accepted',
              abortController: undefined,
            });
            const sourceQuestion = allQuestionsRef.current[entry.questionIndex];
            const displayAnswer = computeDisplayAnswer(
              sourceQuestion,
              entry.selectedOptionId,
              entry.customAnswer,
            );
            setAllQuestions((prev) =>
              prev.map((q, i) =>
                i === entry.questionIndex
                  ? {
                      ...q,
                      answered: true,
                      status: 'answered',
                      answer: displayAnswer,
                      selected_option_id: entry.selectedOptionId,
                    }
                  : q,
              ),
            );
            onAnsweredRef.current?.({
              questionIndex: entry.questionIndex,
              questionId: entry.questionId,
              answer: displayAnswer,
              selectedOptionId: entry.selectedOptionId,
              status: 'answered',
            });
          }
        } catch (err) {
          if (controller.signal.aborted) {
            if (isMountedRef.current) {
              updateEntry(entry.localId, { status: 'aborted', abortController: undefined });
            }
            return;
          }
          if (!isMountedRef.current) return;
          if (err instanceof ApiRequestError && err.status === 401) {
            redirectToLogin();
            return;
          }
          if (err instanceof ApiRequestError && err.status === 429) {
            budget.refresh();
          }
          updateEntry(entry.localId, {
            status: 'error',
            errorMessage: getUserFacingErrorMessage('generateReport', err),
            abortController: undefined,
          });
        }
      },
      [projectId, getHeaders, onReportUpdate, budget, updateEntry, setQueueState],
    );

    const drain = useCallback(async () => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        while (true) {
          const blocker = queueRef.current.find(
            (e) => e.status === 'error' || e.status === 'needs_clarification',
          );
          if (blocker) break;
          const next = queueRef.current.find((e) => e.status === 'pending');
          if (!next) break;
          await runEntry(next);
        }
      } finally {
        processingRef.current = false;
      }
    }, [runEntry]);

    const enqueueEntry = useCallback(
      (entry: QueueEntry) => {
        setQueueState((prev) => [...prev, entry]);
        queueMicrotask(() => {
          void drain();
        });
      },
      [drain, setQueueState],
    );

    const handleSubmit = useCallback(() => {
      if (!question || globalIndex == null || !canSubmit || phase !== 'question') return;

      const entry: QueueEntry = {
        localId: nextLocalId(),
        questionId: question.id,
        questionIndex: globalIndex,
        questionPrompt: question.prompt,
        selectedOptionId,
        customAnswer: effectiveCustomText.trim() || null,
        status: 'pending',
      };
      enqueueEntry(entry);

      if (isLastInScope) {
        setEffectiveCustomText('');
        setSelectedOptionId(null);
        setError(null);
        setPhase('complete');
      } else {
        setCursor((c) => c + 1);
        setSelectedOptionId(null);
        setEffectiveCustomText('');
        setError(null);
      }
    }, [
      question,
      globalIndex,
      canSubmit,
      phase,
      selectedOptionId,
      effectiveCustomText,
      isLastInScope,
      enqueueEntry,
      setEffectiveCustomText,
    ]);

    const handleGoBack = useCallback(() => {
      if (safeCursor <= 0) return;
      setCursor(safeCursor - 1);
      setSelectedOptionId(null);
      setEffectiveCustomText('');
      setError(null);
      setPhase('question');
    }, [safeCursor, setEffectiveCustomText]);

    const handleJumpTo = useCallback(
      (targetQuestionIndex: number) => {
        const position = scopeIndices.indexOf(targetQuestionIndex);
        const targets = queueRef.current.filter((e) => e.questionIndex === targetQuestionIndex);
        for (const t of targets) {
          if (t.status === 'in_flight' || t.status === 'pending') t.abortController?.abort();
        }
        setQueueState((prev) => prev.filter((e) => e.questionIndex !== targetQuestionIndex));
        if (position === -1) return;
        setCursor(position);
        setSelectedOptionId(null);
        setEffectiveCustomText('');
        setError(null);
        setPhase('question');
      },
      [scopeIndices, setQueueState, setEffectiveCustomText],
    );

    const waitForDrain = useCallback((): Promise<{ ok: boolean }> => {
      return new Promise((resolve) => {
        const pending = queueRef.current.some(
          (e) => e.status === 'pending' || e.status === 'in_flight',
        );
        if (!pending) {
          const ok = !queueRef.current.some(
            (e) => e.status === 'error' || e.status === 'needs_clarification',
          );
          resolve({ ok });
          return;
        }
        drainWaitersRef.current.push(resolve);
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        submit: handleSubmit,
        goBack: handleGoBack,
        jumpTo: handleJumpTo,
        waitForDrain,
      }),
      [handleSubmit, handleGoBack, handleJumpTo, waitForDrain],
    );

    const standaloneWrap = variant === 'standalone';

    if (phase === 'loading') {
      const inner = (
        <div className="flex items-center gap-2.5 px-4 py-3">
          <Loader2 className="w-4 h-4 text-surface-400 animate-spin shrink-0" />
          <span className="text-sm text-surface-500">Loading questions…</span>
        </div>
      );
      return standaloneWrap ? (
        <div className="rounded-xl border border-surface-200 bg-surface-0">{inner}</div>
      ) : (
        inner
      );
    }

    if (phase === 'error') {
      const inner = (
        <div className="px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      );
      return standaloneWrap ? (
        <div className="rounded-xl border border-red-200 bg-red-50">{inner}</div>
      ) : (
        inner
      );
    }

    if (phase === 'complete') {
      const stillSaving = pendingCount > 0;

      // Issue branch keeps the existing review/recover affordances.
      if (hasIssues) {
        const issueInner = (
          <div className="flex items-start gap-3 px-5 py-4 animate-in fade-in duration-200">
            <div className="w-8 h-8 rounded-full border flex items-center justify-center shrink-0 mt-0.5 bg-amber-50 border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-surface-900">Some answers need attention</p>
              <p className="text-xs text-surface-500 mt-0.5 leading-relaxed">
                Review the highlighted items in the input bar above.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => {
                    handleJumpTo(needsClarificationEntry?.questionIndex ?? scopeIndices[0] ?? 0);
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-surface-600 border border-surface-200 hover:bg-surface-100 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3 h-3" />
                  Review answers
                </button>
                <button
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-surface-600 hover:bg-surface-100 transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        );
        return standaloneWrap ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/30">{issueInner}</div>
        ) : (
          issueInner
        );
      }

      // Saving → success → auto-close animation.
      const savingInner = (
        <div
          key="saving"
          className="flex items-center justify-center gap-3 px-5 py-6 animate-in fade-in duration-200"
        >
          <Loader2 className="w-4 h-4 text-surface-500 animate-spin" />
          <span className="text-sm font-medium text-surface-600">Saving your answers…</span>
        </div>
      );
      const successInner = (
        <div
          key="success"
          className="flex items-center justify-center gap-3 px-5 py-6 animate-in fade-in zoom-in-95 duration-300"
        >
          <div className="relative flex items-center justify-center">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-brand-200/60 animate-ping"
            />
            <div className="relative w-9 h-9 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-brand-600 animate-in zoom-in duration-500" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-brand-700 animate-in fade-in slide-in-from-left-2 duration-300">
              {hasPreloadedAnswers ? 'Saved!' : 'Added to report!'}
            </span>
            <span className="text-[11px] text-surface-500 animate-in fade-in slide-in-from-left-2 duration-500">
              Returning to chat…
            </span>
          </div>
        </div>
      );
      const inner = stillSaving ? savingInner : successInner;
      return standaloneWrap ? (
        <div className="rounded-xl border border-surface-200 bg-surface-0">{inner}</div>
      ) : (
        inner
      );
    }

    if (!question) return null;

    const questionContent = (
      <div key={question.id} className="animate-fade-in-up">
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums bg-surface-100 text-surface-600 border border-surface-200">
                {safeCursor + 1}/{scopeIndices.length}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-surface-400">
                {question.section}
              </span>
              {question.answered && (
                <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Answered
                </span>
              )}
            </div>
            {standaloneWrap && (
              <button
                type="button"
                onClick={closeWithPendingCheck}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700"
                aria-label="Close guided questions"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-[15px] font-semibold text-surface-900 leading-snug">
            {question.prompt}
          </p>
          {question.answered && question.answer && (
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                Saved answer
              </p>
              <p className="mt-1 text-sm leading-relaxed text-surface-700">{question.answer}</p>
            </div>
          )}
          {clarificationInfo && clarificationInfo.questionIndex === globalIndex && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-sm leading-relaxed text-amber-800">
                {clarificationInfo.clarificationPrompt}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-surface-100 divide-y divide-surface-100">
          {[...question.options]
            .sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false))
            .map((opt, i) => {
              const isSelected = selectedOptionId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedOptionId(isSelected ? null : opt.id)}
                  className={`w-full flex items-start gap-3 px-5 py-2.5 text-left transition-colors duration-150 cursor-pointer ${
                    isSelected ? 'bg-brand-50' : 'hover:bg-surface-50'
                  }`}
                >
                  <span
                    className={`shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold transition-colors ${
                      isSelected
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface-100 text-surface-500 border border-surface-200'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 leading-snug">
                    <span className="font-medium text-sm text-surface-900">{opt.label}</span>
                    {opt.recommended && (
                      <span className="ml-1.5 text-xs font-medium text-brand-600">
                        (Recommended)
                      </span>
                    )}
                    {opt.description && (
                      <span className="ml-1.5 text-sm text-surface-500">{opt.description}</span>
                    )}
                  </div>
                </button>
              );
            })}
        </div>

        {error && (
          <div className="mx-5 mb-3 mt-3 px-3.5 py-2 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {standaloneWrap && (
          <div className="border-t border-surface-100 bg-surface-0 px-5 py-4">
            <label className="sr-only" htmlFor={`guided-custom-${question.id}`}>
              Custom answer
            </label>
            <textarea
              id={`guided-custom-${question.id}`}
              value={effectiveCustomText}
              onChange={(event) => setEffectiveCustomText(event.target.value)}
              placeholder={question.placeholder || 'Add your own answer...'}
              rows={2}
              className="w-full resize-none rounded-lg border border-surface-200 bg-surface-50 px-3 py-2.5 text-sm leading-relaxed text-surface-900 outline-none transition-colors placeholder:text-surface-400 focus:border-brand-300 focus:bg-surface-0 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={closeWithPendingCheck}
                className="inline-flex items-center justify-center rounded-lg border border-surface-200 px-3.5 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-50"
              >
                Leave
              </button>
              <div className="flex items-center justify-end gap-2">
                {canGoBack && (
                  <button
                    type="button"
                    onClick={handleGoBack}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-3.5 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {standaloneSubmitLabel}
                  {isLastInScope && <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );

    return standaloneWrap ? (
      <div className="rounded-xl border border-surface-200 bg-surface-0 overflow-hidden">
        {questionContent}
      </div>
    ) : (
      questionContent
    );
  },
);
