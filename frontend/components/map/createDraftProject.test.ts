// Run: pnpm dlx tsx components/map/createDraftProject.test.ts
// Guards the autosave bug where saves without an explicit planChatContext
// erased current_yard_zone, adu_clearances, and fire hazard on the project.
import assert from 'node:assert/strict';

import type { PropertyContext } from '../../types';
import { buildDraftProjectPayload, planChatContextFromPropertyContext } from './createDraftProject';

const propertyContext: PropertyContext = {
  fromMap: true,
  currentYardZone: 'Back Yard',
  fireHazardSeverity: 'High',
  fireHazardZoneType: 'LRA',
  aduClearances: [{ direction: 'top', targetKind: 'parcel-boundary', distanceFeet: 4 }],
};

const fallback = planChatContextFromPropertyContext(propertyContext);
assert.equal(fallback?.currentYardZone, 'Back Yard');
assert.equal(fallback?.fireHazardSeverity, 'High');
assert.equal(fallback?.fireHazardZoneType, 'LRA');
assert.equal(fallback?.aduClearances?.length, 1);

assert.equal(planChatContextFromPropertyContext(null), undefined);

const payload = buildDraftProjectPayload({
  result: { property_area_sqft: 5000 } as never,
  selectedLocation: null,
  aduSize: 350,
  aduBboxDimensions: null,
  aduShapeType: 'rectangle',
  aduType: 'detached',
  financeState: {} as never,
  mapSnapshot: {} as never,
  planChatContext: fallback,
});
assert.equal(payload.current_yard_zone, 'Back Yard');
assert.equal(payload.fire_hazard_severity, 'High');
assert.equal(payload.fire_hazard_zone_type, 'LRA');
assert.equal(payload.adu_clearances.length, 1);
assert.equal(payload.adu_clearances[0].target_kind, 'parcel-boundary');
assert.equal(payload.adu_clearances[0].target_structure_index, null);

console.log('createDraftProject.test.ts OK');
