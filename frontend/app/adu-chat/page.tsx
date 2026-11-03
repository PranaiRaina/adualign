'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PlanningSessionEntryGate } from '@/components/PlanningSessionEntryGate';
import { RAGChat } from '@/components/rag-chat/RAGChat';
import { Header } from '@/components/layout/Header';
import type { AduClearance, AduType, PropertyContext } from '@/types';
import type { PlanningSessionRouteContext } from '@/lib/planningSessionEntry';

function parseAduClearances(value: string | null): AduClearance[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as AduClearance[]) : undefined;
  } catch {
    return undefined;
  }
}

function parseAduType(value: string | null): AduType | undefined {
  if (!value) return undefined;
  if (
    value === 'detached' ||
    value === 'attached' ||
    value === 'garage_conversion' ||
    value === 'jadu' ||
    value === 'unsure'
  ) {
    return value;
  }
  return undefined;
}

function hasChatSessionLikeParams(searchParams: URLSearchParams) {
  return [
    'fromMap',
    'address',
    'county',
    'lat',
    'lng',
    'aduType',
    'aduSize',
    'aduWidthFt',
    'aduLengthFt',
    'aduShape',
    'setback',
    'propertyArea',
    'homeSqft',
    'buildableArea',
    'maxAduSqft',
    'apn',
    'fireHazardSeverity',
    'fireHazardZoneType',
    'currentYardZone',
    'aduClearances',
    'mapReturn',
  ].some((key) => searchParams.get(key) !== null);
}

function ChatWithContext() {
  const sp = useSearchParams();

  const projectId = sp.get('projectId') ?? undefined;
  const entryMode = sp.get('mapReturn') === '1' ? 'map-return' : 'default';

  const propertyContext: PropertyContext | undefined = sp.get('fromMap')
    ? {
        fromMap: true,
        address: sp.get('address') ?? undefined,
        county: sp.get('county') ?? undefined,
        lat: sp.get('lat') ? Number(sp.get('lat')) : undefined,
        lng: sp.get('lng') ? Number(sp.get('lng')) : undefined,
        aduType: parseAduType(sp.get('aduType')),
        aduSize: sp.get('aduSize') ? Number(sp.get('aduSize')) : undefined,
        aduWidthFt: sp.get('aduWidthFt') ? Number(sp.get('aduWidthFt')) : undefined,
        aduLengthFt: sp.get('aduLengthFt') ? Number(sp.get('aduLengthFt')) : undefined,
        aduShape: sp.get('aduShape') ?? undefined,
        setback: sp.get('setback') ? Number(sp.get('setback')) : undefined,
        propertyArea: sp.get('propertyArea') ? Number(sp.get('propertyArea')) : undefined,
        homeSqft: sp.get('homeSqft') ? Number(sp.get('homeSqft')) : undefined,
        buildableArea: sp.get('buildableArea') ? Number(sp.get('buildableArea')) : undefined,
        maxAduSqft: sp.get('maxAduSqft') ? Number(sp.get('maxAduSqft')) : undefined,
        apn: sp.get('apn') ?? undefined,
        fireHazardSeverity: sp.get('fireHazardSeverity') ?? undefined,
        fireHazardZoneType: sp.get('fireHazardZoneType') ?? undefined,
        currentYardZone: sp.get('currentYardZone') ?? undefined,
        aduClearances: parseAduClearances(sp.get('aduClearances')),
      }
    : undefined;
  const routeContext: PlanningSessionRouteContext = {
    routeKind: 'chat',
    projectId,
    hasSessionLikeParams: hasChatSessionLikeParams(sp),
    address: propertyContext?.address,
    lat: propertyContext?.lat,
    lng: propertyContext?.lng,
    aduType: propertyContext?.aduType,
    aduSize: propertyContext?.aduSize,
    aduShape: propertyContext?.aduShape,
    county: propertyContext?.county,
    apn: propertyContext?.apn,
  };

  return (
    <PlanningSessionEntryGate routeContext={routeContext}>
      <RAGChat propertyContext={propertyContext} projectId={projectId} entryMode={entryMode} />
    </PlanningSessionEntryGate>
  );
}

export default function ADUChatPage() {
  return (
    <main className="relative h-dvh overflow-hidden bg-background flex flex-col">
      <Header />
      {/* <AnimatedBackground /> */}
      <div className="relative flex-1 overflow-hidden">
        <Suspense>
          <ChatWithContext />
        </Suspense>
      </div>
    </main>
  );
}
