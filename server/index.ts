// Multiplayer server: WebSocket rooms. Control messages are JSON; cars and traffic are binary, and cars go
// out as one 30 Hz snapshot per room (server tick). Run: npm run server
// In production (STATIC_DIR set) it also serves the built game, so one container is the whole site.
import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { BIN, isState, isTraffic, stateTime, trafficTime } from '../src/net/codec.ts';
import type { ClientMessage, ServerMessage } from '../src/net/protocol.ts';
import { Rooms, type Room } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : null;
const TICK_HZ = 30;
const rooms = new Rooms();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.md': 'text/markdown; charset=utf-8',
};

/** Health for the CI and Docker, and (production) the built game; Caddy in front does HTTPS and compression. */
const http = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://local').pathname;
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.count }));
  }
  if (!STATIC_DIR || (req.method !== 'GET' && req.method !== 'HEAD')) return res.writeHead(404).end();
  let file = resolve(STATIC_DIR, '.' + decodeURIComponent(path));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) return res.writeHead(403).end(); // no ../ escapes
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    return res.writeHead(404).end();
  }
  // Vite's /assets/ have a content hash in their name: cache forever. Models, skies, textures: a day. Pages: always check.
  const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : file.endsWith('.html') ? 'no-cache' : 'public, max-age=86400';
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

// no per-message compression: it costs CPU and adds latency on small, frequent frames
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: false });

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
      if (buf[0] === BIN.STATE && isState(buf)) room.setState(id, buf, stateTime(buf, performance.now()));
      else if (isTraffic(buf)) room.relayTraffic(id, buf, trafficTime(buf, performance.now()));
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
http.listen(PORT, () => console.log(`Line server on :${PORT} (/ws ${TICK_HZ} Hz tick${STATIC_DIR ? `, game from ${STATIC_DIR}` : ''})`));
