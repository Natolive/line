// Battle royale: the online side of a race. Owns the connection, the room, the grid, the wall clock,
// the rivals and eliminations; the Game asks it questions and reacts to its events.
import type * as THREE from 'three';
import { Net } from '../net/client.ts';
import { BIN, decodeSnapshot, decodeTraffic, encodeState, encodeTraffic } from '../net/codec.ts';
import { INTERP_DELAY } from '../net/interp.ts';
import type { CarState, PlayerInfo, ServerMessage } from '../net/protocol.ts';
import { wallAt } from '../rules/wall.ts';
import { Rivals } from '../world/rivals.ts';
import type { Traffic } from '../world/traffic.ts';
import type { Fleet } from '../world/vehicles/fleet.ts';
import { LANES } from './config.ts';

const STATE_EVERY = 1 / 30, TRAFFIC_EVERY = 1 / 15; // seconds between network updates
const PING_EVERY = 1; // s; also keeps the clock in sync
const ROW_GAP = 14; // meters between grid rows

export type BattleEvents = {
  lobby(): void;
  go(slot: { d: number; x: number }): void;
  out(id: string, reason: string, place: number): void;
  winner(id: string | null, ranking: string[]): void;
  error(message: string): void;
  closed(): void;
};

/** Grid slot `i`: four abreast, rows behind the start line. */
export const gridSlot = (i: number) => ({ d: -Math.floor(i / LANES.length) * ROW_GAP, x: LANES[i % LANES.length] });

export class Battle {
  me = '';
  host = '';
  room = '';
  players: PlayerInfo[] = [];
  readonly rivals: Rivals;
  private net = new Net();
  private traffic: Traffic;
  private events: BattleEvents;
  private startAt = Infinity; // performance.now() when the lights go green
  private sendT = 0;
  private trafficT = 0;
  private pingT = 0;
  private grid: string[] = []; // slot → player id, for snapshots
  private clockOffset = 0; // server clock − my clock (ms)
  private bestRtt = Infinity;
  /** Round trip to the server (ms), smoothed. */
  ping = 0;

  private constructor(scene: THREE.Scene, fleet: Fleet, traffic: Traffic, events: BattleEvents) {
    this.rivals = new Rivals(scene, fleet);
    this.traffic = traffic;
    this.events = events;
    this.net.onMessage = (m) => this.handle(m);
    this.net.onBinary = (buf) => this.handleBinary(buf);
    this.net.onClose = () => events.closed();
  }

  /** Connects and joins room `room`; rejects with a message a player can act on. */
  static async join(room: string, name: string, car: string, scene: THREE.Scene, fleet: Fleet, traffic: Traffic, events: BattleEvents) {
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

  /** Moves rivals and mirrored traffic: drawn INTERP_DELAY in the past, between real reports. */
  sync(dt: number, myD: number) {
    const now = this.serverNow();
    this.traffic.netTime = now - INTERP_DELAY;
    this.rivals.update(dt, myD, now - INTERP_DELAY, now);
  }

  nameOf(id: string) {
    return this.players.find((p) => p.id === id)?.name ?? 'Someone';
  }

  setCar(car: string) {
    this.net.send({ t: 'car', car });
  }

  start() {
    this.net.send({ t: 'start' });
  }

  /** Publishes my car (30×/s, 17 bytes) and, as host, the traffic (15×/s); pings once a second. */
  publish(dt: number, s: CarState | null) {
    this.sendT -= dt;
    if (s && this.sendT <= 0) {
      this.sendT = Math.max(0, this.sendT + STATE_EVERY); // keeps an exact 30/s on average, whatever the frame rate
      this.net.send(encodeState(s));
    }
    this.trafficT -= dt;
    if (this.isHost && this.trafficT <= 0) {
      this.trafficT = TRAFFIC_EVERY;
      this.net.send(encodeTraffic(this.traffic.snapshot()));
    }
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = PING_EVERY;
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
        if (id && id !== this.me) this.rivals.setState(id, c.state, snap.time);
      }
    } else if (buf[0] === BIN.TRAFFIC && !this.isHost) {
      const t = decodeTraffic(buf);
      this.traffic.applySnapshot(t.cars, t.time);
    }
  }

  /**
   * Clock sync, as games do it: the server time is ours + offset, measured on the fastest round trips
   * (they're the least distorted by queues), and smoothed so it never jumps.
   */
  private onPong(c: number, s: number) {
    const now = performance.now(), rtt = now - c, offset = s + rtt / 2 - now;
    this.ping = this.ping ? this.ping * 0.8 + rtt * 0.2 : rtt;
    if (rtt <= this.bestRtt * 1.25) {
      this.clockOffset = this.bestRtt === Infinity ? offset : this.clockOffset * 0.7 + offset * 0.3;
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
        this.traffic.remote = !this.isHost;
        return this.events.lobby();
      case 'lobby':
        this.host = m.host;
        this.players = m.players;
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
        return this.events.go(gridSlot(m.grid.indexOf(this.me)));
      }
      case 'out':
        this.rivals.out(m.id);
        return this.events.out(m.id, m.reason, m.place);
      case 'winner':
        this.startAt = Infinity;
        return this.events.winner(m.id, m.ranking);
    }
  }
}
