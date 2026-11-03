// Binary encoding for the frequent messages (cars 30×/s, traffic 15×/s). JSON stays for rare control messages.
// Values are quantised to what the game can show: x to the centimetre, speed to the cm/s, angles to 0.1 mrad.
import type { CarState, TrafficCar } from './protocol.ts';

export const BIN = { STATE: 1, SNAPSHOT: 2, TRAFFIC: 3 } as const;

const STATE_BYTES = 16; // d f32, x i16, heading i16, speed u16, steer i8, flags u8, score u32
const TRAFFIC_BYTES = 13; // id u16, model u8, flags u8, d f32, x i16, speed u16, yaw i8
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function writeState(v: DataView, o: number, s: CarState) {
  v.setFloat32(o, s.d);
  v.setInt16(o + 4, clampInt(s.x * 100, -32768, 32767));
  v.setInt16(o + 6, clampInt(s.heading * 10000, -32768, 32767));
  v.setUint16(o + 8, clampInt(s.speed * 100, 0, 65535));
  v.setInt8(o + 10, clampInt(s.steer * 200, -128, 127));
  v.setUint8(o + 11, s.brake ? 1 : 0);
  v.setUint32(o + 12, clampInt(s.score, 0, 0xffffffff));
}

function readState(v: DataView, o: number): CarState {
  return {
    d: v.getFloat32(o),
    x: v.getInt16(o + 4) / 100,
    heading: v.getInt16(o + 6) / 10000,
    speed: v.getUint16(o + 8) / 100,
    steer: v.getInt8(o + 10) / 200,
    brake: (v.getUint8(o + 11) & 1) === 1,
    score: v.getUint32(o + 12),
  };
}

/** Client → server: my car. */
export function encodeState(s: CarState) {
  const buf = new Uint8Array(1 + STATE_BYTES), v = new DataView(buf.buffer);
  v.setUint8(0, BIN.STATE);
  writeState(v, 1, s);
  return buf;
}

export const decodeState = (buf: Uint8Array) => readState(new DataView(buf.buffer, buf.byteOffset, buf.byteLength), 1);

/** Server → clients: every player's latest car, stamped with the server time (ms). `slot` = grid position. */
export function encodeSnapshot(time: number, cars: { slot: number; state: CarState }[]) {
  const buf = new Uint8Array(10 + cars.length * (1 + STATE_BYTES)), v = new DataView(buf.buffer);
  v.setUint8(0, BIN.SNAPSHOT);
  v.setFloat64(1, time);
  v.setUint8(9, cars.length);
  cars.forEach((c, i) => {
    const o = 10 + i * (1 + STATE_BYTES);
    v.setUint8(o, c.slot);
    writeState(v, o + 1, c.state);
  });
  return buf;
}

export function decodeSnapshot(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), n = v.getUint8(9);
  return {
    time: v.getFloat64(1),
    cars: Array.from({ length: n }, (_, i) => {
      const o = 10 + i * (1 + STATE_BYTES);
      return { slot: v.getUint8(o), state: readState(v, o + 1) };
    }),
  };
}

/** Server: builds a snapshot by copying each player's raw state bytes (as received) without decoding them. */
export function packSnapshot(time: number, cars: { slot: number; raw: Uint8Array }[]) {
  const buf = new Uint8Array(10 + cars.length * (1 + STATE_BYTES)), v = new DataView(buf.buffer);
  v.setUint8(0, BIN.SNAPSHOT);
  v.setFloat64(1, time);
  v.setUint8(9, cars.length);
  cars.forEach((c, i) => {
    const o = 10 + i * (1 + STATE_BYTES);
    buf[o] = c.slot;
    buf.set(c.raw.subarray(1, 1 + STATE_BYTES), o + 1);
  });
  return buf;
}

/** Sizes the server accepts, so a malformed frame is dropped before it's read. */
export const isState = (buf: Uint8Array) => buf.byteLength === 1 + STATE_BYTES && buf[0] === BIN.STATE;
export const isTraffic = (buf: Uint8Array) =>
  buf[0] === BIN.TRAFFIC && buf.byteLength >= 11 && buf.byteLength <= 11 + 120 * TRAFFIC_BYTES && (buf.byteLength - 11) % TRAFFIC_BYTES === 0;

/** Host → server → clients: the traffic. The server stamps its time into bytes 1-8 when relaying. */
export function encodeTraffic(cars: TrafficCar[], time = 0) {
  const buf = new Uint8Array(11 + cars.length * TRAFFIC_BYTES), v = new DataView(buf.buffer);
  v.setUint8(0, BIN.TRAFFIC);
  v.setFloat64(1, time);
  v.setUint16(9, cars.length);
  cars.forEach((c, i) => {
    const o = 11 + i * TRAFFIC_BYTES;
    v.setUint16(o, c.id & 0xffff);
    v.setUint8(o + 2, c.model);
    v.setUint8(o + 3, (c.heavy ? 1 : 0) | (c.brake ? 2 : 0) | ((c.blink + 1) << 2));
    v.setFloat32(o + 4, c.d);
    v.setInt16(o + 8, clampInt(c.x * 100, -32768, 32767));
    v.setUint16(o + 10, clampInt(c.speed * 100, 0, 65535));
    v.setInt8(o + 12, clampInt(c.yaw * 200, -128, 127));
  });
  return buf;
}

export function decodeTraffic(buf: Uint8Array): { time: number; cars: TrafficCar[] } {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), n = v.getUint16(9);
  return {
    time: v.getFloat64(1),
    cars: Array.from({ length: n }, (_, i) => {
      const o = 11 + i * TRAFFIC_BYTES, flags = v.getUint8(o + 3);
      return {
        id: v.getUint16(o), model: v.getUint8(o + 2), heavy: (flags & 1) === 1, brake: (flags & 2) === 2, blink: (((flags >> 2) & 3) - 1) as -1 | 0 | 1,
        d: v.getFloat32(o + 4), x: v.getInt16(o + 8) / 100, speed: v.getUint16(o + 10) / 100, yaw: v.getInt8(o + 12) / 200,
      };
    }),
  };
}

/** Stamps the relay time into a traffic message (server side). */
export function stampTraffic(buf: Uint8Array, time: number) {
  const copy = buf.slice();
  new DataView(copy.buffer).setFloat64(1, time);
  return copy;
}
