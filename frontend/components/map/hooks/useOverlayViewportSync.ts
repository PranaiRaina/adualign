import { useEffect, useState } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';

interface UseOverlayViewportSyncArgs {
  mapRef: React.MutableRefObject<MapRef | null>;
  enabled: boolean;
}

export function useOverlayViewportSync({ mapRef, enabled }: UseOverlayViewportSyncArgs) {
  const [overlayTick, setOverlayTick] = useState(0);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !enabled) return;

    const updateOverlayTick = () => {
      setOverlayTick((prev) => prev + 1);
    };

    map.on('move', updateOverlayTick);
    map.on('zoom', updateOverlayTick);
    map.on('rotate', updateOverlayTick);
    map.on('resize', updateOverlayTick);
    return () => {
      map.off('move', updateOverlayTick);
      map.off('zoom', updateOverlayTick);
      map.off('rotate', updateOverlayTick);
      map.off('resize', updateOverlayTick);
    };
  }, [enabled, mapRef]);

  return overlayTick;
}
