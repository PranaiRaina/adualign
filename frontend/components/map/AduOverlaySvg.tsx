import type React from 'react';
import type { Point2D, CornerId, EdgeId } from './types';
import {
  CORNER_HANDLE_VISUAL_RADIUS,
  ROTATE_HANDLE_VISUAL_RADIUS,
  EDGE_HANDLE_VISUAL_HALF_W,
  EDGE_HANDLE_VISUAL_HALF_H,
  LEG_HANDLE_VISUAL_SIZE,
  LEG_HANDLE_HIT_RADIUS,
  HANDLE_HIT_AREA_SCALE,
  HANDLE_HIT_AREA_SCALE_DOUBLE,
} from './constants';

interface AduOverlaySvgProps {
  geometry: {
    canvasWidth: number;
    canvasHeight: number;
    bboxPath: string;
    topMid: Point2D;
    rotationHandle: Point2D;
    corners: Record<CornerId, Point2D & { cursor: string }>;
    edgeHandles: Record<EdgeId, Point2D & { cursor: string }>;
    legHandles: { x: number; y: number; legIndex: number; cursor: string }[];
  } | null;
  svgRef: React.RefObject<SVGSVGElement>;
  onMouseDown: (e: React.MouseEvent<SVGElement>) => void;
}

export default function AduOverlaySvg({ geometry, svgRef, onMouseDown }: AduOverlaySvgProps) {
  if (!geometry) return null;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-40"
      width={geometry.canvasWidth}
      height={geometry.canvasHeight}
      style={{ pointerEvents: 'none' }}
    >
      <defs>
        <filter id="adu-overlay-handle-shadow" x="-150%" y="-150%" width="400%" height="400%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="1" floodColor="#000000" floodOpacity="0.18" />
        </filter>
      </defs>

      <path
        d={geometry.bboxPath}
        fill="none"
        stroke="rgba(255, 255, 255, 0.9)"
        strokeWidth={1}
        style={{ pointerEvents: 'none' }}
      />

      <line
        x1={geometry.topMid.x}
        y1={geometry.topMid.y}
        x2={geometry.rotationHandle.x}
        y2={geometry.rotationHandle.y}
        stroke="rgba(255, 255, 255, 0.4)"
        strokeWidth={1}
        style={{ pointerEvents: 'none' }}
      />

      <polygon
        points={[
          geometry.corners['top-left'],
          geometry.corners['top-right'],
          geometry.corners['bottom-right'],
          geometry.corners['bottom-left'],
        ]
          .map((p) => `${p.x},${p.y}`)
          .join(' ')}
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'move' }}
        onMouseDown={onMouseDown}
      />

      {(['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((id) => {
        const p = geometry.corners[id];
        return (
          <g key={`corner-${id}`} style={{ cursor: p.cursor }} onMouseDown={onMouseDown}>
            <circle
              cx={p.x}
              cy={p.y}
              r={CORNER_HANDLE_VISUAL_RADIUS * HANDLE_HIT_AREA_SCALE}
              fill="transparent"
              style={{ pointerEvents: 'all' }}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={CORNER_HANDLE_VISUAL_RADIUS}
              fill="white"
              filter="url(#adu-overlay-handle-shadow)"
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}

      {(['top', 'right', 'bottom', 'left'] as const).map((id) => {
        const p = geometry.edgeHandles[id];
        return (
          <g key={`edge-${id}`} style={{ cursor: p.cursor }} onMouseDown={onMouseDown}>
            <rect
              x={p.x - EDGE_HANDLE_VISUAL_HALF_W * HANDLE_HIT_AREA_SCALE}
              y={p.y - EDGE_HANDLE_VISUAL_HALF_H * HANDLE_HIT_AREA_SCALE}
              width={EDGE_HANDLE_VISUAL_HALF_W * HANDLE_HIT_AREA_SCALE_DOUBLE}
              height={EDGE_HANDLE_VISUAL_HALF_H * HANDLE_HIT_AREA_SCALE_DOUBLE}
              fill="transparent"
              style={{ pointerEvents: 'all' }}
            />
            <rect
              x={p.x - EDGE_HANDLE_VISUAL_HALF_W}
              y={p.y - EDGE_HANDLE_VISUAL_HALF_H}
              width={EDGE_HANDLE_VISUAL_HALF_W * 2}
              height={EDGE_HANDLE_VISUAL_HALF_H * 2}
              rx={EDGE_HANDLE_VISUAL_HALF_H}
              ry={EDGE_HANDLE_VISUAL_HALF_H}
              fill="white"
              opacity={0.9}
              filter="url(#adu-overlay-handle-shadow)"
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}

      <g style={{ cursor: 'grab' }} onMouseDown={onMouseDown}>
        <circle
          cx={geometry.rotationHandle.x}
          cy={geometry.rotationHandle.y}
          r={ROTATE_HANDLE_VISUAL_RADIUS * HANDLE_HIT_AREA_SCALE}
          fill="transparent"
          style={{ pointerEvents: 'all' }}
        />
        <circle
          cx={geometry.rotationHandle.x}
          cy={geometry.rotationHandle.y}
          r={ROTATE_HANDLE_VISUAL_RADIUS}
          fill="white"
          filter="url(#adu-overlay-handle-shadow)"
          style={{ pointerEvents: 'none' }}
        />
      </g>

      {geometry.legHandles.map((handle, idx) => (
        <g key={`leg-handle-${idx}`} style={{ cursor: handle.cursor }} onMouseDown={onMouseDown}>
          <polygon
            points={generateDiamond(handle.x, handle.y, LEG_HANDLE_VISUAL_SIZE)}
            fill="#FFEA00"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={1.5}
            className="drop-shadow-sm pointer-events-none"
          />
          <circle
            cx={handle.x}
            cy={handle.y}
            r={LEG_HANDLE_HIT_RADIUS}
            fill="transparent"
            style={{ pointerEvents: 'all' }}
          />
        </g>
      ))}
    </svg>
  );
}

const generateDiamond = (cx: number, cy: number, r: number) => {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
};
