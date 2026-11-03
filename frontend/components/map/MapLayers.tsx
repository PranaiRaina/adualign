import { Source, Layer, NavigationControl, Marker } from 'react-map-gl/mapbox';
import { Eye, EyeOff, Flag } from 'lucide-react';
import type { AnalyzeResponse } from '@/types';
import MapLegend from './MapLegend';
import {
  PROPERTY_LINE_DASH_ARRAY,
  YARD_DIVIDER_DASH_ARRAY,
  YARD_LABEL_OPACITY_TRANSITION_MS,
  WALL_LABEL_OPACITY_TRANSITION_MS,
} from './constants';

interface MapLayersProps {
  selectedLocation: { lat: number; lng: number; name: string } | null;
  result: AnalyzeResponse | null;
  propertySourceData: GeoJSON.FeatureCollection | null;
  activeUnbuildableSourceData: GeoJSON.FeatureCollection | null;
  activeBuildableSourceData: GeoJSON.FeatureCollection | null;
  activeBuildingExclusionsData: GeoJSON.FeatureCollection;
  disabledBuildingExclusionsData: GeoJSON.FeatureCollection;
  hoveredBuildingData: GeoJSON.FeatureCollection | null;
  clearanceGuideSourceData: GeoJSON.FeatureCollection | null;
  wallLengthLabelData: GeoJSON.FeatureCollection | null;
  showWallLengths: boolean;
  internalYardLines: GeoJSON.FeatureCollection | null;
  aduPolygon: GeoJSON.Polygon | null;
  edgeSelectMode: boolean;
  propertyEdges: number[][][];
  yardLabelPositions: { name: string; lng: number; lat: number }[] | null;
  showYardLabels: boolean;
  aduType: 'detached' | 'attached';
  isAduValid: boolean;
  isAduInteracting: boolean;
  isDraggingAdu: boolean;
  disabledBuildings: Set<number>;
  uiVisible: boolean;
  onSetUiVisible: (v: boolean) => void;
  onReselectFrontYard: () => void;
}

export default function MapLayers({
  selectedLocation,
  result,
  propertySourceData,
  activeUnbuildableSourceData,
  activeBuildableSourceData,
  activeBuildingExclusionsData,
  disabledBuildingExclusionsData,
  hoveredBuildingData,
  clearanceGuideSourceData,
  wallLengthLabelData,
  showWallLengths,
  internalYardLines,
  aduPolygon,
  edgeSelectMode,
  propertyEdges,
  yardLabelPositions,
  showYardLabels,
  aduType,
  isAduValid,
  isAduInteracting,
  isDraggingAdu,
  disabledBuildings,
  uiVisible,
  onSetUiVisible,
  onReselectFrontYard,
}: MapLayersProps) {
  const clearanceGuidePalette = getClearanceGuidePalette({ aduType, isAduInteracting });

  return (
    <>
      {/* Visual Click Pin */}
      {selectedLocation && !result && (
        <Marker longitude={selectedLocation.lng} latitude={selectedLocation.lat} anchor="bottom">
          <div className="relative flex flex-col items-center group cursor-pointer animate-in slide-in-from-top-4 fade-in duration-300">
            <div className="w-8 h-8 bg-emerald-500 rounded-full border-[3px] border-white shadow-lg flex items-center justify-center z-10 transition-transform group-hover:scale-110">
              <div className="w-2.5 h-2.5 bg-white rounded-full opacity-90" />
            </div>
            <div className="w-px h-4 bg-emerald-600 shadow-sm z-0 -mt-1" />
            <div className="w-3 h-1 bg-black/20 rounded-[100%] blur-[1px] -mt-0.5" />
          </div>
        </Marker>
      )}

      <Source id="mapbox-buildings" type="vector" url="mapbox://mapbox.mapbox-streets-v8">
        <Layer
          id="building"
          type="fill"
          source-layer="building"
          paint={{
            'fill-opacity': 0,
          }}
        />
      </Source>

      <NavigationControl position="bottom-right" />
      <div
        className={`absolute bottom-2 right-12 z-50 flex flex-col gap-2 ${isDraggingAdu ? 'pointer-events-none' : ''}`}
      >
        <button
          onClick={() => onSetUiVisible(!uiVisible)}
          className="p-2 bg-white hover:bg-slate-50 text-slate-600 rounded-lg shadow-md ring-1 ring-slate-900/5 transition-all active:scale-95"
          title={uiVisible ? 'Hide UI (Tab)' : 'Show UI (Tab)'}
        >
          {uiVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        {result && !edgeSelectMode && (
          <button
            onClick={onReselectFrontYard}
            className="p-2 bg-white hover:bg-slate-50 text-slate-600 rounded-lg shadow-md ring-1 ring-slate-900/5 transition-all active:scale-95"
            title="Reselect front yard"
          >
            <Flag className="w-4 h-4" />
          </button>
        )}
      </div>

      {activeUnbuildableSourceData && (
        <Source id="property-boundary" type="geojson" data={activeUnbuildableSourceData}>
          <Layer
            id="property-fill"
            type="fill"
            paint={{
              'fill-color': '#2563EB',
              'fill-opacity': 0.23,
            }}
          />
        </Source>
      )}

      {propertySourceData && (
        <Source id="property-outline-src" type="geojson" data={propertySourceData}>
          <Layer
            id="property-outline"
            type="line"
            paint={{
              'line-color': '#2563EB',
              'line-width': 2.5,
              'line-dasharray': PROPERTY_LINE_DASH_ARRAY,
              'line-opacity': 0.9,
            }}
          />
        </Source>
      )}

      {activeBuildableSourceData && (
        <Source id="buildable-zone" type="geojson" data={activeBuildableSourceData}>
          <Layer
            id="buildable-fill"
            type="fill"
            paint={{
              'fill-color': '#10b981',
              'fill-opacity': 0.12,
            }}
          />
          <Layer
            id="buildable-outline"
            type="line"
            paint={{
              'line-color': '#10b981',
              'line-width': 2,
              'line-opacity': 0.6,
            }}
          />
        </Source>
      )}

      {internalYardLines && internalYardLines.features.length > 0 && (
        <Source id="internal-yard-lines" type="geojson" data={internalYardLines}>
          <Layer
            id="internal-yard-lines-layer"
            type="line"
            paint={{
              'line-color': '#FBBF24',
              'line-width': 2.5,
              'line-dasharray': YARD_DIVIDER_DASH_ARRAY,
              'line-opacity': 0.73,
            }}
          />
        </Source>
      )}

      {edgeSelectMode && propertyEdges.length > 0 && (
        <Source
          id="selectable-edges"
          type="geojson"
          data={{
            type: 'FeatureCollection',
            features: propertyEdges.map((edge, i) => ({
              type: 'Feature' as const,
              properties: { index: i },
              geometry: {
                type: 'LineString' as const,
                coordinates: edge,
              },
            })),
          }}
        >
          <Layer
            id="selectable-edges-line"
            type="line"
            paint={{
              'line-color': '#60a5fa',
              'line-width': 5,
              'line-opacity': 0.7,
            }}
          />
        </Source>
      )}

      {result?.detected_buildings && result.detected_buildings.length > 0 && (
        <>
          <Source
            id="building-exclusions-active"
            type="geojson"
            data={activeBuildingExclusionsData}
          >
            <Layer
              id="building-exclusion-fill"
              type="fill"
              paint={{
                'fill-color': '#EF4444',
                'fill-opacity': 0.25,
              }}
            />
            <Layer
              id="building-exclusion-outline"
              type="line"
              paint={{
                'line-color': '#DC2626',
                'line-width': 2,
                'line-opacity': 0.8,
              }}
            />
          </Source>

          {disabledBuildings.size > 0 && (
            <Source
              id="building-exclusions-disabled"
              type="geojson"
              data={disabledBuildingExclusionsData}
            >
              <Layer
                id="building-disabled-fill"
                type="fill"
                paint={{
                  'fill-color': '#9CA3AF',
                  'fill-opacity': 0.08,
                }}
              />
              <Layer
                id="building-disabled-outline"
                type="line"
                paint={{
                  'line-color': '#9CA3AF',
                  'line-width': 2,
                  'line-dasharray': [4, 3],
                  'line-opacity': 0.6,
                }}
              />
            </Source>
          )}
        </>
      )}

      {hoveredBuildingData && (
        <Source id="building-highlight" type="geojson" data={hoveredBuildingData}>
          <Layer
            id="building-highlight-outline"
            type="line"
            paint={{
              'line-color': '#FBBF24',
              'line-width': 3.5,
              'line-opacity': 1,
            }}
          />
          <Layer
            id="building-highlight-fill"
            type="fill"
            paint={{
              'fill-color': '#FBBF24',
              'fill-opacity': 0.15,
            }}
          />
        </Source>
      )}

      {yardLabelPositions &&
        yardLabelPositions.length > 0 &&
        yardLabelPositions.map((pos, i) => (
          <Marker key={`yard-label-${i}`} longitude={pos.lng} latitude={pos.lat} anchor="center">
            <div
              className={`
                px-2 py-1 rounded backdrop-blur-md bg-white/80 border border-white/40 shadow-sm
                text-[10px] font-bold uppercase tracking-wider text-emerald-700 pointer-events-none
                transition-opacity ease-in-out
                ${showYardLabels ? 'opacity-100' : 'opacity-0'}
              `}
              style={{ transitionDuration: `${YARD_LABEL_OPACITY_TRANSITION_MS}ms` }}
            >
              {pos.name}
            </div>
          </Marker>
        ))}

      {clearanceGuideSourceData && (
        <Source id="adu-clearance-guides" type="geojson" data={clearanceGuideSourceData}>
          <Layer
            id="adu-clearance-guide-halo"
            type="line"
            filter={['==', '$type', 'LineString']}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
            paint={{
              'line-color': clearanceGuidePalette.glow,
              'line-width': 3.5,
              'line-opacity': 0.16,
              'line-blur': 0.7,
            }}
          />
          <Layer
            id="adu-clearance-guide-lines"
            type="line"
            filter={['==', '$type', 'LineString']}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
            paint={{
              'line-color': clearanceGuidePalette.base,
              'line-width': 2,
              'line-dasharray': [1.4, 2.4],
              'line-opacity': 0.9,
            }}
          />
          <Layer
            id="adu-clearance-guide-labels"
            type="symbol"
            filter={['==', '$type', 'Point']}
            layout={{
              'text-field': ['get', 'label'],
              'text-size': 13,
              'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{
              'text-color': clearanceGuidePalette.label,
              'text-halo-color': clearanceGuidePalette.labelHalo,
              'text-halo-width': 1.8,
              'text-halo-blur': 0,
            }}
          />
        </Source>
      )}

      {wallLengthLabelData && wallLengthLabelData.features.length > 0 && (
        // Layer stays mounted while there are walls; text-opacity toggles with a
        // quick transition so it fades both in (on show) and out (on hide).
        <Source id="primary-wall-lengths" type="geojson" data={wallLengthLabelData}>
          <Layer
            id="primary-wall-length-labels"
            type="symbol"
            layout={{
              'text-field': ['get', 'label'],
              'text-size': 13,
              'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
              'text-allow-overlap': false,
              'text-ignore-placement': false,
            }}
            paint={{
              'text-color': '#FFFFFF',
              'text-halo-color': 'rgba(30, 41, 59, 0.9)',
              'text-halo-width': 1.8,
              'text-halo-blur': 0,
              'text-opacity': showWallLengths ? 1 : 0,
              'text-opacity-transition': { duration: WALL_LABEL_OPACITY_TRANSITION_MS },
            }}
          />
        </Source>
      )}

      {aduPolygon && (
        <Source
          id="adu-polygon"
          type="geojson"
          data={{
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: aduPolygon,
              },
            ],
          }}
        >
          <Layer
            id="adu-fill"
            type="fill"
            paint={{
              'fill-color':
                aduType === 'attached' && isAduInteracting
                  ? '#F43F5E'
                  : isAduValid
                    ? '#10b981'
                    : '#F43F5E',
              'fill-opacity': 0.7,
            }}
          />
          <Layer
            id="adu-outline"
            type="line"
            paint={{
              'line-color':
                aduType === 'attached' && isAduInteracting
                  ? '#FB7185'
                  : isAduValid
                    ? '#059669'
                    : '#FB7185',
              'line-width': 2,
            }}
          />
        </Source>
      )}

      <MapLegend visible={uiVisible && !!result} isDraggingAdu={isDraggingAdu} />
    </>
  );
}

function getClearanceGuidePalette({
  aduType,
  isAduInteracting,
}: {
  aduType: 'detached' | 'attached';
  isAduInteracting: boolean;
}) {
  // White text over a dark tinted halo reads on any satellite imagery;
  // setback state (ok vs attached-drag) lives in the halo tint.
  if (aduType === 'attached' && isAduInteracting) {
    return {
      base: '#FFFFFF',
      glow: '#FFFFFF',
      label: '#FFFFFF',
      labelHalo: 'rgba(136, 19, 55, 0.9)',
    };
  }

  return {
    base: '#FFFFFF',
    glow: '#FFFFFF',
    label: '#FFFFFF',
    labelHalo: 'rgba(6, 78, 59, 0.9)',
  };
}
