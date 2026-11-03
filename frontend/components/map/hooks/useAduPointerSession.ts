import type * as React from 'react';
import { useEffect } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';

import { DRAG_START_THRESHOLD_PX } from '../constants';
import type { AduAction, InteractionMode, LegDimensions, ShapeType } from '../types';
import { dot, fromTo } from '../utils/geometry';
import { handleCornerScaleInteraction } from '../utils/handleCornerScaleInteraction';
import { handleEdgeScaleInteraction } from '../utils/handleEdgeScaleInteraction';
import { handleLegReshapeInteraction } from '../utils/handleLegReshapeInteraction';
import { handleMoveInteraction } from '../utils/handleMoveInteraction';
import { handleRotateInteraction } from '../utils/handleRotateInteraction';
import type { InteractionSession, SelectedOverlayGeometry } from '../utils/interactionEngineTypes';

interface UseAduPointerSessionArgs {
  interactionMode: InteractionMode;
  interactionRef: React.MutableRefObject<InteractionSession | null>;
  interactionMovedRef: React.MutableRefObject<boolean>;
  mapRef: React.MutableRefObject<MapRef | null>;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  selectedOverlayGeometry: SelectedOverlayGeometry | null;
  applyConstrainedMove: (candidate: { lng: number; lat: number }) => void;
  endInteraction: () => void;
  aduCenter: { lng: number; lat: number } | null;
  aduSize: number;
  aduAspectRatio: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  aduMaxArea: number;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: React.Dispatch<AduAction>;
}

function handlePointerMove({
  event,
  interactionRef,
  interactionMovedRef,
  mapRef,
  movementBoundary,
  selectedOverlayGeometry,
  applyConstrainedMove,
  aduCenter,
  aduSize,
  aduAspectRatio,
  aduShapeType,
  currentLegDimensions,
  aduMaxArea,
  dispatchCenter,
  dispatch,
}: Omit<UseAduPointerSessionArgs, 'interactionMode' | 'endInteraction'> & { event: MouseEvent }) {
  const active = interactionRef.current;
  const map = mapRef.current?.getMap();
  if (!active || !map) return;

  const canvasRect = map.getCanvas().getBoundingClientRect();
  const mousePx = { x: event.clientX - canvasRect.left, y: event.clientY - canvasRect.top };
  const pointerTravel = Math.hypot(
    mousePx.x - active.startMousePx.x,
    mousePx.y - active.startMousePx.y,
  );
  if (pointerTravel > DRAG_START_THRESHOLD_PX) {
    interactionMovedRef.current = true;
  }

  const rel = fromTo(active.startCenterPx, mousePx);
  const u = dot(rel, active.axisWidth);
  const v = dot(rel, active.axisHeight);

  if (active.mode === 'moving') {
    handleMoveInteraction({ active, map, mousePx, applyConstrainedMove });
    return;
  }

  if (active.mode === 'rotating') {
    handleRotateInteraction({
      active,
      mousePx,
      aduCenter,
      aduSize,
      aduAspectRatio,
      aduShapeType,
      currentLegDimensions,
      movementBoundary,
      dispatch,
    });
    return;
  }

  if (!aduCenter) return;

  if (active.mode === 'scaling-corner') {
    handleCornerScaleInteraction({
      active,
      map,
      u,
      v,
      aduCenter,
      aduMaxArea,
      aduShapeType,
      currentLegDimensions,
      movementBoundary,
      dispatchCenter,
      dispatch,
    });
    return;
  }

  if (active.mode === 'scaling-edge') {
    handleEdgeScaleInteraction({
      active,
      map,
      u,
      v,
      aduMaxArea,
      aduShapeType,
      currentLegDimensions,
      movementBoundary,
      dispatchCenter,
      dispatch,
    });
    return;
  }

  if (active.mode === 'reshaping-leg') {
    handleLegReshapeInteraction({
      active,
      u,
      v,
      aduCenter,
      aduMaxArea,
      aduShapeType,
      movementBoundary,
      selectedOverlayGeometry,
      dispatch,
    });
  }
}

export function useAduPointerSession({
  interactionMode,
  interactionRef,
  interactionMovedRef,
  mapRef,
  movementBoundary,
  selectedOverlayGeometry,
  applyConstrainedMove,
  endInteraction,
  aduCenter,
  aduSize,
  aduAspectRatio,
  aduShapeType,
  currentLegDimensions,
  aduMaxArea,
  dispatchCenter,
  dispatch,
}: UseAduPointerSessionArgs) {
  useEffect(() => {
    if (interactionMode === 'idle') return;

    const onMouseMove = (event: MouseEvent) => {
      handlePointerMove({
        event,
        interactionRef,
        interactionMovedRef,
        mapRef,
        movementBoundary,
        selectedOverlayGeometry,
        applyConstrainedMove,
        aduCenter,
        aduSize,
        aduAspectRatio,
        aduShapeType,
        currentLegDimensions,
        aduMaxArea,
        dispatchCenter,
        dispatch,
      });
    };

    const onMouseUp = () => endInteraction();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [
    interactionMode,
    interactionRef,
    interactionMovedRef,
    mapRef,
    movementBoundary,
    selectedOverlayGeometry,
    applyConstrainedMove,
    endInteraction,
    aduCenter,
    aduSize,
    aduAspectRatio,
    aduShapeType,
    currentLegDimensions,
    aduMaxArea,
    dispatchCenter,
    dispatch,
  ]);
}
