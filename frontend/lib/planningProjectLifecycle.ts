/**
 * Shared create/update path for planning projects used by map and chat flows.
 * Callers supply the payload; this module owns POST vs PATCH selection.
 */

import { buildPlanningDraftScopeKey, transferPlanningDraftScope } from './planningDraft';

export function resolveEffectiveProjectId(args: {
  sessionProjectId?: string | null;
  routeProjectId?: string;
}): string | undefined {
  if (args.sessionProjectId === null) {
    return undefined;
  }

  return args.sessionProjectId ?? args.routeProjectId;
}

export function buildPersistPayload(
  projectId: string | undefined,
  payload: Record<string, unknown>,
  omitStatusOnUpdate = false,
): Record<string, unknown> {
  if (!projectId || !omitStatusOnUpdate || !('status' in payload)) {
    return payload;
  }

  const { status: _status, ...updatePayload } = payload;
  return updatePayload;
}

export function promotePlanningDraftScopeOnCreate(args: {
  previousProjectId?: string;
  savedProjectId: string;
  fromScopeKey?: string;
}): string {
  const savedScopeKey = buildPlanningDraftScopeKey(args.savedProjectId);
  if (!args.previousProjectId) {
    transferPlanningDraftScope(args.fromScopeKey ?? buildPlanningDraftScopeKey(), savedScopeKey);
  }

  return savedScopeKey;
}

export async function persistPlanningProject(args: {
  projectId?: string;
  apiBaseUrl: string;
  token: string;
  payload: Record<string, unknown>;
  omitStatusOnUpdate?: boolean;
}): Promise<string> {
  const body = buildPersistPayload(args.projectId, args.payload, args.omitStatusOnUpdate ?? false);

  const response = await fetch(
    args.projectId
      ? `${args.apiBaseUrl}/projects/${args.projectId}`
      : `${args.apiBaseUrl}/projects`,
    {
      method: args.projectId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Project save failed with status ${response.status}`);
  }

  if (args.projectId) {
    return args.projectId;
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    throw new Error('Project save did not return an id.');
  }

  return data.id;
}
