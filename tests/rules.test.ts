import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARRIAGEWAY_HALF, GUARDRAIL_X, LANES, SHOULDER, TRAFFIC, WALL } from '../src/core/config.ts';
import { GARAGE } from '../src/data/cars/index.ts';
import { TRANSITION_LENGTH, ZONE_LENGTH } from '../src/data/themes.ts';
import { rectsOverlap } from '../src/rules/collision.ts';
import { densityAt, multiplierFor, onShoulder } from '../src/rules/difficulty.ts';
import { stepSpring } from '../src/rules/spring.ts';
import { themeBlend, themeIndexAt } from '../src/rules/themes.ts';
import { wallAt, wallSpeedAt } from '../src/rules/wall.ts';
import { measure, pickGear, stepVehicle, type DriveInput, type VehicleState } from '../src/rules/vehicle.ts';

const CAR = GARAGE[0].physics;

function drive(s: VehicleState, input: DriveInput, seconds: number, dt = 1 / 60) {
  let maxLat = 0;
  for (let t = 0; t < seconds; t += dt) {
    const r = stepVehicle(s, input, dt, CAR);
    s = r.state;
    maxLat = Math.max(maxLat, Math.abs(r.lateralAccel));
  }
  return { s, maxLat };
}
const at = (speed: number): VehicleState => ({ x: 0, heading: 0, speed, steer: 0 });

test('full brake stops the car without rolling backwards', () => {
  const { s } = drive(at(30), { steer: 0, throttle: 0, brake: 1 }, 5);
  assert.equal(s.speed, 0);
});

test('flat out, the car stops at its limiter', () => {
  const { s } = drive(at(0), { steer: 0, throttle: 1, brake: 0 }, 120);
  assert.ok(Math.abs(s.speed * 3.6 - CAR.limiterKmh) < 2);
});

test('cornering never exceeds the grip limit, and steering right goes right', () => {
  const { s, maxLat } = drive(at(40), { steer: 1, throttle: 0, brake: 0 }, 3);
  assert.ok(maxLat <= CAR.grip + 1e-9);
  assert.ok(s.x > 0);
});

test('no input keeps the car straight', () => {
  const { s } = drive(at(30), { steer: 0, throttle: 0, brake: 0 }, 5);
  assert.equal(s.x, 0);
});

test('the gearbox shifts up as speed rises and never over-revs', () => {
  for (const { physics: c } of GARAGE) {
    let last = 0;
    for (let v = 0; v <= c.limiterKmh / 3.6; v++) {
      const { gear, rpm } = pickGear(c, v, 1);
      assert.ok(gear >= last && rpm <= c.redline);
      last = gear;
    }
    assert.ok(last >= c.gears.length - 2, `flat out it should reach the top gears, got ${last}`);
  }
  assert.equal(pickGear(CAR, 30, 0).gear, 8, 'cruising at 108 km/h, an 8-speed sits in 8th (~1,700 rpm)');
  const f40 = GARAGE.find((c) => c.id === 'f40')!.physics; // close ratios: 4th and 5th both past peak power near top speed
  assert.equal(pickGear(f40, 82, 1).gear, 5, 'equal push: the taller gear, so it never drops a gear at full throttle');
});

test('rotated rectangles collide on their corners', () => {
  const box = { x: 0, z: 0, w: 2, l: 2, heading: 0 };
  assert.ok(rectsOverlap(box, { ...box, x: 1.9 }));
  assert.ok(!rectsOverlap(box, { ...box, x: 2.0 }));
  assert.ok(rectsOverlap({ ...box, heading: Math.PI / 4 }, { ...box, x: 2.3 }));
  assert.ok(!rectsOverlap(box, { ...box, z: -5 }));
});

test('traffic density and score multiplier stay in range', () => {
  assert.equal(densityAt(0), TRAFFIC.densityStart);
  assert.equal(densityAt(1e4), TRAFFIC.densityMax);
  assert.equal(multiplierFor(120), 1);
  assert.equal(multiplierFor(260), 4);
  assert.equal(onShoulder(LANES[3]), false);
  assert.equal(onShoulder(LANES[0] - 3), true);
  assert.equal(multiplierFor(260, LANES[3] + 3), 0); // the hard shoulder pays nothing
});

test('a broken-down car blocks the whole hard shoulder but not the right lane', () => {
  const w = 2, l = 4.6; // a wide car
  const parked = { x: SHOULDER.x, z: 0, w, l, heading: 0 };
  assert.equal(rectsOverlap({ x: LANES[3], z: 0, w, l, heading: 0 }, parked), false);
  for (let x = CARRIAGEWAY_HALF + 0.01; x < GUARDRAIL_X - w / 2; x += 0.1) {
    assert.ok(onShoulder(x));
    assert.ok(rectsOverlap({ x, z: 0, w, l, heading: 0 }, parked), `slipped past at x = ${x}`);
  }
});

test('suspension spring rebounds once, then settles on its target', () => {
  const s = { x: 0, v: 0 };
  let peak = 0;
  for (let t = 0; t < 4; t += 1 / 60) {
    stepSpring(s, 1, 1.6, 0.35, 1 / 60);
    peak = Math.max(peak, s.x);
  }
  assert.ok(peak > 1.05, 'should overshoot a little');
  assert.ok(Math.abs(s.x - 1) < 0.01, 'should settle');
});

test('garage cars perform like the real ones', () => {
  for (const car of GARAGE) {
    const m = measure(car.physics), r = car.real;
    assert.ok(Math.abs(m.zeroTo100 - r.zeroTo100) < 0.15, `${car.name} 0-100: ${m.zeroTo100.toFixed(2)} s, real ${r.zeroTo100} s`);
    assert.ok(Math.abs(m.topKmh - r.topKmh) < 5, `${car.name} top: ${Math.round(m.topKmh)} km/h, real ${r.topKmh}`);
    assert.ok(Math.abs(m.brake100 - r.brake100) < 1.5, `${car.name} 100-0: ${m.brake100.toFixed(1)} m, real ${r.brake100} m`);
  }
});

test('themes follow each other and blend smoothly across each border', () => {
  assert.deepEqual(themeBlend(0, 3), { from: 0, to: 0, t: 0 });
  assert.equal(themeIndexAt(ZONE_LENGTH * 3 + 1, 3), 0, 'cycles back to the first theme');
  // no jump when crossing a border: both sides meet halfway between the same two themes
  const before = themeBlend(ZONE_LENGTH - 0.01, 3), after = themeBlend(ZONE_LENGTH + 0.01, 3);
  assert.deepEqual([before.from, before.to, after.from, after.to], [0, 1, 0, 1]);
  assert.ok(Math.abs(before.t - after.t) < 0.01);
  // the share of the next theme only grows while you drive through the border
  const share = (d: number) => {
    const { from, to, t } = themeBlend(d, 3);
    return from === to ? (to === 1 ? 1 : 0) : t;
  };
  let last = -1;
  for (let d = ZONE_LENGTH - TRANSITION_LENGTH; d <= ZONE_LENGTH + TRANSITION_LENGTH; d += 5) {
    assert.ok(share(d) >= last, `share dropped at ${d} m`);
    last = share(d);
  }
  assert.equal(last, 1);
  assert.deepEqual(themeBlend(ZONE_LENGTH + TRANSITION_LENGTH, 3), { from: 1, to: 1, t: 0 });
});

test('the battle royale wall speeds up, caps, and never jumps', () => {
  assert.equal(wallAt(0), WALL.startD);
  assert.ok(Math.abs(wallSpeedAt(0) * 3.6 - WALL.startKmh) < 1e-9);
  assert.ok(Math.abs(wallSpeedAt(1e4) * 3.6 - WALL.maxKmh) < 1e-9);
  let last = wallAt(0);
  for (let t = 0.5; t < 600; t += 0.5) {
    const d = wallAt(t), step = d - last;
    // over half a second it moves by its speed (no teleport at the cap)
    assert.ok(step > 0 && Math.abs(step - wallSpeedAt(t - 0.25) * 0.5) < 0.2, `jump at ${t}s`);
    last = d;
  }
});
