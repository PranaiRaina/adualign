import type { PropertyContext } from '@/types';

const CHAT_DRAFT_KEY_PREFIX = 'adu-chat-draft:';
const REPORT_CHAT_RESUME_KEY_PREFIX = 'adu-chat-report-resume:';
const BLOCKED_CHAT_DRAFT_RESTORE_KEY_PREFIX = 'adu-chat-blocked-restore:';

export function buildProjectChatDraftScopeKey(projectId: string): string {
  return `project:${projectId}`;
}

function buildContextDraftScopeKey(context: PropertyContext): string {
  const serializedContext = JSON.stringify({
    address: context.address ?? null,
    county: context.county ?? null,
    lat: context.lat ?? null,
    lng: context.lng ?? null,
    aduType: context.aduType ?? null,
    aduSize: context.aduSize ?? null,
    aduShape: context.aduShape ?? null,
    setback: context.setback ?? null,
    propertyArea: context.propertyArea ?? null,
    buildableArea: context.buildableArea ?? null,
    maxAduSqft: context.maxAduSqft ?? null,
    apn: context.apn ?? null,
    fireHazardSeverity: context.fireHazardSeverity ?? null,
    fireHazardZoneType: context.fireHazardZoneType ?? null,
    currentYardZone: context.currentYardZone ?? null,
    aduClearances: context.aduClearances ?? [],
  });

  let hash = 0;
  for (let index = 0; index < serializedContext.length; index += 1) {
    hash = (hash * 31 + serializedContext.charCodeAt(index)) >>> 0;
  }

  return `context:${hash.toString(36)}`;
}

export function buildChatDraftScopeKey(
  projectId?: string,
  context?: PropertyContext,
): string | null {
  if (projectId) {
    return buildProjectChatDraftScopeKey(projectId);
  }
  if (context) {
    return buildContextDraftScopeKey(context);
  }
  return null;
}

export function buildChatDraftStorageKey(scopeKey: string): string {
  return `${CHAT_DRAFT_KEY_PREFIX}${scopeKey}`;
}

function buildReportChatResumeKey(scopeKey: string): string {
  return `${REPORT_CHAT_RESUME_KEY_PREFIX}${scopeKey}`;
}

function buildBlockedChatDraftRestoreKey(scopeKey: string): string {
  return `${BLOCKED_CHAT_DRAFT_RESTORE_KEY_PREFIX}${scopeKey}`;
}

export function markReportChatDraftResume(scopeKey: string): void {
  sessionStorage.setItem(buildReportChatResumeKey(scopeKey), '1');
}

export function hasReportChatDraftResume(scopeKey: string): boolean {
  return sessionStorage.getItem(buildReportChatResumeKey(scopeKey)) === '1';
}

export function clearReportChatDraftResume(scopeKey: string): void {
  sessionStorage.removeItem(buildReportChatResumeKey(scopeKey));
}

export function markBlockedChatDraftRestore(scopeKey: string): void {
  sessionStorage.setItem(buildBlockedChatDraftRestoreKey(scopeKey), '1');
}

export function consumeBlockedChatDraftRestore(scopeKey: string): boolean {
  const key = buildBlockedChatDraftRestoreKey(scopeKey);
  const isBlocked = sessionStorage.getItem(key) === '1';
  if (isBlocked) {
    sessionStorage.removeItem(key);
  }
  return isBlocked;
}

export function clearBlockedChatDraftRestore(scopeKey: string): void {
  sessionStorage.removeItem(buildBlockedChatDraftRestoreKey(scopeKey));
}
