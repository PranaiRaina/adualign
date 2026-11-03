/**
 * Shared TypeScript types for the ADU Feasibility Engine frontend.
 * Mirrors the backend Pydantic models.
 */

export type AduType = 'detached' | 'garage_conversion' | 'attached' | 'jadu' | 'unsure' | null;

export interface PropertyContext {
  fromMap?: boolean;
  address?: string;
  county?: string;
  lat?: number;
  lng?: number;
  aduType?: AduType;
  aduSize?: number;
  aduWidthFt?: number;
  aduLengthFt?: number;
  aduShape?: string;
  setback?: number;
  propertyArea?: number;
  homeSqft?: number;
  buildableArea?: number;
  maxAduSqft?: number;
  apn?: string;
  fireHazardSeverity?: string;
  fireHazardZoneType?: string;
  currentYardZone?: string;
  aduClearances?: AduClearance[];
}

export interface AduClearance {
  direction: 'top' | 'right' | 'bottom' | 'left';
  targetKind: 'parcel-boundary' | 'active-structure';
  distanceFeet: number;
  targetStructureIndex?: number;
}

export interface EstimateRange {
  low: number;
  high: number;
}

export interface FinanceComplicationOption {
  key: string;
  label: string;
  display_range_text: string;
  is_selected: boolean;
  is_automatic: boolean;
  trigger_reason?: string | null;
}

export interface FinanceComplicationFlags {
  slope?: boolean;
  demolition?: boolean;
  electric_panel?: boolean;
  septic_tank?: boolean;
  solar_mandate?: boolean;
  fire_resilient_upgrades?: boolean;
  very_high_fire_risk?: boolean;
  hoa_restrictions?: boolean;
  high_fire_risk?: boolean;
  contingency?: boolean;
}

export interface FinanceStateSnapshot {
  address?: string | null;
  county?: string | null;
  adu_sqft?: number | null;
  adu_width_ft?: number | null;
  adu_length_ft?: number | null;
  adu_type?: string | null;
  adu_shape?: string | null;
  fire_hazard_severity?: string | null;
  fire_hazard_zone_type?: string | null;
  base_estimate_value?: number | null;
  base_estimate_range?: EstimateRange | null;
  complication_flags?: FinanceComplicationFlags;
  complication_adjusted_value?: number | null;
  complication_adjusted_range?: EstimateRange | null;
}

export interface FinancePresentation {
  address?: string | null;
  county?: string | null;
  adu_sqft?: number | null;
  current_estimate_range?: EstimateRange | null;
  base_estimate_value?: number | null;
  base_estimate_range?: EstimateRange | null;
  complication_adjusted_value?: number | null;
  complication_adjusted_range?: EstimateRange | null;
  automatic_addons: FinanceComplicationOption[];
  manual_addons: FinanceComplicationOption[];
  missing_inputs: string[];
}

export interface GeoJSONGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface AnalyzeRequest {
  lat: number;
  lng: number;
  location: string;
  building_footprints?: GeoJSONGeometry[];
  project_id?: string;
  map_search_id?: string;
}

export interface DetectedObstacle {
  name: string;
  area_sqft: number;
  confidence: number;
  geojson: GeoJSONGeometry;
}

export interface AnalyzeResponse {
  is_valid: boolean;
  message: string;
  property_geojson: GeoJSONGeometry;
  buildable_zone_geojson: GeoJSONGeometry | null;
  unbuildable_zone_geojson: GeoJSONGeometry | null;
  obstacles: DetectedObstacle[];
  property_area_sqft: number;
  buildable_area_sqft: number;
  setback_ft: number;
  max_adu_sqft: number;
  est_cost_low: number | null;
  est_cost_high: number | null;
  parcel_source: string;
  apn: string | null;
  parcel_address: string | null;
  county: string | null;
  primary_structure_sqft: number | null;
  home_sqft: number | null;
  primary_structure_dimensions: string | null;
  secondary_structures_sqft: number[] | null;
  detected_buildings: GeoJSONGeometry[];
  fire_hazard: { severity: string; zone_type: string } | null;
  map_search_usage: {
    charged: boolean;
    credits_charged: number;
    remaining_credits: number | null;
    status: 'charged' | 'deduped' | 'exempt_existing_project' | 'not_chargeable' | 'failed';
  };
}
