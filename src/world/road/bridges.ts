// Bridges carrying the motorway: the deck, parapets and lamps, piers down to the valley or lake bed, and the
// lake bridge's cable-stayed towers.
import * as THREE from 'three';
import { floorHeight, waterLevel } from '../../rules/terrain.ts';
import { structuresIn, type Structure } from '../../rules/track.ts';
import type { Mesher } from '../mesher.ts';
import type { RoadPaints } from './paints.ts';
import { CONCRETE_TILE, DECK, every, RH, sideBox, type Build } from './piece.ts';

const PIER_EVERY = 40, LAMP_EVERY = 30; // m
const PARAPET = 0.35; // m thick, 1 m high
const TOWER = 46, STAYS = 7, STAY_EVERY = 10; // m tall above the deck; cables per side of each tower, m apart on the deck
const UP = new THREE.Vector3(0, 0, 1);

export function bridges(b: Build, p: RoadPaints) {
  for (const rows of b.runs((m) => m === 'bridge')) deck(b, p, rows);
  for (const s of structuresIn(b.d0, b.d1)) {
    if (s.kind === 'tunnel') continue;
    supports(b.mesher(p.concrete), s, b.d0, b.d1);
    const mid = (s.from + s.to) / 2;
    if (s.kind === 'lake' && mid >= b.d0 && mid < b.d1) cableTowers(b.mesher(p.concrete), mid, waterLevel(s));
  }
}

/** The deck under the road, a parapet and painted fascia on each edge, lamp posts staggered along the parapets. */
function deck(b: Build, p: RoadPaints, rows: number[]) {
  const w = RH + PARAPET;
  b.mesher(p.concrete).sweepFlat(rows, () => [[w, 0], [w, -DECK], [-w, -DECK], [-w, 0]], CONCRETE_TILE, b.v0(rows));
  for (const s of [-1, 1]) {
    b.mesher(p.concrete).sweepFlat(rows, () => sideBox(s, RH, w, -0.05, 1), CONCRETE_TILE);
    b.mesher(p.steel).sweepFlat(rows, () => sideBox(s, w, w + 0.1, -0.9, -0.1), 1);
  }
  for (const d of every(LAMP_EVERY, rows[0], rows[rows.length - 1])) {
    const s = (Math.round(d / LAMP_EVERY) % 2) * 2 - 1;
    lampPost(b.mesher(p.steel), b.mesher(p.streetLamp), d, s * (RH + 0.2), 1, -s * 2.6);
  }
}

/** A lamp post at road point (d, x) standing at height `y`, its head on an arm `arm` m out along x (none when 0). */
export function lampPost(m: Mesher, head: Mesher, d: number, x: number, y: number, arm: number) {
  m.solid(new THREE.BoxGeometry(0.18, 8, 0.18).translate(0, 4, 0), d, x, y);
  if (arm) m.solid(new THREE.BoxGeometry(Math.abs(arm), 0.12, 0.12), d, x + arm / 2, y + 7.95);
  head.solid(new THREE.BoxGeometry(arm ? 0.9 : 0.5, 0.15, arm ? 0.35 : 0.5), d, x + arm, y + 7.85 + (arm ? 0 : 0.2));
}

/** Abutments at both ends of a bridge and piers every ~40 m, down to the valley floor or the lake bed. */
function supports(m: Mesher, s: Structure, d0: number, d1: number) {
  const n = Math.max(1, Math.round((s.to - s.from) / PIER_EVERY)), step = (s.to - s.from) / n;
  for (let i = 0; i <= n; i++) {
    const d = s.from + i * step;
    if (d < d0 || d >= d1) continue;
    const bottom = Math.min(floorHeight(d), s.water ? waterLevel(s) - 4 : Infinity) - 2, top = -DECK, h = top - bottom;
    if (h <= 0) continue;
    if (i === 0 || i === n) m.solid(new THREE.BoxGeometry(2 * RH + 0.7, h, 2.5).translate(0, bottom + h / 2, 0), d + (i === 0 ? 1.25 : -1.25), 0, 0);
    else pier(m, d, top, bottom);
  }
}

/** Two columns on footings, flared heads under a cap beam, tied halfway down when tall. */
function pier(m: Mesher, d: number, top: number, bottom: number) {
  const h = top - bottom;
  m.solid(new THREE.BoxGeometry(2 * RH - 2, 1.2, 2.6).translate(0, top - 0.6, 0), d, 0, 0);
  for (const x of [-5, 5]) {
    m.solid(new THREE.BoxGeometry(2.2, h - 1.2, 2.2).translate(0, bottom + (h - 1.2) / 2, 0), d, x, 0);
    m.solid(new THREE.BoxGeometry(3.4, 1.4, 3.4).translate(0, top - 1.9, 0), d, x, 0);
    m.solid(new THREE.BoxGeometry(4.4, 2, 4.4).translate(0, bottom + 1, 0), d, x, 0);
  }
  if (h > 14) m.solid(new THREE.BoxGeometry(8, 1, 1.4).translate(0, bottom + h * 0.5, 0), d, 0, 0);
}

/** The lake bridge's landmark: two tall towers at mid-span, a crossbeam over the road, a fan of stays to each parapet. */
function cableTowers(m: Mesher, mid: number, water: number) {
  const x = RH + 1.4;
  for (const s of [-1, 1]) {
    m.solid(new THREE.BoxGeometry(2.4, TOWER - water + 2, 3).translate(0, (TOWER + water - 2) / 2, 0), mid, s * x, 0);
    m.solid(new THREE.BoxGeometry(1.6, 4, 2).translate(0, TOWER + 2, 0), mid, s * x, 0);
    for (let k = 1; k <= STAYS; k++) {
      for (const dir of [-1, 1]) m.solid(cable(new THREE.Vector3(0, TOWER - k * 2.4, 0), new THREE.Vector3(0, 1, -dir * k * STAY_EVERY)), mid, s * x, 0);
    }
  }
  m.solid(new THREE.BoxGeometry(2 * x + 2.4, 2, 2.4).translate(0, TOWER - 4, 0), mid, 0, 0);
}

/** A thin straight cable from `a` to `b`. */
function cable(a: THREE.Vector3, b: THREE.Vector3) {
  const v = b.clone().sub(a);
  return new THREE.BoxGeometry(0.14, 0.14, v.length())
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, v.normalize()))
    .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
