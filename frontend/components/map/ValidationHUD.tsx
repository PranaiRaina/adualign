'use client';

/**
 * ValidationHUD — Heads-up display overlay showing the analysis workflow
 * and results panel with interactive secondary structure toggles.
 */

import type { AnalyzeResponse } from '@/types';
import type { ReactNode } from 'react';
import { useEffect, useState, useRef } from 'react';
import { ChevronDown, ChevronUp, Check, MapPin } from 'lucide-react';
import { HUD_LOADING_INTERVAL_MS } from './constants';
import { formatWholeNumber } from '@/lib/utils/formatting';

const LOADING_STAGES = [
  'Resolving property boundaries...',
  'Identifying primary structures...',
  'Detecting secondary structures...',
  'Applying setback requirements...',
  'Computing buildable geometry...',
  'Finalizing feasibility model...',
];

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface ValidationHUDProps {
  selectedLocation: { lat: number; lng: number; name: string } | null;
  isLoading: boolean;
  isAnalysisQueuedOrResolving: boolean;
  result: AnalyzeResponse | null;
  error: string | null;
  onAnalyze: () => void;
  onStartNewProject: () => void;
  disabledBuildings: Set<number>;
  hoveredBuildingIndex: number;
  onToggleBuilding: (index: number) => void;
  onHoverBuilding: (index: number) => void;
  visibleSecondaryBuildingIndices?: number[];
  showWallLengths?: boolean;
  onToggleWallLengths?: () => void;
  uiVisible?: boolean;
  isDraggingAdu?: boolean;
  /** Shown in the card header (e.g. project workflow badge). */
  projectStatusBadge?: ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function ValidationHUD({
  selectedLocation,
  isLoading,
  isAnalysisQueuedOrResolving,
  result,
  error,
  onAnalyze,
  onStartNewProject,
  disabledBuildings,
  hoveredBuildingIndex,
  onToggleBuilding,
  onHoverBuilding,
  visibleSecondaryBuildingIndices,
  showWallLengths = false,
  onToggleWallLengths,
  uiVisible = true,
  isDraggingAdu = false,
  projectStatusBadge,
}: ValidationHUDProps) {
  const [isEngineExpanded, setIsEngineExpanded] = useState(true);
  const [isStructuresExpanded, setIsStructuresExpanded] = useState(false);
  const [showAllSecondaryStructures, setShowAllSecondaryStructures] = useState(false);
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);
  const prevIsLoading = useRef(isLoading);
  const isAnalysisInProgress = isLoading || isAnalysisQueuedOrResolving;
  const hasAnalyzedProperty = Boolean(result);

  useEffect(() => {
    if (!isAnalysisInProgress) {
      setLoadingStageIndex(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setLoadingStageIndex((prev) => (prev + 1) % LOADING_STAGES.length);
    }, HUD_LOADING_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isAnalysisInProgress]);

  useEffect(() => {
    // Only auto-collapse the engine immediately after a loading cycle finishes
    if (prevIsLoading.current && !isLoading && (result || error)) {
      setIsEngineExpanded(false);
      setIsStructuresExpanded(true);
    }
    prevIsLoading.current = isLoading;
  }, [isLoading, result, error]);

  const handleAnalyzeClick = () => {
    onAnalyze();
  };

  const handleStartNewProjectClick = () => {
    onStartNewProject();
  };

  useEffect(() => {
    if (!selectedLocation || result || isLoading) return;
    // New property selected: reset HUD to the initial expanded engine state.
    setIsEngineExpanded(true);
    setIsStructuresExpanded(false);
    setShowAllSecondaryStructures(false);
  }, [selectedLocation, result, isLoading]);

  return (
    <>
      {/* ---- Step Indicator Panel ---- */}
      <div
        className={`
        absolute top-2 left-2 z-50 w-72 shadow-[0_4px_16px_rgba(0,0,0,0.10),0_1px_4px_rgba(0,0,0,0.06)] bg-surface-0 flex flex-col rounded-xl
        transition-all duration-300 ease-in-out
        ${
          !uiVisible
            ? 'opacity-0 pointer-events-none -translate-x-4 scale-95'
            : isDraggingAdu
              ? 'opacity-[0.65] pointer-events-none'
              : 'opacity-100 pointer-events-auto'
        }
      `}
      >
        {/* Header Section */}
        <div className="pt-3 px-3 mb-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-[17px] font-semibold tracking-tight text-surface-900 leading-tight min-w-0 flex-1">
              ADU Feasibility
            </h2>
            {projectStatusBadge ? (
              <div className="shrink-0 max-w-[58%] flex justify-end items-start pt-0.5">
                {projectStatusBadge}
              </div>
            ) : null}
          </div>
          {!result && (
            <button
              onClick={() => setIsEngineExpanded(!isEngineExpanded)}
              className="mt-1 pl-1 w-full flex items-center justify-between group cursor-pointer"
            >
              <p className="text-xs text-surface-500 group-hover:text-surface-700 transition-colors">
                Property qualification engine
              </p>
              {isEngineExpanded ? (
                <ChevronUp className="w-4 h-4 text-surface-400 group-hover:text-surface-600 transition-colors" />
              ) : (
                <ChevronDown className="w-4 h-4 text-surface-400 group-hover:text-surface-600 transition-colors" />
              )}
            </button>
          )}
        </div>

        {/* Steps Section */}
        {!result && (
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isEngineExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          >
            <div className="overflow-hidden min-h-0">
              <div className="px-4 space-y-1.5">
                <StepRow
                  number={1}
                  label="Location Search"
                  description="Identify target parcel"
                  isActive={!selectedLocation}
                  isComplete={!!selectedLocation}
                />

                <StepRow
                  number={2}
                  label="Parcel Generation"
                  description="Compute buildable geometry"
                  isActive={!!selectedLocation && isAnalysisInProgress}
                  isComplete={!!result}
                />
              </div>
            </div>
          </div>
        )}

        {/* Unified Footer Section */}
        <div
          className={`mt-auto flex flex-col w-full bg-surface-50/50 rounded-b-xl ${result ? 'mt-0' : 'mt-4'}`}
        >
          {!result && !isLoading && !isAnalysisQueuedOrResolving && selectedLocation && (
            <div className="flex flex-col w-full">
              <div className="px-3 pt-3 pb-2 border-t border-surface-100">
                <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-0 border border-surface-200 shadow-sm rounded-xl">
                  <MapPin className="w-4 h-4 text-surface-400 shrink-0" />
                  <span className="text-sm font-medium text-surface-700 truncate flex-1 leading-tight">
                    {selectedLocation.name}
                  </span>
                </div>
              </div>
              <div className="px-3 pb-3 pt-1">
                <button
                  onClick={handleAnalyzeClick}
                  disabled={!selectedLocation}
                  className="w-full h-9 flex items-center justify-center gap-2 px-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-[13px] font-semibold transition-all shadow-sm active:scale-[0.98] cursor-pointer"
                >
                  Check property
                </button>
              </div>
            </div>
          )}

          {!selectedLocation && !result && !error && (
            <div className="text-center py-6 border-t border-surface-100 rounded-b-xl">
              <p className="text-sm text-surface-500">Search an address to begin</p>
            </div>
          )}

          {error && (
            <div className="px-3 py-3 border-t border-surface-100 bg-rose-50 rounded-b-xl">
              <p className="text-sm text-rose-700 font-medium leading-tight">{error}</p>
            </div>
          )}

          {/* Building Measurements Panel */}
          {result && result.primary_structure_sqft && (
            <div className="px-3 pt-0 pb-3">
              <button
                onClick={() => setIsStructuresExpanded(!isStructuresExpanded)}
                className="w-full flex items-center justify-between mb-0.5 group cursor-pointer"
              >
                <p className="text-[11px] font-medium text-surface-500 group-hover:text-surface-700 transition-colors">
                  Detected structures
                </p>
                {isStructuresExpanded ? (
                  <ChevronUp className="w-4 h-4 text-surface-400 group-hover:text-surface-600 transition-colors" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-surface-400 group-hover:text-surface-600 transition-colors" />
                )}
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                  isStructuresExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden min-h-0">
                  <div className="space-y-0.5 pt-0 pb-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-surface-700">Living area</span>
                      <span className="text-sm font-semibold text-surface-800 tabular-nums">
                        {result.home_sqft
                          ? `${formatWholeNumber(Math.round(result.home_sqft))} ft²`
                          : 'Not in county records'}
                      </span>
                    </div>
                    {result.detected_buildings && result.detected_buildings.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-surface-500">Wall lengths</span>
                        <button
                          type="button"
                          onClick={onToggleWallLengths}
                          className="text-xs font-semibold text-surface-600 hover:text-surface-800 transition-colors cursor-pointer"
                        >
                          {showWallLengths ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    )}
                    {result.secondary_structures_sqft &&
                      result.secondary_structures_sqft.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-surface-100">
                          {(() => {
                            const secondaryIndices =
                              visibleSecondaryBuildingIndices ??
                              result.secondary_structures_sqft.map((_, i) => i + 1);
                            if (!secondaryIndices.length) return null;
                            const hasMoreSecondary = secondaryIndices.length > 3;
                            const displayedSecondaryIndices = showAllSecondaryStructures
                              ? secondaryIndices
                              : secondaryIndices.slice(0, 3);
                            const hiddenSecondaryCount =
                              secondaryIndices.length - displayedSecondaryIndices.length;
                            return (
                              <>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs text-surface-500">
                                    {secondaryIndices.length} secondary structure
                                    {secondaryIndices.length > 1 ? 's' : ''}
                                  </span>
                                  <span className="text-[11px] text-surface-400">
                                    Click to exclude
                                  </span>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  {displayedSecondaryIndices.map((buildingIndex) => {
                                    const sqft =
                                      result.secondary_structures_sqft?.[buildingIndex - 1] ?? 0;
                                    const isDisabled = disabledBuildings.has(buildingIndex);
                                    const isHovered = hoveredBuildingIndex === buildingIndex;
                                    return (
                                      <button
                                        key={buildingIndex}
                                        type="button"
                                        aria-label={`Structure ${buildingIndex}, ${isDisabled ? 'excluded' : 'active'}. Click to toggle.`}
                                        onClick={() => onToggleBuilding(buildingIndex)}
                                        onMouseEnter={() => onHoverBuilding(buildingIndex)}
                                        onMouseLeave={() => onHoverBuilding(-1)}
                                        className={`
                                        flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium
                                        transition-all duration-150 cursor-pointer border
                                        ${
                                          isDisabled
                                            ? 'bg-surface-50 text-surface-400 border-surface-200 line-through'
                                            : isHovered
                                              ? 'bg-red-100 text-red-700 border-red-200'
                                              : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                        }
                                        ${isHovered ? 'ring-2 ring-inset ring-amber-400 shadow-sm' : ''}
                                      `}
                                      >
                                        <span className="flex items-center gap-2">
                                          <span
                                            className={`
                                            shrink-0 w-3 h-3 rounded-[2px] border flex items-center justify-center
                                            ${
                                              isDisabled
                                                ? 'border-surface-300 bg-surface-0'
                                                : 'border-red-300 bg-white'
                                            }
                                          `}
                                            aria-hidden
                                          >
                                            {!isDisabled && (
                                              <Check
                                                className="w-[11px] h-[11px] text-red-700 shrink-0"
                                                strokeWidth={3.25}
                                              />
                                            )}
                                          </span>
                                          Structure {buildingIndex}
                                        </span>
                                        <span className="tabular-nums">
                                          {formatWholeNumber(sqft)} ft²
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                                {hasMoreSecondary && (
                                  <button
                                    onClick={() => setShowAllSecondaryStructures((prev) => !prev)}
                                    className="mt-1 text-[10px] text-surface-400 hover:text-surface-500 transition-colors"
                                  >
                                    {showAllSecondaryStructures
                                      ? 'Show less'
                                      : `Show ${hiddenSecondaryCount} more`}
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {hasAnalyzedProperty && (
            <div className="mt-auto pt-0 relative">
              <div className="px-3 pb-2">
                <button
                  onClick={handleStartNewProjectClick}
                  className="w-full h-9 flex items-center justify-center gap-2 px-3 border border-surface-200 bg-surface-0 text-surface-700 hover:bg-surface-100 rounded-lg text-[13px] font-medium transition-all active:scale-[0.98] cursor-pointer"
                >
                  Start new project
                </button>
              </div>
            </div>
          )}

          {/* Loading indicator with scanning animation */}
          {isAnalysisInProgress && (
            <div className="py-5 px-3 border-t border-surface-100 rounded-b-xl">
              <p className="text-sm font-medium text-brand-600 animate-pulse text-center">
                {LOADING_STAGES[loadingStageIndex]}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function StepRow({
  number,
  label,
  description,
  isActive,
  isComplete,
}: {
  number: number;
  label: string;
  description: string;
  isActive: boolean;
  isComplete: boolean;
}) {
  return (
    <div
      className={`relative flex items-center gap-2 p-1 rounded-xl transition-all border ${isActive ? 'bg-surface-0 border-surface-200 shadow-sm' : 'bg-transparent border-transparent opacity-70'}`}
    >
      <div
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
          ${
            isComplete
              ? 'bg-brand-100 text-brand-600 animate-checkmark'
              : isActive
                ? 'bg-surface-800 text-white shadow-md shadow-surface-900/10'
                : 'bg-surface-100 text-surface-500'
          }`}
      >
        {isComplete ? (
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          number
        )}
      </div>
      <div className="min-w-0">
        <p
          className={`text-[13px] font-semibold tracking-tight transition-colors ${
            isComplete || isActive ? 'text-surface-800' : 'text-surface-500'
          }`}
        >
          {label}
        </p>
        <p className="text-xs text-surface-500 mt-0.5 leading-snug truncate">{description}</p>
      </div>

      {isActive && !isComplete && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 bg-brand-600 rounded-full animate-pulse shadow-sm shadow-brand-600/50" />
      )}
    </div>
  );
}
