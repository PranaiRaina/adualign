import type { FinanceStateSnapshot, PropertyContext } from '@/types';
import { coerceMapSnapshot, type MapSnapshot, type PlanningDraft } from '@/lib/planningDraft';

type PlanningDirtySnapshot = {
  financeState: FinanceStateSnapshot | null;
  mapSnapshot: ReturnType<typeof normalizeMapSnapshot>;
  propertyContext: ReturnType<typeof normalizePropertyContext>;
};

export type PlanningDirtySnapshotArgs = {
  financeState: FinanceStateSnapshot | null;
  mapSnapshot: MapSnapshot | null;
  propertyContext?: PropertyContext | null;
};

export type PlanningProjectSnapshot = {
  address?: string | null;
  county?: string | null;
  map_snapshot?: unknown | null;
  adu_type?: string | null;
  property_area_sqft?: number | null;
  buildable_area_sqft?: number | null;
  setback_ft?: number | null;
  max_adu_sqft?: number | null;
  adu_sqft?: number | null;
  adu_width_ft?: number | null;
  adu_length_ft?: number | null;
  adu_shape?: string | null;
  fire_hazard_severity?: string | null;
  fire_hazard_zone_type?: string | null;
  current_yard_zone?: string | null;
  adu_clearances?: Array<{
    direction: 'top' | 'right' | 'bottom' | 'left';
    target_kind: 'parcel-boundary' | 'active-structure';
    distance_feet: number;
    target_structure_index?: number | null;
  }> | null;
  finance_state?: FinanceStateSnapshot | null;
};

function normalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSnapshotValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const normalizedValue = normalizeSnapshotValue((value as Record<string, unknown>)[key]);
        if (normalizedValue !== undefined) {
          result[key] = normalizedValue;
        }
        return result;
      }, {});
  }

  return value;
}

function normalizeMapSnapshot(snapshot: MapSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  return normalizeSnapshotValue({
    version: snapshot.version,
    selectedLocation: snapshot.selectedLocation,
    adu: snapshot.adu,
    frontEdgeSelectionPoint: snapshot.frontEdgeSelectionPoint,
    disabledBuildingIndices: [...snapshot.disabledBuildingIndices].sort(
      (left, right) => left - right,
    ),
  });
}

function normalizePropertyContext(propertyContext?: PropertyContext | null) {
  if (!propertyContext) {
    return null;
  }

  const normalizedClearances = propertyContext.aduClearances
    ?.map((clearance) => ({
      direction: clearance.direction,
      distanceFeet: clearance.distanceFeet,
      targetKind: clearance.targetKind,
      targetStructureIndex: clearance.targetStructureIndex ?? null,
    }))
    .sort((left, right) => {
      const leftKey = `${left.direction}:${left.targetKind}:${left.targetStructureIndex ?? ''}`;
      const rightKey = `${right.direction}:${right.targetKind}:${right.targetStructureIndex ?? ''}`;
      return leftKey.localeCompare(rightKey);
    });

  return normalizeSnapshotValue({
    address: propertyContext.address,
    county: propertyContext.county,
    aduType: propertyContext.aduType,
    aduSize: propertyContext.aduSize,
    aduWidthFt: propertyContext.aduWidthFt,
    aduLengthFt: propertyContext.aduLengthFt,
    aduShape: propertyContext.aduShape,
    setback: propertyContext.setback,
    propertyArea: propertyContext.propertyArea,
    buildableArea: propertyContext.buildableArea,
    maxAduSqft: propertyContext.maxAduSqft,
    fireHazardSeverity: propertyContext.fireHazardSeverity,
    fireHazardZoneType: propertyContext.fireHazardZoneType,
    currentYardZone: propertyContext.currentYardZone,
    aduClearances: normalizedClearances,
  });
}

export function buildPlanningDirtyPropertyContextFromProject(
  project: PlanningProjectSnapshot,
): PropertyContext {
  return {
    address: project.address ?? undefined,
    county: project.county ?? undefined,
    aduType:
      project.adu_type === 'detached' ||
      project.adu_type === 'attached' ||
      project.adu_type === 'garage_conversion' ||
      project.adu_type === 'jadu' ||
      project.adu_type === 'unsure'
        ? project.adu_type
        : undefined,
    propertyArea: project.property_area_sqft ?? undefined,
    buildableArea: project.buildable_area_sqft ?? undefined,
    setback: project.setback_ft ?? undefined,
    maxAduSqft: project.max_adu_sqft ?? undefined,
    aduSize: project.adu_sqft ?? undefined,
    aduWidthFt: project.adu_width_ft ?? undefined,
    aduLengthFt: project.adu_length_ft ?? undefined,
    aduShape: project.adu_shape ?? undefined,
    fireHazardSeverity: project.fire_hazard_severity ?? undefined,
    fireHazardZoneType: project.fire_hazard_zone_type ?? undefined,
    currentYardZone: project.current_yard_zone ?? undefined,
    aduClearances: Array.isArray(project.adu_clearances)
      ? project.adu_clearances.map((clearance) => ({
          direction: clearance.direction,
          targetKind: clearance.target_kind,
          distanceFeet: clearance.distance_feet,
          targetStructureIndex: clearance.target_structure_index ?? undefined,
        }))
      : undefined,
  };
}

function serializePlanningDirtySnapshot(snapshot: PlanningDirtySnapshot): string {
  return JSON.stringify(normalizeSnapshotValue(snapshot));
}

export function buildPlanningDirtySnapshot(args: PlanningDirtySnapshotArgs): string {
  return serializePlanningDirtySnapshot({
    financeState: args.financeState,
    mapSnapshot: normalizeMapSnapshot(args.mapSnapshot),
    propertyContext: normalizePropertyContext(args.propertyContext),
  });
}

type BuildPlanningSessionDirtySnapshotArgs = {
  project?: PlanningProjectSnapshot | null;
  planningDraft?: PlanningDraft | null;
  financeState?: FinanceStateSnapshot | null;
  mapSnapshot?: MapSnapshot | null;
  propertyContext?: PropertyContext | null;
};

export function buildPlanningSessionDirtySnapshot(
  args: BuildPlanningSessionDirtySnapshotArgs,
): string {
  const resolvedFinanceState =
    args.financeState !== undefined
      ? args.financeState
      : (args.planningDraft?.financeState ?? args.project?.finance_state ?? null);
  const resolvedMapSnapshot =
    args.mapSnapshot !== undefined
      ? args.mapSnapshot
      : (args.planningDraft?.mapSnapshot ?? coerceMapSnapshot(args.project?.map_snapshot ?? null));
  const resolvedPropertyContext =
    args.propertyContext !== undefined
      ? args.propertyContext
      : (args.planningDraft?.propertyContext ??
        (args.project ? buildPlanningDirtyPropertyContextFromProject(args.project) : null));

  return buildPlanningDirtySnapshot({
    financeState: resolvedFinanceState,
    mapSnapshot: resolvedMapSnapshot,
    propertyContext: resolvedPropertyContext,
  });
}

export function buildPlanningDirtySnapshotFromProject(project: PlanningProjectSnapshot): string {
  return buildPlanningSessionDirtySnapshot({ project });
}

export const EMPTY_PLANNING_DIRTY_SNAPSHOT = buildPlanningDirtySnapshot({
  financeState: null,
  mapSnapshot: null,
  propertyContext: null,
});
