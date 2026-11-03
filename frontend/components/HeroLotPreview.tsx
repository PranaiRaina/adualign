'use client';

/**
 * HeroLotPreview — public, pre-auth "Check My Lot" map. The visitor types a
 * California address (Mapbox SearchBox geocoder, no parcel/ReportAll lookup),
 * the satellite map flies to the house, then we prompt sign-in. On success we
 * hand the selected location off to the full /map planning flow.
 */

import { useCallback, useRef, useState } from 'react';
import Map, { Marker } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import AddressSearch from '@/components/map/AddressSearch';
import { MAPBOX_TOKEN, IRVINE_CENTER } from '@/components/map/constants';
import { AuthModal } from '@/components/auth/AuthModal';
import { useAuth } from '@/lib/hooks/useAuth';

// Opening shot for the hero card only: the Turtle Rock neighborhood around
// 9 Olympus, Irvine — tree-lined lots that read as "California backyard" instead
// of a state-wide satellite view. The fullScreen /map variant keeps the classic
// state-wide start.
const HERO_START = { longitude: -117.8117, latitude: 33.6396, zoom: 16.8 };
// Slow drone-hover pan (~185m east over 50s). A drag or a search flyTo cancels it —
// mapbox stops the current camera animation on user input or a new one.
const HERO_DRIFT_TARGET: [number, number] = [HERO_START.longitude + 0.002, HERO_START.latitude];
const HERO_DRIFT_DURATION_MS = 50_000;

const HERO_AUTH_HIGHLIGHTS = [
  'Analyze your parcel boundary and buildable zone',
  'Place an ADU on the map interactively',
  'Save your project and reopen it later',
];

export default function HeroLotPreview({ fullScreen = false }: { fullScreen?: boolean }) {
  const { isLoggedIn } = useAuth();
  const mapRef = useRef<MapRef | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [marker, setMarker] = useState<{ lng: number; lat: number; name: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState('');

  const startDrift = useCallback(() => {
    if (fullScreen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    mapRef.current?.getMap().easeTo({
      center: HERO_DRIFT_TARGET,
      duration: HERO_DRIFT_DURATION_MS,
      easing: (t) => t,
    });
  }, [fullScreen]);

  const handleResult = useCallback(
    (lng: number, lat: number, placeName: string) => {
      setError('');
      // No hero fly-to: /map does its own fly-to and analysis (see spec
      // 2026-07-05-hero-map-logged-in-bypass-design.md).
      if (isLoggedIn) {
        window.location.assign(
          `/map?${new URLSearchParams({
            lat: String(lat),
            lng: String(lng),
            address: placeName,
            name: placeName,
          }).toString()}`,
        );
        return;
      }
      // Logged out (or auth still loading): marker feeds mapHref, the sign-in
      // handoff URL used by the modal below.
      setMarker({ lng, lat, name: placeName });
      setAuthOpen(true);
    },
    [isLoggedIn],
  );

  // The /map URL that carries the searched house through sign-in. Used both for
  // the email/password handoff and the OAuth redirect (Google).
  const mapHref = marker
    ? `/map?${new URLSearchParams({
        lat: String(marker.lat),
        lng: String(marker.lng),
        address: marker.name,
        name: marker.name,
      }).toString()}`
    : '/map';

  // Full-document load, not router.push: on sign-in `isLoggedIn` flips and
  // AuthenticatedMapRouteGate swaps HeroLotPreview -> MapInterface at the same
  // instant. A soft same-route push races that swap and the searched location is
  // lost (map resets, no analysis). A full load mounts /map fresh with the params,
  // matching the OAuth path that already works.
  // ponytail: full reload is the robust fix; switch to a draft/sessionStorage handoff only if the reload flash matters.
  const continueToMap = useCallback(() => {
    window.location.assign(mapHref);
  }, [mapHref]);

  // The interactive map area (positioning context for the search box + marker).
  const stage = (
    <div className="relative h-full w-full">
      <div
        className={
          fullScreen
            ? 'absolute inset-0 overflow-hidden'
            : 'absolute inset-0 rounded-2xl overflow-hidden shadow-xl ring-1 ring-black/5'
        }
      >
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={
            fullScreen
              ? { ...IRVINE_CENTER, zoom: 9, pitch: 0, bearing: 0 }
              : { ...HERO_START, pitch: 0, bearing: 0 }
          }
          onLoad={startDrift}
          mapStyle="mapbox://styles/mapbox/satellite-v9"
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
        >
          {marker && (
            <Marker longitude={marker.lng} latitude={marker.lat} anchor="bottom">
              {/* Same pin the logged-in map drops (MapLayers.tsx) for continuity. */}
              <div className="relative flex flex-col items-center group cursor-pointer animate-in slide-in-from-top-4 fade-in duration-300">
                <div className="w-8 h-8 bg-emerald-500 rounded-full border-[3px] border-white shadow-lg flex items-center justify-center z-10 transition-transform group-hover:scale-110">
                  <div className="w-2.5 h-2.5 bg-white rounded-full opacity-90" />
                </div>
                <div className="w-px h-4 bg-emerald-600 shadow-sm z-0 -mt-1" />
                <div className="w-3 h-1 bg-black/20 rounded-[100%] blur-[1px] -mt-0.5" />
              </div>
            </Marker>
          )}

          {/* Caption overlay — hero card only. */}
          {!fullScreen && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-6 pb-6 pt-20">
              <p className="text-white text-xl font-semibold tracking-tight">
                See your lot from above
              </p>
              <p className="text-white/80 text-sm mt-1 max-w-sm leading-relaxed">
                Enter your address to find your home and check ADU eligibility in seconds.
              </p>
            </div>
          )}
        </Map>
      </div>

      <AddressSearch
        accessToken={MAPBOX_TOKEN}
        value={searchValue}
        onValueChange={setSearchValue}
        onResult={handleResult}
        onInvalidResult={setError}
      />

      {error && (
        <div className="absolute top-16 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow">
          {error}
        </div>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div id="check-lot" className="relative h-full w-full">
        {stage}
        <AuthModal
          isOpen={authOpen}
          onClose={() => setAuthOpen(false)}
          onSuccess={continueToMap}
          oauthNext={mapHref}
          defaultTab="signin"
          variant="planning"
          title="Sign in to see your full report"
          highlights={HERO_AUTH_HIGHLIGHTS}
        />
      </div>
    );
  }

  return (
    <div id="check-lot" className="w-full max-w-xl">
      <div className="relative h-[600px] w-full">{stage}</div>
      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={continueToMap}
        oauthNext={mapHref}
        defaultTab="signin"
        variant="planning"
        title="Sign in to see your full report"
        highlights={HERO_AUTH_HIGHLIGHTS}
      />
    </div>
  );
}
