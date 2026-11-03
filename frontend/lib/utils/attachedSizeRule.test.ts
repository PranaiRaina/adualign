// Run: pnpm dlx tsx lib/utils/attachedSizeRule.test.ts
import assert from 'node:assert/strict';

import { getAttachedSizeStatus } from './attachedSizeRule';

// Not applicable: wrong type or no size.
for (const aduType of ['detached', 'jadu', 'garage_conversion', undefined]) {
  assert.equal(getAttachedSizeStatus({ aduType, aduSize: 1000, homeSqft: 1500 }), 'not-applicable');
}
assert.equal(getAttachedSizeStatus({ aduType: 'attached', homeSqft: 1500 }), 'not-applicable');
assert.equal(
  getAttachedSizeStatus({ aduType: 'attached', aduSize: 0, homeSqft: 1500 }),
  'not-applicable',
);

// 800 floor: exactly 800 passes regardless of home size.
assert.equal(getAttachedSizeStatus({ aduType: 'attached', aduSize: 800 }), 'ok-under-800');
assert.equal(
  getAttachedSizeStatus({ aduType: 'attached', aduSize: 800, homeSqft: 1000 }),
  'ok-under-800',
);

// Over 800 with unknown home size warns conservatively.
assert.equal(getAttachedSizeStatus({ aduType: 'attached', aduSize: 801 }), 'unknown-home');
assert.equal(
  getAttachedSizeStatus({ aduType: 'attached', aduSize: 801, homeSqft: null }),
  'unknown-home',
);

// 50% boundary is strict: exactly half passes, one over warns.
assert.equal(
  getAttachedSizeStatus({ aduType: 'attached', aduSize: 905, homeSqft: 1810 }),
  'ok-under-half',
);
assert.equal(
  getAttachedSizeStatus({ aduType: 'attached', aduSize: 906, homeSqft: 1810 }),
  'over-half',
);

console.log('attachedSizeRule: all assertions passed');
