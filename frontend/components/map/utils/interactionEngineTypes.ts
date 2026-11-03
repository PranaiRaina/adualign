import type { CornerId, EdgeId, LegDimensions, InteractionMode, Point2D } from '../types';

export type OverlayHit = {
  mode: InteractionMode;
  cornerId?: CornerId;
  edgeId?: EdgeId;
  legIndex?: number;
};

export type OverlayHandle = Point2D & { cursor: string };
export type OverlayLegHandle = Point2D & { legIndex: number; cursor: string };

export type SelectedOverlayGeometry = {
  canvasWidth: number;
  canvasHeight: number;
  centerPx: Point2D;
  axisWidth: Point2D;
  axisHeight: Point2D;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  corners: Record<CornerId, OverlayHandle>;
  edgeHandles: Record<EdgeId, OverlayHandle>;
  topMid: OverlayHandle;
  rotationHandle: Point2D;
  aduScreenPoints: Point2D[];
  bboxPath: string;
  toScreen: (u: number, v: number) => Point2D;
  legHandles: OverlayLegHandle[];
};

export type InteractionSession = {
  mode: InteractionMode;
  startMousePx: Point2D;
  startCenter: { lng: number; lat: number };
  startSize: number;
  startAspectRatio: number;
  startRotation: number;
  startCenterPx: Point2D;
  axisWidth: Point2D;
  axisHeight: Point2D;
  startU: number;
  startV: number;
  anchorU: number;
  anchorV: number;
  cornerId?: CornerId;
  edgeId?: EdgeId;
  rotationStartAngle?: number;
  legIndex?: number;
  startLegDimensions?: LegDimensions[keyof LegDimensions];
};
