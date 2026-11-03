// End-to-end netcode check against a running server: A drives (lane changes, braking) and sends with
// jitter and loss; B draws it the way the game does and measures the gap to the real car and how smooth it is.
// Run: docker compose exec server node scripts/net-soak.ts [jitter ms = 25] [loss 0..1 = 0]
import WebSocket from 'ws';
import { BIN, decodeSnapshot, encodeState } from '../src/net/codec.ts';
import { addReport, present, track } from '../src/net/interp.ts';

const URL = 'ws://localhost:8080/ws', ROOM = 'SOAK' + Math.floor(Math.random() * 90 + 10);
const JITTER = Number(process.argv[2] ?? 25); // ms of random delay on each send
const LOSS = Number(process.argv[3] ?? 0); // share of sends dropped
const open = (name: string) => new Promise<WebSocket>((ok) => { const w = new WebSocket(URL); w.binaryType = 'arraybuffer'; w.on('open', () => { w.send(JSON.stringify({ t: 'join', room: ROOM, name, car: 'x' })); ok(w); }); });
async function offset(w: WebSocket) { // best of 10 pings
  let best = Infinity, off = 0;
  for (let i = 0; i < 10; i++) {
    const c = performance.now();
    w.send(JSON.stringify({ t: 'ping', c }));
    const s: number = await new Promise((ok) => { const f = (m: any, bin: boolean) => { if (!bin) { const j = JSON.parse(String(m)); if (j.t === 'pong') { w.off('message', f); ok(j.s); } } }; w.on('message', f); });
    const rtt = performance.now() - c;
    if (rtt < best) { best = rtt; off = s + rtt / 2 - performance.now(); }
  }
  return off;
}
const a = await open('A'), b = await open('B');
const offA = await offset(a), offB = await offset(b);
let grid: string[] = [];
b.on('message', (m: any, bin: boolean) => { if (!bin) { const j = JSON.parse(String(m)); if (j.t === 'go') grid = j.grid; } });
a.send(JSON.stringify({ t: 'start' }));
await new Promise((r) => setTimeout(r, 300));

// A's truth: 30 m/s, a lane change every 2 s, a hard brake at 4 s
const truth = (t: number) => { // t in s
  const tb = Math.max(0, Math.min(t - 4, 4 / 3)); // braking 9 m/s² from 30 to 18 m/s
  const speed = 30 - 9 * tb, d = 30 * Math.min(t, 4) + 30 * tb - 4.5 * tb * tb + 18 * Math.max(0, t - 4 - 4 / 3);
  const phase = (t % 2) / 2, x = 1.8 - 1.8 * Math.cos(Math.PI * Math.min(1, phase * 2) + Math.PI * (Math.floor(t / 2) % 2));
  return { d, x, speed, heading: 0 };
};
const t0 = performance.now(), DUR = 6;
const sendTimer = setInterval(() => {
  const t = (performance.now() - t0) / 1000, s = truth(t), stamp = performance.now() + offA;
  const dx = truth(t + 0.001).x - s.x;
  if (Math.random() >= LOSS) setTimeout(() => a.send(encodeState({ ...s, heading: Math.asin(Math.max(-1, Math.min(1, dx / 0.001 / s.speed))), steer: 0, brake: false, score: 0 }, stamp)), Math.random() * JITTER);
}, 1000 / 30);

const tr = track();
b.on('message', (m: any, bin: boolean) => {
  if (!bin) return;
  const buf = new Uint8Array(m as ArrayBuffer);
  if (buf[0] !== BIN.SNAPSHOT) return;
  const snap = decodeSnapshot(buf);
  for (const c of snap.cars) if (grid[c.slot] !== undefined) addReport(tr, { t: snap.time - c.age, ...c.state }, performance.now() + offB);
});
const errs: number[] = [], xs: number[] = [], ts: number[] = [];
let last = performance.now();
const frame = setInterval(() => {
  const now = performance.now(), dt = (now - last) / 1000; last = now;
  const p = present(tr, now + offB, dt), t = (now - t0) / 1000;
  if (p && t > 0.5 && t < DUR) { const real = truth(t); errs.push(Math.hypot(p.d - real.d, p.x - real.x)); xs.push(p.d); ts.push(now); }
}, 1000 / 60);
await new Promise((r) => setTimeout(r, DUR * 1000));
clearInterval(sendTimer); clearInterval(frame);
errs.sort((p, q) => p - q);
// smoothness: per-frame change in drawn speed (m/s); a stutter shows as a spike
const v = xs.slice(1).map((d, i) => ((d - xs[i]) * 1000) / (ts[i + 1] - ts[i])), dv = v.slice(1).map((s, i) => Math.abs(s - v[i])).sort((p, q) => p - q);
const q = (arr: number[], k: number) => arr[Math.floor(arr.length * k)].toFixed(3);
console.log(`jitter ${JITTER} ms, loss ${LOSS * 100}%, ${errs.length} frames | gap to the real car (m): median ${q(errs, 0.5)}, p95 ${q(errs, 0.95)}, max ${errs[errs.length - 1].toFixed(3)} | frame-to-frame speed change (m/s): median ${q(dv, 0.5)}, p99 ${q(dv, 0.99)}`);
process.exit(0);
