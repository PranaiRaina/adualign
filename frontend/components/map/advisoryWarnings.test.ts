// Run: pnpm dlx tsx components/map/advisoryWarnings.test.ts
import assert from 'node:assert/strict';

import { buildAdvisoryWarnings } from './advisoryWarnings';

assert.deepEqual(buildAdvisoryWarnings({ aduType: 'detached', aduSize: 1000, homeSqft: 1500 }), []);
assert.deepEqual(buildAdvisoryWarnings({ aduType: 'attached', aduSize: 800 }), []);

const unknown = buildAdvisoryWarnings({ aduType: 'attached', aduSize: 900, homeSqft: null });
assert.equal(unknown.length, 1);
assert.match(unknown[0].message, /couldn't verify your home's size/);

const overHalf = buildAdvisoryWarnings({ aduType: 'attached', aduSize: 1000, homeSqft: 1810 });
assert.equal(overHalf.length, 1);
assert.match(overHalf[0].message, /may exceed that for your home/);
for (const w of [...unknown, ...overHalf]) {
  assert.match(w.message, /CA caps attached ADUs over 800 ft² at 50% of living area/);
  assert.doesNotMatch(w.message, /—/);
}

// Front-yard rule: fires over 800 in any zone containing Front, any ADU type.
const frontYard = buildAdvisoryWarnings({
  aduType: 'detached',
  aduSize: 900,
  currentZone: 'Front',
});
assert.equal(frontYard.length, 1);
assert.equal(frontYard[0].id, 'front-yard-size');
assert.doesNotMatch(frontYard[0].message, /—/);
assert.equal(
  buildAdvisoryWarnings({ aduType: 'detached', aduSize: 900, currentZone: 'Front / Side' }).length,
  1,
);
assert.equal(
  buildAdvisoryWarnings({ aduType: 'detached', aduSize: 800, currentZone: 'Front' }).length,
  0,
);
assert.equal(
  buildAdvisoryWarnings({ aduType: 'detached', aduSize: 900, currentZone: 'Rear' }).length,
  0,
);
assert.equal(
  buildAdvisoryWarnings({ aduType: 'detached', aduSize: 900, currentZone: 'Unknown' }).length,
  0,
);

// Both rules can fire together: attached, over 800, unknown home, front yard.
const both = buildAdvisoryWarnings({
  aduType: 'attached',
  aduSize: 900,
  homeSqft: null,
  currentZone: 'Front',
});
assert.deepEqual(
  both.map((w) => w.id),
  ['attached-size-ratio', 'front-yard-size'],
);

console.log('advisoryWarnings: all assertions passed');
