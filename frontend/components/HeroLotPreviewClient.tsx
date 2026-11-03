'use client';

import type { ComponentProps } from 'react';
import dynamic from 'next/dynamic';
import type HeroLotPreviewComponent from '@/components/HeroLotPreview';

type HeroLotPreviewProps = ComponentProps<typeof HeroLotPreviewComponent>;

// mapbox-gl needs the window object, so the interactive lot map is client-only.
const HeroLotPreview = dynamic(() => import('@/components/HeroLotPreview'), {
  ssr: false,
  loading: () => (
    <div className="w-full max-w-xl">
      <div className="h-[600px] rounded-2xl border border-surface-200 bg-surface-50 animate-pulse" />
    </div>
  ),
});

export function HeroLotPreviewClient(props: HeroLotPreviewProps) {
  return <HeroLotPreview {...props} />;
}
