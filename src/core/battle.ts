// Battle royale: the online side of a race. Owns the connection, the room, the grid, the wall clock,
// the rivals and eliminations; the Game asks it questions and reacts to its events.
import type { TrackView } from '../world/track.ts';
import { gridSlot } from '../rules/grid.ts';
import { Net } from '../net/client.ts';
import { BIN, decodeSnapshot, decodeTraffic, encodeState, encodeTraffic } from '../net/codec.ts';
import { due } from '../net/interp.ts';
import { NET_HZ, type CarState, type PlayerInfo, type Result, type ServerMessage } from '../net/protocol.ts';
import { wallAt } from '../rules/wall.ts';
import { Rivals } from '../world/rivals.ts';
import type { Traffic } from '../world/traffic.ts';
import type { Fleet } from '../world/vehicles/fleet.ts';

const STATE_EVERY = 1 / NET_HZ, TRAFFIC_EVERY = 1 / 30; // seconds between network updates (traffic is steady: 30 is plenty)
const CLOCK_SLEW = 0.05; // the clock estimate catches up at most 5% faster or slower than real time: no visible jump
const PING_EVERY = 1; // s; also keeps the clock in sync
const PING_BURST = { count: 10, every: 0.1 }; // the first pings come fast, so the clock is settled before the lights go green

export type BattleEvents = {
  lobby(): void;
  go(slot: { d: number; x: number }, seed: number): void; // seed: the map of this race
  out(id: string, reason: string, place: number): void;
  winner(ranking: Result[]): void;
  error(message: string): void;
  closed(): void;
};

export class Battle {
  me = '';
  host = '';
  room = '';
  players: PlayerInfo[] = [];
  spec: string | null = null; // the room's setting: garage car id whose figures everyone drives with, or null
  readonly rivals: Rivals;
  private net = new Net();
  private traffic: Traffic;
  private events: BattleEvents;
  private startAt = Infinity; // performance.now() when the lights go green
  private sendT = { t: 0 };
  private trafficT = { t: 0 };
  private pingT = 0;
  private pings = 0;
  private trafficAt = -Infinity; // server time of the newest traffic report applied
  /** performance.now() of the frame being simulated (the rAF timestamp): what my car's state and the drawn rivals correspond to. */
  frameAt = performance.now();
  private grid: string[] = []; // slot → player id, for snapshots
  private clockOffset = 0; // server clock − my clock (ms), as used: eases toward clockTarget
  private clockTarget = NaN; // latest measured offset (ms)
  private bestRtt = Infinity;
  /** True when cars and traffic travel over UDP (WebRTC), false on the WebSocket fallback. */
  get udp() {
    return this.net.udp;
  }

  /** Round trip to the server (ms), smoothed. */
  ping = 0;
  /** For the HUD, over the last second of rival reports: how far ahead of them we predict (ms) and the average correction each brought (m). */
  link = { ahead: 0, fix: 0 };
  private tally = { ahead: 0, fix: 0, n: 0, t: 0 };

  private constructor(scene: TrackView, fleet: Fleet, traffic: Traffic, events: BattleEvents) {
    this.rivals = new Rivals(scene, fleet);
    this.traffic = traffic;
    this.events = events;
    this.net.onMessage = (m) => this.handle(m);
    this.net.onBinary = (buf) => this.handleBinary(buf);
    this.net.onClose = () => events.closed();
  }

  /** Connects and joins room `room`; rejects with a message a player can act on. */
  static async join(room: string, name: string, car: string, scene: TrackView, fleet: Fleet, traffic: Traffic, events: BattleEvents) {
    const b = new Battle(scene, fleet, traffic, events);
    await b.net.connected();
    b.net.send({ t: 'join', room, name, car });
    return b;
  }

  get isHost() {
    return this.me === this.host;
  }

  /** Seconds since the start (negative during the countdown). */
  raceTime() {
    return (performance.now() - this.startAt) / 1000;
  }

  /** Where the storm wall is now, in meters along the road. */
  wall() {
    return wallAt(this.raceTime());
  }

  /** The server's clock (ms), estimated from ping/pong. */
  serverNow() {
    return performance.now() + this.clockOffset;
  }

  /** The server time (ms) of the frame being simulated: not of the call, whose moment within the frame varies by a few ms. */
  private frameNow() {
    return this.frameAt + this.clockOffset;
  }

  /** Moves rivals and mirrored traffic to where they are now, predicted from their reports (net/interp.ts). */
  sync(dt: number, myD: number) {
    const step = dt * 1000 * CLOCK_SLEW;
    if (!Number.isNaN(this.clockTarget)) this.clockOffset += Math.max(-step, Math.min(step, this.clockTarget - this.clockOffset));
    const now = this.frameNow(), tl = this.tally;
    this.traffic.netNow = now;
    this.rivals.update(dt, myD, now);
    if ((tl.t += dt) >= 1) {
      this.link = tl.n ? { ahead: tl.ahead / tl.n, fix: tl.fix / tl.n } : { ahead: 0, fix: 0 };
      this.tally = { ahead: 0, fix: 0, n: 0, t: 0 };
    }
  }

  nameOf(id: string) {
    return this.players.find((p) => p.id === id)?.name ?? 'Someone';
  }

  setCar(car: string) {
    this.net.send({ t: 'car', car });
  }

  /** Host only: everyone drives with garage car `car`'s figures, or each their own (null). */
  setSpec(car: string | null) {
    this.net.send({ t: 'spec', car });
  }

  start() {
    this.net.send({ t: 'start' });
  }

  /** Publishes my car (NET_HZ, 19 bytes) and, as host, the traffic (30×/s), stamped with this frame's time; pings once a second. */
  publish(dt: number, s: CarState | null) {
    if (due(this.sendT, dt, STATE_EVERY) && s) this.net.send(encodeState(s, this.frameNow()));
    if (due(this.trafficT, dt, TRAFFIC_EVERY) && this.isHost) this.net.send(encodeTraffic(this.traffic.snapshot(), this.frameNow()));
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = ++this.pings < PING_BURST.count ? PING_BURST.every : PING_EVERY;
      this.net.send({ t: 'ping', c: performance.now() });
    }
  }

  eliminated(reason: 'crash' | 'wall', d: number) {
    this.net.send({ t: 'out', reason, d });
  }

  leave() {
    this.net.close();
    this.rivals.clear();
    this.traffic.remote = false;
  }

  private handleBinary(buf: Uint8Array) {
    if (buf[0] === BIN.SNAPSHOT) {
      const snap = decodeSnapshot(buf);
      for (const c of snap.cars) {
        const id = this.grid[c.slot];
        if (!id || id === this.me) continue;
        const t = snap.time - c.age, now = this.serverNow(), tl = this.tally;
        tl.fix += this.rivals.setState(id, c.state, t, now);
        tl.ahead += now - t;
        tl.n++;
      }
    } else if (buf[0] === BIN.TRAFFIC && !this.isHost) {
      const t = decodeTraffic(buf);
      if (t.time <= this.trafficAt) return; // older than the last one applied: arrived out of order (UDP); it would bring back gone cars
      this.trafficAt = t.time;
      this.traffic.applySnapshot(t.cars, t.time, this.serverNow());
    }
  }

  /**
   * Clock sync, as games do it: the server time is ours + offset, measured on the fastest round trips
   * (they're the least distorted by queues), and the clock used eases toward it (CLOCK_SLEW) so it never jumps.
   */
  private onPong(c: number, s: number) {
    const now = performance.now(), rtt = now - c, offset = s + rtt / 2 - now;
    this.ping = this.ping ? this.ping * 0.8 + rtt * 0.2 : rtt;
    if (rtt <= this.bestRtt * 1.25) {
      if (this.bestRtt === Infinity) this.clockOffset = offset; // first measure: jump there, before the race
      this.clockTarget = this.bestRtt === Infinity ? offset : this.clockTarget * 0.7 + offset * 0.3;
      this.bestRtt = Math.min(this.bestRtt, rtt);
    }
    this.bestRtt *= 1.02; // let it drift up, in case the route got slower for good
  }

  private handle(m: ServerMessage) {
    switch (m.t) {
      case 'pong':
        return this.onPong(m.c, m.s);
      case 'joined':
        this.me = m.you;
        this.room = m.room;
        this.host = m.host;
        this.players = m.players;
        this.spec = m.spec;
        this.traffic.remote = !this.isHost;
        return this.events.lobby();
      case 'lobby':
        this.host = m.host;
        this.players = m.players;
        this.spec = m.spec;
        this.traffic.remote = !this.isHost; // the host leaving hands the traffic to the next player
        for (const id of this.rivals.all.keys()) if (!m.players.some((p) => p.id === id)) this.rivals.out(id);
        return this.events.lobby();
      case 'error':
        return this.events.error(m.message);
      case 'go': {
        this.startAt = performance.now() + m.startsIn;
        this.grid = m.grid;
        this.rivals.clear();
        m.grid.forEach((id, i) => {
          const p = this.players.find((q) => q.id === id), slot = gridSlot(i);
          if (p && id !== this.me) this.rivals.add(p, slot.d, slot.x);
        });
        return this.events.go(gridSlot(m.grid.indexOf(this.me)), m.seed);
      }
      case 'out':
        this.rivals.out(m.id);
        return this.events.out(m.id, m.reason, m.place);
      case 'winner':
        this.startAt = Infinity;
        return this.events.winner(m.ranking);
    }
  }
}
