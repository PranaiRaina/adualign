import type * as React from 'react';
import { useCallback, useEffect } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';

interface UseOverlayWheelForwardingArgs {
  mapRef: React.MutableRefObject<MapRef | null>;
  overlaySvgRef: React.MutableRefObject<SVGSVGElement | null>;
  enabled: boolean;
}

export function useOverlayWheelForwarding({
  mapRef,
  overlaySvgRef,
  enabled,
}: UseOverlayWheelForwardingArgs) {
  const forwardOverlayWheelToMap = useCallback(
    (event: WheelEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      const canvas = map.getCanvas();
      const forwarded = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      canvas.dispatchEvent(forwarded);
    },
    [mapRef],
  );

  useEffect(() => {
    const svg = overlaySvgRef.current;
    if (!svg || !enabled) return;

    const wheelHandler = (event: WheelEvent) => forwardOverlayWheelToMap(event);
    svg.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
    return () => {
      svg.removeEventListener('wheel', wheelHandler, true);
    };
  }, [enabled, forwardOverlayWheelToMap, overlaySvgRef]);
}
