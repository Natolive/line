import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RACE_GRACE_MS, type ServerMessage } from '../src/net/protocol.ts';
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
    { id: 'p0', name: 'p0', out: null, d: 900, time: null },
    { id: 'p2', name: 'p2', out: 'left', d: 650, time: null }, // still named, though gone
    { id: 'p1', name: 'p1', out: 'wall', d: 400, time: null },
  ] });
  assert.equal(r.racing, false);
});

test('a solo room ends when its only driver is out', () => {
  const { r, last } = room(1);
  r.start('p0');
  r.eliminate('p0', 'crash');
  assert.deepEqual(last('p0', 'winner'), { t: 'winner', id: 'p0', ranking: [{ id: 'p0', name: 'p0', out: 'crash', d: 0, time: null }] });
});

test('each tick sends one snapshot with every racing car, by grid slot', () => {
  const { r, inbox } = room(3);
  r.start('p0');
  const grid = (inbox.p0.find((m) => !(m instanceof Uint8Array) && m.t === 'go') as { grid: string[] }).grid;
  const seeds = ['p0', 'p1', 'p2'].map((p) => (inbox[p].find((m) => !(m instanceof Uint8Array) && m.t === 'go') as { seed: number }).seed);
  assert.ok(Number.isInteger(seeds[0]) && seeds.every((s) => s === seeds[0]), 'the whole room races on the same map');
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
  assert.deepEqual(last('p1', 'lobby'), { t: 'lobby', host: 'p0', players: r.players, spec: 'bmw', mode: null });
  const got: ServerMessage[] = [];
  r.join({ id: 'p9', name: 'p9', car: 'car-bmw' }, (m) => got.push(m as ServerMessage));
  assert.equal(got[0].t === 'joined' && got[0].spec, 'bmw');
  r.start('p0');
  r.setSpec('p0', null); // not during a race
  assert.equal(r.spec, 'bmw');
});

test('over UDP a late, older car report is dropped, by its own time stamp (even across the u16 wrap)', () => {
  const { r, inbox } = room(2);
  r.start('p0');
  const s = (d: number, stamp: number) => encodeState({ d, x: 0, heading: 0, speed: 30, steer: 0, brake: false, score: 0 }, stamp);
  r.setState('p1', s(20, 65_530), 4990);
  r.setState('p1', s(10, 65_500), 4995); // simulated earlier, arrived later
  r.setState('p1', s(20, 65_530), 4996); // the same report twice
  r.tick(5000);
  r.setState('p1', s(21, 10), 5010); // past the wrap: newer
  r.tick(5017);
  const ds = inbox.p0.filter((m): m is Uint8Array => m instanceof Uint8Array).map((b) => decodeSnapshot(b).cars[0].state.d);
  assert.deepEqual(ds, [20, 21]);
});

test('a race: first home wins, finishers by time, then the others by how far they got', () => {
  const { r, last } = room(4);
  r.setMode('p1', 5000); // not the host: ignored
  r.setMode('p0', 1234); // not a race length: ignored
  assert.equal(r.mode, null);
  r.setMode('p0', 5000);
  assert.deepEqual(last('p2', 'lobby'), { t: 'lobby', host: 'p0', players: r.players, spec: null, mode: 5000 });
  r.start('p0', 0); // green at 3000
  r.setState('p0', at(4990), 0);
  r.setState('p1', at(5001), 0);
  r.setState('p2', at(2000), 0);
  r.setState('p3', at(3000), 0);
  r.finish('p2', 90_000, 100_000); // nowhere near the line: not believed
  assert.equal(last('p0', 'finish'), undefined);
  r.finish('p1', 93_000, 93_100);
  r.finish('p0', 95_500, 95_600);
  r.finish('p0', 96_000, 96_000); // twice: counted once
  assert.deepEqual(last('p3', 'finish'), { t: 'finish', id: 'p0', place: 2, time: 92_500 });
  r.eliminate('p2', 'crash');
  assert.deepEqual(last('p2', 'out'), { t: 'out', id: 'p2', reason: 'crash', place: 4 }); // behind the two home and the one still racing
  assert.equal(r.racing, true); // p3 still racing
  r.tick(93_100 + RACE_GRACE_MS - 1);
  assert.equal(r.racing, true);
  r.tick(93_100 + RACE_GRACE_MS); // the race closes
  assert.deepEqual(last('p0', 'winner'), { t: 'winner', id: 'p1', ranking: [
    { id: 'p1', name: 'p1', out: null, d: 5000, time: 90_000 },
    { id: 'p0', name: 'p0', out: null, d: 5000, time: 92_500 },
    { id: 'p3', name: 'p3', out: 'late', d: 3000, time: null },
    { id: 'p2', name: 'p2', out: 'crash', d: 2000, time: null },
  ] });
});

test('a race goes on after the others are out, until the last driver gets home', () => {
  const { r, last } = room(2);
  r.setMode('p0', 5000);
  r.start('p0', 0);
  r.eliminate('p1', 'crash');
  assert.equal(r.racing, true); // a battle royale would be over: here p0 still has to finish
  r.setState('p0', at(5000), 0);
  r.finish('p0', 1000, 70_000); // a time before the green light is kept at the green light
  assert.equal((last('p0', 'winner') as { id: string }).id, 'p0');
  assert.equal((last('p0', 'finish') as { time: number }).time, 0);
});

test('a finisher keeps driving: their car is still sent to the others', () => {
  const { r, inbox } = room(2);
  r.setMode('p0', 5000);
  r.start('p0', 0);
  r.setState('p0', at(5000), 0);
  r.finish('p0', 50_000, 50_000);
  r.setState('p0', at(5100), 1);
  const before = inbox.p1.length;
  r.tick(2);
  assert.equal(inbox.p1.length, before + 1);
});
