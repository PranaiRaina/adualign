import * as turf from '@turf/turf';
import type { Map as MapboxMap } from 'mapbox-gl';

import {
  ROTATE_HANDLE_OFFSET_PX,
  PROBE_DISTANCE_KM,
  ROTATE_HANDLE_MIN_OFFSET_PX,
  ROTATE_HANDLE_DYNAMIC_FACTOR,
} from '../constants';
import type { Point2D, ShapeType } from '../types';
import { dot, fromTo, getRotatedCursor, normalizeVector } from './geometry';
import type {
  OverlayHandle,
  OverlayLegHandle,
  SelectedOverlayGeometry,
} from './interactionEngineTypes';

export function createProjectionAxes({
  map,
  center,
  rotation,
  centerPx,
}: {
  map: MapboxMap;
  center: { lng: number; lat: number };
  rotation: number;
  centerPx: Point2D;
}) {
  const centerPoint = turf.point([center.lng, center.lat]);
  const widthProbe = turf.destination(centerPoint, PROBE_DISTANCE_KM, 90 + rotation, {
    units: 'kilometers',
  });
  const heightProbe = turf.destination(centerPoint, PROBE_DISTANCE_KM, rotation, {
    units: 'kilometers',
  });
  const widthProbePx = map.project(widthProbe.geometry.coordinates as [number, number]);
  const heightProbePx = map.project(heightProbe.geometry.coordinates as [number, number]);

  return {
    axisWidth: normalizeVector({
      x: widthProbePx.x - centerPx.x,
      y: widthProbePx.y - centerPx.y,
    }),
    axisHeight: normalizeVector({
      x: heightProbePx.x - centerPx.x,
      y: heightProbePx.y - centerPx.y,
    }),
  };
}

function createLegHandles({
  aduShapeType,
  aduScreenPoints,
  aduRotation,
}: {
  aduShapeType: ShapeType;
  aduScreenPoints: Point2D[];
  aduRotation: number;
}) {
  const legHandles: OverlayLegHandle[] = [];

  if (aduShapeType === 'rectangle' || aduScreenPoints.length < 6) {
    return legHandles;
  }

  if (aduShapeType === 'l-shape') {
    const p3 = aduScreenPoints[3];
    const p4 = aduScreenPoints[4];
    const p5 = aduScreenPoints[5];
    legHandles.push({
      x: (p3.x + p4.x) / 2,
      y: (p3.y + p4.y) / 2,
      legIndex: 0,
      cursor: getRotatedCursor(90, aduRotation),
    });
    legHandles.push({
      x: (p4.x + p5.x) / 2,
      y: (p4.y + p5.y) / 2,
      legIndex: 1,
      cursor: getRotatedCursor(0, aduRotation),
    });
    return legHandles;
  }

  if (aduScreenPoints.length < 8) {
    return legHandles;
  }

  if (aduShapeType === 't-shape') {
    const p5 = aduScreenPoints[5];
    const p6 = aduScreenPoints[6];
    const p7 = aduScreenPoints[7];
    legHandles.push({
      x: (p5.x + p6.x) / 2,
      y: (p5.y + p6.y) / 2,
      legIndex: 0,
      cursor: getRotatedCursor(90, aduRotation),
    });
    legHandles.push({
      x: (p6.x + p7.x) / 2,
      y: (p6.y + p7.y) / 2,
      legIndex: 1,
      cursor: getRotatedCursor(0, aduRotation),
    });
    return legHandles;
  }

  const p3 = aduScreenPoints[3];
  const p4 = aduScreenPoints[4];
  const p5 = aduScreenPoints[5];
  legHandles.push({
    x: (p3.x + p4.x) / 2,
    y: (p3.y + p4.y) / 2,
    legIndex: 0,
    cursor: getRotatedCursor(90, aduRotation),
  });
  legHandles.push({
    x: (p4.x + p5.x) / 2,
    y: (p4.y + p5.y) / 2,
    legIndex: 1,
    cursor: getRotatedCursor(0, aduRotation),
  });
  return legHandles;
}

export function createSelectedOverlayGeometry({
  map,
  aduCenter,
  aduPolygon,
  aduRotation,
  aduShapeType,
}: {
  map: MapboxMap;
  aduCenter: { lng: number; lat: number };
  aduPolygon: GeoJSON.Polygon;
  aduRotation: number;
  aduShapeType: ShapeType;
}): SelectedOverlayGeometry | null {
  const canvas = map.getCanvas();
  const projectedCenter = map.project([aduCenter.lng, aduCenter.lat]);
  const centerPx: Point2D = { x: projectedCenter.x, y: projectedCenter.y };
  const { axisWidth, axisHeight } = createProjectionAxes({
    map,
    center: aduCenter,
    rotation: aduRotation,
    centerPx,
  });
  const aduScreenPoints = aduPolygon.coordinates[0]
    .slice(0, -1)
    .map((coord) => map.project(coord as [number, number]))
    .map((point) => ({ x: point.x, y: point.y }));

  if (aduScreenPoints.length < 3) {
    return null;
  }

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const point of aduScreenPoints) {
    const delta = fromTo(centerPx, point);
    const u = dot(delta, axisWidth);
    const v = dot(delta, axisHeight);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const toScreen = (u: number, v: number): Point2D => ({
    x: centerPx.x + axisWidth.x * u + axisHeight.x * v,
    y: centerPx.y + axisWidth.y * u + axisHeight.y * v,
  });

  const corners: Record<'top-left' | 'top-right' | 'bottom-right' | 'bottom-left', OverlayHandle> =
    {
      'top-left': { ...toScreen(minU, maxV), cursor: getRotatedCursor(315, aduRotation) },
      'top-right': { ...toScreen(maxU, maxV), cursor: getRotatedCursor(45, aduRotation) },
      'bottom-right': { ...toScreen(maxU, minV), cursor: getRotatedCursor(135, aduRotation) },
      'bottom-left': { ...toScreen(minU, minV), cursor: getRotatedCursor(225, aduRotation) },
    };

  const edgeHandles: Record<'top' | 'right' | 'bottom' | 'left', OverlayHandle> = {
    top: { ...toScreen((minU + maxU) / 2, maxV), cursor: getRotatedCursor(0, aduRotation) },
    right: { ...toScreen(maxU, (minV + maxV) / 2), cursor: getRotatedCursor(90, aduRotation) },
    bottom: { ...toScreen((minU + maxU) / 2, minV), cursor: getRotatedCursor(180, aduRotation) },
    left: { ...toScreen(minU, (minV + maxV) / 2), cursor: getRotatedCursor(270, aduRotation) },
  };

  const topMid = edgeHandles.top;
  const topOutward = normalizeVector(fromTo(centerPx, topMid));
  const obbShortestSide = Math.min(maxU - minU, maxV - minV);
  const dynamicOffset = Math.min(
    ROTATE_HANDLE_OFFSET_PX,
    Math.max(ROTATE_HANDLE_MIN_OFFSET_PX, obbShortestSide * ROTATE_HANDLE_DYNAMIC_FACTOR),
  );
  const rotationHandle: Point2D = {
    x: topMid.x + topOutward.x * dynamicOffset,
    y: topMid.y + topOutward.y * dynamicOffset,
  };

  return {
    canvasWidth: canvas.clientWidth,
    canvasHeight: canvas.clientHeight,
    centerPx,
    axisWidth,
    axisHeight,
    minU,
    maxU,
    minV,
    maxV,
    corners,
    edgeHandles,
    topMid,
    rotationHandle,
    aduScreenPoints,
    bboxPath: [
      `M ${corners['top-left'].x} ${corners['top-left'].y}`,
      `L ${corners['top-right'].x} ${corners['top-right'].y}`,
      `L ${corners['bottom-right'].x} ${corners['bottom-right'].y}`,
      `L ${corners['bottom-left'].x} ${corners['bottom-left'].y}`,
      'Z',
    ].join(' '),
    toScreen,
    legHandles: createLegHandles({ aduShapeType, aduScreenPoints, aduRotation }),
  };
}
