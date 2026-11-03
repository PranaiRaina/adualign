/* ------------------------------------------------------------------ */
/*  Constants for Map Interface                                        */
/* ------------------------------------------------------------------ */

// Environment
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
export const IRVINE_CENTER = { longitude: -117.7731, latitude: 33.6846 };
export const CALIFORNIA_BBOX: [number, number, number, number] = [
  -124.482003, 32.528832, -114.131211, 42.009518,
];
export const CALIFORNIA_BBOX_PARAM = CALIFORNIA_BBOX.join(',');
export const CALIFORNIA_REGION_CODE = 'CA';
export const CALIFORNIA_REGION_NAME = 'California';
export const CALIFORNIA_ADDRESS_ONLY_MESSAGE = 'Please select a California address.';

// ADU dimension constraints
export const DEFAULT_ADU_SIZE_SQFT = 300;
export const DEFAULT_ADU_ASPECT_RATIO = 1.0;
export const FLOOR_AREA_MIN = 200;
export const ASPECT_RATIO_MIN = 0.3;
export const ASPECT_RATIO_MAX = 3.0;
export const ORIENTATION_MIN = 0;
export const ORIENTATION_MAX = 360;

// Handle hit-testing radii (px)
export const CORNER_HANDLE_HIT_RADIUS = 6;
export const ROTATE_HANDLE_HIT_RADIUS = 6;
export const EDGE_HANDLE_HIT_HALF_W = 5;
export const EDGE_HANDLE_HIT_HALF_H = 4;
export const ROTATE_HANDLE_MIN_OFFSET_PX = 6;
export const ROTATE_HANDLE_DYNAMIC_FACTOR = 0.2;
export const DRAG_START_THRESHOLD_PX = 2;
export const HIT_TEST_TOLERANCE_PX = 2;
export const SCALE_MIN_FACTOR = 0.01;

// Handle visual sizes (px)
export const CORNER_HANDLE_VISUAL_RADIUS = 3.5;
export const ROTATE_HANDLE_VISUAL_RADIUS = 4.5;
export const EDGE_HANDLE_VISUAL_HALF_W = 5;
export const EDGE_HANDLE_VISUAL_HALF_H = 1.5;
export const HANDLE_HIT_AREA_SCALE = 2.2;
export const HANDLE_HIT_AREA_SCALE_DOUBLE = 4.4;

// Leg-reshape diamond handle
export const LEG_HANDLE_HIT_RADIUS = 16;
export const LEG_HANDLE_VISUAL_SIZE = 7;
export const LEG_DIMENSION_MIN = 0.2;
export const LEG_DIMENSION_MAX = 0.8;
export const DEFAULT_LEG_DIMENSIONS: import('./types').LegDimensions = {
  'l-shape': { tX: 0.5, tY: 0.5 },
  't-shape': { stemWidth: 0.5, crossbarDepth: 0.4 },
  'u-shape': { cutoutWidth: 0.5, cutoutDepth: 0.5 },
};
export const ROTATE_HANDLE_OFFSET_PX = 24;

// Auto-correction
export const AUTO_CORRECT_THRESHOLD_METERS = 0.75;
export const AUTO_CORRECT_ANIMATION_STEPS = 10;
export const AUTO_CORRECT_ANIMATION_INTERVAL_MS = 40;
export const AUTO_CORRECT_START_OFFSET_METERS = 0.1;
export const AUTO_CORRECT_DIST_STEP_METERS = 0.2;
export const AUTO_CORRECT_BACKOFF_METERS = 0.2;
export const AUTO_CORRECT_RADIAL_START_METERS = 0.2;
export const AUTO_CORRECT_RADIAL_STEP_METERS = 0.2;
export const AUTO_CORRECT_RADIAL_TOLERANCE_METERS = 0.05;
export const AUTO_CORRECT_BINARY_SEARCH_ITERS = 8;
export const AUTO_CORRECT_ANGLE_STEP_DEG = 15;
export const RADIAL_SEARCH_ANGLE_STEP_DEG = 22.5;

// Fallback spawn
export const FALLBACK_SPAWN_MIN_SIZE_SQFT = 200;
export const FALLBACK_SPAWN_RING_STEP_METERS = 0.75;
export const FALLBACK_SPAWN_MAX_RADIUS_METERS = 6;

// Optimal Placement
export const PLACEMENT_GRID_SAMPLES = 20;
export const PLACEMENT_ASPECT_RATIOS = [
  0.3, 0.35, 0.5, 0.67, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];
export const PLACEMENT_ROTATION_STEP_DEG = 15;
export const PLACEMENT_LOCAL_ROTATION_STEP_DEG = 1;
export const PLACEMENT_LOCAL_CENTER_STEP_METERS = 1.0;
export const PLACEMENT_LOCAL_CENTER_RINGS = 3;
export const PLACEMENT_REFINE_INITIAL_STEP_METERS = 2.0;
export const PLACEMENT_REFINE_DIRECTIONS = 8;
export const PLACEMENT_BINARY_SEARCH_ITERS = 12;
export const PLACEMENT_MAX_LOCAL_SPAWN_SQFT = 1200;
export const PLACEMENT_REFINE_ROUNDS = 10;
export const PLACEMENT_ROBUST_FINALISTS_MIN = 10;
export const PLACEMENT_ROBUST_FINALISTS_MAX = 150;
export const PLACEMENT_ROBUST_FINALISTS_SMALL_BUILDABLE_SQFT = 1200;
export const PLACEMENT_ROBUST_FINALISTS_LARGE_BUILDABLE_SQFT = 15000;

// Attached ADU snap tuning
export const ATTACHED_DRAG_CLAMP_PADDING_METERS = 15;
export const ATTACHED_CLEARANCE_BUFFER_METERS = 0.02;
export const ATTACHED_SLIDE_STEP_METERS = 0.1;
export const ATTACHED_CONTACT_THRESHOLD_METERS = 0.2;
export const ATTACHED_SLIDE_MIN_GAIN_TO_MOVE = 2;
export const ATTACHED_SLIDE_MAX_FOR_SMALL_GAIN_METERS = 0.75;
export const ATTACHED_CONTACT_VERTEX_BAND_METERS = 0.12;
export const ATTACHED_SLIDE_LOCAL_MAX_METERS = 0.35;
export const ATTACHED_PUSH_SWEEP_STEP_METERS = 0.05;
export const ATTACHED_PUSH_BINARY_ITERS = 16;
export const ATTACHED_PUSH_MAX_SWEEP_METERS = 50;
export const ATTACHED_ACTIVE_FACE_PROXIMITY_METERS = 3;
export const ATTACHED_ACTIVE_FACE_MIN_DISTANCE_EPSILON_METERS = 0.05;

// Map line styles
export const PROPERTY_LINE_DASH_ARRAY = [4, 4];
export const YARD_DIVIDER_DASH_ARRAY = [4, 4];

// Conversion factors
export const FOUR_FEET_METERS = 4 * 0.3048;
export const SIX_FEET_METERS = 6 * 0.3048;
export const METERS_TO_FEET = 1 / 0.3048;
export const ADU_GENERATION_BASE_SCALE_METERS = 10;
export const METERS_PER_DEGREE_LAT = 111111;
export const MIN_COS_LAT = 0.000001;
export const PROBE_DISTANCE_KM = 0.001;
export const ATTACHED_SNAP_PROBE_DISTANCE_KM = 0.00003;
export const BBOX_PADDING_DEG = 0.0002;
export const POLYLABEL_PRECISION_FINE = 0.00001;
export const POLYLABEL_PRECISION_ULTRA_FINE = 0.000001;
export const INTERNAL_YARD_LINE_THRESHOLD_METERS = 0.5;
export const RESTORED_FRONT_EDGE_MAX_DISTANCE_METERS = 15;
export const SQFT_TO_SQM = 0.09290304;
export const SQM_TO_SQFT = 1 / SQFT_TO_SQM;
export const ADU_MAX_ALLOWED_AREA_SQFT = 1500;
export const POLYGON_COVERAGE_THRESHOLD = 1;

// Derived constants
export const MAX_REACHABLE_ADU_HALF_DIAGONAL_METERS = (() => {
  const maxAreaSqM = ADU_MAX_ALLOWED_AREA_SQFT * SQFT_TO_SQM;
  const maxWidthMeters = Math.sqrt(maxAreaSqM * ASPECT_RATIO_MAX);
  const maxHeightMeters = Math.sqrt(maxAreaSqM / ASPECT_RATIO_MAX);
  return Math.hypot(maxWidthMeters, maxHeightMeters) / 2;
})();

export const ATTACHED_MAX_REACHABLE_DISTANCE_METERS =
  MAX_REACHABLE_ADU_HALF_DIAGONAL_METERS +
  ATTACHED_PUSH_MAX_SWEEP_METERS +
  ATTACHED_SLIDE_LOCAL_MAX_METERS;

// Edge alignment threshold (meters)
export const ALIGN_THRESHOLD_METERS = 0.75;

// UI Delays & Buffers
export const HUD_LOADING_INTERVAL_MS = 750;
export const DEFAULT_SEARCH_ZOOM = 18;
export const DEFAULT_INITIAL_ZOOM = 9;
export const MAX_MAP_ZOOM = 22;
export const CAMERA_FLY_TO_DURATION_MS = 1500;
export const MAP_SELECT_FLY_TO_DURATION_MS = 2000;
export const CAMERA_SLOW_FLY_TO_DURATION_MS = 5000;
export const MAP_ANALYSIS_READY_TIMEOUT_MS = 12000;
export const MAP_ANALYSIS_READY_POLL_INTERVAL_MS = 150;
export const MAP_ANALYSIS_BUILDING_RETRY_COUNT = 3;
export const YARD_LABEL_FADE_DELAY_MS = 2000;
export const YARD_LABEL_OPACITY_TRANSITION_MS = 1000;
export const WALL_LABEL_OPACITY_TRANSITION_MS = 180;
export const MOVEMENT_BOUNDARY_BUFFER_FEET = 50;
