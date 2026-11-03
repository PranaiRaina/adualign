import { METERS_PER_DEGREE_LAT, METERS_TO_FEET } from '../constants';
import type {
  ClearanceGuide,
  ClearanceGuideDirection,
  ClearanceGuideTargetKind,
  LngLatCoordinate,
} from '../types';

type MeterPoint = { x: number; y: number };
type LocalPoint = { u: number; v: number };
type AxisInterval = { min: number; max: number };
type AxisName = 'u' | 'v';

type BoundarySegment = {
  start: LngLatCoordinate;
  end: LngLatCoordinate;
  targetKind: ClearanceGuideTargetKind;
  targetStructureIndex?: number;
};

type MeterSegment = {
  start: MeterPoint;
  end: MeterPoint;
  targetKind: ClearanceGuideTargetKind;
  targetStructureIndex?: number;
};

type LocalSegment = {
  start: LocalPoint;
  end: LocalPoint;
  targetKind: ClearanceGuideTargetKind;
  targetStructureIndex?: number;
};

type MeterProjection = {
  toMeters: (point: LngLatCoordinate) => MeterPoint;
  toLngLat: (point: MeterPoint) => LngLatCoordinate;
};

type LocalFrame = {
  toLocal: (point: MeterPoint) => LocalPoint;
  toMeter: (point: LocalPoint) => MeterPoint;
};

type SideSupport = {
  direction: ClearanceGuideDirection;
  outwardAxis: AxisName;
  outwardSign: 1 | -1;
  supportValue: number;
  intervals: AxisInterval[];
};

type DirectionalHit = {
  sourcePoint: LocalPoint;
  targetPoint: LocalPoint;
  forwardDistanceMeters: number;
  targetKind: ClearanceGuideTargetKind;
  targetStructureIndex?: number;
};

export type IndexedStructureGeometry = {
  index: number;
  geometry: GeoJSON.Geometry;
};

const DIRECTIONAL_EPSILON_METERS = 1e-6;
const SIDE_SUPPORT_TOLERANCE_METERS = 0.05;
const ATTACHED_SIDE_TOLERANCE_FEET = 1;
const SIDE_DIRECTIONS: ClearanceGuideDirection[] = ['top', 'right', 'bottom', 'left'];

export function extractBoundarySegments({
  geometry,
  targetKind,
  targetStructureIndex,
}: {
  geometry: GeoJSON.Geometry | null | undefined;
  targetKind: ClearanceGuideTargetKind;
  targetStructureIndex?: number;
}): BoundarySegment[] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return extractRingSegments({ ring: geometry.coordinates[0], targetKind, targetStructureIndex });
  }
  if (geometry.type !== 'MultiPolygon') return [];

  return geometry.coordinates.flatMap((polygon) =>
    extractRingSegments({ ring: polygon[0], targetKind, targetStructureIndex }),
  );
}

export function getStructureBoundarySegments(
  structures: IndexedStructureGeometry[],
): BoundarySegment[] {
  return structures.flatMap(({ index, geometry }) =>
    extractBoundarySegments({
      geometry,
      targetKind: 'active-structure',
      targetStructureIndex: index,
    }),
  );
}

export function calculateDirectionalClearanceGuides({
  aduGeometry,
  aduRotation,
  parcelBoundarySegments,
  structureBoundarySegments,
}: {
  aduGeometry: GeoJSON.Polygon;
  aduRotation: number;
  parcelBoundarySegments: BoundarySegment[];
  structureBoundarySegments: BoundarySegment[];
}): ClearanceGuide[] {
  const aduSegments = extractBoundarySegments({
    geometry: aduGeometry,
    targetKind: 'parcel-boundary',
  });
  if (!aduSegments.length) return [];

  const projection = createMeterProjection(aduSegments[0].start);
  const meterAduSegments = aduSegments.map((segment) => toMeterSegment({ segment, projection }));
  const meterTargetSegments = [...parcelBoundarySegments, ...structureBoundarySegments].map(
    (segment) => toMeterSegment({ segment, projection }),
  );
  const localFrame = createLocalFrame(aduRotation);
  const localAduSegments = meterAduSegments.map((segment) =>
    toLocalSegment({ segment, localFrame }),
  );
  const localTargetSegments = meterTargetSegments.map((segment) =>
    toLocalSegment({ segment, localFrame }),
  );
  const sideSupports = getSideSupports(localAduSegments);

  return sideSupports.flatMap((sideSupport) => {
    const hit = findNearestSideHit({ sideSupport, targetSegments: localTargetSegments });
    if (!hit) return [];
    return [
      createClearanceGuide({
        direction: sideSupport.direction,
        hit,
        localFrame,
        projection,
      }),
    ];
  });
}

export function getAttachedSideDirection({
  aduGeometry,
  aduRotation,
  primaryStructureSegments,
}: {
  aduGeometry: GeoJSON.Polygon | null;
  aduRotation: number;
  primaryStructureSegments: BoundarySegment[];
}): ClearanceGuideDirection | null {
  if (!aduGeometry || !primaryStructureSegments.length) return null;

  const directionalGuides = calculateDirectionalClearanceGuides({
    aduGeometry,
    aduRotation,
    parcelBoundarySegments: [],
    structureBoundarySegments: primaryStructureSegments,
  });
  if (!directionalGuides.length) return null;

  const attachedGuide = directionalGuides.reduce((closestGuide, guide) =>
    guide.distanceFeet < closestGuide.distanceFeet ? guide : closestGuide,
  );

  if (attachedGuide.distanceFeet > ATTACHED_SIDE_TOLERANCE_FEET) return null;

  return attachedGuide.direction;
}

function extractRingSegments({
  ring,
  targetKind,
  targetStructureIndex,
}: {
  ring: number[][] | undefined;
  targetKind: ClearanceGuideTargetKind;
  targetStructureIndex?: number;
}): BoundarySegment[] {
  if (!ring || ring.length < 2) return [];

  const segments: BoundarySegment[] = [];
  for (let index = 0; index < ring.length - 1; index++) {
    const start = toLngLatCoordinate(ring[index]);
    const end = toLngLatCoordinate(ring[index + 1]);
    if (!start || !end || areSameCoordinate(start, end)) continue;
    segments.push({ start, end, targetKind, targetStructureIndex });
  }
  return segments;
}

function createMeterProjection(referencePoint: LngLatCoordinate): MeterProjection {
  const [referenceLng, referenceLat] = referencePoint;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((referenceLat * Math.PI) / 180) || 1;

  return {
    toMeters: ([lng, lat]) => ({
      x: (lng - referenceLng) * metersPerDegreeLng,
      y: (lat - referenceLat) * METERS_PER_DEGREE_LAT,
    }),
    toLngLat: ({ x, y }) => [
      referenceLng + x / metersPerDegreeLng,
      referenceLat + y / METERS_PER_DEGREE_LAT,
    ],
  };
}

function createLocalFrame(aduRotation: number): LocalFrame {
  const angleRadians = (aduRotation * Math.PI) / 180;
  const rightAxis = normalize({ x: Math.cos(angleRadians), y: -Math.sin(angleRadians) });
  const topAxis = normalize({ x: Math.sin(angleRadians), y: Math.cos(angleRadians) });

  return {
    toLocal: ({ x, y }) => ({
      u: dot({ x, y }, rightAxis),
      v: dot({ x, y }, topAxis),
    }),
    toMeter: ({ u, v }) => ({
      x: rightAxis.x * u + topAxis.x * v,
      y: rightAxis.y * u + topAxis.y * v,
    }),
  };
}

function toMeterSegment({
  segment,
  projection,
}: {
  segment: BoundarySegment;
  projection: MeterProjection;
}): MeterSegment {
  return {
    start: projection.toMeters(segment.start),
    end: projection.toMeters(segment.end),
    targetKind: segment.targetKind,
    targetStructureIndex: segment.targetStructureIndex,
  };
}

function toLocalSegment({
  segment,
  localFrame,
}: {
  segment: MeterSegment;
  localFrame: LocalFrame;
}): LocalSegment {
  return {
    start: localFrame.toLocal(segment.start),
    end: localFrame.toLocal(segment.end),
    targetKind: segment.targetKind,
    targetStructureIndex: segment.targetStructureIndex,
  };
}

function getSideSupports(localAduSegments: LocalSegment[]): SideSupport[] {
  const supportBounds = getSupportBounds(localAduSegments);

  return [
    createSideSupport({
      direction: 'top',
      outwardAxis: 'v',
      outwardSign: 1,
      supportValue: supportBounds.maxV,
      aduSegments: localAduSegments,
    }),
    createSideSupport({
      direction: 'right',
      outwardAxis: 'u',
      outwardSign: 1,
      supportValue: supportBounds.maxU,
      aduSegments: localAduSegments,
    }),
    createSideSupport({
      direction: 'bottom',
      outwardAxis: 'v',
      outwardSign: -1,
      supportValue: supportBounds.minV,
      aduSegments: localAduSegments,
    }),
    createSideSupport({
      direction: 'left',
      outwardAxis: 'u',
      outwardSign: -1,
      supportValue: supportBounds.minU,
      aduSegments: localAduSegments,
    }),
  ];
}

function getSupportBounds(localAduSegments: LocalSegment[]) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const segment of localAduSegments) {
    for (const point of [segment.start, segment.end]) {
      minU = Math.min(minU, point.u);
      maxU = Math.max(maxU, point.u);
      minV = Math.min(minV, point.v);
      maxV = Math.max(maxV, point.v);
    }
  }

  return { minU, maxU, minV, maxV };
}

function createSideSupport({
  direction,
  outwardAxis,
  outwardSign,
  supportValue,
  aduSegments,
}: {
  direction: ClearanceGuideDirection;
  outwardAxis: AxisName;
  outwardSign: 1 | -1;
  supportValue: number;
  aduSegments: LocalSegment[];
}): SideSupport {
  return {
    direction,
    outwardAxis,
    outwardSign,
    supportValue,
    intervals: mergeIntervals(
      aduSegments.flatMap((segment) =>
        getSupportInterval({
          segment,
          outwardAxis,
          supportValue,
        }),
      ),
    ),
  };
}

function getSupportInterval({
  segment,
  outwardAxis,
  supportValue,
}: {
  segment: LocalSegment;
  outwardAxis: AxisName;
  supportValue: number;
}): AxisInterval[] {
  if (outwardAxis === 'v') {
    if (!isHorizontal(segment)) return [];
    if (!liesOnSupportLine(segment.start.v, segment.end.v, supportValue)) return [];
    return [createInterval(segment.start.u, segment.end.u)];
  }

  if (!isVertical(segment)) return [];
  if (!liesOnSupportLine(segment.start.u, segment.end.u, supportValue)) return [];
  return [createInterval(segment.start.v, segment.end.v)];
}

function liesOnSupportLine(first: number, second: number, supportValue: number): boolean {
  return (
    Math.abs(first - supportValue) <= SIDE_SUPPORT_TOLERANCE_METERS &&
    Math.abs(second - supportValue) <= SIDE_SUPPORT_TOLERANCE_METERS
  );
}

function mergeIntervals(intervals: AxisInterval[]): AxisInterval[] {
  if (!intervals.length) return [];

  const sortedIntervals = [...intervals].sort((left, right) => left.min - right.min);
  const mergedIntervals: AxisInterval[] = [sortedIntervals[0]];

  for (const interval of sortedIntervals.slice(1)) {
    const lastInterval = mergedIntervals[mergedIntervals.length - 1];
    if (interval.min <= lastInterval.max + SIDE_SUPPORT_TOLERANCE_METERS) {
      lastInterval.max = Math.max(lastInterval.max, interval.max);
      continue;
    }
    mergedIntervals.push({ ...interval });
  }

  return mergedIntervals;
}

function findNearestSideHit({
  sideSupport,
  targetSegments,
}: {
  sideSupport: SideSupport;
  targetSegments: LocalSegment[];
}): DirectionalHit | null {
  let bestHit: DirectionalHit | null = null;

  for (const interval of sideSupport.intervals) {
    for (const targetSegment of targetSegments) {
      const hit = findSegmentHit({
        interval,
        sideSupport,
        targetSegment,
      });
      if (!hit) continue;
      if (!bestHit || isCloserHit(hit, bestHit)) {
        bestHit = hit;
      }
    }
  }

  return bestHit;
}

function isCloserHit(next: DirectionalHit, current: DirectionalHit): boolean {
  return next.forwardDistanceMeters < current.forwardDistanceMeters - DIRECTIONAL_EPSILON_METERS;
}

function findSegmentHit({
  interval,
  sideSupport,
  targetSegment,
}: {
  interval: AxisInterval;
  sideSupport: SideSupport;
  targetSegment: LocalSegment;
}): DirectionalHit | null {
  const clippedSegment = clipSegmentToInterval({
    segment: targetSegment,
    axis: getIntervalAxisName(sideSupport.outwardAxis),
    interval,
  });
  if (!clippedSegment) return null;

  return createDirectionalHit({
    clippedSegment,
    sideSupport,
  });
}

function getIntervalAxisName(outwardAxis: AxisName): AxisName {
  return outwardAxis === 'u' ? 'v' : 'u';
}

function clipSegmentToInterval({
  segment,
  axis,
  interval,
}: {
  segment: LocalSegment;
  axis: AxisName;
  interval: AxisInterval;
}): LocalSegment | null {
  const startValue = getAxisValue(segment.start, axis);
  const endValue = getAxisValue(segment.end, axis);
  const delta = endValue - startValue;

  if (Math.abs(delta) <= DIRECTIONAL_EPSILON_METERS) {
    if (startValue < interval.min - DIRECTIONAL_EPSILON_METERS) return null;
    if (startValue > interval.max + DIRECTIONAL_EPSILON_METERS) return null;
    return segment;
  }

  const tAtMin = (interval.min - startValue) / delta;
  const tAtMax = (interval.max - startValue) / delta;
  const clippedStartT = Math.max(0, Math.min(tAtMin, tAtMax));
  const clippedEndT = Math.min(1, Math.max(tAtMin, tAtMax));
  if (clippedStartT > clippedEndT + DIRECTIONAL_EPSILON_METERS) return null;

  return {
    ...segment,
    start: interpolateLocalPoint(segment.start, segment.end, clippedStartT),
    end: interpolateLocalPoint(segment.start, segment.end, clippedEndT),
  };
}

function createDirectionalHit({
  clippedSegment,
  sideSupport,
}: {
  clippedSegment: LocalSegment;
  sideSupport: SideSupport;
}): DirectionalHit | null {
  const startForward = getForwardDistance(clippedSegment.start, sideSupport);
  const endForward = getForwardDistance(clippedSegment.end, sideSupport);
  const maxForward = Math.max(startForward, endForward);
  if (maxForward < -DIRECTIONAL_EPSILON_METERS) return null;

  const targetPoint = chooseFirstHitPoint({
    segment: clippedSegment,
    sideSupport,
    startForward,
    endForward,
  });
  if (!targetPoint) return null;

  return {
    sourcePoint: createSourcePoint(targetPoint, sideSupport),
    targetPoint,
    forwardDistanceMeters: Math.max(0, getForwardDistance(targetPoint, sideSupport)),
    targetKind: clippedSegment.targetKind,
    targetStructureIndex: clippedSegment.targetStructureIndex,
  };
}

function chooseFirstHitPoint({
  segment,
  sideSupport,
  startForward,
  endForward,
}: {
  segment: LocalSegment;
  sideSupport: SideSupport;
  startForward: number;
  endForward: number;
}): LocalPoint | null {
  const startOnSupport = Math.abs(startForward) <= DIRECTIONAL_EPSILON_METERS;
  if (startOnSupport) return segment.start;

  const endOnSupport = Math.abs(endForward) <= DIRECTIONAL_EPSILON_METERS;
  if (endOnSupport) return segment.end;

  if (startForward * endForward < 0) {
    return intersectWithSupportLine({ segment, sideSupport });
  }

  if (startForward > 0 && endForward > 0) {
    return startForward < endForward ? segment.start : segment.end;
  }

  return null;
}

function intersectWithSupportLine({
  segment,
  sideSupport,
}: {
  segment: LocalSegment;
  sideSupport: SideSupport;
}): LocalPoint | null {
  const outwardAxis = sideSupport.outwardAxis;
  const startValue = getAxisValue(segment.start, outwardAxis);
  const endValue = getAxisValue(segment.end, outwardAxis);
  const denominator = endValue - startValue;
  if (Math.abs(denominator) <= DIRECTIONAL_EPSILON_METERS) return null;

  const t = (sideSupport.supportValue - startValue) / denominator;
  if (t < -DIRECTIONAL_EPSILON_METERS || t > 1 + DIRECTIONAL_EPSILON_METERS) return null;
  return interpolateLocalPoint(segment.start, segment.end, clamp(t, 0, 1));
}

function createSourcePoint(targetPoint: LocalPoint, sideSupport: SideSupport): LocalPoint {
  if (sideSupport.outwardAxis === 'u') {
    return { u: sideSupport.supportValue, v: targetPoint.v };
  }
  return { u: targetPoint.u, v: sideSupport.supportValue };
}

function getForwardDistance(point: LocalPoint, sideSupport: SideSupport): number {
  const axisValue = getAxisValue(point, sideSupport.outwardAxis);
  return sideSupport.outwardSign * (axisValue - sideSupport.supportValue);
}

function createClearanceGuide({
  direction,
  hit,
  localFrame,
  projection,
}: {
  direction: ClearanceGuideDirection;
  hit: DirectionalHit;
  localFrame: LocalFrame;
  projection: MeterProjection;
}): ClearanceGuide {
  return {
    direction,
    targetKind: hit.targetKind,
    aduPoint: projection.toLngLat(localFrame.toMeter(hit.sourcePoint)),
    targetPoint: projection.toLngLat(localFrame.toMeter(hit.targetPoint)),
    distanceFeet: hit.forwardDistanceMeters * METERS_TO_FEET,
    targetStructureIndex: hit.targetStructureIndex,
  };
}

function interpolateLocalPoint(start: LocalPoint, end: LocalPoint, t: number): LocalPoint {
  return {
    u: start.u + (end.u - start.u) * t,
    v: start.v + (end.v - start.v) * t,
  };
}

function createInterval(first: number, second: number): AxisInterval {
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
}

function isHorizontal(segment: LocalSegment): boolean {
  return Math.abs(segment.start.v - segment.end.v) <= SIDE_SUPPORT_TOLERANCE_METERS;
}

function isVertical(segment: LocalSegment): boolean {
  return Math.abs(segment.start.u - segment.end.u) <= SIDE_SUPPORT_TOLERANCE_METERS;
}

function getAxisValue(point: LocalPoint, axis: AxisName): number {
  return axis === 'u' ? point.u : point.v;
}

function toLngLatCoordinate(coord: number[] | undefined): LngLatCoordinate | null {
  if (!coord || coord.length < 2) return null;
  return [coord[0], coord[1]];
}

function areSameCoordinate(first: LngLatCoordinate, second: LngLatCoordinate): boolean {
  return first[0] === second[0] && first[1] === second[1];
}

function normalize(point: MeterPoint): MeterPoint {
  const length = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / length, y: point.y / length };
}

function dot(first: MeterPoint, second: MeterPoint): number {
  return first.x * second.x + first.y * second.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
