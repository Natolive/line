import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARRIAGEWAY_HALF, EVENTS, MIRROR, GUARDRAIL_X, IMPACT, LANE_WIDTH, LANES, ROADSIDE, SHOULDER, START, TRACK, TRAFFIC, WALL } from '../src/core/config.ts';
import { gridSlot } from '../src/rules/grid.ts';
import { blocksIn, eventsIn } from '../src/rules/events.ts';
import { MAX_PLAYERS } from '../src/net/protocol.ts';
import { GARAGE } from '../src/data/cars/index.ts';
import { THEMES, TRANSITION_LENGTH, ZONE_LENGTH } from '../src/data/themes.ts';
import { rectsOverlap } from '../src/rules/collision.ts';
import { crashSeverity, groundLift, shunt, startWreck, stepWreck } from '../src/rules/crash.ts';
import { densityAt, mirrorWarning, multiplierFor, onShoulder } from '../src/rules/difficulty.ts';
import { stepSpring } from '../src/rules/spring.ts';
import { themeBlend, themeIndexAt } from '../src/rules/themes.ts';
import { damageEffects, impact, joltDamage, massOf, railImpact, type Moving } from '../src/rules/impact.ts';
import { floorHeight, terrainHeight, waterAt } from '../src/rules/terrain.ts';
import { curvatureAt, frameAt, lateral, setSeed, structuresIn, structuresOf, tunnelShade } from '../src/rules/track.ts';
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

test('a crash wreck slides, rolls over only at speed, and comes to rest flat between the rails', () => {
  const seq = (...v: number[]) => () => v.length > 1 ? v.shift()! : v[0];
  for (const [speed, rolls] of [[15, false], [60, true]] as const) {
    for (const side of [0.2, 0.8]) {
      const w = startWreck(LANES[3], 0, speed, 1.9, 1.3, seq(side, 0.5));
      let maxRoll = 0, t = 0;
      for (; t < 10; t += 1 / 120) {
        stepWreck(w, 1 / 120);
        maxRoll = Math.max(maxRoll, Math.abs(w.roll));
        assert.ok(Math.abs(w.x) < GUARDRAIL_X, `through the rail at ${speed} m/s`);
        assert.ok(w.y >= groundLift(w.w, w.h, w.roll) - 1e-9, 'sank into the road');
        if (Math.hypot(w.vx, w.vs) < 0.01 && Math.abs(w.rollRate) < 0.01 && w.vy === 0) break;
      }
      assert.ok(t < 10, `still moving after 10 s at ${speed} m/s`);
      assert.equal(maxRoll > Math.PI / 2, rolls, `rollover at ${speed} m/s`);
      assert.ok(Math.abs(Math.sin(w.roll)) < 0.02, 'rests on its wheels or roof, not balanced on a side');
      assert.ok(w.s > 0, 'slides on down the road');
    }
  }
});

test('a crash grows with speed: further slide, more spin, more rolling', () => {
  const run = (speed: number) => {
    const w = startWreck(0, 0, speed, 1.9, 1.3, () => 0.7);
    let rolled = 0, spun = 0, top = 0;
    for (let t = 0; t < 12; t += 1 / 120) {
      stepWreck(w, 1 / 120);
      rolled += Math.abs(w.rollRate) / 120;
      spun += Math.abs(w.yawRate) / 120;
      top = Math.max(top, w.y);
    }
    return { slid: w.s, rolled, spun, top };
  };
  const runs = [10, 30, 50, 70].map(run);
  for (let i = 1; i < runs.length; i++) {
    for (const key of ['slid', 'spun'] as const) assert.ok(runs[i][key] > runs[i - 1][key], `${key} at run ${i}`);
    for (const key of ['rolled', 'top'] as const) assert.ok(runs[i][key] >= runs[i - 1][key], `${key} at run ${i}`);
  }
  assert.equal(runs[0].rolled, 0, 'a slow crash does not tip the car');
  assert.ok(runs[3].rolled > runs[2].rolled && runs[3].rolled > 2 * Math.PI, 'a fast one rolls it over, more than once');
  assert.equal(crashSeverity(0), 0);
  assert.equal(crashSeverity(1000), 2);
});

test('a wreck and a car it touches shunt: shared speed, pushed apart, never through each other', () => {
  const wreck = { d: 102, speed: 20, l: 4.5 }, car = { d: 104, speed: 10, l: 4.5 }; // overlapping, wreck closing in
  shunt(wreck, car);
  assert.equal(wreck.speed, 15);
  assert.equal(car.speed, 15);
  assert.ok(car.d - wreck.d >= 4.5, 'still inside the car');
  const ahead = { d: 200, speed: 0, l: 4.5 }, follower = { d: 197, speed: 25, l: 12 }; // a truck runs into a stopped wreck
  shunt(ahead, follower);
  assert.ok(ahead.speed > 0 && ahead.speed === follower.speed, 'the wreck is shoved on');
  assert.ok(ahead.d - follower.d >= (4.5 + 12) / 2);
  const away = { d: 0, speed: 5, l: 4.5 }, leader = { d: 3, speed: 30, l: 4.5 }; // pulling away: left alone
  shunt(away, leader);
  assert.deepEqual([away.speed, leader.speed, away.d], [5, 30, 0]);
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

// ---- the road's shape ----

test('the road is one smooth curve: each meter of road is a meter long and turns by its curvature', () => {
  let last = frameAt(0);
  for (let d = 1; d < 60000; d += 1) {
    const f = frameAt(d);
    const step = Math.hypot(f.x - last.x, f.z - last.z);
    assert.ok(Math.abs(step - 1) < 1e-3, `a meter of road is ${step} m long at ${d}`);
    assert.ok(Math.abs(f.heading - last.heading - (f.curvature + last.curvature) / 2) < 1e-6, `heading jumps at ${d}`);
    assert.ok(Math.abs(f.curvature - last.curvature) < 1 / 300 / 100, `curvature jumps at ${d}`);
    last = f;
  }
  assert.equal(frameAt(TRACK.straightStart - 1).curvature, 0, 'the start is straight');
  assert.deepEqual(frameAt(-50), { x: 0, z: 50, heading: 0, curvature: 0 });
});

test('bends are never tighter than their landscape allows, and some landscapes bend more', () => {
  const tightest = new Map<string, number>();
  for (let d = 0; d < THEMES.length * ZONE_LENGTH * 3; d += 25) {
    const k = Math.abs(curvatureAt(d));
    if (!k) continue;
    const theme = THEMES[themeIndexAt(Math.floor(d / TRACK.piece) * TRACK.piece + TRACK.piece / 2, THEMES.length)];
    assert.ok(1 / k >= theme.curves.minRadius - 1e-6, `radius ${Math.round(1 / k)} m in ${theme.id}`);
    tightest.set(theme.id, Math.min(tightest.get(theme.id) ?? Infinity, 1 / k));
  }
  assert.ok(tightest.get('mountains')! < tightest.get('candy')!);
});

test('the inside of a bend is squeezed far out, never folded', () => {
  const k = 1 / 500;
  let last = 0;
  for (let x = 0; x < 3000; x += 5) {
    const l = lateral(x, k);
    assert.ok(l >= last && l < 500, `folds at ${x}`);
    last = l;
  }
  assert.equal(lateral(12, k), 12, 'exact next to the road');
  assert.equal(lateral(-800, k), -800, 'the outside is never squeezed');
});

test('in a bend, a car going straight drifts to the outside; steering holds the lane only within grip', () => {
  const k = 1 / 600;
  let s = at(30);
  for (let t = 0; t < 3; t += 1 / 60) s = stepVehicle(s, { steer: 0, throttle: 0, brake: 0 }, 1 / 60, CAR, k).state;
  assert.ok(s.x < -1, 'bending right, the car runs wide to the left');
  // a simple driver steering to hold x = 0
  const hold = (speed: number) => {
    let s = at(speed), worst = 0;
    for (let t = 0; t < 8; t += 1 / 60) {
      const steer = Math.max(-1, Math.min(1, -s.x * 0.4 - s.heading * 6));
      s = { ...stepVehicle(s, { steer, throttle: 0, brake: 0 }, 1 / 60, CAR, k).state, speed };
      worst = Math.max(worst, Math.abs(s.x));
    }
    return worst;
  };
  assert.ok(hold(Math.sqrt(CAR.grip * 600) * 0.8) < 3, 'below the grip limit the lane can be held');
  assert.ok(hold(Math.sqrt(CAR.grip * 600) * 1.2) > 5, 'past it the car is pushed out of the bend');
});

test('tunnels and bridges fit inside their zone, apart from each other, as their landscape asks', () => {
  const kinds = new Map<string, number>();
  for (let z = 0; z < THEMES.length * 6; z++) {
    const list = structuresOf(z), theme = THEMES[themeIndexAt(z * ZONE_LENGTH, THEMES.length)];
    for (const [i, s] of list.entries()) {
      assert.ok(s.from >= z * ZONE_LENGTH + ROADSIDE.zoneMargin && s.to <= (z + 1) * ZONE_LENGTH - ROADSIDE.zoneMargin);
      if (i) assert.ok(s.from - list[i - 1].to >= ROADSIDE.structureGap);
      if (s.kind === 'tunnel') assert.ok(theme.structures.tunnels > 0);
      if (s.kind === 'lake') assert.ok(theme.structures.lake);
      kinds.set(`${theme.id}:${s.kind}`, (kinds.get(`${theme.id}:${s.kind}`) ?? 0) + 1);
    }
  }
  assert.ok((kinds.get('mountains:tunnel') ?? 0) >= 6, 'the mountains have tunnels');
  assert.equal(kinds.get('lake:lake'), 6, 'every lakeside zone crosses its lake');
  assert.deepEqual(structuresOf(3), structuresOf(3), 'the same road for everyone');
});

test('the land hugs the road: level at the verge, over the vault of tunnels, below the decks of bridges', () => {
  for (let z = 0; z < 16; z++) {
    for (const s of structuresOf(z)) {
      const mid = (s.from + s.to) / 2;
      for (const x of [-ROADSIDE.corridor, ROADSIDE.corridor]) {
        if (s.kind === 'tunnel') assert.ok(terrainHeight(mid, x) > ROADSIDE.tunnelHeight + 2, 'the hill covers the tunnel');
        else assert.ok(terrainHeight(mid, x) < -2, 'the valley drops away under the bridge');
      }
      if (s.water) assert.ok(floorHeight(mid) < waterAt(mid)!, 'water fills the bottom');
    }
  }
  // no cliffs: the land never jumps between two samples a few meters apart
  for (let d = 0; d < 6 * ZONE_LENGTH; d += 4) {
    for (const [x, max] of [[ROADSIDE.corridor, 6], [40, 6], [200, 6], [900, 12]]) {
      const dh = Math.abs(terrainHeight(d + 4, x) - terrainHeight(d, x));
      assert.ok(dh < max, `cliff of ${dh.toFixed(1)} m at ${d}, ${x}`);
    }
  }
});

test('a tunnel dims the daylight gradually at each portal', () => {
  const t = structuresOf(0).concat(...Array.from({ length: 40 }, (_, z) => structuresOf(z))).find((s) => s.kind === 'tunnel')!;
  assert.equal(tunnelShade(t.from - 1), 0);
  assert.equal(tunnelShade((t.from + t.to) / 2), 1);
  assert.ok(tunnelShade(t.from + ROADSIDE.tunnelFade / 2) > 0.4 && tunnelShade(t.from + ROADSIDE.tunnelFade / 2) < 0.6);
});

test('every seed draws its own map, and the same seed always the same one', () => {
  const map = (seed: number) => {
    setSeed(seed);
    const bends = Array.from({ length: 40 }, (_, i) => curvatureAt(i * 250).toFixed(6)).join();
    return { bends, land: terrainHeight(3000, 120).toFixed(3), structures: JSON.stringify(Array.from({ length: 8 }, (_, z) => structuresOf(z))), first: themeIndexAt(0, THEMES.length) };
  };
  const a = map(12345), b = map(987654), again = map(12345);
  assert.deepEqual(again, a, 'same seed, same map');
  assert.notEqual(a.bends, b.bends);
  assert.notEqual(a.land, b.land);
  assert.notEqual(a.structures, b.structures);
  assert.equal(curvatureAt(TRACK.straightStart - 1), 0, 'the start is always straight');
  const firsts = new Set(Array.from({ length: 40 }, (_, s) => map(s * 7919).first));
  assert.ok(firsts.size > 4, 'the start line lands in different regions');
  setSeed(0);
});

// ---- impacts ----

const carAt = (x: number, z: number, vx: number, vz: number, w = 1.9, l = 4.6): Moving => ({ rect: { x, z, w, l, heading: 0 }, vx, vz, mass: massOf(w, l) });

test('a side swipe shoves and scrapes but does not wreck', () => {
  // two cars side by side at 130 km/h, one drifting into the other at 2 m/s
  const v = -130 / 3.6, hit = impact(carAt(0, 0, 2, v), carAt(1.85, 0, 0, v))!;
  assert.ok(hit, 'they touch');
  assert.ok(Math.abs(hit.normal[0]) > 0.99, 'pushed sideways, not along the road');
  assert.ok(hit.dva[0] < 0, 'pushed back away from the other car');
  assert.equal(hit.wreck, false);
  assert.ok(hit.damage < 2, `a light swipe barely marks the car (${hit.damage.toFixed(1)} %)`);
  const firm = impact(carAt(0, 0, 6, v), carAt(1.85, 0, 0, v))!;
  assert.ok(!firm.wreck && firm.damage > hit.damage, 'a firmer one damages more, still drivable');
});

test('running into the back of a car: damage grows with the closing speed, and a fast one wrecks', () => {
  const rearEnd = (kmh: number, w = 1.9, l = 4.6) => impact(carAt(0, 0, 0, -(100 + kmh) / 3.6), carAt(0, -(4.6 + l) / 2 + 0.05, 0, -100 / 3.6, w, l))!;
  const light = rearEnd(15), medium = rearEnd(35), hard = rearEnd(70);
  assert.ok(Math.abs(light.normal[1]) > 0.99, 'pushed back along the road');
  assert.ok(light.damage > 0 && !light.wreck);
  assert.ok(medium.damage > light.damage * 2 && !medium.wreck, `35 km/h faster: ${medium.damage.toFixed(0)} %`);
  assert.ok(hard.wreck, '70 km/h faster wrecks the car');
  assert.ok(rearEnd(35, 2.5, 16).damage > medium.damage, 'a lorry barely moves: you take more of the jolt');
});

test('an impact shares momentum: what one car gains the other loses', () => {
  const a = carAt(0, 0, 1, -40), b = carAt(1.5, -3, 0, -30, 2.5, 12), hit = impact(a, b)!;
  assert.ok(Math.abs(a.mass * hit.dva[0] + b.mass * hit.dvb[0]) < 1e-6);
  assert.ok(Math.abs(a.mass * hit.dva[1] + b.mass * hit.dvb[1]) < 1e-6);
  assert.equal(impact(carAt(0, 0, 0, -30), carAt(0, -10, 0, -30)), null, 'apart: no impact');
  // pulling away from a car you touch: no impulse
  const parting = impact(carAt(0, 0, -2, -30), carAt(1.85, 0, 0, -30))!;
  assert.equal(parting.damage, 0);
  assert.equal(Math.hypot(...parting.dva), 0);
});

test('hit off-centre, a car spins: a knock on the rear swings the tail away', () => {
  // the other car pushes into my rear right corner from the right
  const hit = impact(carAt(0, 0, 0, -30), { ...carAt(1.8, 3, -3, -30) })!;
  assert.ok(hit.dva[0] < 0, 'pushed left');
  assert.ok(hit.spin > 0, 'tail pushed left, nose turns right');
});

test('rails: grazing is harmless, a steep fast hit wrecks', () => {
  const at = (kmh: number, deg: number) => railImpact((kmh / 3.6) * Math.sin((deg * Math.PI) / 180));
  assert.equal(at(250, 0.5).damage, 0, 'running along the rail');
  assert.ok(at(200, 4).damage > 0 && !at(200, 4).wreck, 'clipping it at an angle damages the car');
  assert.ok(at(200, 15).wreck, 'hitting it at 15° at 200 km/h wrecks it');
  assert.ok(at(200, 15).damage > at(100, 15).damage);
});

test('damage takes power and pulls the car once it is bad; one more big knock and it is wrecked', () => {
  assert.deepEqual(damageEffects(30), { power: 1, pull: 0, smoke: false });
  assert.equal(damageEffects(IMPACT.smokeAt).smoke, true);
  assert.ok(damageEffects(90).power < 1 && damageEffects(90).pull > 0);
  assert.ok(Math.abs(damageEffects(100).power - IMPACT.limpPower) < 1e-9);
  assert.ok(joltDamage(IMPACT.wreckKmh - 0.1) < 100 && joltDamage(IMPACT.wreckKmh) === 100);
  let total = 0, hits = 0;
  while (total < 100) {
    total += joltDamage(22);
    hits++;
  }
  assert.ok(hits >= 2 && hits <= 6, `${hits} medium knocks wreck a car`);
});

test('every player of a full room gets their own place on the grid, behind the line and clear of the storm', () => {
  const LONGEST = 5.5; // m: longer than any garage car (the Veneno is 5.02 m)
  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => gridSlot(i));
  assert.equal(new Set(slots.map((s) => `${s.d}:${s.x}`)).size, MAX_PLAYERS, 'no two players share a slot');
  for (const s of slots) {
    assert.ok(LANES.includes(s.x), 'each car stands in the middle of a lane');
    assert.ok(s.d + LONGEST / 2 < START.line, 'every nose is behind the start line');
    assert.ok(s.d - WALL.startD > 100, 'the back row starts well ahead of the storm');
  }
  // cars one behind the other in a lane have room between them
  for (const a of slots) for (const b of slots) if (a !== b && a.x === b.x) assert.ok(Math.abs(a.d - b.d) >= LONGEST + 3);
  assert.equal(Math.max(...slots.map((s) => s.d)), 0, 'the front row is at d = 0');
});

test('road events: the same for every player, never in the way of the start, a tunnel or a bridge, never closing every lane', () => {
  setSeed(4242);
  const all = eventsIn(0, 200000);
  assert.deepEqual(eventsIn(0, 200000), all, 'the same map gives the same events');
  const kinds = new Set(all.map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), ['accident', 'load', 'works'], 'all three kinds happen');
  for (const [i, e] of all.entries()) {
    assert.ok(e.from >= EVENTS.firstAt, 'nothing near the start');
    assert.ok(e.lanes.length >= 1 && e.lanes.length < LANES.length - 1, 'at least two lanes stay open');
    assert.equal(structuresIn(e.from - EVENTS.signsAhead[0] - 20, e.to + 20).length, 0, 'no event in a tunnel or on a bridge');
    if (i) assert.ok(e.from - EVENTS.signsAhead[0] > all[i - 1].to, 'events never overlap');
    for (const t of e.things) assert.ok(Math.abs(t.x) < GUARDRAIL_X, 'everything stands between the rails');
    // what blocks a lane stands in it, inside the event (signs and the triangle come before it)
    for (const t of e.things.filter((t) => !['sign', 'triangle', 'truck'].includes(t.kind))) {
      assert.ok(t.d >= e.from - 1 && t.d <= e.to + 1, `${t.kind} inside its event`);
    }
  }
  // traffic sees exactly the closed lanes, and only there
  const works = all.find((e) => e.kind === 'works')!, mid = (works.from + works.to) / 2;
  assert.deepEqual(blocksIn(mid, mid).map((b) => b.lane).sort(), [...works.lanes].sort());
  // the cones line the closure: the open lanes beside it are free of them
  const open = LANES.filter((_, i) => !works.lanes.includes(i));
  for (const c of works.things.filter((t) => t.kind === 'cone')) for (const x of open) assert.ok(Math.abs(c.x - x) > LANE_WIDTH / 2 - 0.1);
  // two closed lanes shut one after the other along the taper: the inner one stays open (no cone in it) until its block starts
  for (const e of all.filter((e) => e.kind === 'works' && e.lanes.length === 2)) {
    const [outer, inner] = blocksIn(e.from, e.from);
    assert.equal(outer.from, e.from);
    assert.equal(inner.from, e.from + EVENTS.taper / 2);
    for (const c of e.things.filter((t) => t.kind === 'cone' && t.d < inner.from)) assert.ok(Math.abs(c.x - LANES[inner.lane]) > LANE_WIDTH / 2 - 0.3);
  }
  // site machines stand inside the closed lanes, past the taper, clear of the open lanes
  for (const e of all.filter((e) => e.kind === 'works')) {
    const machines = e.things.filter((t) => ['digger', 'roller', 'dumper'].includes(t.kind));
    assert.ok(machines.length >= EVENTS.machines[0] && machines.length <= EVENTS.machines[1]);
    for (const m of machines) {
      assert.ok(e.lanes.some((l) => Math.abs(LANES[l] - m.x) < 0.01), 'in a closed lane');
      assert.ok(m.d > e.from + EVENTS.taper && m.d + m.l / 2 < e.to, 'behind the cones, inside the site');
      assert.ok(m.w / 2 + 0.3 < LANE_WIDTH / 2 + 0.2, 'not wider than its lane');
    }
  }
});

test('the mirror warns of a vehicle closing in behind in my path, the nearer the brighter, and of police on my tail', () => {
  const me = { d: 1000, x: 0, speed: 30, w: 1.9, l: 4.5 };
  const car = (behind: number, x: number, speed: number, police = false) => ({ d: me.d - 4.5 - behind, x, speed, w: 1.9, l: 4.5, police });
  assert.deepEqual(mirrorWarning(me, []), { danger: 0, police: false });
  const near = mirrorWarning(me, [car(5, 0, 40)]).danger, far = mirrorWarning(me, [car(30, 0, 40)]).danger;
  assert.ok(near > far && far > 0, 'nearer is brighter');
  assert.equal(mirrorWarning(me, [car(MIRROR.warnGap + 5, 0, 40)]).danger, 0, 'too far to matter');
  assert.equal(mirrorWarning(me, [car(5, 3.6, 40)]).danger, 0, 'in the next lane: it will pass');
  assert.equal(mirrorWarning(me, [car(5, 0, 25)]).danger, 0, 'slower than me: falling back');
  assert.equal(mirrorWarning(me, [{ ...car(5, 0, 40), d: me.d + 20 }]).danger, 0, 'ahead is not in the mirror');
  assert.ok(mirrorWarning(me, [car(100, 3.6, 50, true)]).police, 'a police car behind, any lane');
  assert.ok(!mirrorWarning(me, [car(MIRROR.policeRange + 10, 0, 50, true)]).police);
});
