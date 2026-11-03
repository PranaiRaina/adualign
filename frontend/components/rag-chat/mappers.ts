import type { FinanceStateSnapshot, PropertyContext, AduType } from '@/types';
import type { ProjectAduClearanceDto, ProjectChatDto, ProjectPreferences } from './types';

function normalizeAduType(value: string | null | undefined): AduType | undefined {
  if (!value) return undefined;
  if (value === 'detached' || value === 'attached') return value;
  if (value === 'garage_conversion' || value === 'jadu' || value === 'unsure') return value;
  return undefined;
}

export function buildAduClearancePayload(
  context: PropertyContext | undefined,
): ProjectAduClearanceDto[] {
  return (context?.aduClearances ?? []).map((clearance) => ({
    direction: clearance.direction,
    target_kind: clearance.targetKind,
    distance_feet: clearance.distanceFeet,
    target_structure_index: clearance.targetStructureIndex ?? null,
  }));
}

export function buildChatContextPayload(context: PropertyContext | undefined) {
  const payload: Record<string, unknown> = {
    address: context?.address ?? null,
    county: context?.county ?? null,
    adu_sqft: context?.aduSize ?? null,
    adu_type: context?.aduType ?? null,
    adu_shape: context?.aduShape ?? null,
    fire_hazard_severity: context?.fireHazardSeverity ?? null,
    fire_hazard_zone_type: context?.fireHazardZoneType ?? null,
    current_yard_zone: context?.currentYardZone ?? null,
    adu_clearances: buildAduClearancePayload(context),
  };

  // Omit footprint fields when unknown so PATCH/orchestrate does not clear DB values.
  if (context?.aduWidthFt != null) {
    payload.adu_width_ft = context.aduWidthFt;
  }
  if (context?.aduLengthFt != null) {
    payload.adu_length_ft = context.aduLengthFt;
  }

  return payload;
}

export function buildFinancePayload(
  context: PropertyContext | undefined,
  financeState: FinanceStateSnapshot | null,
  options?: {
    projectId?: string;
    persistFinanceState?: boolean;
  },
) {
  return {
    finance_state: financeState,
    project_id: options?.projectId ?? null,
    persist_finance_state: options?.persistFinanceState ?? false,
    ...buildChatContextPayload(context),
  };
}

export function buildHydratedPropertyContext(project: ProjectChatDto): PropertyContext {
  return {
    address: project.address ?? undefined,
    county: project.county ?? undefined,
    aduType: normalizeAduType(project.adu_type),
    propertyArea: project.property_area_sqft ?? undefined,
    homeSqft: project.home_sqft ?? undefined,
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

export function buildProjectPreferencePayload(preferences: ProjectPreferences) {
  return {
    primary_use: preferences.primaryUse ?? null,
    blocker_types: preferences.blockerTypes,
    has_existing_structure: preferences.hasExistingStructure,
  };
}
