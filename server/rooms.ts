// Battle royale rooms: who's in, who hosts, who's still alive, who won, and the NET_HZ car snapshots.
// No networking here, so it is testable.
import { newerState, packSnapshot, stampTraffic, stateD, stateStamp } from '../src/net/codec.ts';
import { MAX_PLAYERS, type PlayerInfo, type Result, type ServerMessage } from '../src/net/protocol.ts';

export const COUNTDOWN_MS = 3000;

type Send = (m: ServerMessage | Uint8Array) => void;
type Member = { info: PlayerInfo; send: Send; alive: boolean; slot: number; latest: Uint8Array | null; at: number; stamp: number | null; d: number }; // d: last reported road position (m); stamp: the newest state's own time stamp

export class Room {
  readonly code: string;
  host = '';
  racing = false;
  spec: string | null = null; // garage car id whose figures everyone drives with, or null: each their own
  private members = new Map<string, Member>();
  private out: Result[] = []; // eliminated this race, first out first

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
    this.members.set(info.id, { info, send, alive: false, slot: -1, latest: null, at: 0, stamp: null, d: 0 });
    if (!this.host) this.host = info.id;
    send({ t: 'joined', you: info.id, room: this.code, host: this.host, players: this.players, racing: this.racing, spec: this.spec });
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

  private broadcastLobby(except?: string) {
    this.broadcast({ t: 'lobby', host: this.host, players: this.players, spec: this.spec }, except);
  }

  start(by: string) {
    if (by !== this.host || this.racing || !this.members.size) return;
    this.racing = true;
    this.out = [];
    const grid = [...this.members.keys()].sort(() => Math.random() - 0.5);
    grid.forEach((id, slot) => Object.assign(this.members.get(id)!, { alive: true, slot, latest: null, stamp: null, d: 0 }));
    this.broadcast({ t: 'go', startsIn: COUNTDOWN_MS, grid });
  }

  /** A player's car (raw binary, already size-checked), simulated at server time `at` (see `stateTime`): kept until the next tick. */
  setState(id: string, raw: Uint8Array, at: number) {
    const m = this.members.get(id);
    if (!this.racing || !m?.alive || !newerState(raw, m.stamp)) return; // not newer than what we have: out of order or repeated (UDP)
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
    const fresh = [...this.members.values()].filter((m) => m.latest);
    const cars = fresh.map((m) => ({ slot: m.slot, at: m.at, raw: m.latest! }));
    for (const m of fresh) m.latest = null;
    if (cars.length) this.broadcast(packSnapshot(now, cars));
  }

  /** A player reports their own elimination. */
  eliminate(id: string, reason: 'crash' | 'wall' | 'left') {
    const m = this.members.get(id);
    if (!this.racing || !m?.alive) return;
    m.alive = false;
    this.out.push({ id, name: m.info.name, out: reason, d: m.d });
    const place = this.alive().length + 1;
    this.broadcast({ t: 'out', id, reason, place });
    this.checkWinner();
  }

  /** Sends to everyone in the room except `except`. */
  broadcast(msg: ServerMessage | Uint8Array, except?: string) {
    for (const [id, m] of this.members) if (id !== except) m.send(msg);
  }

  private alive() {
    return [...this.members.entries()].filter(([, m]) => m.alive).map(([id]) => id);
  }

  /** Race over when one driver is left (or none, in a solo room). */
  private checkWinner() {
    if (!this.racing) return;
    const alive = this.alive(), field = alive.length + this.out.length;
    if (alive.length > 1 || (alive.length === 1 && field === 1)) return;
    const ranking = [...alive.map((id): Result => ({ id, name: this.members.get(id)!.info.name, out: null, d: this.members.get(id)!.d })), ...[...this.out].reverse()];
    this.racing = false;
    this.broadcast({ t: 'winner', id: ranking[0]?.id ?? null, ranking });
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
