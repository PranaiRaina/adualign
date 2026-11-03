import type { AduClearance, AduType, FinancePresentation, FinanceStateSnapshot } from '@/types';

export type ErrorAction =
  | 'hydrateProject'
  | 'refreshCalculator'
  | 'loadMapSummary'
  | 'sendMessage'
  | 'saveProject'
  | 'createProject'
  | 'updateProject'
  | 'generateReport'
  | 'rateLimited';

export interface ProjectPreferences {
  primaryUse: string | null;
  blockerTypes: string[];
  hasExistingStructure: boolean | null;
}

export type ChatEntryMode = 'default' | 'map-return';

export const DEFAULT_PROJECT_PREFERENCES: ProjectPreferences = {
  primaryUse: null,
  blockerTypes: [],
  hasExistingStructure: null,
};

export interface ProjectAduClearanceDto {
  direction: AduClearance['direction'];
  target_kind: AduClearance['targetKind'];
  distance_feet: number;
  target_structure_index?: number | null;
}

export interface ProjectChatDto {
  address?: string | null;
  county?: string | null;
  map_snapshot?: unknown | null;
  adu_type?: string | null;
  property_area_sqft?: number | null;
  home_sqft?: number | null;
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
  adu_clearances?: ProjectAduClearanceDto[] | null;
  primary_use?: string | null;
  blocker_types?: string[] | null;
  finance_state?: FinanceStateSnapshot | null;
}

export interface CalculatorResponse {
  finance_state: FinanceStateSnapshot;
  presentation: FinancePresentation;
  report_synced: boolean;
}

export type ProjectSavePayload = {
  address: string | null;
  county: string | null;
  property_area_sqft: number | null;
  home_sqft: number | null;
  buildable_area_sqft: number | null;
  setback_ft: number | null;
  max_adu_sqft: number | null;
  adu_sqft: number | null;
  adu_width_ft?: number | null;
  adu_length_ft?: number | null;
  adu_shape: string | null;
  adu_type: AduType | null | undefined;
  primary_use: string | null;
  blocker_types: string[];
  fire_hazard_severity: string | null;
  fire_hazard_zone_type: string | null;
  current_yard_zone: string | null;
  adu_clearances: ProjectAduClearanceDto[];
  finance_state: FinanceStateSnapshot | null;
  map_snapshot?: unknown | null;
};
