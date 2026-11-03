// Multiplayer server: WebSocket rooms. Control messages are JSON; cars and traffic are binary, and cars go
// out as one 30 Hz snapshot per room (server tick). Run: npm run server
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { BIN, isState, isTraffic } from '../src/net/codec.ts';
import type { ClientMessage, ServerMessage } from '../src/net/protocol.ts';
import { Rooms, type Room } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_HZ = 30;
const rooms = new Rooms();
// no per-message compression: it costs CPU and adds latency on small, frequent frames
const wss = new WebSocketServer({ port: PORT, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: false });

// inputs come from the internet: keep only what we expect
const clean = (s: unknown, max: number, pattern: RegExp) => (typeof s === 'string' && pattern.test(s) ? s.slice(0, max) : null);

wss.on('connection', (ws, req) => {
  req.socket.setNoDelay(true); // send small frames immediately (no Nagle batching)
  const id = randomUUID().slice(0, 8);
  let room: Room | null = null;
  const send = (m: ServerMessage | Uint8Array) => {
    if (ws.readyState === ws.OPEN) ws.send(m instanceof Uint8Array ? m : JSON.stringify(m));
  };

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (!room) return;
      const buf = new Uint8Array(raw as Buffer);
      if (buf[0] === BIN.STATE && isState(buf)) room.setState(id, buf);
      else if (isTraffic(buf)) room.relayTraffic(id, buf, performance.now());
      return;
    }
    let m: ClientMessage;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === 'ping') return send({ t: 'pong', c: Number(m.c) || 0, s: performance.now() });
    if (m.t === 'join' && !room) {
      const code = clean(m.room?.toUpperCase(), 6, /^[A-Z0-9]{4,6}$/);
      const name = clean(m.name, 16, /^[\p{L}\p{N} _.-]{1,16}$/u);
      const car = clean(m.car, 32, /^[a-z0-9-]{1,32}$/);
      if (!code || !name || !car) return send({ t: 'error', message: 'Use a 4-6 letter room code and a name of up to 16 letters.' });
      const r = rooms.get(code), error = r.join({ id, name, car }, send);
      if (error) {
        send({ t: 'error', message: error });
        if (!r.size) rooms.leave(r, id);
      } else room = r;
      return;
    }
    if (!room) return;
    if (m.t === 'car') {
      const car = clean(m.car, 32, /^[a-z0-9-]{1,32}$/);
      if (car) room.setCar(id, car);
    } else if (m.t === 'start') room.start(id);
    else if (m.t === 'out') room.eliminate(id, m.reason === 'wall' ? 'wall' : 'crash');
  });

  ws.on('close', () => room && rooms.leave(room, id));
});

setInterval(() => rooms.tick(performance.now()), 1000 / TICK_HZ);
console.log(`Line multiplayer server on :${PORT}/ws, ${TICK_HZ} Hz tick`);
