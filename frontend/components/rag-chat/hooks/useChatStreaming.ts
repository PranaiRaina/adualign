'use client';

import { useCallback, useRef, useState } from 'react';
import type { SourceRef } from '@/components/source-drawer';
import type { FinanceStateSnapshot, PropertyContext } from '@/types';
import {
  ApiRequestError,
  assertOkResponse,
  consumeSSEStream,
  getUserFacingErrorMessage,
} from '../api';
import { buildFinancePayload, buildProjectPreferencePayload } from '../mappers';
import type { ProjectPreferences } from '../types';
import { RESUME_CHAT_MARKER, isResumeBootstrapMessage } from './useChatDraftState';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  isHidden?: boolean;
}

type SendMessageOptions = {
  isHidden?: boolean;
  projectIdOverride?: string;
};

type UseChatStreamingArgs = {
  activeProjectId?: string;
  apiBaseUrl: string;
  createMessageId: () => string;
  financeState: FinanceStateSnapshot | null;
  getProtectedAuthHeaders: () => Promise<Record<string, string>>;
  isAuthLoading: boolean;
  isBudgetBlocked: boolean;
  isLoading: boolean;
  isLoggedIn: boolean;
  localContext?: PropertyContext;
  openPlanningAuthModal: () => void;
  projectPreferences: ProjectPreferences;
  refreshBudget: () => void;
  setError: (message: string | null) => void;
  setFinanceState: (financeState: FinanceStateSnapshot | null) => void;
  setInput: (value: string) => void;
  setIsLoading: (value: boolean) => void;
  setIsRateLimited: (value: boolean) => void;
};

function buildHistory(messages: ChatMessage[]) {
  return messages
    .filter((message) => !message.isHidden && !isResumeBootstrapMessage(message.content))
    .slice(-20)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export function useChatStreaming({
  activeProjectId,
  apiBaseUrl,
  createMessageId,
  financeState,
  getProtectedAuthHeaders,
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
}: UseChatStreamingArgs) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingStage, setStreamingStage] = useState<string | undefined>(undefined);
  const [streamingSources, setStreamingSources] = useState<SourceRef[] | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const financeStateRef = useRef(financeState);
  financeStateRef.current = financeState;
  const localContextRef = useRef(localContext);
  localContextRef.current = localContext;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const projectPreferencesRef = useRef(projectPreferences);
  projectPreferencesRef.current = projectPreferences;

  const clearStreamingPreview = useCallback(() => {
    setStreamingContent('');
    setStreamingStage(undefined);
    setStreamingSources(undefined);
  }, []);

  const replaceMessages = useCallback((nextMessages: ChatMessage[]) => {
    setMessages(nextMessages);
  }, []);

  const replaceSuggestions = useCallback((nextSuggestions: string[]) => {
    setSuggestions(nextSuggestions);
  }, []);

  const resetStreamingState = useCallback(() => {
    setSuggestions([]);
    clearStreamingPreview();
  }, [clearStreamingPreview]);

  const sendMessage = useCallback(
    async (text: string, options?: SendMessageOptions) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading || isBudgetBlocked) return;
      if (isAuthLoading) return;
      if (!isLoggedIn) {
        openPlanningAuthModal();
        return;
      }

      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: 'user',
        content: trimmed,
        isHidden: options?.isHidden ?? false,
      };
      const previousMessages = messagesRef.current;

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setError(null);
      setIsRateLimited(false);
      setSuggestions([]);
      setIsLoading(true);

      const payload = {
        message: trimmed,
        history: buildHistory(previousMessages),
        ...buildFinancePayload(localContextRef.current, financeStateRef.current, {
          projectId: options?.projectIdOverride ?? activeProjectIdRef.current,
        }),
        ...buildProjectPreferencePayload(projectPreferencesRef.current),
      };

      try {
        const authHeaders = await getProtectedAuthHeaders();
        setStreamingStage(
          trimmed === RESUME_CHAT_MARKER
            ? 'Generating your project summary...'
            : 'Analyzing your question...',
        );
        setStreamingContent('');
        setStreamingSources(undefined);

        const res = await fetch(`${apiBaseUrl}/agent/orchestrate/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify(payload),
        });
        await assertOkResponse(res, 'sendMessage');

        const { content, sources } = await consumeSSEStream(res, {
          onStage: (stage) => setStreamingStage(stage),
          onText: (nextText) => setStreamingContent(nextText),
          onSources: (nextSources) =>
            setStreamingSources(nextSources.length > 0 ? nextSources : undefined),
          onSuggestions: (nextSuggestions) => setSuggestions(nextSuggestions),
          onFinanceState: (nextFinanceState) => setFinanceState(nextFinanceState),
        });

        setMessages((prev) => [
          ...prev,
          { id: createMessageId(), role: 'assistant', content, sources },
        ]);
        clearStreamingPreview();
        refreshBudget();
      } catch (error) {
        const isRateLimitedError = error instanceof ApiRequestError && error.status === 429;
        if (error instanceof ApiRequestError && error.status === 401) {
          openPlanningAuthModal();
          return;
        }

        setIsRateLimited(isRateLimitedError);
        if (isRateLimitedError) {
          refreshBudget();
        }

        setError(getUserFacingErrorMessage('sendMessage', error));
        clearStreamingPreview();
      } finally {
        setIsLoading(false);
      }
    },
    [
      apiBaseUrl,
      clearStreamingPreview,
      createMessageId,
      getProtectedAuthHeaders,
      isAuthLoading,
      isBudgetBlocked,
      isLoading,
      isLoggedIn,
      openPlanningAuthModal,
      refreshBudget,
      setError,
      setFinanceState,
      setInput,
      setIsLoading,
      setIsRateLimited,
    ],
  );

  return {
    messages,
    replaceMessages,
    replaceSuggestions,
    resetStreamingState,
    sendMessage,
    streamingContent,
    streamingSources,
    streamingStage,
    suggestions,
  };
}
