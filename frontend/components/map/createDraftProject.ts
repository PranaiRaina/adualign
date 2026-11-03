import type { MapSnapshot } from '@/lib/planningDraft';
import { persistPlanningProject } from '@/lib/planningProjectLifecycle';
import type { AnalyzeResponse, FinanceStateSnapshot, PropertyContext } from '@/types';

import type { MapLocation, ShapeType } from './types';
import type { PlanChatContext } from './hooks/useMapSessionLifecycle';
import type { AduBboxDimensions } from './utils/aduDimensions';

interface DraftClearancePayload {
  direction: string;
  target_kind: string;
  distance_feet: number;
  target_structure_index: number | null;
}

export interface DraftProjectPayload {
  status: 'project';
  address: string | null;
  county: string | null;
  property_area_sqft: number | null;
  home_sqft: number | null;
  buildable_area_sqft: number | null;
  setback_ft: number | null;
  max_adu_sqft: number | null;
  adu_sqft: number | null;
  adu_width_ft: number | null;
  adu_length_ft: number | null;
  adu_type: string | null;
  adu_shape: string | null;
  fire_hazard_severity: string | null;
  fire_hazard_zone_type: string | null;
  current_yard_zone: string | null;
  adu_clearances: DraftClearancePayload[];
  finance_state: FinanceStateSnapshot;
  map_snapshot: MapSnapshot;
}

// Saves without an explicit plan-chat context (autosave, header Save Project)
// fall back to the live property context, so yard zone, clearances, and fire
// hazard are persisted instead of being overwritten with nulls.
export function planChatContextFromPropertyContext(
  propertyContext: PropertyContext | null,
): PlanChatContext | undefined {
  if (!propertyContext) {
    return undefined;
  }

  return {
    currentYardZone: propertyContext.currentYardZone,
    fireHazardSeverity: propertyContext.fireHazardSeverity,
    fireHazardZoneType: propertyContext.fireHazardZoneType,
    aduClearances: propertyContext.aduClearances,
  };
}

export function buildDraftProjectPayload({
  result,
  selectedLocation,
  aduSize,
  aduBboxDimensions,
  aduShapeType,
  aduType,
  financeState,
  mapSnapshot,
  planChatContext,
}: {
  result: AnalyzeResponse;
  selectedLocation: MapLocation | null;
  aduSize: number;
  aduBboxDimensions: AduBboxDimensions | null;
  aduShapeType: ShapeType;
  aduType: 'detached' | 'attached';
  financeState: FinanceStateSnapshot;
  mapSnapshot: MapSnapshot;
  planChatContext?: PlanChatContext;
}): DraftProjectPayload {
  const fireHazard = resolveFireHazard(result, planChatContext);
  const currentYardZone =
    planChatContext?.currentYardZone && planChatContext.currentYardZone !== 'Unknown'
      ? planChatContext.currentYardZone
      : null;

  return {
    status: 'project',
    address: selectedLocation?.name ?? null,
    county: result.county ?? null,
    property_area_sqft: result.property_area_sqft ?? null,
    home_sqft: result.home_sqft ?? null,
    buildable_area_sqft: result.buildable_area_sqft ?? null,
    setback_ft: result.setback_ft ?? null,
    max_adu_sqft: result.max_adu_sqft ?? null,
    adu_sqft: aduSize,
    adu_width_ft: aduBboxDimensions?.widthFt ?? null,
    adu_length_ft: aduBboxDimensions?.lengthFt ?? null,
    adu_type: aduType,
    adu_shape: aduShapeType,
    fire_hazard_severity: fireHazard.severity,
    fire_hazard_zone_type: fireHazard.zoneType,
    current_yard_zone: currentYardZone,
    adu_clearances: (planChatContext?.aduClearances ?? []).map((clearance) => ({
      direction: clearance.direction,
      target_kind: clearance.targetKind,
      distance_feet: clearance.distanceFeet,
      target_structure_index: clearance.targetStructureIndex ?? null,
    })),
    finance_state: financeState,
    map_snapshot: mapSnapshot,
  };
}

function resolveFireHazard(
  result: AnalyzeResponse,
  planChatContext?: PlanChatContext,
): { severity: string | null; zoneType: string | null } {
  return {
    severity: planChatContext?.fireHazardSeverity ?? result.fire_hazard?.severity ?? null,
    zoneType: planChatContext?.fireHazardZoneType ?? result.fire_hazard?.zone_type ?? null,
  };
}

export async function persistDraftProject({
  activeProjectId,
  apiBaseUrl,
  token,
  payload,
}: {
  activeProjectId?: string;
  apiBaseUrl: string;
  token: string;
  payload: DraftProjectPayload;
}): Promise<string> {
  return persistPlanningProject({
    projectId: activeProjectId,
    apiBaseUrl,
    token,
    payload: { ...payload },
    omitStatusOnUpdate: true,
  });
}
