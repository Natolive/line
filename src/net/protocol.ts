// Messages between the game and the server (server/index.ts). Shared by both, so they can't drift apart.
// Rare control messages are JSON (below); cars and traffic go as binary frames (codec.ts).
// Positions are along the road: `d` = meters from the start line, `x` = lateral (+ = right).

export type PlayerInfo = { id: string; name: string; car: string };

export type OutReason = 'crash' | 'wall' | 'left' | 'late'; // late: still short of the finish line when the race closed

/**
 * A line of the final ranking: how far each driver got (m along the road), how they went out (null: the battle
 * royale's last one standing, or a race finisher) and, in a race, their time to the finish line (ms, else null).
 */
export type Result = { id: string; name: string; out: OutReason | null; d: number; time: number | null };

/** A room's mode: null = battle royale (a storm wall chases the pack), else a race to a finish line this many m from the start. */
export type Mode = number | null;
export const RACE_LENGTHS = [5000, 10000, 20000]; // m, the races a host can choose
export const RACE_GRACE_MS = 60_000; // once the winner is home, how long the others have to finish
export const FINISH_SLACK = 60; // m a finish claim may be ahead of the driver's last reported position (their latest frames)

/** A player's car, sent NET_HZ times a second by its own game (binary, see codec.ts). */
export type CarState = {
  d: number;
  x: number;
  heading: number;
  speed: number;
  steer: number;
  brake: boolean;
  score: number;
};

/** One traffic car, as simulated by the room host. */
export type TrafficCar = { id: number; model: number; heavy: boolean; d: number; x: number; speed: number; brake: boolean; blink: -1 | 0 | 1; yaw: number };

export type ClientMessage =
  | { t: 'join'; room: string; name: string; car: string }
  | { t: 'car'; car: string } // changed car in the lobby
  | { t: 'spec'; car: string | null } // host only, in the lobby: everyone drives with this garage car's figures (id), or each their own (null)
  | { t: 'mode'; mode: Mode } // host only, in the lobby
  | { t: 'finish'; at: number } // I crossed the finish line, at this server time (ms; the moment within my frame)
  | { t: 'start' } // host only
  | { t: 'out'; reason: 'crash' | 'wall'; d: number } // I'm eliminated
  | { t: 'ping'; c: number } // client clock (ms), for round trip and clock sync
  | Rtc;

/** WebRTC set-up, both ways: the game offers a UDP channel for the binary frames, the server answers (server/rtc.ts). */
type Rtc = { t: 'rtc'; sdp: string } | { t: 'ice'; c: string; mid: string };

export type ServerMessage =
  | { t: 'joined'; you: string; room: string; host: string; players: PlayerInfo[]; racing: boolean; spec: string | null; mode: Mode }
  | { t: 'lobby'; host: string; players: PlayerInfo[]; spec: string | null; mode: Mode } // spec, mode: see the client messages
  | { t: 'error'; message: string }
  | { t: 'go'; startsIn: number; grid: string[]; seed: number; mode: Mode } // countdown in ms; grid = starting order, index = slot in snapshots; seed = the map (rules/track.ts)
  | { t: 'pong'; c: number; s: number } // c: the ping's client clock, s: server clock (ms)
  | { t: 'out'; id: string; reason: OutReason; place: number }
  | { t: 'finish'; id: string; place: number; time: number } // a race: `id` crossed the line, `time` ms after the start
  | { t: 'winner'; id: string | null; ranking: Result[] } // ranking: winner first
  | Rtc;

export const MAX_PLAYERS = 16;

/** Hz: how often each game sends its car and the server sends a snapshot. 60 halves the latency and the guess of 30, for ~20 KB/s per player. */
export const NET_HZ = 60;
