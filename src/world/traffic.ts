// Traffic AI: keeps a safe distance, brakes (with brake lights), signals, then changes lanes.
// Positions are along the road (`d`, meters from the start), so the same traffic can be shared online:
// one game simulates it ('local': solo, or the room host) and the others mirror it ('remote').
import { CARRIAGEWAY_HALF, EVENTS, IMPACT, LANE_COUNT, LANE_WIDTH, LANES, NEAR_MISS, SHOULDER, TRAFFIC as T } from '../core/config.ts';
import { addReport, present, track, type Track } from '../net/interp.ts';
import type { TrafficCar } from '../net/protocol.ts';
import { rectsOverlap, type Rect } from '../rules/collision.ts';
import { densityAt, onShoulder, type Seen } from '../rules/difficulty.ts';
import { blocksIn } from '../rules/events.ts';
import { massOf, type Moving } from '../rules/impact.ts';
import { curvatureAt } from '../rules/track.ts';
import type { TrackView } from './track.ts';
import { setBeacons, type Fleet } from './vehicles/fleet.ts';
import { setBlinker, setBrakeLights } from './vehicles/lights.ts';
import { spawn, spinWheels, type Prefab, type Vehicle } from './vehicles/prefab.ts';
import { Suspension } from './suspension.ts';

const kmh = (k: number) => k / 3.6;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** Meters to the next broken-down car on shoulder `side` (0 left, 1 right). */
const nextGap = (side: number) => SHOULDER.breakdownGap[side] * (0.5 + Math.random());

/** Traffic with a job: a police car on a chase, a wide load, the motorbikes escorting it. */
type Role = 'police' | 'convoy' | 'moto' | null;
const ROLES: Role[] = ['police', 'convoy', 'moto']; // their models follow the ordinary traffic's, in this order

type Car = {
  id: number;
  role: Role;
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
  shift: number; // 0..1 through a lane change under way (-1: none)
  fromX: number; // where that lane change started
  vx: number; // m/s sideways (+ right), measured each frame: the nose follows it
  latAccel: number; // m/s² sideways, smoothed: the body leans with it
  wants: number; // lane it is waiting, stopped, to merge into out of a closure (-1: none): the car behind there lets it in
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
  private specialFrom: number; // models from here on are ROLES
  private blocks: { event: number; lane: number; from: number; to: number }[] = []; // lanes closed by road events, around the pack
  private sirens: Car[] = []; // police cars on the road
  private policeIn = 0; // s until the next police chase
  private convoyIn = 0; // s until the next wide load
  /** Things worth telling the player (a police car coming, a wide load ahead): the game shows and empties it. */
  readonly news: string[] = [];
  private cars: Car[] = [];
  private clock = 0;
  private nextId = 1;
  private nextBreakdown = [0, 0]; // road position of the next broken-down car, left and right shoulder
  private clearUntil = -Infinity; // road position before which no car spawns behind the pack (the start)

  constructor(track: TrackView, fleet: Fleet) {
    this.track = track;
    this.scene = track.root;
    this.models = [...fleet.cars, ...fleet.heavy, fleet.police, fleet.convoy, fleet.moto];
    this.heavyFrom = fleet.cars.length;
    this.specialFrom = fleet.cars.length + fleet.heavy.length;
  }

  /** Clears the road and pre-fills it ahead of `me`. */
  reset(me: Driver) {
    for (const c of this.cars) this.scene.remove(c.v.mesh);
    this.cars = [];
    this.news.length = 0;
    if (this.remote) return;
    this.policeIn = EVENTS.policeEverySec * (0.5 + Math.random());
    this.convoyIn = EVENTS.convoyEverySec * (0.5 + Math.random());
    this.blocks = blocksIn(me.d - 200, me.d + 800);
    this.nextBreakdown = [0, 1].map((side) => me.d + 150 + nextGap(side));
    this.clearUntil = me.d + T.startClear;
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
    setBeacons(this.clock);
    if (!this.remote) {
      const ds0 = drivers.length ? drivers.map((p) => p.d) : [me.d];
      this.blocks = blocksIn(Math.min(...ds0) - T.despawnBehind, Math.max(...ds0) - T.despawnAhead + T.mergeAhead);
      this.sirens = this.cars.filter((c) => c.role === 'police');
    }

    for (const c of this.cars) {
      const before = c.d - me.d;
      if (this.remote) this.mirror(c, dt);
      else if (!parked(c)) {
        const x0 = c.x;
        this.drive(c, dt, drivers);
        c.d += c.speed * dt;
        const vx = (c.x - x0) / dt;
        c.latAccel += ((vx - c.vx) / dt - c.latAccel) * Math.min(1, dt * 8);
        c.vx = vx;
      }
      const after = c.d - me.d;
      // near miss: the car crossed the player's position, close but not touching
      if (meRacing && !c.passed && Math.sign(before) !== Math.sign(after)) {
        c.passed = true;
        const gap = Math.abs(c.x - me.x) - (c.v.w + me.rect.w) / 2;
        if (gap > 0 && gap < NEAR_MISS.gap && me.speed > NEAR_MISS.minSpeed) nearMisses++;
      }
      if (!this.remote) c.yaw = Math.atan2(c.vx, Math.max(c.speed, 3)); // the nose points where it is going
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
      if (this.nextBreakdown[side] < front) this.nextBreakdown[side] = horizon; // e.g. just took over as host
      if (this.nextBreakdown[side] >= horizon) continue;
      this.add(Math.floor(Math.random() * this.heavyFrom), this.nextBreakdown[side], (side ? 1 : -1) * SHOULDER.x, 0, false);
      this.nextBreakdown[side] += nextGap(side);
    }
    this.dispatch(dt, front, back, Math.max(0, ...drivers.map((p) => p.speed)));
    const wanted = Math.min(70, densityAt(km) * (1 + (front - back) / 500));
    if (this.cars.filter((c) => !parked(c) && !c.role).length < wanted) {
      const speed = drivers.reduce((s, p) => s + p.speed, 0) / Math.max(1, drivers.length);
      // faster than traffic: new cars appear ahead; slower: they come up from behind
      // near the start nothing comes from behind: cars at full speed would run into a grid still pulling away
      const ahead = back - T.spawnBehind < this.clearUntil || Math.random() < Math.min(1, Math.max(0.15, (speed * 3.6 - 60) / 70));
      this.trySpawn(ahead ? front - T.spawnAhead : back - T.spawnBehind, drivers);
    }
    return nearMisses;
  }

  /** Every traffic car between road positions `d0` and `d1`, as the rear-view mirror sees it. */
  seen(d0: number, d1: number): Seen[] {
    return this.cars.filter((c) => c.d > d0 && c.d < d1).map((c) => ({ d: c.d, x: c.x, speed: c.speed, w: c.v.w, l: c.v.l, police: c.role === 'police' }));
  }

  /** The traffic car `me` touches, if any. */
  hits(me: Driver) {
    return this.cars.find((c) => Math.abs(c.d - me.d) < 20 && rectsOverlap({ ...me.rect, z: 0 }, this.rectOf(c, me.d)));
  }

  /** Every traffic car `me` touches, as impacts see them (relative to `me`'s road position). Broken-down cars don't budge. */
  touching(me: Driver): { car: Car; moving: Moving }[] {
    return this.cars.filter((c) => Math.abs(c.d - me.d) < 20 && rectsOverlap({ ...me.rect, z: 0 }, this.rectOf(c, me.d))).map((c) => {
      return { car: c, moving: { rect: this.rectOf(c, me.d), vx: c.vx, vz: -c.speed, mass: parked(c) ? 1e9 : massOf(c.v.w, c.v.l) } };
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
    // far enough back to stop in time, even for something standing still (an accident, roadworks)
    const room = lead && T.minGap + Math.max(c.speed * T.headwaySec, (c.speed ** 2 - lead.speed ** 2) / (2 * T.brake * 0.7));
    if (lead && room && lead.gap < room) want = Math.min(want, lead.speed * (lead.gap < T.minGap ? 0.8 : 1));
    const before = c.speed;
    c.braking = c.speed > want + 0.3;
    c.speed = c.braking ? Math.max(want, c.speed - T.brake * dt) : Math.min(want, c.speed + T.accel * dt);
    setBrakeLights(c.v, c.braking);
    c.suspension.update(c.v.body, dt, (c.speed - before) / dt, c.latAccel * T.laneChangeLean, c.speed * dt); // squats, dives, and leans out of its lane changes
    if (c.role === 'convoy' || c.role === 'moto') return; // the wide load and its escorts hold their line

    // knocked sideways: the shove dies out, then the driver steers back to the middle of the nearest lane
    if (c.knock !== 0) {
      const edge = CARRIAGEWAY_HALF - c.v.w / 2; // shoved, but kept on the carriageway (the shoulder is for broken-down cars)
      c.x = Math.max(-edge, Math.min(edge, c.x + c.knock * dt));
      c.knock -= Math.sign(c.knock) * Math.min(Math.abs(c.knock), 6 * dt);
      c.lane = c.target = LANES.reduce((best, lx, i) => (Math.abs(lx - c.x) < Math.abs(LANES[best] - c.x) ? i : best), 0);
      c.blink = 0;
      c.shift = -1;
      return;
    }
    if (c.target === c.lane && Math.abs(LANES[c.lane] - c.x) > 0.01) {
      const dx = LANES[c.lane] - c.x;
      c.x += Math.sign(dx) * Math.min(Math.abs(dx), T.laneChangeSpeed * dt);
      return;
    }
    // a police car coming up behind in my lane: move over, right first
    if (c.target === c.lane && !c.role && this.sirens.some((p) => p.d < c.d && c.d - p.d < EVENTS.yieldDistance && Math.abs(p.x - c.x) < LANE_WIDTH * 0.8)) {
      for (const to of [c.lane + 1, c.lane - 1]) {
        if (to < 0 || to >= LANE_COUNT || !this.laneClear(to, c, drivers)) continue;
        c.target = to;
        c.blink = 0.3;
        return;
      }
    }
    // lane changes: signal first, then drift over
    if (c.target === c.lane) {
      // my lane closed ahead (roadworks, an accident, a lost load): head for the nearest open lane, a lane at a time
      const closed = this.closureAhead(c);
      // otherwise: stuck behind someone slower
      const stuck = !!lead && lead.gap < 50 && lead.speed < c.desired - 2;
      const rate = closed ? T.mergePerSec : c.role === 'police' ? (stuck ? 4 : 0) : stuck ? T.blockedLaneChangePerSec : T.laneChangePerSec;
      if (!closed) c.wants = -1;
      if (Math.random() < dt * rate) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        const open = closed && LANES.map((_, i) => i).filter((i) => !closed.has(i)).sort((a, b) => Math.abs(a - c.lane) - Math.abs(b - c.lane))[0];
        for (const to of closed ? [c.lane + Math.sign((open as number) - c.lane)] : [c.lane + dir, c.lane - dir]) {
          if (to < 0 || to >= LANE_COUNT || (c.heavy && to < 2 && !closed)) continue; // lorries keep right, unless the right is closed
          if (!this.laneClear(to, c, drivers, !!closed)) {
            if (closed && c.speed < 2) c.wants = to; // stopped at the closure: signal, so the queue beside lets me in
            continue;
          }
          c.target = to;
          c.blink = T.blinkerTime;
          c.wants = -1;
          break;
        }
      }
    } else if (c.blink > 0) {
      c.blink -= dt;
    } else {
      // the move itself: an S across, eased in and out; the nose turns into it, then straightens
      if (c.shift < 0) {
        c.shift = 0;
        c.fromX = c.x;
      }
      const span = LANES[c.target] - c.fromX;
      c.shift = Math.min(1, c.shift + (dt * T.laneChangeSpeed) / Math.max(Math.abs(span), 0.5));
      const s = c.shift;
      c.x = c.fromX + span * s * s * (3 - 2 * s);
      if (s >= 1) {
        c.lane = c.target;
        c.shift = -1;
      }
    }
  }

  /** The lanes closed by the next road event ahead in `c`'s own lane, within `mergeAhead` m; null if its lane runs on. */
  private closureAhead(c: Car) {
    const mine = this.blocks.find((b) => b.lane === c.lane && b.to > c.d && b.from - c.d < T.mergeAhead);
    return mine ? new Set(this.blocks.filter((b) => b.event === mine.event).map((b) => b.lane)) : null;
  }

  /** Nearest vehicle ahead that overlaps us sideways, players included. */
  private leader(c: Car, drivers: Driver[]) {
    let best: { gap: number; speed: number } | null = null;
    const consider = (x: number, d: number, w: number, l: number, speed: number) => {
      if (d <= c.d || Math.abs(x - c.x) > (w + c.v.w) / 2 + 0.3) return;
      const gap = d - c.d - (l + c.v.l) / 2;
      if (!best || gap < best.gap) best = { gap, speed };
    };
    for (const o of this.cars) {
      if (o === c) continue;
      consider(o.x, o.d, o.v.w, o.v.l, o.speed);
      // someone stopped beside, waiting to merge into my lane: I hold back behind it and let it in
      // (only once it is wholly ahead of me: right alongside, I drive on and the next one lets it in)
      const ahead = o.d - c.d;
      if (o.wants === c.lane && o.speed < 2 && ahead > (o.v.l + c.v.l) / 2 + 1 && ahead < 40) consider(LANES[o.wants], o.d, o.v.w, o.v.l, 0);
    }
    for (const p of drivers) consider(p.x, p.d, p.rect.w, p.rect.l, p.speed);
    for (const b of this.blocks) consider(LANES[b.lane], (b.from + b.to) / 2, LANE_WIDTH * 0.8, b.to - b.from, 0);
    return best as { gap: number; speed: number } | null;
  }

  /**
   * Whether `c` can move over into `lane`. `crossing`: on its way out of a closure, it may cross a lane that is
   * closed too, as long as what closes it is still ahead of the car (it then moves on to the next lane).
   */
  private laneClear(lane: number, c: Car, drivers: Driver[], crossing = false) {
    const room = 12 + c.v.l + c.speed * 0.8;
    // crossing: only if it can still stop short of what closes the lane; otherwise never into a lane closed ahead
    const reach = crossing ? c.v.l / 2 + 3 + c.speed ** 2 / (2 * T.brake * 0.7) : T.mergeAhead;
    const occupies = (x: number) => Math.abs(x - LANES[lane]) < LANE_WIDTH * 0.85;
    if (drivers.some((p) => occupies(p.x) && Math.abs(p.d - c.d) < room)) return false;
    if (this.blocks.some((b) => b.lane === lane && c.d + reach > b.from && c.d - room < b.to)) return false;
    // zip merging: out of a closure, a car slips in front of one crawling in the queue beside it, given the space;
    // that one then waits for it (it brakes for whatever is ahead in its lane)
    const inWay = (o: Car) => Math.abs(o.d - c.d) < (crossing && o.speed < 3 ? (c.v.l + o.v.l) / 2 + 1 : room);
    return !this.cars.some((o) => o !== c && !parked(o) && (occupies(o.x) || o.target === lane) && inWay(o));
  }

  private trySpawn(d: number, drivers: Driver[]) {
    const behind = drivers.every((p) => d < p.d);
    // never let a cross-section of road fill up: keep at least two lanes open
    if (this.cars.filter((c) => !parked(c) && Math.abs(c.d - d) < 25).length > LANE_COUNT - 3) return;
    const lanes = LANES.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (const lane of lanes) {
      if (this.cars.some((c) => (c.lane === lane || c.target === lane) && Math.abs(c.d - d) < 30)) continue;
      if (this.blocks.some((b) => b.lane === lane && d > b.from - 60 && d < b.to + 10)) continue; // not in a closed lane
      const heavy = !behind && lane >= 2 && Math.random() < T.heavyChance;
      let desired = heavy ? kmh(T.truckKmh + (Math.random() - 0.5) * 10) : kmh(T.laneSpeedsKmh[lane] + (Math.random() - 0.5) * 2 * T.speedJitterKmh);
      if (behind) desired = Math.max(desired, Math.min(...drivers.map((p) => p.speed)) + kmh(15)); // must be faster to ever reach anyone
      const models = this.models.map((_, i) => i).filter((i) => i < this.specialFrom && (i >= this.heavyFrom) === heavy);
      this.add(pick(models), d, LANES[lane], desired, heavy).desired = desired;
      return;
    }
  }

  /**
   * Now and then sends a police car up from behind the pack (fast lane, everyone moves over), or a wide load
   * ahead of it: a boat across the two right lanes at walking pace for a motorway, a motorbike before and after.
   */
  private dispatch(dt: number, front: number, back: number, fastest: number) {
    // it arrives where ordinary traffic does, out in the fog: whoever stands in its way there simply isn't spawned
    const makeRoom = (d: number, lanes: number[], span: number) => {
      if (this.blocks.some((b) => lanes.includes(b.lane) && d + span > b.from && d - span < b.to)) return false;
      this.cars = this.cars.filter((c) => {
        if (c.role || parked(c) || !lanes.includes(c.lane) || Math.abs(c.d - d) > span) return true;
        this.scene.remove(c.v.mesh);
        return false;
      });
      return true;
    };
    if ((this.policeIn -= dt) <= 0 && back - T.spawnBehind > this.clearUntil) {
      const d = back - (T.spawnBehind + T.despawnBehind) / 2; // behind the pack, yet short of where traffic is dropped
      if (makeRoom(d, [0], 30)) {
        // always faster than whoever it is chasing: a police car that never catches up is never seen
        this.add(this.specialFrom, d, LANES[0], Math.max(kmh(EVENTS.policeKmh), fastest + kmh(EVENTS.policeOverKmh)), false);
        this.policeIn = EVENTS.policeEverySec * (0.5 + Math.random());
      }
    }
    if ((this.convoyIn -= dt) <= 0 && front - T.spawnAhead > this.clearUntil) {
      const d = front - T.spawnAhead, speed = kmh(EVENTS.convoyKmh), g = EVENTS.escortGap;
      // it never changes lanes: only sent onto a stretch where both right lanes stay open
      const clear = !blocksIn(d - g, d + EVENTS.convoyClearAhead).some((b) => b.lane >= 2);
      if (clear && makeRoom(d, [2, 3], g + 30)) {
        this.add(this.specialFrom + 2, d + g, LANES[3], speed, true);
        this.add(this.specialFrom + 1, d, (LANES[2] + LANES[3]) / 2, speed, true);
        this.add(this.specialFrom + 2, d - g, LANES[3], speed, true);
        this.convoyIn = EVENTS.convoyEverySec * (0.5 + Math.random());
      }
    }
  }

  private add(model: number, d: number, x: number, speed: number, heavy: boolean, id = this.nextId++): Car {
    const v = spawn(this.models[model]);
    setBrakeLights(v, false);
    this.track.place(v.mesh, d, x); // in place right away, not only from the next frame
    this.scene.add(v.mesh);
    const lane = LANES.reduce((best, lx, i) => (Math.abs(lx - x) < Math.abs(LANES[best] - x) ? i : best), 0);
    const role = model >= this.specialFrom ? ROLES[model - this.specialFrom] : null;
    if (role === 'police') this.news.push('Police chase!');
    if (role === 'convoy') this.news.push('Wide load ahead');
    const car: Car = { id, role, model, v, lane, target: lane, x, d, yaw: 0, knock: 0, shaken: 0, speed, desired: speed, blink: 0, shift: -1, fromX: x, vx: 0, latAccel: 0, wants: -1, heavy, braking: false, passed: false, suspension: new Suspension(), track: track() };
    this.cars.push(car);
    return car;
  }
}
