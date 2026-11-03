import type * as React from 'react';
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { Map as MapboxMap, MapMouseEvent, GeoJSONFeature } from 'mapbox-gl';
import type { MapRef } from 'react-map-gl/mapbox';
import type { AnalyzeResponse } from '@/types';
import type { InteractionMode, Point2D, ShapeType, LegDimensions, AduAction } from '../types';
import { clamp, dot, fromTo, generateAduPolygon, getShapeAreaRatio } from '../utils/geometry';
import { isPolygonWithinZone } from '../utils/polygonContainment';
import { resolveAttachedMove } from '../utils/resolveAttachedMove';
import { resolveDetachedMove } from '../utils/resolveDetachedMove';
import { resolveAutoEdgeAlignedRotation } from '../utils/resolveAutoEdgeAlignedRotation';
import {
  createProjectionAxes,
  createSelectedOverlayGeometry,
} from '../utils/createSelectedOverlayGeometry';
import { createMoveSession } from '../utils/createMoveSession';
import { createOverlaySession } from '../utils/createOverlaySession';
import { detectOverlayHit } from '../utils/detectOverlayHit';
import {
  type InteractionSession,
  type SelectedOverlayGeometry,
} from '../utils/interactionEngineTypes';
import { useAduPointerSession } from './useAduPointerSession';
import { useOverlayWheelForwarding } from './useOverlayWheelForwarding';
import { useOverlayViewportSync } from './useOverlayViewportSync';
import {
  ADU_MAX_ALLOWED_AREA_SQFT,
  FLOOR_AREA_MIN,
  ASPECT_RATIO_MIN,
  ASPECT_RATIO_MAX,
  ORIENTATION_MIN,
  ORIENTATION_MAX,
  LEG_DIMENSION_MIN,
  LEG_DIMENSION_MAX,
  SCALE_MIN_FACTOR,
} from '../constants';
import { isAduLayerFeature } from '../mapInteractionLayers';

type AduSnapshot = {
  aduCenter: { lng: number; lat: number } | null;
  aduCenterRef: React.MutableRefObject<{ lng: number; lat: number } | null>;
  aduSize: number;
  aduAspectRatio: number;
  aduRotation: number;
  aduShapeType: ShapeType;
  aduType: 'detached' | 'attached';
  aduPolygon: GeoJSON.Polygon | null;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
};

type InteractionPolicy = {
  autoEdgeAlign: boolean;
  autoPositionCorrection: boolean;
  isAutoCorrecting: boolean;
  isAttachedSnapPending: boolean;
  edgeSelectMode: boolean;
  aduMaxArea: number;
};

type MapContext = {
  mapRef: React.MutableRefObject<MapRef | null>;
  overlaySvgRef: React.MutableRefObject<SVGSVGElement | null>;
  result: AnalyzeResponse | null;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  attachedDragBounds: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null;
};

type InteractionActions = {
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: React.Dispatch<AduAction>;
  snapAttachedPlacement: (options?: {
    center?: { lng: number; lat: number };
    rotation?: number;
    size?: number;
    aspectRatio?: number;
    shapeType?: ShapeType;
    legDimensions?: LegDimensions[keyof LegDimensions];
    customPolygon?: GeoJSON.Polygon | null;
    animate?: boolean;
  }) => boolean;
  findDetachedAutoCorrectTarget: () => { lng: number; lat: number } | null;
  animateAutoCorrectTo: (
    targetCenter: { lng: number; lat: number },
    onComplete?: () => void,
  ) => void;
  stopAutoCorrectAnimation: (snapToFinalTarget: boolean) => void;
  setAduSelected_external?: React.Dispatch<React.SetStateAction<boolean>>;
};

function createPointerProjection({
  map,
  center,
  rotation,
  mousePx,
}: {
  map: MapboxMap;
  center: { lng: number; lat: number };
  rotation: number;
  mousePx: Point2D;
}) {
  const startCenterPxProjected = map.project([center.lng, center.lat]);
  const startCenterPx: Point2D = { x: startCenterPxProjected.x, y: startCenterPxProjected.y };
  const { axisWidth, axisHeight } = createProjectionAxes({
    map,
    center,
    rotation,
    centerPx: startCenterPx,
  });
  const mouseDelta = fromTo(startCenterPx, mousePx);

  return {
    startCenterPx,
    axisWidth,
    axisHeight,
    startU: dot(mouseDelta, axisWidth),
    startV: dot(mouseDelta, axisHeight),
  };
}

export function useAduInteraction({
  aduCenter,
  aduCenterRef,
  aduSize,
  aduAspectRatio,
  aduRotation,
  aduShapeType,
  aduType,
  aduPolygon,
  currentLegDimensions,
  legDimensions,
  result,
  movementBoundary,
  attachedDragBounds,
  autoEdgeAlign,
  autoPositionCorrection,
  isAutoCorrecting,
  isAttachedSnapPending,
  edgeSelectMode,
  mapRef,
  overlaySvgRef,
  dispatchCenter,
  dispatch,
  snapAttachedPlacement,
  findDetachedAutoCorrectTarget,
  animateAutoCorrectTo,
  stopAutoCorrectAnimation,
  setAduSelected_external,
}: {
  aduCenter: { lng: number; lat: number } | null;
  aduCenterRef: React.MutableRefObject<{ lng: number; lat: number } | null>;
  aduSize: number;
  aduAspectRatio: number;
  aduRotation: number;
  aduShapeType: ShapeType;
  aduType: 'detached' | 'attached';
  aduPolygon: GeoJSON.Polygon | null;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  legDimensions: LegDimensions;
  result: AnalyzeResponse | null;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  attachedDragBounds: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null;
  autoEdgeAlign: boolean;
  autoPositionCorrection: boolean;
  isAutoCorrecting: boolean;
  isAttachedSnapPending: boolean;
  edgeSelectMode: boolean;
  mapRef: React.MutableRefObject<MapRef | null>;
  overlaySvgRef: React.MutableRefObject<SVGSVGElement | null>;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: React.Dispatch<AduAction>;
  snapAttachedPlacement: (options?: {
    center?: { lng: number; lat: number };
    rotation?: number;
    size?: number;
    aspectRatio?: number;
    shapeType?: ShapeType;
    legDimensions?: LegDimensions[keyof LegDimensions];
    customPolygon?: GeoJSON.Polygon | null;
    animate?: boolean;
  }) => boolean;
  findDetachedAutoCorrectTarget: () => { lng: number; lat: number } | null;
  animateAutoCorrectTo: (
    targetCenter: { lng: number; lat: number },
    onComplete?: () => void,
  ) => void;
  stopAutoCorrectAnimation: (snapToFinalTarget: boolean) => void;
  setAduSelected_external?: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [isDraggingAdu, setIsDraggingAdu] = useState(false);
  const [aduSelected, setAduSelected] = useState(false);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const interactionRef = useRef<InteractionSession | null>(null);
  const suppressNextMapClickRef = useRef(false);
  const interactionMovedRef = useRef(false);
  const aduMaxArea = result?.max_adu_sqft || ADU_MAX_ALLOWED_AREA_SQFT;
  const isAduInteracting = isDraggingAdu || isAutoCorrecting || isAttachedSnapPending;
  const aduSnapshot = useMemo<AduSnapshot>(
    () => ({
      aduCenter,
      aduCenterRef,
      aduSize,
      aduAspectRatio,
      aduRotation,
      aduShapeType,
      aduType,
      aduPolygon,
      currentLegDimensions,
    }),
    [
      aduCenter,
      aduCenterRef,
      aduSize,
      aduAspectRatio,
      aduRotation,
      aduShapeType,
      aduType,
      aduPolygon,
      currentLegDimensions,
    ],
  );
  const interactionPolicy = useMemo<InteractionPolicy>(
    () => ({
      autoEdgeAlign,
      autoPositionCorrection,
      isAutoCorrecting,
      isAttachedSnapPending,
      edgeSelectMode,
      aduMaxArea,
    }),
    [
      autoEdgeAlign,
      autoPositionCorrection,
      isAutoCorrecting,
      isAttachedSnapPending,
      edgeSelectMode,
      aduMaxArea,
    ],
  );
  const mapContext = useMemo<MapContext>(
    () => ({
      mapRef,
      overlaySvgRef,
      result,
      movementBoundary,
      attachedDragBounds,
    }),
    [mapRef, overlaySvgRef, result, movementBoundary, attachedDragBounds],
  );
  const interactionActions = useMemo<InteractionActions>(
    () => ({
      dispatchCenter,
      dispatch,
      snapAttachedPlacement,
      findDetachedAutoCorrectTarget,
      animateAutoCorrectTo,
      stopAutoCorrectAnimation,
      setAduSelected_external,
    }),
    [
      dispatchCenter,
      dispatch,
      snapAttachedPlacement,
      findDetachedAutoCorrectTarget,
      animateAutoCorrectTo,
      stopAutoCorrectAnimation,
      setAduSelected_external,
    ],
  );

  const onAduEnter = useCallback(() => {
    if (mapRef.current && interactionMode === 'idle') {
      mapRef.current.getCanvas().style.cursor = 'move';
    }
  }, [interactionMode, mapRef]);

  const onAduLeave = useCallback(() => {
    if (mapRef.current && interactionMode === 'idle') {
      mapRef.current.getCanvas().style.cursor = '';
    }
  }, [interactionMode, mapRef]);

  const overlayTick = useOverlayViewportSync({
    mapRef,
    enabled: aduSelected,
  });

  const selectedOverlayGeometry = useMemo(() => {
    if (!aduSelected || !aduSnapshot.aduPolygon || !aduSnapshot.aduCenter) return null;
    const map = mapContext.mapRef.current?.getMap();
    if (!map) return null;
    void overlayTick;
    return createSelectedOverlayGeometry({
      map,
      aduCenter: aduSnapshot.aduCenter,
      aduPolygon: aduSnapshot.aduPolygon,
      aduRotation: aduSnapshot.aduRotation,
      aduShapeType: aduSnapshot.aduShapeType,
    });
  }, [aduSelected, aduSnapshot, overlayTick, mapContext]);

  const applyConstrainedMove = useCallback(
    (candidate: { lng: number; lat: number }) => {
      if (!aduSnapshot.aduCenter) return;

      if (aduSnapshot.aduType === 'attached') {
        interactionActions.dispatchCenter(
          resolveAttachedMove({
            candidate,
            attachedDragBounds: mapContext.attachedDragBounds,
          }),
        );
        return;
      }

      const nextCenter = resolveDetachedMove({
        candidate,
        aduCenter: aduSnapshot.aduCenter,
        aduSize: aduSnapshot.aduSize,
        aduAspectRatio: aduSnapshot.aduAspectRatio,
        aduRotation: aduSnapshot.aduRotation,
        aduShapeType: aduSnapshot.aduShapeType,
        currentLegDimensions: aduSnapshot.currentLegDimensions,
        movementBoundary: mapContext.movementBoundary,
      });

      if (interactionPolicy.autoEdgeAlign && mapContext.result?.buildable_zone_geojson) {
        const nextRotation = resolveAutoEdgeAlignedRotation({
          center: nextCenter,
          currentRotation: aduSnapshot.aduRotation,
          aduSize: aduSnapshot.aduSize,
          aduAspectRatio: aduSnapshot.aduAspectRatio,
          aduShapeType: aduSnapshot.aduShapeType,
          currentLegDimensions: aduSnapshot.currentLegDimensions,
          movementBoundary: mapContext.movementBoundary,
          buildableZoneGeojson: mapContext.result.buildable_zone_geojson,
        });
        if (nextRotation !== null) {
          interactionActions.dispatch({ type: 'SET_ROTATION', rotation: nextRotation });
        }
      }

      interactionActions.dispatchCenter(nextCenter);
    },
    [aduSnapshot, interactionPolicy, mapContext, interactionActions],
  );

  const endInteraction = useCallback(() => {
    const endedInteraction = interactionRef.current;
    const dropCenter = aduSnapshot.aduCenterRef.current;
    const hadMovement = interactionMovedRef.current;
    if (interactionRef.current && interactionMovedRef.current) {
      suppressNextMapClickRef.current = true;
    }
    interactionMovedRef.current = false;
    interactionRef.current = null;
    setInteractionMode('idle');
    setIsDraggingAdu(false);
    if (mapContext.mapRef.current) {
      const map = mapContext.mapRef.current.getMap();
      mapContext.mapRef.current.getCanvas().style.cursor = '';
      if (map && map.dragPan) map.dragPan.enable();
    }

    if (aduSnapshot.aduType === 'attached' && endedInteraction && hadMovement && dropCenter) {
      interactionActions.snapAttachedPlacement({ center: dropCenter, animate: true });
      return;
    }

    if (interactionPolicy.autoPositionCorrection) {
      const autoCorrectTarget = interactionActions.findDetachedAutoCorrectTarget();
      if (autoCorrectTarget) {
        interactionActions.animateAutoCorrectTo(autoCorrectTarget);
      }
    }
  }, [aduSnapshot, interactionPolicy, mapContext, interactionActions]);

  const startMapAduDrag = useCallback(
    (e: MapMouseEvent) => {
      if (
        !aduSnapshot.aduCenter ||
        interactionPolicy.edgeSelectMode ||
        interactionPolicy.isAutoCorrecting
      ) {
        return;
      }

      const isAdu = isAduLayerFeature(e.features as GeoJSONFeature[] | undefined);
      if (!isAdu) return;

      const map = mapContext.mapRef.current?.getMap();
      if (!map) return;

      setAduSelected(true);

      const canvasRect = map.getCanvas().getBoundingClientRect();
      const mousePx: Point2D = {
        x: e.originalEvent.clientX - canvasRect.left,
        y: e.originalEvent.clientY - canvasRect.top,
      };
      const projection = createPointerProjection({
        map,
        center: aduSnapshot.aduCenter,
        rotation: aduSnapshot.aduRotation,
        mousePx,
      });

      interactionRef.current = createMoveSession({
        mousePx,
        aduCenter: aduSnapshot.aduCenter,
        aduSize: aduSnapshot.aduSize,
        aduAspectRatio: aduSnapshot.aduAspectRatio,
        aduRotation: aduSnapshot.aduRotation,
        projection,
      });
      interactionMovedRef.current = false;

      setInteractionMode('moving');
      setIsDraggingAdu(true);
      if (map.dragPan) map.dragPan.disable();
      mapContext.mapRef.current?.getCanvas().style.setProperty('cursor', 'move');

      e.originalEvent?.preventDefault();
      e.originalEvent?.stopPropagation();
    },
    [aduSnapshot, interactionPolicy, mapContext],
  );

  useEffect(() => {
    if (!aduSnapshot.aduPolygon) {
      setAduSelected(false);
      interactionActions.setAduSelected_external?.(false);
      endInteraction();
    }
  }, [aduSnapshot, interactionActions, endInteraction]);

  const startOverlayInteraction = useCallback(
    (e: React.MouseEvent<SVGElement>) => {
      if (interactionPolicy.isAutoCorrecting) {
        interactionActions.stopAutoCorrectAnimation(true);
      }
      if (!selectedOverlayGeometry || !aduSnapshot.aduCenter) return;
      const map = mapContext.mapRef.current?.getMap();
      if (!map) return;
      const svgRect = map.getCanvas().getBoundingClientRect();
      const mousePx: Point2D = {
        x: e.clientX - svgRect.left,
        y: e.clientY - svgRect.top,
      };

      const overlayHit = detectOverlayHit({ mousePx, selectedOverlayGeometry });
      if (!overlayHit) return;

      interactionRef.current = createOverlaySession({
        mousePx,
        overlayHit,
        selectedOverlayGeometry,
        aduCenter: aduSnapshot.aduCenter,
        aduSize: aduSnapshot.aduSize,
        aduAspectRatio: aduSnapshot.aduAspectRatio,
        aduRotation: aduSnapshot.aduRotation,
        currentLegDimensions: aduSnapshot.currentLegDimensions,
      });

      setInteractionMode(overlayHit.mode);
      setIsDraggingAdu(true);
      if (map && map.dragPan) map.dragPan.disable();
      if (mapContext.mapRef.current) {
        mapContext.mapRef.current
          .getCanvas()
          .style.setProperty('cursor', overlayHit.mode === 'rotating' ? 'grabbing' : 'move');
      }

      e.preventDefault();
      e.stopPropagation();
    },
    [interactionPolicy, interactionActions, selectedOverlayGeometry, aduSnapshot, mapContext],
  );

  useOverlayWheelForwarding({
    mapRef: mapContext.mapRef,
    overlaySvgRef: mapContext.overlaySvgRef,
    enabled: selectedOverlayGeometry !== null,
  });

  useAduPointerSession({
    interactionMode,
    interactionRef,
    interactionMovedRef,
    mapRef: mapContext.mapRef,
    movementBoundary: mapContext.movementBoundary,
    selectedOverlayGeometry,
    applyConstrainedMove,
    endInteraction,
    aduCenter: aduSnapshot.aduCenter,
    aduSize: aduSnapshot.aduSize,
    aduAspectRatio: aduSnapshot.aduAspectRatio,
    aduShapeType: aduSnapshot.aduShapeType,
    currentLegDimensions: aduSnapshot.currentLegDimensions,
    aduMaxArea: interactionPolicy.aduMaxArea,
    dispatchCenter: interactionActions.dispatchCenter,
    dispatch: interactionActions.dispatch,
  });

  const resetInteractionState = useCallback(() => {
    interactionRef.current = null;
    setAduSelected(false);
    setInteractionMode('idle');
    setIsDraggingAdu(false);
  }, []);

  return {
    isDraggingAdu,
    aduSelected,
    setAduSelected,
    interactionMode,
    selectedOverlayGeometry,
    startOverlayInteraction,
    startMapAduDrag,
    onAduEnter,
    onAduLeave,
    isAduInteracting,
    resetInteractionState,
    suppressNextMapClickRef,
  };
}
