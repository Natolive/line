// The shape of the land beside the road: height (m, road level = 0) at road position (d, lateral x).
// Pure, so the land is the same for every player and unit-testable. The road itself is always at 0:
// the land rises into cuttings and hills around it, falls away under bridges, and is dug out for tunnels.
import { ROADSIDE } from '../core/config.ts';
import { THEMES } from '../data/themes.ts';
import { themeBlend } from './themes.ts';
import { hash, overpassesIn, structuresIn, type Structure } from './track.ts';

const C = ROADSIDE.corridor;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 at a, 1 at b (either order), eased. */
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), e = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
}
/** Smooth noise in [0, 1) with detail at three scales. */
const fbm = (x: number, y: number) => 0.55 * noise(x, y) + 0.3 * noise(x * 2.1 + 5.3, y * 2.1 - 1.7) + 0.15 * noise(x * 4.3 - 2.9, y * 4.3 + 8.1);

function terraced(h: number, step: number) {
  if (step <= 0 || h <= 0) return h;
  const k = h / step, f = k - Math.floor(k);
  return step * (Math.floor(k) + smooth(0.7, 1, f));
}

/** The natural land, before structures dig into it. */
function land(d: number, x: number) {
  const ax = Math.abs(x), { from, to, t } = themeBlend(d, THEMES.length);
  const a = THEMES[from].relief, b = THEMES[to].relief;
  const ranges = a.ranges + (b.ranges - a.ranges) * t;
  // right by the road the ground is shaped into gentle cuttings and embankments, then rolls away
  // (each theme's hills at their own size, crossfaded: blending the size itself would sweep the noise)
  const roll = (r: typeof a) => r.hills * (fbm(d / r.size, x / r.size) * 2 - 0.8);
  let h = (t > 0 ? roll(a) * (1 - t) + roll(b) * t : roll(a)) * smooth(C - 8, C + 45, ax);
  // ridges further out: hills in the country, mountains in the mountains
  const ridge = 1 - Math.abs(2 * fbm(d / 700 + 31, x / 700) - 1);
  h += ranges * smooth(90, 650, ax) * (0.25 + 0.75 * ridge);
  // mesas: flat tops and steep risers, crossfaded like the rest
  return terraced(h, a.terraces) * (1 - t) + terraced(h, b.terraces) * t;
}

/** How a tunnel or bridge reshapes the land at (d, x) that would otherwise be at height `h`. */
function shape(s: Structure, d: number, x: number, h: number) {
  const ax = Math.abs(x), mid = (s.from + s.to) / 2, half = (s.to - s.from) / 2, off = Math.abs(d - mid);
  if (s.kind === 'tunnel') {
    // the hill it goes through: high enough over the vault, rising away from the road, with approach cuttings
    const k = smooth(half + 140, half - 10, off);
    const hill = ROADSIDE.tunnelHeight + 6 + Math.min(Math.max(0, ax - C), 150) * 0.45 + 30 * fbm(d / 150, x / 150);
    return Math.max(h, hill * k);
  }
  if (s.kind === 'viaduct') {
    // a valley running across the road, deepest under the middle of the bridge
    const floor = -s.depth * smooth(half + 50, half * 0.4, off) + 4 * (fbm(d / 60, x / 90) - 0.5) * smooth(half + 50, half, off);
    const w = smooth(half + 110, half + 50, off);
    return h + (floor - h) * w;
  }
  // a lake: its shore wanders away from the bridge, which crosses it from shore to shore
  const shore = half + 20 + smooth(60, 300, ax) * (fbm(x / 300, mid) - 0.3) * 160;
  const w = smooth(shore + 220, shore - 20, off);
  return h + (-(s.depth + 4) - h) * w;
}

/** Height of the land at road position `d`, `x` meters from the centre line. */
export function terrainHeight(d: number, x: number) {
  let h = land(d, x);
  for (const s of structuresIn(d - 260, d + 260)) h = shape(s, d, x, h);
  const ax = Math.abs(x);
  for (const o of overpassesIn(d - 30, d + 30)) {
    // the local road climbs onto an embankment to cross: a flat top as wide as its deck, 1:1.5 slopes
    const top = ROADSIDE.overpassClear + 1.4, w = smooth(8 + top * 1.5, 8, Math.abs(d - o)) * smooth(C + 2, C + 6, ax) * smooth(450, 300, ax);
    h += (top - h) * w;
  }
  return h;
}

/** Height of the ground under the road itself (seen only from bridges): below the road and both verges. */
export const floorHeight = (d: number) => Math.min(-0.3, terrainHeight(d, -C), terrainHeight(d, C)) - 0.2;

/** Water level at `d` (m), or null where there is none: lakes and rivers under bridges. */
export function waterAt(d: number) {
  const s = structuresIn(d - 300, d + 300).find((s) => s.water);
  return s ? waterLevel(s) : null;
}

/** A lake lies just under its bridge; a river runs along the bottom of its valley. */
export const waterLevel = (s: Structure) => (s.kind === 'lake' ? -s.depth : -s.depth + 2.5);
