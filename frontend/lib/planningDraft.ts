import type { FinanceStateSnapshot, PropertyContext } from '@/types';
import type { LegDimensions, MapLocation, ShapeType } from '@/components/map/types';

const PLANNING_DRAFT_KEY_PREFIX = 'adu-planning-draft:';
const PLANNING_DRAFT_DEBUG_ENDPOINT = '/api/debug/planning-draft';
const MAP_SNAPSHOT_NUMBER_TOLERANCE = 0.000001;
export const MAP_SNAPSHOT_VERSION = 1;

type MapSnapshotPoint = {
  lat: number;
  lng: number;
};

type MapSnapshotAdu = {
  center: MapSnapshotPoint | null;
  size: number;
  aspectRatio: number;
  rotation: number;
  shapeType: ShapeType;
  type: 'detached' | 'attached';
  legDimensions: LegDimensions;
};

type MapSnapshotParcelContext = {
  address: string | null;
  apn: string | null;
  county: string | null;
};

export interface MapSnapshot {
  version: number;
  selectedLocation: MapLocation;
  parcelContext: MapSnapshotParcelContext;
  adu: MapSnapshotAdu;
  frontEdgeSelectionPoint: MapSnapshotPoint | null;
  disabledBuildingIndices: number[];
}

export interface PlanningDraft {
  propertyContext: PropertyContext | null;
  financeState: FinanceStateSnapshot | null;
  mapSnapshot: MapSnapshot | null;
  mapReturnBaselineContext: PropertyContext | null;
}

function areNumbersEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MAP_SNAPSHOT_NUMBER_TOLERANCE;
}

function areMapSnapshotPointsEqual(
  left: MapSnapshotPoint | null,
  right: MapSnapshotPoint | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return areNumbersEqual(left.lat, right.lat) && areNumbersEqual(left.lng, right.lng);
}

function areMapLocationsEqual(left: MapLocation, right: MapLocation): boolean {
  return (
    left.name === right.name &&
    areNumbersEqual(left.lat, right.lat) &&
    areNumbersEqual(left.lng, right.lng)
  );
}

function areLegDimensionsEqual(left: LegDimensions, right: LegDimensions): boolean {
  return (
    areNumbersEqual(left['l-shape'].tX, right['l-shape'].tX) &&
    areNumbersEqual(left['l-shape'].tY, right['l-shape'].tY) &&
    areNumbersEqual(left['t-shape'].stemWidth, right['t-shape'].stemWidth) &&
    areNumbersEqual(left['t-shape'].crossbarDepth, right['t-shape'].crossbarDepth) &&
    areNumbersEqual(left['u-shape'].cutoutWidth, right['u-shape'].cutoutWidth) &&
    areNumbersEqual(left['u-shape'].cutoutDepth, right['u-shape'].cutoutDepth)
  );
}

function areDisabledBuildingIndicesEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((index, position) => index === sortedRight[position]);
}

function areMapSnapshotAdusEqual(left: MapSnapshotAdu, right: MapSnapshotAdu): boolean {
  return (
    left.shapeType === right.shapeType &&
    left.type === right.type &&
    areMapSnapshotPointsEqual(left.center, right.center) &&
    areNumbersEqual(left.size, right.size) &&
    areNumbersEqual(left.aspectRatio, right.aspectRatio) &&
    areNumbersEqual(left.rotation, right.rotation) &&
    areLegDimensionsEqual(left.legDimensions, right.legDimensions)
  );
}

export function areMapSnapshotsEqual(left: MapSnapshot | null, right: MapSnapshot | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.version === right.version &&
    areMapLocationsEqual(left.selectedLocation, right.selectedLocation) &&
    areMapSnapshotAdusEqual(left.adu, right.adu) &&
    areMapSnapshotPointsEqual(left.frontEdgeSelectionPoint, right.frontEdgeSelectionPoint) &&
    areDisabledBuildingIndicesEqual(left.disabledBuildingIndices, right.disabledBuildingIndices)
  );
}

export function buildPlanningDraftScopeKey(projectId?: string): string {
  return projectId ? `project:${projectId}` : 'ephemeral';
}

function buildPlanningDraftStorageKey(scopeKey: string): string {
  return `${PLANNING_DRAFT_KEY_PREFIX}${scopeKey}`;
}

function logPlanningDraftDeletion(scopeKey: string, reason: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = JSON.stringify({
    scopeKey,
    reason,
    href: window.location.href,
    timestamp: new Date().toISOString(),
  });

  console.info('[planning-draft] cleared', payload);

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(PLANNING_DRAFT_DEBUG_ENDPOINT, blob);
    return;
  }

  void fetch(PLANNING_DRAFT_DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => undefined);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function coerceMapSnapshotPoint(value: unknown): MapSnapshotPoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const point = value as Partial<MapSnapshotPoint>;
  if (!isFiniteNumber(point.lat) || !isFiniteNumber(point.lng)) {
    return null;
  }

  return { lat: point.lat, lng: point.lng };
}

function coerceMapLocation(value: unknown): MapLocation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const location = value as Partial<MapLocation>;
  if (
    !isFiniteNumber(location.lat) ||
    !isFiniteNumber(location.lng) ||
    typeof location.name !== 'string'
  ) {
    return null;
  }

  return { lat: location.lat, lng: location.lng, name: location.name };
}

function coerceLegDimensions(value: unknown): LegDimensions | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const next = value as Partial<LegDimensions>;
  const lShape = next['l-shape'];
  const tShape = next['t-shape'];
  const uShape = next['u-shape'];

  if (
    !lShape ||
    !isFiniteNumber(lShape.tX) ||
    !isFiniteNumber(lShape.tY) ||
    !tShape ||
    !isFiniteNumber(tShape.stemWidth) ||
    !isFiniteNumber(tShape.crossbarDepth) ||
    !uShape ||
    !isFiniteNumber(uShape.cutoutWidth) ||
    !isFiniteNumber(uShape.cutoutDepth)
  ) {
    return null;
  }

  return {
    'l-shape': { tX: lShape.tX, tY: lShape.tY },
    't-shape': {
      stemWidth: tShape.stemWidth,
      crossbarDepth: tShape.crossbarDepth,
    },
    'u-shape': {
      cutoutWidth: uShape.cutoutWidth,
      cutoutDepth: uShape.cutoutDepth,
    },
  };
}

export function coerceMapSnapshot(value: unknown): MapSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<MapSnapshot>;
  const selectedLocation = coerceMapLocation(snapshot.selectedLocation);
  const center = coerceMapSnapshotPoint(snapshot.adu?.center);
  const legDimensions = coerceLegDimensions(snapshot.adu?.legDimensions);
  const frontEdgeSelectionPoint = snapshot.frontEdgeSelectionPoint
    ? coerceMapSnapshotPoint(snapshot.frontEdgeSelectionPoint)
    : null;

  if (
    !isFiniteNumber(snapshot.version) ||
    snapshot.version !== MAP_SNAPSHOT_VERSION ||
    !selectedLocation ||
    !snapshot.parcelContext ||
    typeof snapshot.parcelContext !== 'object' ||
    !snapshot.adu ||
    typeof snapshot.adu !== 'object' ||
    !isFiniteNumber(snapshot.adu.size) ||
    !isFiniteNumber(snapshot.adu.aspectRatio) ||
    !isFiniteNumber(snapshot.adu.rotation) ||
    (snapshot.adu.shapeType !== 'rectangle' &&
      snapshot.adu.shapeType !== 'l-shape' &&
      snapshot.adu.shapeType !== 't-shape' &&
      snapshot.adu.shapeType !== 'u-shape') ||
    (snapshot.adu.type !== 'detached' && snapshot.adu.type !== 'attached') ||
    !legDimensions ||
    !Array.isArray(snapshot.disabledBuildingIndices) ||
    !snapshot.disabledBuildingIndices.every((index) => Number.isInteger(index))
  ) {
    return null;
  }

  const parcelContext = snapshot.parcelContext as Partial<MapSnapshotParcelContext>;

  return {
    version: snapshot.version,
    selectedLocation,
    parcelContext: {
      address: typeof parcelContext.address === 'string' ? parcelContext.address : null,
      apn: typeof parcelContext.apn === 'string' ? parcelContext.apn : null,
      county: typeof parcelContext.county === 'string' ? parcelContext.county : null,
    },
    adu: {
      center,
      size: snapshot.adu.size,
      aspectRatio: snapshot.adu.aspectRatio,
      rotation: snapshot.adu.rotation,
      shapeType: snapshot.adu.shapeType,
      type: snapshot.adu.type,
      legDimensions,
    },
    frontEdgeSelectionPoint,
    disabledBuildingIndices: snapshot.disabledBuildingIndices,
  };
}

export function readPlanningDraft(scopeKey: string): PlanningDraft | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawDraft = sessionStorage.getItem(buildPlanningDraftStorageKey(scopeKey));
    if (!rawDraft) {
      return null;
    }

    const parsedDraft = JSON.parse(rawDraft) as Partial<PlanningDraft>;
    return {
      propertyContext: parsedDraft.propertyContext ?? null,
      financeState: parsedDraft.financeState ?? null,
      mapSnapshot: coerceMapSnapshot(parsedDraft.mapSnapshot),
      mapReturnBaselineContext: parsedDraft.mapReturnBaselineContext ?? null,
    };
  } catch {
    return null;
  }
}

export function writePlanningDraft(scopeKey: string, draft: PlanningDraft): void {
  if (typeof window === 'undefined') {
    return;
  }

  sessionStorage.setItem(
    buildPlanningDraftStorageKey(scopeKey),
    JSON.stringify({
      propertyContext: draft.propertyContext ?? null,
      financeState: draft.financeState ?? null,
      mapSnapshot: draft.mapSnapshot ?? null,
      mapReturnBaselineContext: draft.mapReturnBaselineContext ?? null,
    }),
  );
}

export function updatePlanningDraft(scopeKey: string, draftPatch: Partial<PlanningDraft>): void {
  const currentDraft = readPlanningDraft(scopeKey) ?? {
    propertyContext: null,
    financeState: null,
    mapSnapshot: null,
    mapReturnBaselineContext: null,
  };

  writePlanningDraft(scopeKey, {
    ...currentDraft,
    ...draftPatch,
  });
}

export function clearPlanningDraftMapReturnBaseline(scopeKey: string): void {
  const currentDraft = readPlanningDraft(scopeKey);
  if (!currentDraft?.mapReturnBaselineContext) {
    return;
  }

  writePlanningDraft(scopeKey, {
    ...currentDraft,
    mapReturnBaselineContext: null,
  });
}

export function transferPlanningDraftScope(fromScopeKey: string, toScopeKey: string): void {
  if (fromScopeKey === toScopeKey) {
    return;
  }

  const currentDraft = readPlanningDraft(fromScopeKey);
  if (!currentDraft) {
    return;
  }

  writePlanningDraft(toScopeKey, currentDraft);
  clearPlanningDraft(fromScopeKey, `transferred-to-${toScopeKey}`);
}

export function clearPlanningDraft(scopeKey: string, reason = 'unknown'): void {
  if (typeof window === 'undefined') {
    return;
  }

  const storageKey = buildPlanningDraftStorageKey(scopeKey);
  if (sessionStorage.getItem(storageKey) === null) {
    return;
  }

  sessionStorage.removeItem(storageKey);
  logPlanningDraftDeletion(scopeKey, reason);
}
