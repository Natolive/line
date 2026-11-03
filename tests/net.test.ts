import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSnapshot, decodeState, decodeTraffic, encodeSnapshot, encodeState, encodeTraffic, stampTraffic } from '../src/net/codec.ts';
import { pushSample, sampleAt, type Sample } from '../src/net/interp.ts';
import type { CarState, TrafficCar } from '../src/net/protocol.ts';

const car: CarState = { d: 12345.678, x: -3.61, heading: 0.1234, speed: 83.27, steer: -0.21, brake: true, score: 987654 };
const close = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('a car survives the binary round trip at game precision, in 17 bytes', () => {
  const buf = encodeState(car), back = decodeState(buf);
  assert.equal(buf.byteLength, 17);
  close(back.d, car.d, 0.002);
  close(back.x, car.x, 0.005);
  close(back.heading, car.heading, 0.0001);
  close(back.speed, car.speed, 0.005);
  close(back.steer, car.steer, 0.003);
  assert.equal(back.brake, true);
  assert.equal(back.score, car.score);
  assert.ok(buf.byteLength * 8 < JSON.stringify(car).length * 8 / 5, 'at least 5x smaller than JSON');
});

test('a snapshot carries every player and the server time', () => {
  const snap = decodeSnapshot(encodeSnapshot(1234.5, [{ slot: 0, state: car }, { slot: 7, state: { ...car, x: 1.8, brake: false } }]));
  assert.equal(snap.time, 1234.5);
  assert.deepEqual(snap.cars.map((c) => c.slot), [0, 7]);
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
