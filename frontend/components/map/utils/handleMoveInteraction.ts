import type { Map as MapboxMap } from 'mapbox-gl';

import type { Point2D } from '../types';
import type { InteractionSession } from './interactionEngineTypes';
import { fromTo } from './geometry';

interface HandleMoveInteractionArgs {
  active: InteractionSession;
  map: MapboxMap;
  mousePx: Point2D;
  applyConstrainedMove: (candidate: { lng: number; lat: number }) => void;
}

export function handleMoveInteraction({
  active,
  map,
  mousePx,
  applyConstrainedMove,
}: HandleMoveInteractionArgs) {
  const startCenterPx = map.project([active.startCenter.lng, active.startCenter.lat]);
  const deltaPx = fromTo(active.startMousePx, mousePx);
  const nextCenterPx = { x: startCenterPx.x + deltaPx.x, y: startCenterPx.y + deltaPx.y };
  const nextLngLat = map.unproject([nextCenterPx.x, nextCenterPx.y]);
  applyConstrainedMove({ lng: nextLngLat.lng, lat: nextLngLat.lat });
}
