// Traffic AI: keeps a safe distance, brakes (with brake lights), signals, then changes lanes.
// Positions are along the road (`d`, meters from the start), so the same traffic can be shared online:
// one game simulates it ('local': solo, or the room host) and the others mirror it ('remote').
import { CARRIAGEWAY_HALF, IMPACT, LANE_COUNT, LANE_WIDTH, LANES, NEAR_MISS, SHOULDER, TRAFFIC as T } from '../core/config.ts';
import { addReport, present, track, type Track } from '../net/interp.ts';
import type { TrafficCar } from '../net/protocol.ts';
import { rectsOverlap, type Rect } from '../rules/collision.ts';
import { densityAt, onShoulder } from '../rules/difficulty.ts';
import { massOf, type Moving } from '../rules/impact.ts';
import { curvatureAt } from '../rules/track.ts';
import type { TrackView } from './track.ts';
import type { Fleet } from './vehicles/fleet.ts';
import { setBlinker, setBrakeLights } from './vehicles/lights.ts';
import { spawn, spinWheels, type Prefab, type Vehicle } from './vehicles/prefab.ts';
import { Suspension } from './suspension.ts';

const kmh = (k: number) => k / 3.6;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** Meters to the next broken-down car on shoulder `side` (0 left, 1 right); a queue if someone is riding it. */
const nextGap = (side: number, ridden = false) => {
  const [lo, hi] = SHOULDER.queueGap;
  return ridden ? lo + Math.random() * (hi - lo) : SHOULDER.breakdownGap[side] * (0.5 + Math.random());
};

type Car = {
  id: number;
  model: number; // index into the fleet's traffic models, the same on every player's game
  v: Vehicle;
  lane: number;
  target: number;
  x: number;
  d: number;
  yaw: number; // rad from the road's direction, + = right (changing lanes)
  speed: number;
  knock: number; // m/s sideways from a knock, dying out
  shaken: number; // s left braking with hazards on after being hit
  desired: number;
  blink: number; // seconds of signalling left before moving over
  heavy: boolean;
  braking: boolean;
  passed: boolean; // near miss already judged against the local player
  suspension: Suspension;
  track: Track; // the host's reports, when mirroring
};

/** Broken down on the hard shoulder: moving traffic never goes there, so position alone says it (host and mirrors alike). */
const parked = (c: Car) => onShoulder(c.x);

/** A car traffic must respect: the local player or a rival. `rect` carries its size and heading. */
export type Driver = { d: number; x: number; speed: number; rect: Rect };

export class Traffic {
  remote = false; // true: mirror the host's traffic instead of simulating it
  netNow = 0; // server time (ms) now: mirrored traffic is drawn where it is at that time (predicted)
  private scene: TrackView['root'];
  private track: TrackView;
  private models: Prefab[];
  private heavyFrom: number;
  private cars: Car[] = [];
  private clock = 0;
  private nextId = 1;
  private nextBreakdown = [0, 0]; // road position of the next broken-down car, left and right shoulder
  private queued = [0, 0]; // cars already queued for whoever is riding that shoulder

  constructor(track: TrackView, fleet: Fleet) {
    this.track = track;
    this.scene = track.root;
    this.models = [...fleet.cars, ...fleet.heavy];
    this.heavyFrom = fleet.cars.length;
  }

  /** Clears the road and pre-fills it ahead of `me`. */
  reset(me: Driver) {
    for (const c of this.cars) this.scene.remove(c.v.mesh);
    this.cars = [];
    if (this.remote) return;
    this.nextBreakdown = [0, 1].map((side) => me.d + 150 + nextGap(side));
    this.queued = [0, 0];
    for (let d = me.d + 70; d < me.d - T.spawnAhead; d += 22 + Math.random() * 25) this.trySpawn(d, [me]);
  }

  /**
   * Advances traffic. `me` is the local player (rendering is relative to them), `others` the rivals still
   * racing. Returns how many near misses `me` just had.
   */
  update(dt: number, me: Driver, others: Driver[], km: number, meRacing = true) {
    this.clock += dt;
    const drivers = meRacing ? [me, ...others] : others;
    let nearMisses = 0;

    for (const c of this.cars) {
      const before = c.d - me.d;
      if (this.remote) this.mirror(c, dt);
      else if (!parked(c)) {
        this.drive(c, dt, drivers);
        c.d += c.speed * dt;
      }
      const after = c.d - me.d;
      // near miss: the car crossed the player's position, close but not touching
      if (meRacing && !c.passed && Math.sign(before) !== Math.sign(after)) {
        c.passed = true;
        const gap = Math.abs(c.x - me.x) - (c.v.w + me.rect.w) / 2;
        if (gap > 0 && gap < NEAR_MISS.gap && me.speed > NEAR_MISS.minSpeed) nearMisses++;
      }
      const lateral = LANES[c.target] - c.x;
      if (!this.remote) c.yaw = c.target !== c.lane && c.blink <= 0 ? Math.sign(lateral) * Math.atan(T.laneChangeSpeed / Math.max(c.speed, 1)) : 0;
      this.track.place(c.v.mesh, c.d, c.x, c.yaw);
      spinWheels(c.v, c.speed * dt);
      setBlinker(c.v, c.target === c.lane ? 0 : c.target > c.lane ? 1 : -1, this.clock % 0.8 < 0.4, parked(c) || c.shaken > 0);
    }
    if (this.remote) return nearMisses;

    // spawn and despawn around the whole pack, so every player has traffic
    const ds = drivers.length ? drivers.map((p) => p.d) : [me.d];
    const front = Math.max(...ds), back = Math.min(...ds);
    this.cars = this.cars.filter((c) => {
      if (c.d < front + -T.despawnAhead && c.d > back - T.despawnBehind) return true;
      this.scene.remove(c.v.mesh);
      return false;
    });
    const horizon = front - T.spawnAhead;
    for (const side of [0, 1]) {
      const sign = side ? 1 : -1, ridden = drivers.some((p) => onShoulder(p.x) && Math.sign(p.x) === sign);
      if (this.nextBreakdown[side] < front) this.nextBreakdown[side] = horizon; // e.g. just took over as host
      const queue = ridden && this.queued[side] < SHOULDER.queueMax;
      if (!ridden) this.queued[side] = 0;
      if (queue) this.nextBreakdown[side] = Math.min(this.nextBreakdown[side], horizon); // start the block now
      if (this.nextBreakdown[side] >= horizon) continue;
      this.add(Math.floor(Math.random() * this.heavyFrom), this.nextBreakdown[side], sign * SHOULDER.x, 0, false);
      if (queue) this.queued[side]++;
      this.nextBreakdown[side] += nextGap(side, queue && this.queued[side] < SHOULDER.queueMax);
    }
    const wanted = Math.min(70, densityAt(km) * (1 + (front - back) / 500));
    if (this.cars.filter((c) => !parked(c)).length < wanted) {
      const speed = drivers.reduce((s, p) => s + p.speed, 0) / Math.max(1, drivers.length);
      // faster than traffic: new cars appear ahead; slower: they come up from behind
      const ahead = Math.random() < Math.min(1, Math.max(0.15, (speed * 3.6 - 60) / 70));
      this.trySpawn(ahead ? front - T.spawnAhead : back - T.spawnBehind, drivers);
    }
    return nearMisses;
  }

  /** The traffic car `me` touches, if any. */
  hits(me: Driver) {
    return this.cars.find((c) => Math.abs(c.d - me.d) < 20 && rectsOverlap({ ...me.rect, z: 0 }, this.rectOf(c, me.d)));
  }

  /** Every traffic car `me` touches, as impacts see them (relative to `me`'s road position). Broken-down cars don't budge. */
  touching(me: Driver): { car: Car; moving: Moving }[] {
    return this.cars.filter((c) => Math.abs(c.d - me.d) < 20 && rectsOverlap({ ...me.rect, z: 0 }, this.rectOf(c, me.d))).map((c) => {
      const lateral = c.target !== c.lane && c.blink <= 0 ? Math.sign(LANES[c.target] - c.x) * T.laneChangeSpeed : 0;
      return { car: c, moving: { rect: this.rectOf(c, me.d), vx: lateral + c.knock, vz: -c.speed, mass: parked(c) ? 1e9 : massOf(c.v.w, c.v.l) } };
    });
  }

  /**
   * A traffic car knocked by the player: `dv` its change of velocity (x right, z back), pushed `push` meters
   * (x, z) out of the overlap. Its driver brakes, hazards on, and steers back into a lane. Only the game that
   * simulates the traffic moves it; mirrors get it from the host.
   */
  knock(c: Car, dv: [number, number], push: [number, number], jolt: number) {
    if (this.remote || parked(c)) return;
    c.speed = Math.max(0, c.speed - dv[1]);
    c.knock += dv[0];
    c.x += push[0];
    c.d -= push[1];
    if (jolt > IMPACT.scratchKmh) c.shaken = IMPACT.shakenTime;
  }

  /** What the host sends to the other players. */
  snapshot(): TrafficCar[] {
    return this.cars.map((c) => ({
      id: c.id, model: c.model, heavy: c.heavy, d: Math.round(c.d * 100) / 100, x: Math.round(c.x * 100) / 100,
      speed: Math.round(c.speed * 10) / 10, brake: c.braking, blink: c.target === c.lane ? 0 : c.target > c.lane ? 1 : -1, yaw: -c.yaw,
    }));
  }

  /** Mirrors the host's traffic, simulated at server time `time` and arriving at `now`: adds new cars, drops gone ones, feeds the rest's predictions. */
  applySnapshot(cars: TrafficCar[], time: number, now: number) {
    const byId = new Map(this.cars.map((c) => [c.id, c]));
    const keep = new Set<number>();
    for (const s of cars) {
      keep.add(s.id);
      this.nextId = Math.max(this.nextId, s.id + 1); // if we become host, our new cars won't reuse an id
      let c = byId.get(s.id);
      if (!c) {
        c = this.add(s.model, s.d, s.x, s.speed, s.heavy, s.id);
        byId.set(s.id, c);
      }
      addReport(c.track, { t: time, d: s.d, x: s.x, heading: -s.yaw, speed: s.speed, steer: 0 }, now); // yaw is the mesh rotation: heading's opposite
      c.braking = s.brake;
      c.target = s.blink === 0 ? c.lane : c.lane + s.blink;
      setBrakeLights(c.v, s.brake);
    }
    this.cars = this.cars.filter((c) => {
      if (keep.has(c.id)) return true;
      this.scene.remove(c.v.mesh);
      return false;
    });
  }

  /** Mirrored car: drawn where it is at `netNow`, predicted from the host's reports (net/interp.ts). */
  private mirror(c: Car, dt: number) {
    const s = present(c.track, this.netNow, dt);
    if (!s) return;
    Object.assign(c, { d: s.d, x: s.x, speed: s.speed });
    c.yaw = s.heading;
    c.lane = LANES.reduce((best, lx, i) => (Math.abs(lx - c.x) < Math.abs(LANES[best] - c.x) ? i : best), 0);
  }

  private rectOf(c: Car, meD: number): Rect {
    return { x: c.x, z: meD - c.d, w: c.v.w, l: c.v.l, heading: c.yaw };
  }

  private drive(c: Car, dt: number, drivers: Driver[]) {
    // car-following: match the speed of whoever is ahead if we're inside our safe headway
    const lead = this.leader(c, drivers);
    let want = c.desired;
    // drivers ease off for a bend ahead that would throw them sideways too hard
    const bend = Math.max(Math.abs(curvatureAt(c.d)), Math.abs(curvatureAt(c.d + 120)));
    if (bend > 0) want = Math.min(want, Math.sqrt(T.curveAccel / bend));
    if (c.shaken > 0) {
      c.shaken -= dt;
      want = Math.min(want, c.desired * 0.5); // just been hit: slows right down
    }
    if (lead && lead.gap < T.minGap + c.speed * T.headwaySec) want = Math.min(want, lead.speed * (lead.gap < T.minGap ? 0.8 : 1));
    const before = c.speed;
    c.braking = c.speed > want + 0.3;
    c.speed = c.braking ? Math.max(want, c.speed - T.brake * dt) : Math.min(want, c.speed + T.accel * dt);
    setBrakeLights(c.v, c.braking);
    c.suspension.update(c.v.body, dt, (c.speed - before) / dt, 0, c.speed * dt);

    // knocked sideways: the shove dies out, then the driver steers back to the middle of the nearest lane
    if (c.knock !== 0) {
      const edge = CARRIAGEWAY_HALF - c.v.w / 2; // shoved, but kept on the carriageway (the shoulder is for broken-down cars)
      c.x = Math.max(-edge, Math.min(edge, c.x + c.knock * dt));
      c.knock -= Math.sign(c.knock) * Math.min(Math.abs(c.knock), 6 * dt);
      c.lane = c.target = LANES.reduce((best, lx, i) => (Math.abs(lx - c.x) < Math.abs(LANES[best] - c.x) ? i : best), 0);
      c.blink = 0;
      return;
    }
    if (c.target === c.lane && Math.abs(LANES[c.lane] - c.x) > 0.01) {
      const dx = LANES[c.lane] - c.x;
      c.x += Math.sign(dx) * Math.min(Math.abs(dx), T.laneChangeSpeed * dt);
      return;
    }
    // lane changes: signal first, then drift over
    if (c.target === c.lane) {
      const stuck = !!lead && lead.gap < 50 && lead.speed < c.desired - 2;
      if (Math.random() < dt * (stuck ? T.blockedLaneChangePerSec : T.laneChangePerSec)) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (const to of [c.lane + dir, c.lane - dir]) {
          if (to < 0 || to >= LANE_COUNT || (c.heavy && to < 2)) continue;
          if (!this.laneClear(to, c, drivers)) continue;
          c.target = to;
          c.blink = T.blinkerTime;
          break;
        }
      }
    } else if (c.blink > 0) {
      c.blink -= dt;
    } else {
      const dx = LANES[c.target] - c.x, step = T.laneChangeSpeed * dt;
      if (Math.abs(dx) <= step) {
        c.x = LANES[c.target];
        c.lane = c.target;
      } else c.x += Math.sign(dx) * step;
    }
  }

  /** Nearest vehicle ahead that overlaps us sideways, players included. */
  private leader(c: Car, drivers: Driver[]) {
    let best: { gap: number; speed: number } | null = null;
    const consider = (x: number, d: number, w: number, l: number, speed: number) => {
      if (d <= c.d || Math.abs(x - c.x) > (w + c.v.w) / 2 + 0.3) return;
      const gap = d - c.d - (l + c.v.l) / 2;
      if (!best || gap < best.gap) best = { gap, speed };
    };
    for (const o of this.cars) if (o !== c) consider(o.x, o.d, o.v.w, o.v.l, o.speed);
    for (const p of drivers) consider(p.x, p.d, p.rect.w, p.rect.l, p.speed);
    return best as { gap: number; speed: number } | null;
  }

  private laneClear(lane: number, c: Car, drivers: Driver[]) {
    const room = 12 + c.v.l + c.speed * 0.8;
    const occupies = (x: number) => Math.abs(x - LANES[lane]) < LANE_WIDTH * 0.85;
    if (drivers.some((p) => occupies(p.x) && Math.abs(p.d - c.d) < room)) return false;
    return !this.cars.some((o) => o !== c && !parked(o) && (occupies(o.x) || o.target === lane) && Math.abs(o.d - c.d) < room);
  }

  private trySpawn(d: number, drivers: Driver[]) {
    const behind = drivers.every((p) => d < p.d);
    // never let a cross-section of road fill up: keep at least two lanes open
    if (this.cars.filter((c) => !parked(c) && Math.abs(c.d - d) < 25).length > LANE_COUNT - 3) return;
    const lanes = LANES.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (const lane of lanes) {
      if (this.cars.some((c) => (c.lane === lane || c.target === lane) && Math.abs(c.d - d) < 30)) continue;
      const heavy = !behind && lane >= 2 && Math.random() < T.heavyChance;
      let desired = heavy ? kmh(T.truckKmh + (Math.random() - 0.5) * 10) : kmh(T.laneSpeedsKmh[lane] + (Math.random() - 0.5) * 2 * T.speedJitterKmh);
      if (behind) desired = Math.max(desired, Math.min(...drivers.map((p) => p.speed)) + kmh(15)); // must be faster to ever reach anyone
      const models = this.models.map((_, i) => i).filter((i) => (i >= this.heavyFrom) === heavy);
      this.add(pick(models), d, LANES[lane], desired, heavy).desired = desired;
      return;
    }
  }

  private add(model: number, d: number, x: number, speed: number, heavy: boolean, id = this.nextId++): Car {
    const v = spawn(this.models[model]);
    setBrakeLights(v, false);
    this.track.place(v.mesh, d, x); // in place right away, not only from the next frame
    this.scene.add(v.mesh);
    const lane = LANES.reduce((best, lx, i) => (Math.abs(lx - x) < Math.abs(LANES[best] - x) ? i : best), 0);
    const car: Car = { id, model, v, lane, target: lane, x, d, yaw: 0, knock: 0, shaken: 0, speed, desired: speed, blink: 0, heavy, braking: false, passed: false, suspension: new Suspension(), track: track() };
    this.cars.push(car);
    return car;
  }
}
