// Events at fixed spots of the map: roadworks closing lanes behind cones, a lost load strewn across a lane,
// an accident blocking one or two lanes. A pure function of the road position and the map's seed (through
// hash()), so every player meets the same ones in the same place; unit-tested.
import { CARRIAGEWAY_HALF, EVENTS as E, LANES, LANE_WIDTH, SHOULDER } from '../core/config.ts';
import { hash, structuresIn } from './track.ts';

export type EventKind = 'works' | 'load' | 'accident';
export type ThingKind = keyof typeof E.things;
/** Something standing on the road: where (d along, x across, yaw turned), its footprint and mass. */
export type Thing = { id: string; kind: ThingKind; d: number; x: number; yaw: number; w: number; l: number; mass: number };
/** An event: the lanes it blocks from `from` to `to` (for traffic), and what stands there. */
export type RoadEvent = { id: number; kind: EventKind; from: number; to: number; lanes: number[]; things: Thing[] };

const KINDS: EventKind[] = ['works', 'load', 'accident'];
const MACHINES: ThingKind[] = ['digger', 'roller', 'dumper'];

/** The event at candidate spot `k` (every `EVENTS.every` m), if there is one. */
export function eventAt(k: number): RoadEvent | null {
  const r = (salt: number) => hash(k, 400 + salt);
  const from = k * E.every + r(1) * E.every * 0.3;
  if (from < E.firstAt || r(2) > E.chance) return null;
  const kind = KINDS[Math.floor(r(3) * KINDS.length)], things: Thing[] = [];
  const put = (t: ThingKind, d: number, x: number, yaw = 0) => things.push({ id: `${k}:${things.length}`, kind: t, d, x, yaw, ...E.things[t] });
  let lanes: number[], to: number;

  if (kind === 'works') {
    // one or two lanes on one side, closed off by a line of cones; the arrow trailer at its head
    const n = r(4) < 0.4 ? 2 : 1, side = r(5) < 0.7 ? 1 : -1;
    lanes = side > 0 ? [3, 2].slice(0, n) : [0, 1].slice(0, n);
    to = from + E.worksLength[0] + r(6) * (E.worksLength[1] - E.worksLength[0]);
    const edge = side * (CARRIAGEWAY_HALF - n * LANE_WIDTH), outer = side * CARRIAGEWAY_HALF;
    for (let d = from; d <= to; d += E.coneEvery) {
      const lead = Math.min(1, (d - from) / E.taper), tail = Math.min(1, (to - d) / (E.taper / 2)), k2 = Math.min(lead, tail);
      put('cone', d, outer + (edge - outer) * k2);
    }
    put('arrow', from + E.taper + 6, LANES[lanes[0]]);
    // the site itself: machines parked in the closed lanes, behind the cones
    const [lo, hi] = E.machines, count = lo + Math.floor(r(7) * (hi - lo + 1)), start = from + E.taper + 30, gap = (to - start - 20) / count;
    for (let i = 0; i < count; i++) put(MACHINES[Math.floor(r(8 + i) * MACHINES.length)], start + (i + 0.5) * gap, LANES[lanes[i % n]], (r(12 + i) - 0.5) * 0.3);
    for (const ahead of E.signsAhead) put('sign', from - ahead, side * SHOULDER.x);
  } else if (kind === 'load') {
    // a lorry stopped on the shoulder, its boxes and tyres spread over the lane beside it
    const lane = Math.floor(r(4) * LANES.length), side = lane < 2 ? -1 : 1;
    lanes = [lane];
    to = from + E.loadLength;
    put('truck', from - 15, side * SHOULDER.x);
    for (let i = 0; i < 8; i++) put(r(10 + i) < 0.55 ? 'box' : 'tyre', from + r(20 + i) * E.loadLength, LANES[lane] + (r(30 + i) - 0.5) * 2.4, r(40 + i) * Math.PI);
  } else {
    // two cars locked together across one lane (sometimes two), hazards on; a triangle further back
    const two = r(4) < 0.3, lane = Math.floor(r(5) * (two ? LANES.length - 1 : LANES.length));
    lanes = two ? [lane, lane + 1] : [lane];
    const x = two ? (LANES[lane] + LANES[lane + 1]) / 2 : LANES[lane];
    to = from + 18;
    const turn = two ? 1 : 0.3; // a single lane leaves them little room to lie across
    put('wreck', from + 4, x - 0.4 * turn, 0.5 * turn);
    put('wreck', from + 11, x + 0.5 * turn, -(0.9 + r(6)) * turn);
    put('triangle', from - E.trianglesAhead, LANES[lane]);
    for (const ahead of E.signsAhead) put('sign', from - ahead, (lane < 2 ? -1 : 1) * SHOULDER.x);
  }
  // keep tunnels and bridges clear: no room there for any of it
  if (structuresIn(from - E.signsAhead[0] - 20, to + 20).length) return null;
  return { id: k, kind, from, to, lanes, things };
}

/** Every event with something between road positions `d0` and `d1` (signs included). */
export function eventsIn(d0: number, d1: number) {
  const out: RoadEvent[] = [];
  const reach = E.signsAhead[0] + 10; // an event's signs stand this far before it
  for (let k = Math.floor(d0 / E.every) - 1; k * E.every <= d1 + reach; k++) {
    const e = eventAt(k);
    if (e && e.to >= d0 && e.from - reach <= d1) out.push(e);
  }
  return out;
}

/**
 * Each blocked lane between `d0` and `d1`, as a stopped obstacle traffic must queue behind or steer round.
 * Roadworks close their lanes one after the other along the cones' taper (outer lane first), so a driver
 * in the outer lane can still cross the inner one to get out.
 */
export function blocksIn(d0: number, d1: number) {
  return eventsIn(d0, d1).flatMap((e) =>
    e.lanes.map((lane, i) => ({ event: e.id, lane, from: e.kind === 'works' ? e.from + (E.taper * i) / e.lanes.length : e.from, to: e.to })),
  );
}
