// Tunnels: the tube and the hill closed over it, lamps, fans, emergency niches, and a headwall with a sign at each mouth.
import * as THREE from 'three';
import { ROADSIDE } from '../../core/config.ts';
import { terrainHeight } from '../../rules/terrain.ts';
import { structuresIn } from '../../rules/track.ts';
import type { Mesher, Profile } from '../mesher.ts';
import { texV } from '../terrain.ts';
import type { RoadPaints } from './paints.ts';
import { C, CONCRETE_TILE, every, LAND_TILE, RH, sideBox, TH, VAULT, type Build } from './piece.ts';

const H = ROADSIDE.tunnelHeight;
const LAMP_EVERY = 10, REFLECTOR_EVERY = 25, FAN_EVERY = 150; // m
const LAMP = new THREE.BoxGeometry(0.35, 0.1, 1.6), REFLECTOR = new THREE.BoxGeometry(0.08, 0.12, 0.3);
const FAN = new THREE.CylinderGeometry(0.6, 0.6, 4, 10).rotateX(Math.PI / 2), HANGER = new THREE.BoxGeometry(0.15, 0.9, 0.15);
const NICHE = new THREE.BoxGeometry(0.25, 2.2, 1.6).translate(0, 1.1, 0), BAND = new THREE.BoxGeometry(2 * TH + 2, 0.5, 0.4);
const SIGN = new THREE.PlaneGeometry(3.2, 1.6);

/** Inside of the tunnel: floor stubs, walls and vault, traced so every face looks into the tube. */
const VAULT_PROFILE: Profile = [
  [RH, 0], [TH, 0], [TH, VAULT],
  ...Array.from({ length: 11 }, (_, i): [number, number] => {
    const a = (Math.PI * (i + 1)) / 12;
    return [TH * Math.cos(a), VAULT + (H - VAULT) * Math.sin(a)];
  }),
  [-TH, VAULT], [-TH, 0], [-RH, 0],
];

export function tunnels(b: Build, p: RoadPaints) {
  for (const rows of b.runs((m) => m === 'tunnel')) tube(b, p, rows);
  for (const s of structuresIn(b.d0, b.d1)) {
    if (s.kind !== 'tunnel') continue;
    for (const e of [s.from, s.to]) if (e >= b.d0 && e < b.d1) portal(b.mesher(p.headwall), e);
    if (s.from >= b.d0 && s.from < b.d1) {
      // a lit tunnel sign over the way in, on a band of colour across the headwall
      b.group.add(b.pf.place(new THREE.Mesh(SIGN, p.tunnelSign), s.from - 0.3, 0, H + 1.2));
      b.mesher(p.steel).solid(BAND, s.from - 0.25, 0, H + 0.4);
    }
  }
}

/** One stretch of tunnel: vault, hill over it, and what lines it. */
function tube(b: Build, p: RoadPaints, rows: number[]) {
  const from = rows[0], to = rows[rows.length - 1];
  b.mesher(p.concrete).sweep(rows, () => VAULT_PROFILE, CONCRETE_TILE, b.v0(rows));
  const hill = b.mesher(b.land);
  for (const d of rows) {
    const l = terrainHeight(d, -C), r = terrainHeight(d, C);
    for (const [x, y] of [[-C, l], [0, (l + r) / 2 + 1], [C, r]]) hill.vertex(d, x, y, x / LAND_TILE, texV(b.d0, d) / LAND_TILE, b.blend(d));
  }
  hill.grid(rows.length, 3);
  for (const s of [-1, 1]) {
    b.mesher(p.steel).sweepFlat(rows, () => sideBox(s, TH - 0.06, TH, 0.9, 2.4), 1); // painted band
    b.mesher(p.dark).sweepFlat(rows, () => sideBox(s, RH + 0.3, TH, 0, 0.3), 1); // raised walkway
  }
  for (const d of every(LAMP_EVERY, from, to)) for (const x of [-3.2, 3.2]) b.mesher(p.lamp).solid(LAMP, d, x, H - 0.55);
  for (const d of every(REFLECTOR_EVERY, from, to)) for (const s of [-1, 1]) b.mesher(p.lamp).solid(REFLECTOR, d, s * (TH - 0.1), 0.7);
  for (const d of every(FAN_EVERY, from, to - 10, 40)) {
    // jet fans hung in pairs from the vault; an SOS niche lit on each wall a little further on
    for (const x of [-5, 5]) {
      b.mesher(p.fan).solid(FAN, d, x, 6.3);
      b.mesher(p.dark).solid(HANGER, d, x, 7.1);
    }
    for (const s of [-1, 1]) b.mesher(p.sos).solid(NICHE, d + 30, s * (TH - 0.1), 0.3);
  }
}

/** Headwall around a tunnel mouth at road position `d`: a ring of concrete from the vault out to the hill's face. */
function portal(m: Mesher, d: number) {
  const l = terrainHeight(d, -C), r = terrainHeight(d, C), mid = (l + r) / 2 + 2;
  const top = (x: number) => (x < 0 ? mid + (l + 1 - mid) * (-x / C) : mid + (r + 1 - mid) * (x / C));
  const inner = VAULT_PROFILE.slice(1, -1), pairs: [number, number, number, number][] = [];
  for (const [x, y] of inner) {
    const ox = (x / TH) * C;
    if (y <= VAULT) {
      pairs.push([x, y, ox, y === 0 ? -0.5 : y]);
      if (y === VAULT) pairs.push([x, y, ox, top(ox)]); // up the side to the top corner
    } else pairs.push([x, y, ox, top(ox)]);
  }
  // the right wall's corner comes before its arch, the left wall's after: put the left corner pair after the arch
  const ordered = [...pairs.slice(0, 3), ...pairs.slice(3, -3), pairs[pairs.length - 2], pairs[pairs.length - 3], pairs[pairs.length - 1]];
  for (const [x, y, ox, oy] of ordered) {
    m.vertex(d, x, y, x / CONCRETE_TILE, y / CONCRETE_TILE);
    m.vertex(d, ox, oy, ox / CONCRETE_TILE, oy / CONCRETE_TILE);
  }
  m.grid(ordered.length, 2);
}
