// Messages between the game and the server (server/index.ts). Shared by both, so they can't drift apart.
// Rare control messages are JSON (below); cars and traffic go as binary frames (codec.ts).
// Positions are along the road: `d` = meters from the start line, `x` = lateral (+ = right).

export type PlayerInfo = { id: string; name: string; car: string };

/** A line of the final ranking: how far each driver got (m along the road) and how they went out (null: still racing, the winner). */
export type Result = { id: string; name: string; out: 'crash' | 'wall' | 'left' | null; d: number };

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
  | { t: 'start' } // host only
  | { t: 'out'; reason: 'crash' | 'wall'; d: number } // I'm eliminated
  | { t: 'ping'; c: number } // client clock (ms), for round trip and clock sync
  | Rtc;

/** WebRTC set-up, both ways: the game offers a UDP channel for the binary frames, the server answers (server/rtc.ts). */
type Rtc = { t: 'rtc'; sdp: string } | { t: 'ice'; c: string; mid: string };

export type ServerMessage =
  | { t: 'joined'; you: string; room: string; host: string; players: PlayerInfo[]; racing: boolean; spec: string | null }
  | { t: 'lobby'; host: string; players: PlayerInfo[]; spec: string | null } // spec: see the 'spec' client message
  | { t: 'error'; message: string }
  | { t: 'go'; startsIn: number; grid: string[] } // countdown in ms; grid = starting order, index = slot in snapshots
  | { t: 'pong'; c: number; s: number } // c: the ping's client clock, s: server clock (ms)
  | { t: 'out'; id: string; reason: 'crash' | 'wall' | 'left'; place: number }
  | { t: 'winner'; id: string | null; ranking: Result[] } // ranking: winner first
  | Rtc;

export const MAX_PLAYERS = 16;

/** Hz: how often each game sends its car and the server sends a snapshot. 60 halves the latency and the guess of 30, for ~20 KB/s per player. */
export const NET_HZ = 60;
