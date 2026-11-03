import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSnapshot, decodeState, decodeTraffic, encodeState, encodeTraffic, packSnapshot, stampTraffic, stateTime, trafficTime } from '../src/net/codec.ts';
import { adaptDelay, INTERP_DELAY, pushSample, sampleAt, type Sample } from '../src/net/interp.ts';
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

test('interpolation draws between reports and extrapolates only a little', () => {
  const s: Sample[] = [];
  pushSample(s, { t: 0, d: 0, x: 0, heading: 0, speed: 20, steer: 0 });
  pushSample(s, { t: 100, d: 2, x: 1, heading: 0, speed: 20, steer: 0 });
  pushSample(s, { t: 50, d: 99, x: 99, heading: 0, speed: 0, steer: 0 }); // late packet: ignored
  close(sampleAt(s, 50)!.d, 1, 1e-9);
  close(sampleAt(s, 50)!.x, 0.5, 1e-9);
  close(sampleAt(s, 200)!.d, 4, 1e-9); // 100 ms past the last report at 20 m/s
  close(sampleAt(s, 10_000)!.d, 2 + 20 * 0.25, 1e-9); // a silent player stops moving after 250 ms
});

test('extrapolation follows how far reports really advance, not the reported speed (laggy sender)', () => {
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

test('the render delay grows with the lateness of reports, gently, and comes back down when the link calms', () => {
  let st = { delay: INTERP_DELAY, peak: 180 };
  st = adaptDelay(st.delay, st.peak, 1 / 60);
  close(st.delay, INTERP_DELAY + 1000 / 60 * 0.1, 1e-9); // 10% time warp at most: no visible jump
  for (let i = 0; i < 60 * 10; i++) st = adaptDelay(st.delay, Math.max(st.peak, 180), 1 / 60);
  close(st.delay, 200, 1e-6); // worst lateness + margin
  for (let i = 0; i < 60 * 30; i++) st = adaptDelay(st.delay, st.peak, 1 / 60);
  assert.equal(st.delay, INTERP_DELAY, 'never below the floor');
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
