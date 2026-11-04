// The road's shape and what it runs through. Everything is a pure function of `d` (meters from the start
// line), so every player builds the same road without sending it over the network.
//
// World frame: x right, z back (forward is -z), heading 0 = toward -z, + = turned right. The road is a
// chain of TRACK.piece pieces, each straight or one bend whose curvature eases in and out linearly (a
// clothoid, as real roads are laid out). Gameplay stays in road coordinates (d, lateral x); only drawing
// needs the frame.
import { ROADSIDE, TRACK } from '../core/config.ts';
import { THEMES, ZONE_LENGTH } from '../data/themes.ts';
import { setFirstTheme, themeIndexAt } from './themes.ts';

let seed = 0;

/**
 * Picks the map: every run draws a new seed (a room shares its own), which decides the region the start
 * line is in, the bends, the tunnels and bridges, the land and the scenery. Same seed, same map.
 */
export function setSeed(s: number) {
  seed = s >>> 0;
  setFirstTheme(seed % THEMES.length);
  heading.length = px.length = pz.length = 1;
  zones.clear();
  overpassSlots.clear();
}

/** Deterministic noise in [0, 1) from two integers (and the map's seed). */
export function hash(a: number, b = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca77) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const themeAt = (d: number) => THEMES[themeIndexAt(d, THEMES.length)];

/** A stream of deterministic random numbers in [0, 1) for slot `n` of the map (e.g. one scenery section). */
export function randomFor(n: number) {
  let i = 0;
  return () => hash(n, 1000 + i++);
}

/** Signed curvature (1/m, + = bends right) at full lock of piece `k`. */
function pieceCurvature(k: number) {
  if (k * TRACK.piece < TRACK.straightStart) return 0;
  const c = themeAt((k + 0.5) * TRACK.piece).curves;
  if (hash(k, 1) < c.straight) return 0;
  const r = c.minRadius + hash(k, 2) * (c.maxRadius - c.minRadius);
  const side = (k % 2 ? 1 : -1) * (hash(k, 3) < 0.75 ? 1 : -1); // bends mostly alternate, as roads follow the land
  return side / r;
}

/** Curvature (1/m) at `d`. */
export function curvatureAt(d: number) {
  if (d <= 0) return 0;
  const k = Math.floor(d / TRACK.piece), u = d - k * TRACK.piece;
  return pieceCurvature(k) * Math.max(0, Math.min(1, u / TRACK.transition, (TRACK.piece - u) / TRACK.transition));
}

// Heading and position sampled every TRACK.step meters from the start, extended on demand. Curvature is
// linear between samples (piece and transition lengths are multiples of the step), so heading is exact.
const heading = [0], px = [0], pz = [0];
function extendTo(i: number) {
  const S = TRACK.step;
  for (let n = heading.length; n <= i; n++) {
    const k0 = curvatureAt((n - 1) * S), k1 = curvatureAt(n * S), h0 = heading[n - 1];
    const h1 = h0 + (S * (k0 + k1)) / 2, hm = h0 + (S / 2) * ((3 * k0 + k1) / 4);
    // Simpson's rule on the direction of travel
    px.push(px[n - 1] + (S / 6) * (Math.sin(h0) + 4 * Math.sin(hm) + Math.sin(h1)));
    pz.push(pz[n - 1] - (S / 6) * (Math.cos(h0) + 4 * Math.cos(hm) + Math.cos(h1)));
    heading.push(h1);
  }
}

export type Frame = { x: number; z: number; heading: number; curvature: number };

/** Where the centre line is at `d`, which way it points and how much it bends. */
export function frameAt(d: number): Frame {
  if (d <= 0) return { x: 0, z: -d, heading: 0, curvature: 0 };
  const S = TRACK.step, i = Math.floor(d / S), u = d - i * S;
  extendTo(i + 1);
  const k0 = curvatureAt(i * S), k1 = curvatureAt((i + 1) * S);
  const h = heading[i] + k0 * u + ((k1 - k0) * u * u) / (2 * S);
  const hm = heading[i] + (k0 * u) / 2 + ((k1 - k0) * u * u) / (8 * S);
  return { x: px[i] + u * Math.sin(hm), z: pz[i] - u * Math.cos(hm), heading: h, curvature: k0 + ((k1 - k0) * u) / S };
}

/**
 * Lateral offset to draw something `x` meters from the centre line at curvature `k`. Exact near the road;
 * far out on the inside of a bend it is squeezed so the land never folds over itself past the bend's centre.
 */
export function lateral(x: number, k: number) {
  const ax = Math.abs(x), keep = 60;
  if (ax <= keep || k * x <= 0) return x;
  const room = 0.85 / Math.abs(k) - keep, u = ax - keep;
  return Math.sign(x) * (keep + (room > 0 ? u / (1 + u / room) : 0));
}

// ---- tunnels and bridges ----

export type Structure = { kind: 'tunnel' | 'viaduct' | 'lake'; from: number; to: number; depth: number; water: boolean };

const zones = new Map<number, Structure[]>();

/** Tunnels and bridges of zone `z` (the zone from z × ZONE_LENGTH), in road order. */
export function structuresOf(z: number): Structure[] {
  if (z < 0) return [];
  const cached = zones.get(z);
  if (cached) return cached;
  const t = THEMES[themeIndexAt(z * ZONE_LENGTH, THEMES.length)].structures, R = ROADSIDE;
  const lo = z * ZONE_LENGTH + R.zoneMargin, hi = (z + 1) * ZONE_LENGTH - R.zoneMargin;
  const list: Structure[] = [];
  let seed = 0;
  const r = () => hash(z, 100 + seed++);
  const span = ([a, b]: [number, number]) => a + r() * (b - a);
  const count = (avg: number) => Math.floor(avg) + (r() < avg % 1 ? 1 : 0);
  const fit = (kind: Structure['kind'], length: number, depth: number, water: boolean) => {
    for (let tries = 0; tries < 12; tries++) {
      const from = Math.round(lo + r() * Math.max(0, hi - lo - length)), to = from + Math.round(length);
      if (to > hi || list.some((s) => from < s.to + R.structureGap && to > s.from - R.structureGap)) continue;
      list.push({ kind, from, to, depth, water });
      return;
    }
  };
  if (t.lake) fit('lake', span(R.lakeLength), R.lakeWater, true);
  for (let i = count(t.tunnels); i > 0; i--) fit('tunnel', span(R.tunnelLength), 0, false);
  for (let i = count(t.viaducts); i > 0; i--) fit('viaduct', span(R.viaductLength), span(R.viaductDepth), t.rivers);
  list.sort((a, b) => a.from - b.from);
  zones.set(z, list);
  return list;
}

/** Every tunnel and bridge overlapping [d0, d1]. */
export function structuresIn(d0: number, d1: number) {
  const out: Structure[] = [];
  for (let z = Math.floor(d0 / ZONE_LENGTH); z <= Math.floor(d1 / ZONE_LENGTH); z++) for (const s of structuresOf(z)) if (s.to >= d0 && s.from <= d1) out.push(s);
  return out;
}

/** The tunnel or bridge the road is on at `d`, if any. */
export const structureAt = (d: number) => structuresIn(d, d)[0] ?? null;

/** How deep in a tunnel `d` is: 0 in daylight, 1 once past the portal's fade. */
export function tunnelShade(d: number) {
  const s = structureAt(d);
  if (s?.kind !== 'tunnel') return 0;
  return Math.min(1, (d - s.from) / ROADSIDE.tunnelFade, (s.to - d) / ROADSIDE.tunnelFade);
}

// ---- things placed along the road ----

const clearOfStructures = (d: number, margin: number) => structuresIn(d - margin, d + margin).length === 0;

/** Road positions of the sign gantries in [d0, d1): every ROADSIDE.gantryEvery meters, never in a tunnel or on a bridge. */
export function gantriesIn(d0: number, d1: number) {
  const E = ROADSIDE.gantryEvery, out: number[] = [];
  for (let j = Math.ceil((d0 - E / 2) / E); j * E + E / 2 < d1; j++) {
    const d = j * E + E / 2;
    if (d >= d0 && clearOfStructures(d, 60)) out.push(d);
  }
  return out;
}

const overpassSlots = new Map<number, boolean>();
function overpassAt(j: number) {
  let yes = overpassSlots.get(j);
  if (yes === undefined) {
    const d = j * ROADSIDE.overpassSlot, every = themeAt(d).structures.overpassEvery;
    yes = d >= TRACK.straightStart && every > 0 && hash(j, 7) < ROADSIDE.overpassSlot / every && gantriesIn(d - 80, d + 80).length === 0 && clearOfStructures(d, 150);
    overpassSlots.set(j, yes);
  }
  return yes;
}

/** Road positions of the bridges that carry a local road over the motorway, in [d0, d1). */
export function overpassesIn(d0: number, d1: number) {
  const S = ROADSIDE.overpassSlot, out: number[] = [];
  for (let j = Math.ceil(d0 / S); j * S < d1; j++) if (overpassAt(j)) out.push(j * S);
  return out;
}

/** Road positions to build geometry at between d0 and d1: every `step` meters, plus each tunnel or bridge end, so edges line up. */
export function rowsIn(d0: number, d1: number, step: number) {
  const out: number[] = [];
  for (let d = d0; d < d1 - 1e-6; d += step) out.push(d);
  out.push(d1);
  for (const s of structuresIn(d0, d1)) for (const e of [s.from, s.to]) if (e > d0 && e < d1 && !out.includes(e)) out.push(e);
  return out.sort((a, b) => a - b);
}
