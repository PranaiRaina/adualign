import { RotateCcw, ChevronDown } from 'lucide-react';

import { FLOOR_AREA_MIN, ORIENTATION_MAX, ORIENTATION_MIN } from './constants';
import type { ShapeType } from './types';

const SHAPE_OPTIONS: ShapeType[] = ['rectangle', 'l-shape', 't-shape', 'u-shape'];

// Zone is informational; amber only flags a front-yard placement, which is
// the one zone likely to fail setback rules.
function getZoneBadgeStyles(currentZone: string) {
  if (currentZone.includes('Front') && !currentZone.includes('/')) {
    return { text: 'text-amber-600', dot: 'bg-amber-500' };
  }
  return { text: 'text-surface-500', dot: 'bg-surface-400' };
}

interface AduControlPanelProps {
  panelState: {
    aduType: 'detached' | 'attached';
    aduSize: number;
    aduRotation: number;
    aduShapeType: ShapeType;
    isAduValid: boolean;
    invalidReasons: string[];
    isDraggingAdu: boolean;
    currentZone: string;
    autoEdgeAlign: boolean;
    autoPositionCorrection: boolean;
    showAdvancedSettings: boolean;
    uiVisible: boolean;
    displayAduSize: string;
    aduDimensions: string | null;
    aspectRatioSliderValue: number;
  };
  panelConstraints: {
    aduMaxArea: number;
  };
  panelActions: {
    selectAduType: (nextType: 'detached' | 'attached') => void;
    resetCurrentShape: () => void;
    selectShape: (shape: ShapeType) => void;
    updateSize: (nextSize: number) => void;
    updateAspectRatioFromSlider: (rawValue: number) => void;
    updateDetachedRotation: (rawValue: number) => void;
    rotateAttachedLeft: () => void;
    rotateAttachedRight: () => void;
    toggleAdvancedSettings: () => void;
    toggleAutoEdgeAlign: () => void;
    toggleAutoPositionCorrection: () => void;
  };
  primaryActionLabel: string;
  isPrimaryActionPending?: boolean;
  onPrimaryActionClick: () => void;
}

export default function AduControlPanel({
  panelState,
  panelConstraints,
  panelActions,
  primaryActionLabel,
  isPrimaryActionPending = false,
  onPrimaryActionClick,
}: AduControlPanelProps) {
  const {
    aduType,
    aduSize,
    aduRotation,
    aduShapeType,
    isAduValid,
    invalidReasons,
    isDraggingAdu,
    currentZone,
    autoEdgeAlign,
    autoPositionCorrection,
    showAdvancedSettings,
    uiVisible,
    displayAduSize,
    aduDimensions,
    aspectRatioSliderValue,
  } = panelState;
  const { aduMaxArea } = panelConstraints;
  const {
    selectAduType,
    resetCurrentShape,
    selectShape,
    updateSize,
    updateAspectRatioFromSlider,
    updateDetachedRotation,
    rotateAttachedLeft,
    rotateAttachedRight,
    toggleAdvancedSettings,
    toggleAutoEdgeAlign,
    toggleAutoPositionCorrection,
  } = panelActions;
  const zoneBadgeStyles = getZoneBadgeStyles(currentZone);

  return (
    <div
      className={`
        absolute right-2 top-12 w-72 bg-surface-0 shadow-[0_4px_16px_rgba(0,0,0,0.10),0_1px_4px_rgba(0,0,0,0.06)] rounded-xl p-3 text-surface-800 z-50 animate-in fade-in slide-in-from-top-5
        transition-all duration-300 ease-in-out flex flex-col
        ${
          !uiVisible
            ? 'opacity-0 pointer-events-none translate-x-4 scale-95'
            : isDraggingAdu
              ? 'opacity-100 pointer-events-none scale-[1.01] shadow-[0_8px_32px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.08)] ring-brand-600/20 ring-2'
              : 'opacity-100 pointer-events-auto'
        }
      `}
    >
      <div className="flex items-center justify-between mb-0.5">
        <h2 className="text-[17px] font-semibold tracking-tight text-surface-900 leading-tight">
          ADU Designer
        </h2>
        {currentZone !== 'Unknown' && (
          <div
            className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors duration-300 ${zoneBadgeStyles.text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${zoneBadgeStyles.dot}`} />
            {currentZone} yard
          </div>
        )}
      </div>

      <div className="mb-1.5">
        <p className="text-[11px] font-medium text-surface-500 mb-1.5">ADU type</p>
        <div className="grid grid-cols-2 p-0.5 bg-surface-100 rounded-xl border border-surface-200">
          {(['detached', 'attached'] as const).map((type) => (
            <button
              key={type}
              onClick={() => selectAduType(type)}
              className={`py-0.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer capitalize
                ${
                  aduType === type
                    ? 'bg-surface-0 text-surface-900 shadow-sm border border-surface-200'
                    : 'text-surface-400 hover:text-surface-700 hover:bg-surface-200/50'
                }`}
            >
              {type === 'detached' ? 'Detached' : 'Attached'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex justify-between items-end mb-1.5">
            <p className="text-[11px] font-medium text-surface-500">Modular profiles</p>
            <button
              onClick={resetCurrentShape}
              className="flex items-center gap-1 text-[11px] font-medium text-surface-400 hover:text-surface-600 transition-colors"
            >
              <RotateCcw className="w-3 h-3" strokeWidth={2.5} />
              Reset
            </button>
          </div>
          <div className="grid grid-cols-4 p-0.5 bg-surface-100 rounded-xl border border-surface-200">
            {SHAPE_OPTIONS.map((shape) => (
              <button
                key={shape}
                onClick={() => selectShape(shape)}
                className={`py-0.5 flex items-center justify-center rounded-lg transition-all cursor-pointer
                  ${
                    aduShapeType === shape
                      ? 'bg-surface-0 text-surface-900 shadow-sm border border-surface-200'
                      : 'text-surface-400 hover:text-surface-700 hover:bg-surface-200/50'
                  }`}
              >
                <span className="flex items-center justify-center w-5 h-5">
                  {shape === 'rectangle' ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                      <path d="M4 4h16v16H4z" />
                    </svg>
                  ) : shape === 'l-shape' ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                      <path d="M4 4h6v10h10v6H4z" />
                    </svg>
                  ) : shape === 't-shape' ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                      <path d="M4 4h16v6h-5v10H9V10H4z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                      <path d="M4 4h5v10h6V4h5v16H4z" />
                    </svg>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center h-auto">
            <p className="text-[11px] font-medium text-surface-500 leading-tight">Floor area</p>
            <span className="text-sm font-semibold text-surface-900 tabular-nums leading-tight">
              {displayAduSize} <span className="text-[10px] font-normal text-surface-500">ft²</span>
            </span>
          </div>
          <input
            type="range"
            min={FLOOR_AREA_MIN}
            max={aduMaxArea}
            step="1"
            value={aduSize}
            onChange={(event) => updateSize(parseInt(event.target.value, 10))}
            className="block w-full h-[3px] my-0 p-0 border-0 bg-surface-200 rounded-full cursor-pointer appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-surface-700 [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center h-auto">
            <p className="text-[11px] font-medium text-surface-500 leading-tight">Dimensions</p>
            <span className="text-sm font-semibold text-surface-900 tabular-nums leading-tight">
              {aduDimensions ? (
                <>
                  {aduDimensions}{' '}
                  <span className="text-[10px] font-normal text-surface-500">ft</span>
                </>
              ) : (
                '-'
              )}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={aspectRatioSliderValue}
            onChange={(event) => updateAspectRatioFromSlider(parseInt(event.target.value, 10))}
            className="block w-full h-[3px] my-0 p-0 border-0 bg-surface-200 rounded-full cursor-pointer appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-surface-700 [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:scale-110 transition-all disabled:opacity-50"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center h-auto">
            <p className="text-[11px] font-medium text-surface-500 leading-tight">Orientation</p>
            {aduType === 'detached' ? (
              <div className="flex items-center text-sm font-semibold text-surface-900 tabular-nums leading-tight">
                <input
                  type="number"
                  value={Number(aduRotation.toFixed(2)).toString()}
                  onChange={(event) => {
                    const rawValue = Number.parseFloat(event.target.value);
                    updateDetachedRotation(Number.isNaN(rawValue) ? 0 : rawValue);
                  }}
                  className="w-16 bg-transparent text-right outline-none appearance-[textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-surface-100 rounded px-1 transition-colors"
                />
                <span>°</span>
              </div>
            ) : (
              <span className="text-[11px] font-medium text-surface-400 leading-tight">
                Side snap
              </span>
            )}
          </div>

          {aduType === 'detached' ? (
            <input
              type="range"
              min={ORIENTATION_MIN}
              max={ORIENTATION_MAX}
              step="1"
              value={aduRotation}
              onChange={(event) => updateDetachedRotation(parseInt(event.target.value, 10))}
              className="block w-full h-[3px] my-0 p-0 border-0 bg-surface-200 rounded-full cursor-pointer appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-surface-700 [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
            />
          ) : (
            <div className="flex gap-2">
              <button
                onClick={rotateAttachedLeft}
                className="flex-1 py-1.5 bg-surface-50 hover:bg-surface-100 text-surface-600 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 border border-surface-200 shadow-sm active:scale-95"
              >
                <span>↺</span> Rotate left
              </button>
              <button
                onClick={rotateAttachedRight}
                className="flex-1 py-1.5 bg-surface-50 hover:bg-surface-100 text-surface-600 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 border border-surface-200 shadow-sm active:scale-95"
              >
                Rotate right <span>↻</span>
              </button>
            </div>
          )}
        </div>

        {aduType === 'detached' && (
          <div className="pt-1">
            <button
              onClick={toggleAdvancedSettings}
              className="w-full flex items-center justify-between group cursor-pointer"
            >
              <span className="text-[11px] font-medium text-surface-400 group-hover:text-surface-600 transition-colors">
                Advanced
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-surface-400 group-hover:text-surface-600 transition-all duration-200 ${showAdvancedSettings ? 'rotate-180' : ''}`}
              />
            </button>

            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showAdvancedSettings ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden min-h-0">
                <div className="space-y-0.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-surface-500">Edge align</span>
                    <button
                      onClick={toggleAutoEdgeAlign}
                      className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${autoEdgeAlign ? 'bg-surface-900' : 'bg-surface-200'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${autoEdgeAlign ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-surface-500">
                      Smart placement
                    </span>
                    <button
                      onClick={toggleAutoPositionCorrection}
                      className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${autoPositionCorrection ? 'bg-surface-900' : 'bg-surface-200'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${autoPositionCorrection ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto pt-2.5 relative">
        {aduType === 'attached' && isDraggingAdu ? (
          <div className="w-full h-9 flex items-center justify-center gap-2 px-3 rounded-lg text-[13px] font-medium bg-red-50 text-red-600 border border-red-200/60 shadow-sm cursor-default">
            <span className="animate-pulse">Release ADU to attach</span>
          </div>
        ) : !isAduValid || invalidReasons.length > 0 ? (
          <div className="w-full h-9 flex items-center justify-center gap-2 px-3 rounded-lg text-[13px] font-medium bg-red-50 text-red-600 border border-red-200/60 shadow-sm cursor-default">
            Invalid placement
          </div>
        ) : (
          <button
            onClick={onPrimaryActionClick}
            disabled={isPrimaryActionPending}
            className="w-full h-9 flex items-center justify-center gap-2 px-3 rounded-lg text-[13px] font-semibold transition-all shadow-sm bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-wait disabled:hover:bg-brand-600"
          >
            {isPrimaryActionPending ? 'Starting…' : primaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
