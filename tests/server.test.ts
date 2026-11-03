import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '../src/net/protocol.ts';
import { decodeSnapshot, encodeState } from '../src/net/codec.ts';
import { Room } from '../server/rooms.ts';

/** A room with `n` players whose messages are recorded. */
function room(n: number) {
  const r = new Room('ABCD'), inbox: Record<string, (ServerMessage | Uint8Array)[]> = {};
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    inbox[id] = [];
    assert.equal(r.join({ id, name: id, car: 'car-bmw' }, (m) => inbox[id].push(m)), null);
  }
  const json = (id: string) => inbox[id].filter((m): m is ServerMessage => !(m instanceof Uint8Array));
  return { r, inbox, last: (id: string, t: string) => json(id).filter((m) => m.t === t).at(-1) };
}

test('the first player hosts; when the host leaves, the next one takes over', () => {
  const { r } = room(3);
  assert.equal(r.host, 'p0');
  r.leave('p0');
  assert.equal(r.host, 'p1');
});

test('only the host can start, and nobody can join a running race', () => {
  const { r } = room(2);
  r.start('p1');
  assert.equal(r.racing, false);
  r.start('p0');
  assert.equal(r.racing, true);
  assert.notEqual(r.join({ id: 'late', name: 'late', car: 'car-bmw' }, () => {}), null);
});

test('last driver standing wins; ranking goes from winner to first out', () => {
  const { r, last } = room(3);
  r.start('p0');
  r.eliminate('p1', 'wall');
  assert.equal(r.racing, true);
  r.eliminate('p1', 'crash'); // reported twice: counted once
  r.leave('p2'); // leaving mid-race counts as out
  const w = last('p0', 'winner');
  assert.deepEqual(w, { t: 'winner', id: 'p0', ranking: ['p0', 'p2', 'p1'] });
  assert.equal(r.racing, false);
});

test('a solo room ends when its only driver is out', () => {
  const { r, last } = room(1);
  r.start('p0');
  r.eliminate('p0', 'crash');
  assert.deepEqual(last('p0', 'winner'), { t: 'winner', id: 'p0', ranking: ['p0'] });
});

test('each tick sends one snapshot with every racing car, by grid slot', () => {
  const { r, inbox } = room(3);
  r.start('p0');
  const grid = (inbox.p0.find((m) => !(m instanceof Uint8Array) && m.t === 'go') as { grid: string[] }).grid;
  r.setState('p1', encodeState({ d: 42, x: 1.8, heading: 0, speed: 30, steer: 0, brake: false, score: 7 }));
  r.setState('p2', encodeState({ d: 40, x: -1.8, heading: 0, speed: 31, steer: 0, brake: true, score: 9 }));
  r.tick(5000);
  const snaps = inbox.p0.filter((m): m is Uint8Array => m instanceof Uint8Array);
  assert.equal(snaps.length, 1, 'one message per tick, not one per player');
  const snap = decodeSnapshot(snaps[0]);
  assert.equal(snap.time, 5000);
  const p1 = snap.cars.find((c) => c.slot === grid.indexOf('p1'))!;
  assert.equal(p1.state.d, 42);
  assert.equal(p1.state.score, 7);
});
