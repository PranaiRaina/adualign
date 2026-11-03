import type { AduType, PropertyContext } from '@/types';
import type { PlanningDraft } from '@/lib/planningDraft';

export type PlanningRouteKind = 'map' | 'chat';

export interface PlanningSessionRouteContext {
  routeKind: PlanningRouteKind;
  projectId?: string;
  hasSessionLikeParams: boolean;
  address?: string;
  lat?: number;
  lng?: number;
  aduType?: AduType;
  aduSize?: number;
  aduShape?: string;
  county?: string;
  apn?: string;
}

export interface PlanningSessionEntryDecision {
  draftScopeToClear?: string;
  shouldBlock: boolean;
}

type PlanningSessionFingerprint = {
  address?: string;
  lat?: number;
  lng?: number;
  aduType?: string;
  aduSize?: number;
  aduShape?: string;
  county?: string;
  apn?: string;
};

function normalizeText(value: string | null | undefined) {
  const normalizedValue = value?.trim().toLowerCase();
  return normalizedValue ? normalizedValue : undefined;
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeAduType(value: AduType | string | null | undefined) {
  return normalizeText(value ?? undefined);
}

function buildDraftFingerprint(draft: PlanningDraft | null): PlanningSessionFingerprint | null {
  if (!draft) {
    return null;
  }

  const propertyContext = draft.propertyContext;
  const mapSnapshot = draft.mapSnapshot;

  return {
    address: normalizeText(
      propertyContext?.address ??
        mapSnapshot?.parcelContext.address ??
        mapSnapshot?.selectedLocation.name,
    ),
    lat: normalizeNumber(propertyContext?.lat ?? mapSnapshot?.selectedLocation.lat),
    lng: normalizeNumber(propertyContext?.lng ?? mapSnapshot?.selectedLocation.lng),
    aduType: normalizeAduType(propertyContext?.aduType ?? mapSnapshot?.adu.type),
    aduSize: normalizeNumber(propertyContext?.aduSize ?? mapSnapshot?.adu.size),
    aduShape: normalizeText(propertyContext?.aduShape ?? mapSnapshot?.adu.shapeType),
    county: normalizeText(propertyContext?.county ?? mapSnapshot?.parcelContext.county),
    apn: normalizeText(propertyContext?.apn ?? mapSnapshot?.parcelContext.apn),
  };
}

function buildRouteFingerprint(
  routeContext: PlanningSessionRouteContext,
): PlanningSessionFingerprint {
  return {
    address: normalizeText(routeContext.address),
    lat: normalizeNumber(routeContext.lat),
    lng: normalizeNumber(routeContext.lng),
    aduType: normalizeAduType(routeContext.aduType),
    aduSize: normalizeNumber(routeContext.aduSize),
    aduShape: normalizeText(routeContext.aduShape),
    county: normalizeText(routeContext.county),
    apn: normalizeText(routeContext.apn),
  };
}

function hasComparableRouteFields(routeFingerprint: PlanningSessionFingerprint) {
  return Object.values(routeFingerprint).some((value) => value !== undefined);
}

function doesRouteMatchDraft(
  routeFingerprint: PlanningSessionFingerprint,
  draftFingerprint: PlanningSessionFingerprint | null,
) {
  if (!draftFingerprint) {
    return false;
  }

  const comparableKeys: Array<keyof PlanningSessionFingerprint> = [
    'address',
    'lat',
    'lng',
    'aduType',
    'aduSize',
    'aduShape',
    'county',
    'apn',
  ];

  return comparableKeys.every((key) => {
    const routeValue = routeFingerprint[key];
    if (routeValue === undefined) {
      return true;
    }

    return draftFingerprint[key] === routeValue;
  });
}

export function getPlanningSessionEntryDecision(args: {
  ephemeralDraft: PlanningDraft | null;
  projectDraft: PlanningDraft | null;
  routeContext: PlanningSessionRouteContext;
}): PlanningSessionEntryDecision {
  const { ephemeralDraft, projectDraft, routeContext } = args;
  const hasProjectId = Boolean(routeContext.projectId);
  const routeFingerprint = buildRouteFingerprint(routeContext);
  const hasComparableFields = hasComparableRouteFields(routeFingerprint);
  const activeDraft = hasProjectId ? projectDraft : ephemeralDraft;

  if (!hasProjectId && routeContext.routeKind === 'chat' && !routeContext.hasSessionLikeParams) {
    return { shouldBlock: true };
  }

  if (!hasProjectId && routeContext.routeKind === 'map' && !routeContext.hasSessionLikeParams) {
    return {
      shouldBlock: activeDraft !== null,
      draftScopeToClear: activeDraft ? 'ephemeral' : undefined,
    };
  }

  if (hasProjectId && ephemeralDraft) {
    return {
      shouldBlock: true,
      draftScopeToClear: 'ephemeral',
    };
  }

  if (!activeDraft) {
    // A fresh standalone map deep-link (a just-selected address, no saved draft
    // yet — e.g. arriving from the public "Check My Lot" search after sign-in) is
    // legitimate: MapInterface commits the ephemeral draft on selection. There's
    // no existing draft to be stale against. Only chat routes truly require a
    // pre-existing session here.
    if (routeContext.routeKind === 'map') {
      return { shouldBlock: false };
    }
    return { shouldBlock: !hasProjectId && routeContext.hasSessionLikeParams };
  }

  if (!hasComparableFields) {
    return {
      shouldBlock: !hasProjectId,
      draftScopeToClear: !hasProjectId ? 'ephemeral' : routeContext.projectId,
    };
  }

  const shouldBlock = !doesRouteMatchDraft(routeFingerprint, buildDraftFingerprint(activeDraft));
  return {
    shouldBlock,
    draftScopeToClear: shouldBlock
      ? hasProjectId
        ? routeContext.projectId
        : 'ephemeral'
      : undefined,
  };
}
