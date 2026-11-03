import type { SourceRef } from '@/components/source-drawer';
import type { FinanceStateSnapshot } from '@/types';
import type { ErrorAction } from './types';

const NETWORK_ERROR_MESSAGE = 'We could not reach the server. Check your connection and try again.';

const DEFAULT_ERROR_MESSAGES: Record<ErrorAction, string> = {
  hydrateProject: 'We could not load this project right now.',
  refreshCalculator: 'We could not refresh the calculator right now.',
  loadMapSummary: 'We could not load the opening summary right now.',
  sendMessage: 'We could not answer that question right now.',
  saveProject: 'We could not save your project right now. Please try again.',
  createProject: 'We could not save your project right now.',
  updateProject: 'We could not update this project right now.',
  generateReport: 'We could not generate the report right now.',
  rateLimited: 'The lifetime AI service budget has been reached. Contact support to continue.',
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code: string | null,
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface ParsedApiError {
  status: number;
  detail: string;
  code: string | null;
  retryAfter: number | null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  return null;
}

function getErrorCode(detail: unknown, parsed: Record<string, unknown>): string | null {
  if (detail && typeof detail === 'object') {
    const nestedError = (detail as Record<string, unknown>).error;
    if (typeof nestedError === 'string') return nestedError;
  }

  return typeof parsed.error === 'string' ? parsed.error : null;
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${Math.ceil(seconds)} second${Math.ceil(seconds) === 1 ? '' : 's'}`;
}

export async function readApiError(res: Response): Promise<ParsedApiError> {
  const retryAfterHeader = res.headers.get('Retry-After');
  const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
  const validRetryAfter =
    retryAfter !== null && !isNaN(retryAfter) && retryAfter > 0 ? retryAfter : null;

  const rawBody = await res.text();
  if (!rawBody) {
    return {
      status: res.status,
      detail: '',
      code: null,
      retryAfter: validRetryAfter,
    };
  }

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const detailValue = parsed.detail ?? parsed.error ?? parsed.message;

    return {
      status: res.status,
      detail: readString(detailValue) ?? readString(parsed) ?? rawBody,
      code: getErrorCode(detailValue, parsed),
      retryAfter: validRetryAfter,
    };
  } catch {
    return {
      status: res.status,
      detail: rawBody,
      code: null,
      retryAfter: validRetryAfter,
    };
  }
}

function buildErrorMessage(action: ErrorAction, failure: ParsedApiError) {
  const detail = failure.detail.toLowerCase();

  if (failure.status === 429) {
    if (failure.retryAfter) {
      return `The shared AI service limit has been reached. Please try again in ${formatDuration(failure.retryAfter)}.`;
    }
    return 'The lifetime AI service budget has been reached. Contact support to continue.';
  }

  if (failure.status === 400 && action === 'sendMessage') {
    return 'Please enter a question before sending.';
  }

  if (failure.status === 401) {
    return 'Please sign in to access or save this project.';
  }

  if (failure.status === 403) {
    return 'Your API key has been deactivated. Please contact support.';
  }

  if (failure.status === 404 && detail.includes('project not found')) {
    return 'This project is no longer available or you do not have access to it.';
  }

  if (failure.status === 404 && detail.includes('report not found')) {
    return 'We could not find a saved report for this project.';
  }

  if (
    failure.status === 409 ||
    failure.code === 'version_conflict' ||
    detail.includes('updated since you last read it')
  ) {
    return 'This report was updated elsewhere. Refresh the page and try again.';
  }

  if (failure.status === 502 && action === 'generateReport') {
    return 'The report generator had a temporary issue. Please try again.';
  }

  if (failure.status === 503 && detail.includes('authentication service unavailable')) {
    return 'Sign-in services are temporarily unavailable. Please try again shortly.';
  }

  if (
    failure.status === 503 &&
    (detail.includes('gemini') ||
      detail.includes('finance chatbot') ||
      detail.includes('finance consultant'))
  ) {
    return 'The AI service is temporarily unavailable. Please try again shortly.';
  }

  return DEFAULT_ERROR_MESSAGES[action];
}

export async function assertOkResponse(res: Response, action: ErrorAction): Promise<void> {
  if (res.ok) return;

  const failure = await readApiError(res);
  throw new ApiRequestError(
    failure.status,
    failure.detail,
    failure.code,
    buildErrorMessage(action, failure),
    failure.retryAfter,
  );
}

export function getUserFacingErrorMessage(action: ErrorAction, error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof TypeError) return NETWORK_ERROR_MESSAGE;
  return DEFAULT_ERROR_MESSAGES[action];
}

export async function consumeSSEStream(
  res: Response,
  callbacks: {
    onStage: (stage: string) => void;
    onText: (content: string) => void;
    onSources: (sources: SourceRef[]) => void;
    onSuggestions: (suggestions: string[]) => void;
    onFinanceState?: (financeState: FinanceStateSnapshot) => void;
  },
): Promise<{ content: string; sources: SourceRef[] }> {
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let currentContent = '';
  let finalSources: SourceRef[] = [];
  let buffer = '';
  let currentEvent = 'message';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim() === '') continue;

      if (line.startsWith('event:')) {
        currentEvent = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        const dataStr = line.substring(5).trim();
        if (!dataStr || dataStr === '{}') {
          currentEvent = 'message';
          continue;
        }

        try {
          const parsed = JSON.parse(dataStr);
          if (currentEvent === 'status' || parsed.stage) {
            callbacks.onStage(parsed.stage);
          } else if (currentEvent === 'sources') {
            finalSources = parsed;
            callbacks.onSources(parsed);
          } else if (currentEvent === 'finance_state') {
            callbacks.onFinanceState?.(parsed);
          } else if (currentEvent === 'suggested_questions') {
            if (Array.isArray(parsed)) {
              callbacks.onSuggestions(parsed);
            }
          } else if (currentEvent === 'done') {
          } else if (parsed.error) {
            throw new Error(parsed.error);
          } else if (parsed.text !== undefined) {
            currentContent += parsed.text;
            callbacks.onText(currentContent);
          }
        } catch (error) {
          console.error('Parse error on chunk:', dataStr, error);
          if (error instanceof Error && error.message !== 'Unexpected end of JSON input') {
            throw error;
          }
        }
        currentEvent = 'message';
      }
    }
  }

  return { content: currentContent, sources: finalSources };
}
