// Battle royale rooms: who's in, who hosts, who's still alive, who won, and the 30 Hz car snapshots.
// No networking here, so it is testable.
import { packSnapshot, stampTraffic } from '../src/net/codec.ts';
import { MAX_PLAYERS, type PlayerInfo, type ServerMessage } from '../src/net/protocol.ts';

export const COUNTDOWN_MS = 3000;

type Send = (m: ServerMessage | Uint8Array) => void;
type Member = { info: PlayerInfo; send: Send; alive: boolean; slot: number; latest: Uint8Array | null };

export class Room {
  readonly code: string;
  host = '';
  racing = false;
  private members = new Map<string, Member>();
  private out: string[] = []; // eliminated this race, first out first

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
    this.members.set(info.id, { info, send, alive: false, slot: -1, latest: null });
    if (!this.host) this.host = info.id;
    send({ t: 'joined', you: info.id, room: this.code, host: this.host, players: this.players, racing: this.racing });
    this.broadcast({ t: 'lobby', host: this.host, players: this.players }, info.id);
    return null;
  }

  leave(id: string) {
    const m = this.members.get(id);
    if (!m) return;
    if (this.racing && m.alive) this.eliminate(id, 'left');
    this.members.delete(id);
    if (this.host === id) this.host = this.members.keys().next().value ?? ''; // the next player takes over (and the traffic)
    this.broadcast({ t: 'lobby', host: this.host, players: this.players });
    this.checkWinner();
  }

  setCar(id: string, car: string) {
    const m = this.members.get(id);
    if (!m || this.racing) return;
    m.info.car = car;
    this.broadcast({ t: 'lobby', host: this.host, players: this.players });
  }

  start(by: string) {
    if (by !== this.host || this.racing || !this.members.size) return;
    this.racing = true;
    this.out = [];
    const grid = [...this.members.keys()].sort(() => Math.random() - 0.5);
    grid.forEach((id, slot) => Object.assign(this.members.get(id)!, { alive: true, slot, latest: null }));
    this.broadcast({ t: 'go', startsIn: COUNTDOWN_MS, grid });
  }

  /** A player's car (raw binary, already size-checked): kept until the next tick. */
  setState(id: string, raw: Uint8Array) {
    const m = this.members.get(id);
    if (this.racing && m?.alive) m.latest = raw;
  }

  /** The host's traffic, relayed at once with the server time stamped in. */
  relayTraffic(id: string, raw: Uint8Array, now: number) {
    if (this.racing && id === this.host) this.broadcast(stampTraffic(raw, now), id);
  }

  /** One server tick: a single snapshot of every car to every player (instead of each message to each player). */
  tick(now: number) {
    if (!this.racing) return;
    const cars = [...this.members.values()].filter((m) => m.latest).map((m) => ({ slot: m.slot, raw: m.latest! }));
    if (cars.length) this.broadcast(packSnapshot(now, cars));
  }

  /** A player reports their own elimination. */
  eliminate(id: string, reason: 'crash' | 'wall' | 'left') {
    const m = this.members.get(id);
    if (!this.racing || !m?.alive) return;
    m.alive = false;
    this.out.push(id);
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
    const ranking = [...alive, ...[...this.out].reverse()];
    this.racing = false;
    this.broadcast({ t: 'winner', id: ranking[0] ?? null, ranking });
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
