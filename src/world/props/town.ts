// Towns and industry: towers with lit windows, petrol stations, factories, containers, cranes, billboards.
import * as THREE from 'three';
import { part, block, post, ball, cone, rnd, turn, prop, WHITE, DARK, GLASS } from './toy.ts';

/** Window texture for the towers: by day blue panes on white (`lit` false), at night warm panes on black. */
function windows(lit: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = lit ? '#000' : '#fff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = lit ? '#ffd890' : '#7fd8ff';
  for (const x of [8, 36]) for (const y of [10, 38]) g.fillRect(x, y, 20, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A box `w`×`h`×`d` standing at height `y`, one window per 3.5 m each way on its sides (none on top). */
function facade(w: number, h: number, d: number, material: THREE.Material, y: number) {
  const geo = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), uv = geo.attributes.uv, n = geo.attributes.normal;
  for (let k = 0; k < uv.count; k++) {
    const side = Math.abs(n.getX(k)) > 0.5 ? d : w; // the box's uv runs 0..1 on every face
    uv.setXY(k, (uv.getX(k) * side) / 3.5, Math.abs(n.getY(k)) > 0.5 ? 0 : (uv.getY(k) * h) / 3.5);
  }
  return part(geo, material, 0, y);
}

/**
 * Tower, 15-80 m: a shop floor with an awning, storeys of windows (stepped back on some), and a roof
 * of air-conditioning boxes, a water tank and an antenna. The windows glow at night.
 */
function tower(i: number, day: THREE.Texture, night: THREE.Texture) {
  const h = 15 + i * 9, w = 14 + 10 * rnd(i + 80), d = 12 + 8 * rnd(i + 90);
  const color = [0xff9a8a, 0x8ad0ff, 0xffe08a, 0xc0a0ff, 0x9affc0][i % 5], awning = [0xff3a5a, 0x2a6bff, 0x2ac87a][i % 3];
  const skin = new THREE.MeshStandardMaterial({ color, map: day, emissiveMap: night, roughness: 0.6, flatShading: true });
  const stepped = i % 3 === 2, lower = stepped ? h * 0.65 : h, parts: THREE.Object3D[] = [];
  parts.push(block(w + 0.4, 4, d + 0.4, 0x4a4a5a), block(w - 1, 3, 0.2, GLASS, 0, 0.3, d / 2 + 0.15), block(w - 1, 3, 0.2, GLASS, 0, 0.3, -d / 2 - 0.15));
  parts.push(turn(block(w, 0.2, 2, awning, 0, 3.6, d / 2 + 0.9), -0.25), facade(w, lower - 4, d, skin, 4));
  let top = lower, tw = w, td = d;
  if (stepped) {
    tw = w * 0.65;
    td = d * 0.7;
    parts.push(block(w + 0.3, 0.5, d + 0.3, 0x5a5a6a, 0, lower), facade(tw, h - lower, td, skin, lower + 0.5));
    top = h + 0.5;
  }
  parts.push(block(tw + 0.3, 0.8, td + 0.3, 0x5a5a6a, 0, top));
  for (let k = 0; k < 3; k++) parts.push(block(2, 1.2, 1.6, 0xb8bcc8, (rnd(i + k) - 0.5) * tw * 0.6, top + 0.8, (rnd(i + k + 9) - 0.5) * td * 0.6));
  parts.push(post(1.5, 1.5, 2.5, 0x8a5a3a, tw * 0.25, top + 2.3, -td * 0.2, 10), cone(1.7, 1, 0x6a4a2a, tw * 0.25, top + 4.8, -td * 0.2, 10));
  for (const s of [-1, 1]) for (const t of [-1, 1]) parts.push(block(0.15, 1.5, 0.15, DARK, tw * 0.25 + s, top + 0.8, -td * 0.2 + t));
  if (i % 2) parts.push(post(0.15, 0.05, 8, 0xcfd2dc, -tw * 0.2, top + 0.8, td * 0.2, 5), ball(0.3, 0xff3a3a, -tw * 0.2, top + 8.8, td * 0.2));
  return prop(...parts);
}

/** Petrol station, ~9 m: a canopy on posts over two pumps, a shop with big windows, a price sign. */
export function petrol() {
  const parts: THREE.Object3D[] = [block(18, 1, 10, 0xff3a3a, 0, 6, 0), block(18.2, 0.3, 10.2, WHITE, 0, 5.7, 0), block(20, 0.15, 12, 0x9a9aa0)];
  for (const x of [-7, 7]) for (const z of [-3.5, 3.5]) parts.push(block(0.4, 5.7, 0.4, WHITE, x, 0, z));
  for (const x of [-3, 3]) {
    parts.push(block(2.4, 0.3, 1.2, 0x9a9aa0, x), block(0.9, 1.8, 0.6, 0x2a6bff, x, 0.3), block(0.6, 0.4, 0.05, 0x1a2a4a, x, 1.4, 0.31), block(0.95, 0.2, 0.65, 0xff3a3a, x, 2.1));
  }
  parts.push(block(12, 4, 8, WHITE, 0, 0, -12), block(12.2, 0.6, 8.2, 0xff3a3a, 0, 4, -12), block(8, 2.4, 0.15, GLASS, -1, 0.4, -7.95), block(1.4, 2.6, 0.18, DARK, 4, 0, -7.95));
  parts.push(block(0.4, 7, 0.4, 0x9a9aa0, 8, 0, 6.5), block(2.6, 3.4, 0.4, WHITE, 8, 7, 6.5), block(2.4, 1, 0.45, 0xff3a3a, 8, 9.2, 6.5));
  for (let k = 0; k < 3; k++) parts.push(block(2, 0.5, 0.45, 0x1a1a22, 8, 7.3 + k * 0.65, 6.5));
  return prop(...parts);
}

/** Factory, `h` m: a hall with a sawtooth roof and a window band, loading doors, striped chimneys, tanks joined by pipes. */
export function factory(h: number, i: number) {
  const wall = [0xb0b8c8, 0xc8b8a0][i], parts: THREE.Object3D[] = [block(30, h * 0.5, 18, wall), block(30.2, 1.2, 0.2, GLASS, 0, h * 0.32, 9.05)];
  for (let x = -12; x <= 12; x += 6) parts.push(turn(block(6, 0.3, 5, 0x5a6a8a, x, h * 0.5 + 1.2, 0), 0, 0, 0.45), block(0.2, 2.6, 18, GLASS, x + 2.7, h * 0.5, 0));
  for (const x of [-9, 0, 9]) parts.push(block(4, 4.5, 0.2, 0xffc21a, x, 0, 9.1), block(4.4, 0.4, 0.3, DARK, x, 4.5, 9.1));
  for (let k = 0; k <= i; k++) {
    const x = -8 + k * 8;
    parts.push(post(1.3, 1, h, WHITE, x, 0, -4, 10), post(1.05, 1.05, h * 0.12, 0xff3a3a, x, h * 0.8, -4, 10), post(1.12, 1.12, h * 0.06, 0xff3a3a, x, h * 0.55, -4, 10));
  }
  for (const z of [4, -4]) parts.push(post(4, 4, h * 0.4, 0xd8d8e0, 21, 0, z, 12), cone(4.1, 1.5, 0xb8b8c0, 21, h * 0.4, z, 12));
  parts.push(part(new THREE.CylinderGeometry(0.4, 0.4, 6, 8).rotateZ(Math.PI / 2), 0x4a8a5a, 18, h * 0.3, 0), part(new THREE.CylinderGeometry(0.4, 0.4, 8, 8).rotateX(Math.PI / 2), 0x4a8a5a, 21, h * 0.38, 0));
  return prop(...parts);
}

/** Shipping containers, 12 m long, stacked two or three high in bright colours. */
export function containers(i: number) {
  const colours = [0xd8342a, 0x2a6bff, 0x2ac87a, 0xffc21a, 0xff7a20, 0x8a8f9a], parts: THREE.Object3D[] = [];
  for (let col = 0; col < 3; col++) {
    for (let k = 0; k < 2 + ((i + col) % 2); k++) {
      const c = colours[Math.floor(rnd(i * 9 + col * 3 + k) * colours.length)];
      parts.push(block(12, 2.6, 2.4, c, 0, k * 2.6, col * 2.5));
      for (let x = -5.5; x <= 5.5; x += 1) parts.push(block(0.08, 2.4, 0.04, DARK, x, k * 2.6 + 0.1, col * 2.5 + 1.21));
    }
  }
  return prop(...parts);
}

/** Tower crane, ~50 m: a yellow lattice mast, a long jib and counter-jib, a cab, concrete blocks and a hook. */
export function crane(i: number) {
  const y = 0xffc21a, h = 42 + i * 8, parts: THREE.Object3D[] = [block(6, 1, 6, 0x9a9aa0)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(block(0.25, h, 0.25, y, sx * 1, 1, sz * 1));
  for (let yy = 4; yy < h; yy += 4) for (const s of [-1, 1]) parts.push(block(2.2, 0.15, 0.15, y, 0, yy, s), block(0.15, 0.15, 2.2, y, s, yy, 0));
  parts.push(block(40, 1.4, 1.4, y, 12, h + 1), block(2.2, 2.2, 2.2, 0x2a6bff, 0, h - 1.3, 1.6), cone(0.9, 6, y, 0, h + 2.4, 0, 4));
  parts.push(block(3.5, 2.5, 2.2, 0x9a9aa0, -6, h - 1.5), block(0.8, 1.2, 1.6, DARK, 22, h - 0.2), post(0.03, 0.03, 18, DARK, 22, h - 19, 0, 4), block(0.8, 0.8, 0.4, 0xff3a3a, 22, h - 20));
  return prop(...parts);
}

/** Billboard, 12 m wide on two legs, the panel at 5 m: a coloured ground, a big shape and a slogan band. */
export function billboard(i: number) {
  const bg = [0xff3a5a, 0x2a6bff, 0xffc21a, 0x2ac87a, 0xc04aff][i], fg = [0xffe08a, WHITE, 0xff3a3a, WHITE, 0xffd23f][i], parts: THREE.Object3D[] = [];
  for (const x of [-3.5, 3.5]) parts.push(block(0.4, 5, 0.4, 0x8a8f9a, x, 0, -0.3));
  parts.push(block(12.4, 4.4, 0.3, WHITE, 0, 4.8, 0), block(12, 4, 0.1, bg, 0, 5, 0.15), block(7, 0.8, 0.12, fg, -2, 5.6, 0.2), block(5, 0.5, 0.12, fg, -2.8, 6.8, 0.2));
  parts.push(i % 2 ? ball(1.4, fg, 3.6, 7, 0.4) : turn(block(2, 2, 0.12, fg, 3.6, 6, 0.2), 0, 0, 0.6), block(12.4, 0.3, 1, 0x5a5a6a, 0, 4.6, 0.4));
  return prop(...parts);
}

/** The towers, shortest first, sharing one window texture by day and one lit at night. */
export function towers(count: number) {
  const day = windows(false), night = windows(true);
  return Array.from({ length: count }, (_, i) => tower(i, day, night));
}
