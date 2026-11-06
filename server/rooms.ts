// Rooms: who's in, who hosts, who's still racing, who won, and the NET_HZ car snapshots. Two modes: a battle
// royale (last one standing wins) or a race to a finish line (first home wins). No networking here, so it is testable.
import { newerState, packSnapshot, stampTraffic, stateD, stateStamp } from '../src/net/codec.ts';
import { FINISH_SLACK, MAX_PLAYERS, RACE_GRACE_MS, RACE_LENGTHS, type Mode, type OutReason, type PlayerInfo, type Result, type ServerMessage } from '../src/net/protocol.ts';

export const COUNTDOWN_MS = 3000;

type Send = (m: ServerMessage | Uint8Array) => void;
// alive: still in contention; home: crossed the finish line (still driving, still sent to the others);
// d: last reported road position (m); stamp: the newest state's own time stamp
type Member = { info: PlayerInfo; send: Send; alive: boolean; home: boolean; slot: number; latest: Uint8Array | null; at: number; stamp: number | null; d: number };

export class Room {
  readonly code: string;
  host = '';
  racing = false;
  spec: string | null = null; // garage car id whose figures everyone drives with, or null: each their own
  mode: Mode = null;
  private members = new Map<string, Member>();
  private out: Result[] = []; // eliminated this race, first out first
  private finishers: Result[] = []; // home this race, first home first
  private startAt = 0; // server time (ms) of the green light
  private closeAt = Infinity; // server time (ms) a race closes: the winner's time plus RACE_GRACE_MS

  constructor(code: string) {
    this.code = code;
  }

  get size() {
    return this.members.size;
  }

  get players() {
    return [...this.members.values()].map((m) => m.info);
  }

  /** Adds a player; returns an error message instead if they can't join. */
  join(info: PlayerInfo, send: Send): string | null {
    if (this.racing) return 'A race is running in this room. Wait for it to finish, or pick another code.';
    if (this.members.size >= MAX_PLAYERS) return `This room is full (${MAX_PLAYERS} players).`;
    this.members.set(info.id, { info, send, alive: false, home: false, slot: -1, latest: null, at: 0, stamp: null, d: 0 });
    if (!this.host) this.host = info.id;
    send({ t: 'joined', you: info.id, room: this.code, host: this.host, players: this.players, racing: this.racing, spec: this.spec, mode: this.mode });
    this.broadcastLobby(info.id);
    return null;
  }

  leave(id: string) {
    const m = this.members.get(id);
    if (!m) return;
    if (this.racing && m.alive) this.eliminate(id, 'left');
    this.members.delete(id);
    if (this.host === id) this.host = this.members.keys().next().value ?? ''; // the next player takes over (and the traffic)
    this.broadcastLobby();
    this.checkWinner();
  }

  setCar(id: string, car: string) {
    const m = this.members.get(id);
    if (!m || this.racing) return;
    m.info.car = car;
    this.broadcastLobby();
  }

  /** Host only, between races: same figures for everyone (a garage car id, already validated) or each their own. */
  setSpec(by: string, car: string | null) {
    if (by !== this.host || this.racing) return;
    this.spec = car;
    this.broadcastLobby();
  }

  /** Host only, between races: a battle royale (null) or a race to one of RACE_LENGTHS. */
  setMode(by: string, mode: Mode) {
    if (by !== this.host || this.racing || (mode !== null && !RACE_LENGTHS.includes(mode))) return;
    this.mode = mode;
    this.broadcastLobby();
  }

  private broadcastLobby(except?: string) {
    this.broadcast({ t: 'lobby', host: this.host, players: this.players, spec: this.spec, mode: this.mode }, except);
  }

  start(by: string, now = performance.now()) {
    if (by !== this.host || this.racing || !this.members.size) return;
    this.racing = true;
    this.out = [];
    this.finishers = [];
    this.startAt = now + COUNTDOWN_MS;
    this.closeAt = Infinity;
    const grid = [...this.members.keys()].sort(() => Math.random() - 0.5);
    grid.forEach((id, slot) => Object.assign(this.members.get(id)!, { alive: true, home: false, slot, latest: null, stamp: null, d: 0 }));
    // a new map every race, the same for the whole room
    this.broadcast({ t: 'go', startsIn: COUNTDOWN_MS, grid, seed: Math.floor(Math.random() * 2 ** 32), mode: this.mode });
  }

  /** A player's car (raw binary, already size-checked), simulated at server time `at` (see `stateTime`): kept until the next tick. */
  setState(id: string, raw: Uint8Array, at: number) {
    const m = this.members.get(id);
    if (!this.racing || !(m?.alive || m?.home) || !newerState(raw, m.stamp)) return; // not newer than what we have: out of order or repeated (UDP)
    const d = stateD(raw);
    Object.assign(m, { latest: raw, at, stamp: stateStamp(raw), d: Number.isFinite(d) ? d : m.d });
  }

  /** The host's traffic, relayed at once with its (clamped) simulation time stamped in. */
  relayTraffic(id: string, raw: Uint8Array, now: number) {
    if (this.racing && id === this.host) this.broadcast(stampTraffic(raw, now), id);
  }

  /**
   * One server tick: a single snapshot of the cars received since the last one, to every player.
   * Each car is sent once, with its own receive time: re-sending an old state under a new time
   * would make it stop for a tick and jump (clients and server both run at NET_HZ, out of phase).
   */
  tick(now: number) {
    if (!this.racing) return;
    if (now >= this.closeAt) for (const id of this.alive()) this.eliminate(id, 'late');
    if (!this.racing) return;
    const fresh = [...this.members.values()].filter((m) => m.latest);
    const cars = fresh.map((m) => ({ slot: m.slot, at: m.at, raw: m.latest! }));
    for (const m of fresh) m.latest = null;
    if (cars.length) this.broadcast(packSnapshot(now, cars));
  }

  /** A player reports their own elimination (or the room puts them out: left, late). */
  eliminate(id: string, reason: OutReason) {
    const m = this.members.get(id);
    if (!this.racing || !m?.alive) return;
    m.alive = false;
    this.out.push({ id, name: m.info.name, out: reason, d: m.d, time: null });
    const place = this.finishers.length + this.alive().length + 1; // behind everyone home or still racing
    this.broadcast({ t: 'out', id, reason, place });
    this.checkWinner();
  }

  /**
   * A race: a player reports crossing the finish line at server time `at` (ms). Believed if their last reported
   * position is within FINISH_SLACK of the line; the time is kept between the green light and now.
   */
  finish(id: string, at: number, now: number) {
    const m = this.members.get(id), line = this.mode;
    if (!this.racing || line === null || !m?.alive || m.d < line - FINISH_SLACK) return;
    m.alive = false;
    m.home = true;
    const time = Math.round(Math.min(now, Math.max(this.startAt, at)) - this.startAt);
    this.finishers.push({ id, name: m.info.name, out: null, d: line, time });
    if (this.finishers.length === 1) this.closeAt = now + RACE_GRACE_MS;
    this.broadcast({ t: 'finish', id, place: this.finishers.length, time });
    this.checkWinner();
  }

  /** Sends to everyone in the room except `except`. */
  broadcast(msg: ServerMessage | Uint8Array, except?: string) {
    for (const [id, m] of this.members) if (id !== except) m.send(msg);
  }

  private alive() {
    return [...this.members.entries()].filter(([, m]) => m.alive).map(([id]) => id);
  }

  /**
   * Battle royale: over when one driver is left (or none, in a solo room); the last out rank highest.
   * Race: over when nobody is still racing; finishers by time, then the others by how far they got.
   */
  private checkWinner() {
    if (!this.racing) return;
    const alive = this.alive();
    let ranking: Result[], winner: string | null;
    if (this.mode === null) {
      if (alive.length > 1 || (alive.length === 1 && alive.length + this.out.length === 1)) return;
      ranking = [...alive.map((id): Result => ({ id, name: this.members.get(id)!.info.name, out: null, d: this.members.get(id)!.d, time: null })), ...[...this.out].reverse()];
      winner = ranking[0]?.id ?? null;
    } else {
      if (alive.length) return;
      ranking = [...[...this.finishers].sort((a, b) => a.time! - b.time!), ...[...this.out].sort((a, b) => b.d - a.d)];
      winner = ranking[0]?.time !== null ? ranking[0]?.id ?? null : null;
    }
    this.racing = false;
    this.broadcast({ t: 'winner', id: winner, ranking });
  }
}

/** All rooms by code; empty rooms are dropped. */
export class Rooms {
  private rooms = new Map<string, Room>();

  get(code: string) {
    let r = this.rooms.get(code);
    if (!r) this.rooms.set(code, (r = new Room(code)));
    return r;
  }

  leave(room: Room, id: string) {
    room.leave(id);
    if (!room.size) this.rooms.delete(room.code);
  }

  tick(now: number) {
    for (const r of this.rooms.values()) r.tick(now);
  }

  get count() {
    return this.rooms.size;
  }
}
