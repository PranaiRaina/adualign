// Run: pnpm dlx tsx components/map/utils/wallLengths.test.ts
import assert from 'node:assert/strict';

import { buildWallLengthLabels } from './wallLengths';

// Null / non-polygon → empty collection.
assert.deepEqual(buildWallLengthLabels(null, 8).features, []);
assert.deepEqual(
  buildWallLengthLabels({ type: 'Point', coordinates: [0, 0] } as GeoJSON.Geometry, 8).features,
  [],
);

// ~100ft square near the equator (0.000273 deg lng ~= 30.4m ~= 100ft).
const d = 0.000273;
const square: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [d, 0],
      [d, d],
      [0, d],
      [0, 0],
    ],
  ],
};
const squareLabels = buildWallLengthLabels(square, 8);
assert.equal(squareLabels.features.length, 4);
for (const f of squareLabels.features) {
  assert.equal(f.geometry.type, 'Point');
  const ft = Number(String(f.properties?.label).replace(' ft', ''));
  assert.ok(Math.abs(ft - 100) <= 2, `expected ~100 ft, got ${ft}`);
}

// Threshold filtering: short (~4ft) notch walls are dropped; long walls remain.
const s = 0.0000109; // ~4ft
const notched: GeoJSON.Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [d, 0],
      [d, d],
      [d - s, d],
      [d - s, d + s],
      [0, d + s],
      [0, 0],
    ],
  ],
};
const notchedLabels = buildWallLengthLabels(notched, 8);
const notchedFt = notchedLabels.features.map((f) =>
  Number(String(f.properties?.label).replace(' ft', '')),
);
assert.ok(
  notchedFt.every((ft) => ft >= 8),
  `all labels should be >= 8ft, got ${notchedFt.join(', ')}`,
);

// MultiPolygon → labels only from the largest polygon (the tiny one is dropped).
const tiny = 0.00002;
const multi: GeoJSON.Geometry = {
  type: 'MultiPolygon',
  coordinates: [
    square.coordinates,
    [
      [
        [1, 1],
        [1 + tiny, 1],
        [1 + tiny, 1 + tiny],
        [1, 1 + tiny],
        [1, 1],
      ],
    ],
  ],
};
assert.equal(buildWallLengthLabels(multi, 8).features.length, 4);

console.log('wallLengths: all assertions passed');
