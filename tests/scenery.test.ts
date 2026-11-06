import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUARDRAIL_X } from '../src/core/config.ts';
import { factory } from '../src/world/props/town.ts';
import { reach } from '../src/world/scenery/plot.ts';

test('a prop turned side-on reaches out by its length, so a factory near the road is kept off the rail', () => {
  const f = factory(18, 0), [hx, hz] = f.userData.half as [number, number];
  assert.ok(hx > 15 && hz > 8, 'the footprint is measured');
  assert.ok(Math.abs(reach(f, 0) - hx) < 1e-9);
  assert.ok(Math.abs(reach(f, Math.PI / 2) - hz) < 1e-9);
  // a factory centred 32 m out, its long side across the road, would cross the rail
  assert.ok(32 - reach(f, 0) * 1.4 < GUARDRAIL_X);
});
