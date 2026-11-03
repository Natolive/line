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

const at = (d: number) => encodeState({ d, x: 0, heading: 0, speed: 30, steer: 0, brake: false, score: 0 });

test('last driver standing wins; ranking goes from winner to first out, with how far each got and how they went out', () => {
  const { r, last } = room(3);
  r.start('p0');
  r.setState('p0', at(900), 0);
  r.setState('p1', at(400), 0);
  r.setState('p2', at(650), 0);
  r.eliminate('p1', 'wall');
  assert.equal(r.racing, true);
  r.eliminate('p1', 'crash'); // reported twice: counted once
  r.leave('p2'); // leaving mid-race counts as out
  const w = last('p0', 'winner');
  assert.deepEqual(w, { t: 'winner', id: 'p0', ranking: [
    { id: 'p0', name: 'p0', out: null, d: 900 },
    { id: 'p2', name: 'p2', out: 'left', d: 650 }, // still named, though gone
    { id: 'p1', name: 'p1', out: 'wall', d: 400 },
  ] });
  assert.equal(r.racing, false);
});

test('a solo room ends when its only driver is out', () => {
  const { r, last } = room(1);
  r.start('p0');
  r.eliminate('p0', 'crash');
  assert.deepEqual(last('p0', 'winner'), { t: 'winner', id: 'p0', ranking: [{ id: 'p0', name: 'p0', out: 'crash', d: 0 }] });
});

test('each tick sends one snapshot with every racing car, by grid slot', () => {
  const { r, inbox } = room(3);
  r.start('p0');
  const grid = (inbox.p0.find((m) => !(m instanceof Uint8Array) && m.t === 'go') as { grid: string[] }).grid;
  r.setState('p1', encodeState({ d: 42, x: 1.8, heading: 0, speed: 30, steer: 0, brake: false, score: 7 }), 4990);
  r.setState('p2', encodeState({ d: 40, x: -1.8, heading: 0, speed: 31, steer: 0, brake: true, score: 9 }), 4980);
  r.tick(5000);
  const snaps = inbox.p0.filter((m): m is Uint8Array => m instanceof Uint8Array);
  assert.equal(snaps.length, 1, 'one message per tick, not one per player');
  const snap = decodeSnapshot(snaps[0]);
  assert.equal(snap.time, 5000);
  const p1 = snap.cars.find((c) => c.slot === grid.indexOf('p1'))!;
  assert.equal(p1.state.d, 42);
  assert.equal(p1.state.score, 7);
  assert.equal(p1.age, 10, 'stamped with when the server got it, not the tick');
});

test('a car is sent once: a tick with no new report does not repeat it under a new time', () => {
  const { r, inbox } = room(2);
  r.start('p0');
  r.setState('p1', encodeState({ d: 42, x: 1.8, heading: 0, speed: 30, steer: 0, brake: false, score: 0 }), 4990);
  r.tick(5000);
  r.tick(5033); // p1's next report is late: nothing to send
  const snaps = inbox.p0.filter((m): m is Uint8Array => m instanceof Uint8Array);
  assert.equal(snaps.length, 1);
});

test('the host can give everyone the same car figures between races; every player, even a late one, is told', () => {
  const { r, last } = room(2);
  r.setSpec('p1', 'bmw'); // not the host
  assert.equal(r.spec, null);
  r.setSpec('p0', 'bmw');
  assert.deepEqual(last('p1', 'lobby'), { t: 'lobby', host: 'p0', players: r.players, spec: 'bmw' });
  const got: ServerMessage[] = [];
  r.join({ id: 'p9', name: 'p9', car: 'car-bmw' }, (m) => got.push(m as ServerMessage));
  assert.equal(got[0].t === 'joined' && got[0].spec, 'bmw');
  r.start('p0');
  r.setSpec('p0', null); // not during a race
  assert.equal(r.spec, 'bmw');
});
