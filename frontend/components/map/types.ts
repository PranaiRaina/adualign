/* ------------------------------------------------------------------ */
/*  Shared Types for Map Interface                                     */
/* ------------------------------------------------------------------ */

import type { PropertyContext } from '@/types';

export type InteractionMode =
  | 'idle'
  | 'rotating'
  | 'scaling-corner'
  | 'scaling-edge'
  | 'moving'
  | 'reshaping-leg';
export type Point2D = { x: number; y: number };
export type CornerId = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
export type EdgeId = 'top' | 'right' | 'bottom' | 'left';
export type ShapeType = 'rectangle' | 'l-shape' | 't-shape' | 'u-shape';
export type WallSegment = { start: number[]; end: number[] };
export type SnapResult = { lng: number; lat: number; rotation: number; isValid: boolean };
export type MapLocation = { lat: number; lng: number; name: string };
export type AddressSelectionOptions = {
  autoAnalyze?: boolean;
  flyTo?: boolean;
};
export type LngLatCoordinate = [number, number];
export type ClearanceGuideDirection = 'top' | 'right' | 'bottom' | 'left';
export type ClearanceGuideTargetKind = 'parcel-boundary' | 'active-structure';

export type ClearanceGuide = {
  direction: ClearanceGuideDirection;
  targetKind: ClearanceGuideTargetKind;
  aduPoint: LngLatCoordinate;
  targetPoint: LngLatCoordinate;
  distanceFeet: number;
  targetStructureIndex?: number;
};

export type MapLaunchContext = {
  initialLocation?: MapLocation;
  initialAddress?: string;
  initialPlanningContext?: PropertyContext;
  isFromChat: boolean;
  projectId?: string;
  mapSearchId?: string;
};

/* ------------------------------------------------------------------ */
/*  ADU Reducer State & Actions                                        */
/* ------------------------------------------------------------------ */

export type LegDimensions = {
  'l-shape': { tX: number; tY: number };
  't-shape': { stemWidth: number; crossbarDepth: number };
  'u-shape': { cutoutWidth: number; cutoutDepth: number };
};

export type ShapeState = {
  center: { lng: number; lat: number };
  size: number;
  aspectRatio: number;
  rotation: number;
  legDimensions?: LegDimensions[keyof LegDimensions];
};

export type ShapeStateCache = {
  [key in ShapeType]: ShapeState | null;
};

export type RectangleShapeState = Omit<ShapeState, 'legDimensions'>;

export interface AduState {
  center: { lng: number; lat: number } | null;
  size: number; // sq ft
  aspectRatio: number; // width / length
  rotation: number; // 0–360°
  type: 'detached' | 'attached';
  isValid: boolean;
  isAttachedSnapPending: boolean;
  isAutoCorrecting: boolean;
  legDimensions: LegDimensions;
}

export type AduAction =
  | { type: 'SET_CENTER'; center: AduState['center'] }
  | { type: 'SET_SIZE'; size: number }
  | { type: 'SET_ASPECT_RATIO'; aspectRatio: number }
  | { type: 'SET_ROTATION'; rotation: number }
  | { type: 'SET_TYPE'; aduType: AduState['type'] }
  | { type: 'SET_IS_VALID'; isValid: boolean }
  | { type: 'SET_ATTACHED_SNAP_PENDING'; pending: boolean }
  | { type: 'SET_AUTO_CORRECTING'; correcting: boolean }
  | { type: 'SET_LEG_DIMENSIONS'; shape: 'l-shape'; dims: { tX: number; tY: number } }
  | {
      type: 'SET_LEG_DIMENSIONS';
      shape: 't-shape';
      dims: { stemWidth: number; crossbarDepth: number };
    }
  | {
      type: 'SET_LEG_DIMENSIONS';
      shape: 'u-shape';
      dims: { cutoutWidth: number; cutoutDepth: number };
    }
  | { type: 'BATCH'; actions: AduAction[] }
  | { type: 'RESET' };
