import { Suspense } from 'react';
import { AuthenticatedMapRouteGate } from '@/components/AuthenticatedMapRouteGate';
import { Header } from '@/components/layout/Header';
import { MapInterfaceClient } from '@/components/map/MapInterfaceClient';
import { PlanningSessionEntryGate } from '@/components/PlanningSessionEntryGate';
import type { AduClearance, AduType, PropertyContext } from '@/types';
import type { MapLaunchContext } from '@/components/map/types';
import type { PlanningSessionRouteContext } from '@/lib/planningSessionEntry';

type MapSearchParams = {
  lat?: string;
  lng?: string;
  name?: string;
  address?: string;
  fromChat?: string;
  projectId?: string;
  mapSearchId?: string;
  county?: string;
  aduType?: string;
  aduSize?: string;
  aduWidthFt?: string;
  aduLengthFt?: string;
  aduShape?: string;
  setback?: string;
  propertyArea?: string;
  buildableArea?: string;
  maxAduSqft?: string;
  apn?: string;
  fireHazardSeverity?: string;
  fireHazardZoneType?: string;
  currentYardZone?: string;
  aduClearances?: string;
};

function parseOptionalNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function parseAduType(value?: string): AduType | undefined {
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

function parseAduClearances(value?: string): AduClearance[] | undefined {
  if (!value) return undefined;

  try {
    const parsedValue = JSON.parse(value);
    return Array.isArray(parsedValue) ? (parsedValue as AduClearance[]) : undefined;
  } catch {
    return undefined;
  }
}

function hasMapSessionLikeParams(searchParams: MapSearchParams) {
  return [
    searchParams.lat,
    searchParams.lng,
    searchParams.name,
    searchParams.address,
    searchParams.fromChat,
    searchParams.county,
    searchParams.aduType,
    searchParams.aduSize,
    searchParams.aduWidthFt,
    searchParams.aduLengthFt,
    searchParams.aduShape,
    searchParams.setback,
    searchParams.propertyArea,
    searchParams.buildableArea,
    searchParams.maxAduSqft,
    searchParams.apn,
    searchParams.fireHazardSeverity,
    searchParams.fireHazardZoneType,
    searchParams.currentYardZone,
    searchParams.aduClearances,
  ].some((value) => value !== undefined);
}

function buildMapLaunchContext(searchParams: MapSearchParams): MapLaunchContext {
  const lat = parseOptionalNumber(searchParams.lat);
  const lng = parseOptionalNumber(searchParams.lng);
  const initialLocation =
    lat !== undefined && lng !== undefined
      ? {
          lat,
          lng,
          name: searchParams.name || 'Selected Location',
        }
      : undefined;
  const isFromChat = searchParams.fromChat === '1';
  const initialPlanningContext: PropertyContext | undefined = isFromChat
    ? {
        address: searchParams.address ?? undefined,
        county: searchParams.county ?? undefined,
        lat,
        lng,
        aduType: parseAduType(searchParams.aduType),
        aduSize: parseOptionalNumber(searchParams.aduSize),
        aduWidthFt: parseOptionalNumber(searchParams.aduWidthFt),
        aduLengthFt: parseOptionalNumber(searchParams.aduLengthFt),
        aduShape: searchParams.aduShape ?? undefined,
        setback: parseOptionalNumber(searchParams.setback),
        propertyArea: parseOptionalNumber(searchParams.propertyArea),
        buildableArea: parseOptionalNumber(searchParams.buildableArea),
        maxAduSqft: parseOptionalNumber(searchParams.maxAduSqft),
        apn: searchParams.apn ?? undefined,
        fireHazardSeverity: searchParams.fireHazardSeverity ?? undefined,
        fireHazardZoneType: searchParams.fireHazardZoneType ?? undefined,
        currentYardZone: searchParams.currentYardZone ?? undefined,
        aduClearances: parseAduClearances(searchParams.aduClearances),
      }
    : undefined;

  return {
    initialLocation,
    initialAddress: searchParams.address,
    initialPlanningContext,
    isFromChat,
    projectId: searchParams.projectId,
    mapSearchId: searchParams.mapSearchId,
  };
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<MapSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const launchContext = buildMapLaunchContext(resolvedSearchParams);

  const mapSessionKey = [
    launchContext.isFromChat ? 'chat' : 'standalone',
    launchContext.projectId ?? '',
    launchContext.mapSearchId ?? '',
    launchContext.initialAddress ?? '',
    launchContext.initialLocation?.lat ?? '',
    launchContext.initialLocation?.lng ?? '',
    launchContext.initialLocation?.name ?? '',
    resolvedSearchParams.county ?? '',
    resolvedSearchParams.aduType ?? '',
    resolvedSearchParams.aduSize ?? '',
    resolvedSearchParams.aduWidthFt ?? '',
    resolvedSearchParams.aduLengthFt ?? '',
    resolvedSearchParams.aduShape ?? '',
    resolvedSearchParams.setback ?? '',
    resolvedSearchParams.propertyArea ?? '',
    resolvedSearchParams.buildableArea ?? '',
    resolvedSearchParams.maxAduSqft ?? '',
    resolvedSearchParams.apn ?? '',
    resolvedSearchParams.fireHazardSeverity ?? '',
    resolvedSearchParams.fireHazardZoneType ?? '',
    resolvedSearchParams.currentYardZone ?? '',
    resolvedSearchParams.aduClearances ?? '',
  ].join('|');
  const routeContext: PlanningSessionRouteContext = {
    routeKind: 'map',
    projectId: resolvedSearchParams.projectId,
    hasSessionLikeParams: hasMapSessionLikeParams(resolvedSearchParams),
    address: resolvedSearchParams.address ?? resolvedSearchParams.name,
    lat: parseOptionalNumber(resolvedSearchParams.lat),
    lng: parseOptionalNumber(resolvedSearchParams.lng),
    aduType: parseAduType(resolvedSearchParams.aduType),
    aduSize: parseOptionalNumber(resolvedSearchParams.aduSize),
    aduShape: resolvedSearchParams.aduShape,
    county: resolvedSearchParams.county,
    apn: resolvedSearchParams.apn,
  };

  return (
    <div className="h-dvh w-full flex flex-col font-sans overflow-hidden">
      <Header />
      <main className="flex-1 relative w-full h-full">
        <Suspense fallback={null}>
          <AuthenticatedMapRouteGate>
            <PlanningSessionEntryGate routeContext={routeContext}>
              <MapInterfaceClient key={mapSessionKey} launchContext={launchContext} />
            </PlanningSessionEntryGate>
          </AuthenticatedMapRouteGate>
        </Suspense>
      </main>
    </div>
  );
}
