'use client';

import type { ComponentProps } from 'react';
import dynamic from 'next/dynamic';
import type MapInterfaceComponent from '@/components/map/MapInterface';

type MapInterfaceProps = ComponentProps<typeof MapInterfaceComponent>;

// mapbox-gl requires the window object, so the full map runs client-side only.
const MapInterface = dynamic(() => import('@/components/map/MapInterface'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-surface-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-surface-600">Loading map...</p>
      </div>
    </div>
  ),
});

export function MapInterfaceClient(props: MapInterfaceProps) {
  return <MapInterface {...props} />;
}
