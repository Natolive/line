import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSnapshot, decodeState, decodeTraffic, encodeState, encodeTraffic, packSnapshot, stampTraffic, stateTime, trafficTime } from '../src/net/codec.ts';
import { addReport, due, present, pushSample, sampleAt, track, type Sample } from '../src/net/interp.ts';
import type { CarState, TrafficCar } from '../src/net/protocol.ts';

const car: CarState = { d: 12345.678, x: -3.61, heading: 0.1234, speed: 83.27, steer: -0.21, brake: true, score: 987654 };
const close = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('a car survives the binary round trip at game precision, in 19 bytes', () => {
  const buf = encodeState(car), back = decodeState(buf);
  assert.equal(buf.byteLength, 19);
  close(back.d, car.d, 0.002);
  close(back.x, car.x, 0.005);
  close(back.heading, car.heading, 0.0001);
  close(back.speed, car.speed, 0.005);
  close(back.steer, car.steer, 0.003);
  assert.equal(back.brake, true);
  assert.equal(back.score, car.score);
  assert.ok(buf.byteLength * 8 < JSON.stringify(car).length * 8 / 5, 'at least 5x smaller than JSON');
});

test('a snapshot carries every player, the server time and how old each car is', () => {
  const cars = [{ slot: 0, at: 1220, raw: encodeState(car) }, { slot: 7, at: 1234.5, raw: encodeState({ ...car, x: 1.8, brake: false }) }];
  const snap = decodeSnapshot(packSnapshot(1234.5, cars));
  assert.equal(snap.time, 1234.5);
  assert.deepEqual(snap.cars.map((c) => c.slot), [0, 7]);
  assert.deepEqual(snap.cars.map((c) => c.age), [15, 0]);
  assert.equal(snap.cars[1].state.brake, false);
  close(snap.cars[1].state.x, 1.8, 0.005);
});

test('traffic round trip keeps flags, and the server can stamp its time', () => {
  const cars: TrafficCar[] = [{ id: 65535, model: 9, heavy: true, d: 500.5, x: 5.4, speed: 23.6, brake: true, blink: -1, yaw: -0.05 }];
  const back = decodeTraffic(stampTraffic(encodeTraffic(cars), 999)).cars[0];
  assert.equal(decodeTraffic(stampTraffic(encodeTraffic(cars), 999)).time, 999);
  assert.deepEqual({ ...back, d: Math.round(back.d * 10) / 10, yaw: Math.round(back.yaw * 100) / 100 }, { ...cars[0], d: 500.5 });
});

test('between reports the car follows them; past the newest it is predicted, but not forever', () => {
  const s: Sample[] = [];
  pushSample(s, { t: 0, d: 0, x: 0, heading: 0, speed: 20, steer: 0 });
  pushSample(s, { t: 100, d: 2, x: 1, heading: 0, speed: 20, steer: 0 });
  pushSample(s, { t: 50, d: 99, x: 99, heading: 0, speed: 0, steer: 0 }); // late packet: ignored
  close(sampleAt(s, 50)!.d, 1, 1e-9);
  close(sampleAt(s, 50)!.x, 0.5, 1e-9);
  close(sampleAt(s, 200)!.d, 4, 1e-9); // 100 ms past the last report at 20 m/s
  close(sampleAt(s, 10_000)!.d, 2 + 20 * 1, 1e-9); // a silent player stops moving after 1 s
});

test('prediction follows how far reports really advance, not the reported speed (laggy sender)', () => {
  const s: Sample[] = [];
  for (let t = 0; t <= 200; t += 66) pushSample(s, { t, d: t * 0.015, x: 0, heading: 0, speed: 20, steer: 0 }); // 15 m/s on the road, 20 on the dial
  const last = s[s.length - 1];
  close(sampleAt(s, last.t + 100)!.d, last.d + 1.5, 1e-9);
});

test('a report is timed when its sender simulated it, but the server never trusts a stamp beyond 200 ms or from the future', () => {
  close(stateTime(encodeState(car, 70_000 - 30), 70_000), 70_000 - 30, 1e-9); // 16-bit stamp wraps at 65536 ms
  close(stateTime(encodeState(car, 65_530), 65_545), 65_530, 1e-9); // across the wrap
  assert.equal(stateTime(encodeState(car, 0), 70_000), 70_000 - 200);
  assert.equal(stateTime(encodeState(car, 70_050), 70_000), 70_000);
  assert.equal(trafficTime(encodeTraffic([], 990), 1000), 990);
  assert.equal(trafficTime(encodeTraffic([], 5000), 1000), 1000);
  assert.equal(trafficTime(encodeTraffic([], 0), 1000), 1000);
});

test('interpolation curves through reports without a kink, and stays exact on steady motion', () => {
  const steady: Sample[] = [];
  for (let t = 0; t <= 99; t += 33) pushSample(steady, { t, d: t * 0.03, x: 0, heading: 0, speed: 30, steer: 0 });
  close(sampleAt(steady, 50)!.d, 1.5, 1e-9);
  // accelerating: the curve's slope at a report is the same coming in and going out
  const acc: Sample[] = [];
  for (let t = 0; t <= 132; t += 33) pushSample(acc, { t, d: (t / 100) ** 2 * 10, x: 0, heading: 0, speed: 0, steer: 0 });
  const rate = (t: number) => (sampleAt(acc, t + 0.01)!.d - sampleAt(acc, t - 0.01)!.d) / 0.02;
  close(rate(66 - 0.05), rate(66 + 0.05), 0.0005); // a straight-line lerp jumps by ~0.006 here
});

/** Reports of a car with constant acceleration `a` (m/s²) and yaw rate `w` (rad/s), every 33 ms up to `until`. */
function drive(a: number, w: number, until: number, v0 = 30, h0 = 0) {
  const out: Sample[] = [];
  let d = 0, x = 0, v = v0, h = h0;
  for (let t = 0; t <= until; t += 1) { // 1 ms steps: the "truth"
    if (t % 33 === 0) out.push({ t, d, x, heading: h, speed: v, steer: 0 });
    d += v / 1000; x += v * Math.sin(h) / 1000; v = Math.max(0, v + a / 1000); h += w / 1000;
  }
  return out;
}
const truthAt = (a: number, w: number, t: number) => drive(a, w, t + 1).find((s) => s.t === t)!;

test('prediction 100 ms ahead lands within a few cm of the real car: braking, accelerating, changing lanes', () => {
  for (const [a, w] of [[0, 0], [-9, 0], [4, 0], [0, 0.3], [-6, -0.3]]) {
    const s: Sample[] = [];
    for (const r of drive(a, w, 198)) pushSample(s, r);
    const p = sampleAt(s, 198 + 99)!, real = truthAt(a, w, 297);
    close(p.d, real.d, 0.03);
    close(p.x, real.x, 0.03);
    close(p.speed, real.speed, 0.05);
  }
});

test('a braking car is predicted to stop, never to reverse', () => {
  const s: Sample[] = [];
  for (const r of drive(-9, 0, 99, 1)) pushSample(s, r); // 1 m/s, braking hard
  const stop = sampleAt(s, 99 + 200)!;
  assert.equal(stop.speed, 0);
  assert.equal(sampleAt(s, 99 + 900)!.d, stop.d);
  assert.ok(stop.d <= s[s.length - 1].d + (1 * 1) / (2 * 9) + 1e-9);
});

test('braking and steering are extrapolated a quarter second, then the car goes straight on: no runaway guess', () => {
  const s: Sample[] = [];
  for (const r of drive(-6, 0.3, 99)) pushSample(s, r);
  const a = sampleAt(s, 99 + 250)!, b = sampleAt(s, 99 + 900)!;
  close(b.speed, a.speed, 1e-9);
  close(b.heading, a.heading, 1e-9);
  close(b.d - a.d, a.speed * 0.65, 0.01);
});

test('a report that disagrees never makes the car jump: the correction fades out', () => {
  const tr = track(), dt = 1 / 60;
  addReport(tr, { t: 0, d: 0, x: 0, heading: 0, speed: 30, steer: 0 }, 0);
  addReport(tr, { t: 33, d: 0.99, x: 0, heading: 0, speed: 30, steer: 0 }, 33);
  let now = 80;
  const before = present(tr, now, 0)!;
  // a report that is 0.5 m behind what we predicted (the driver braked)
  const jump = addReport(tr, { t: 66, d: 1.48, x: 0.2, heading: 0, speed: 29, steer: 0 }, now);
  assert.ok(jump > 0.4, `the correction is measured (${jump})`);
  const after = present(tr, now, 0)!;
  close(after.d, before.d, 1e-9); // same frame: drawn exactly where it was
  close(after.x, before.x, 1e-9);
  for (let i = 0; i < 18; i++) present(tr, (now += 1000 * dt), dt); // 0.3 s
  assert.ok(Math.hypot(tr.err.d, tr.err.x) < 0.05 * jump, 'mostly gone in 0.3 s');
});

test('a teleport (crash, respawn) snaps instead of sliding across the road', () => {
  const tr = track();
  addReport(tr, { t: 0, d: 0, x: 0, heading: 0, speed: 30, steer: 0 }, 0);
  addReport(tr, { t: 33, d: 1, x: 0, heading: 0, speed: 30, steer: 0 }, 40);
  addReport(tr, { t: 66, d: 1, x: 7, heading: 0, speed: 0, steer: 0 }, 70);
  assert.deepEqual(tr.err, { d: 0, x: 0, heading: 0 });
});

test('sending at a fixed rate keeps an even rhythm through frame jitter, and the right average', () => {
  // a 60 Hz display with ±0.3 ms jitter, sending at 30 Hz: every second frame, never a 3-frame gap
  const timer = { t: 0 }, sentOn: number[] = [];
  for (let i = 0; i < 600; i++) if (due(timer, 1 / 60 + (i % 2 ? 0.0003 : -0.0003) * (i % 3 ? 1 : -1), 1 / 30)) sentOn.push(i);
  const steady = sentOn.slice(1); // the first frame is overdue: one early send, then the rhythm
  const gaps = new Set(steady.slice(1).map((f, i) => f - steady[i]));
  assert.deepEqual([...gaps], [2]);
  // 144 Hz sending at 60 Hz: 60 a second on average
  const fast = { t: 0 };
  let n = 0;
  for (let i = 0; i < 1440; i++) if (due(fast, 1 / 144, 1 / 60)) n++;
  close(n, 600, 2);
});
