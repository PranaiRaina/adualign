import { assertOkResponse } from '@/components/rag-chat/api';
import type {
  RequirementQuestionsResponse,
  RequirementAnswerPayload,
  RequirementAnswerResponse,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export async function fetchRequirementQuestions(
  projectId: string,
  headers: Record<string, string>,
): Promise<RequirementQuestionsResponse> {
  const res = await fetch(`${API_URL}/projects/${projectId}/report/requirements/questions`, {
    headers,
  });
  await assertOkResponse(res, 'hydrateProject');
  return res.json();
}

export async function submitRequirementAnswer(
  projectId: string,
  payload: RequirementAnswerPayload,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<RequirementAnswerResponse> {
  const res = await fetch(`${API_URL}/projects/${projectId}/report/requirements/answers`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  await assertOkResponse(res, 'generateReport');
  return res.json();
}
