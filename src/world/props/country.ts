// The countryside: houses, farms and animals, churches, cabins, water towers, wind turbines, pylons and masts.
import * as THREE from 'three';
import { merge } from '../arcade.ts';
import { part, block, post, ball, cone, turn, prop, WHITE, DARK, GLASS, FLOWERS } from './toy.ts';

/** House, ~9 m: walls on a plinth, a pitched roof with eaves, a chimney, framed windows with shutters, a door and a garden fence. */
export function house(i: number) {
  const walls = [0xfff1c8, 0xffc8d8, 0xc8e8ff][i % 3], roofs = [0xe0402a, 0x3a6ad8, 0x2a9a5a][i % 3], shutters = [0x2a8a5a, 0x3a5ad8, 0xd84a3a][i % 3];
  const w = 9 + i, d = 7, r = (d + 1.2) / Math.sqrt(3);
  const roof = new THREE.CylinderGeometry(r, r, w + 1, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2); // triangular prism along x, apex up
  const parts = [block(w + 0.3, 0.5, d + 0.3, 0x9a9aa0), block(w, 5, d, walls, 0, 0.5), part(roof, roofs, 0, 5.5 + r / 2, 0), block(0.9, 3, 0.9, 0xb05a3a, w / 4, 6.5, -0.8)];
  parts.push(block(1.3, 2.4, 0.15, 0x8a5a3a, 0, 0.5, d / 2 + 0.05), block(1.8, 0.2, 0.8, 0x9a9aa0, 0, 0.3, d / 2 + 0.4), block(1.6, 0.15, 0.6, roofs, 0, 3.1, d / 2 + 0.3));
  for (const zs of [-1, 1]) {
    for (const x of [-w / 3, w / 3]) {
      for (const y of [1.8, 3.6]) {
        if (zs > 0 && y < 2 && Math.abs(x) < 1) continue;
        parts.push(block(1.4, 1.1, 0.12, WHITE, x, y, zs * (d / 2 + 0.03)), block(1.2, 0.9, 0.14, GLASS, x, y + 0.1, zs * (d / 2 + 0.03)));
        for (const s of [-1, 1]) parts.push(block(0.4, 1.1, 0.1, shutters, x + s * 0.95, y, zs * (d / 2 + 0.05)));
        if (y < 2) parts.push(block(1.4, 0.3, 0.35, 0x8a5a3a, x, y - 0.25, zs * (d / 2 + 0.2)), ball(0.2, FLOWERS[i], x - 0.3, y + 0.1, zs * (d / 2 + 0.2)), ball(0.2, FLOWERS[i + 1], x + 0.3, y + 0.1, zs * (d / 2 + 0.2)));
      }
    }
  }
  for (const s of [-1, 1]) parts.push(block(0.12, 1.1, 1.2, WHITE, s * (w / 2 + 0.03), 2.6, 0), block(0.14, 0.9, 1, GLASS, s * (w / 2 + 0.03), 2.7, 0));
  // picket fence along the front, with a gap at the gate
  for (let x = -w / 2 - 2; x <= w / 2 + 2; x += 0.6) if (Math.abs(x) > 1) parts.push(block(0.1, 1, 0.1, WHITE, x, 0, d / 2 + 3));
  for (const y of [0.35, 0.75]) for (const s of [-1, 1]) parts.push(block(w / 2 + 1, 0.08, 0.05, WHITE, s * (w / 4 + 1.5), y, d / 2 + 3));
  return prop(...parts);
}

/** Barn, ~12 m: red walls with white trim, big X-braced doors, a hay loft, and a silo beside it. */
export function barn() {
  const r = 11.2 / Math.sqrt(3), roof = new THREE.CylinderGeometry(r, r, 17, 3).rotateX(-Math.PI / 2); // prism along z, apex up
  const parts: THREE.Object3D[] = [block(10, 6, 16, 0xd8342a), part(roof, 0x4a3a3a, 0, 6 + r / 2, 0)];
  for (const s of [-1, 1]) for (const x of [-5, 5]) parts.push(block(0.3, 6, 0.3, WHITE, x, 0, s * 8.05));
  parts.push(block(4.4, 4.9, 0.1, WHITE, 0, 0, 8.05), block(4, 4.5, 0.12, 0xb82a22, 0, 0, 8.06));
  for (const a of [0.73, -0.73]) parts.push(turn(part(new THREE.BoxGeometry(0.25, 5.6, 0.1), WHITE, 0, 2.25, 8.12), 0, 0, a));
  parts.push(block(2, 1.6, 0.12, WHITE, 0, 6.6, 8.06), block(1.6, 1.2, 0.14, 0x3a2a1a, 0, 6.8, 8.06));
  parts.push(post(2.4, 2.4, 13, 0xd8d8e0, 8.5, 0, -4, 14), part(new THREE.SphereGeometry(2.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x8a9ab8, 8.5, 13, -4));
  for (let y = 2; y < 13; y += 3) parts.push(post(2.45, 2.45, 0.2, 0x8a9ab8, 8.5, y, -4, 14));
  return prop(...parts);
}

/** Hay bale, 1.5 m, tied with two bands. */
export function hay() {
  const roll = (r: number, l: number, c: number, x: number) => part(new THREE.CylinderGeometry(r, r, l, 14).rotateZ(Math.PI / 2), c, x, 0.75);
  return prop(roll(0.75, 1.4, 0xf0c84a, 0), roll(0.77, 0.08, 0xc89a2a, -0.35), roll(0.77, 0.08, 0xc89a2a, 0.35));
}

/** Paddock fence, 12 m along x: four posts, two rails. */
export function fence() {
  const wood = 0x9a6a3a, parts: THREE.Object3D[] = [];
  for (let x = -6; x <= 6; x += 4) parts.push(block(0.18, 1.3, 0.18, wood, x));
  for (const y of [0.5, 1.05]) parts.push(block(12, 0.14, 0.08, wood, 0, y, 0.1));
  return prop(...parts);
}

/** Cow, 1.5 m at the shoulder, facing +x: patched black and white or plain brown. */
export function cow(i: number) {
  const coat = i % 2 ? 0x9a5a2a : WHITE, parts: THREE.Object3D[] = [block(2.2, 0.9, 0.9, coat, 0, 0.75), block(0.6, 0.6, 0.5, coat, 1.3, 1.1), block(0.2, 0.3, 0.52, 0xffa0a8, 1.6, 1.1)];
  for (const [x, z] of [[-0.8, -0.3], [-0.8, 0.3], [0.8, -0.3], [0.8, 0.3]]) parts.push(block(0.2, 0.75, 0.2, coat, x, 0, z));
  for (const s of [-1, 1]) parts.push(block(0.08, 0.25, 0.08, 0xeeeedd, 1.35, 1.7, s * 0.2));
  if (!(i % 2)) for (const [x, z] of [[-0.4, 0.46], [0.5, -0.46], [-0.6, -0.46], [0.2, 0.46]]) parts.push(block(0.6, 0.5, 0.02, DARK, x, 0.95, z));
  return prop(...parts);
}

/** Sheep, 1 m: a woolly white body, black face and legs. */
export function sheep() {
  const parts: THREE.Object3D[] = [ball(0.55, WHITE, 0, 0.85, 0, 1), ball(0.45, WHITE, -0.4, 0.85, 0, 1), block(0.35, 0.4, 0.3, DARK, 0.6, 0.9)];
  for (const [x, z] of [[-0.4, -0.2], [-0.4, 0.2], [0.3, -0.2], [0.3, 0.2]]) parts.push(block(0.1, 0.5, 0.1, DARK, x, 0, z));
  return prop(...parts);
}

/** Tractor, 3 m: big back wheels, small front ones, a bonnet and a cab. */
export function tractor(i: number) {
  const paint = [0x2a9a3a, 0xe0302a][i], wheel = (r: number, w: number, x: number, z: number) => part(new THREE.CylinderGeometry(r, r, w, 12).rotateX(Math.PI / 2), DARK, x, r, z);
  const parts: THREE.Object3D[] = [block(2.4, 1, 1.1, paint, 0.6, 0.7), block(1.4, 1.6, 1.3, paint, -0.8, 1), block(1.2, 0.9, 1.32, GLASS, -0.8, 1.6), block(1.6, 0.1, 1.5, paint, -0.8, 2.6)];
  for (const s of [-1, 1]) parts.push(wheel(0.8, 0.5, -0.9, s * 0.9), wheel(0.45, 0.35, 1.3, s * 0.75));
  parts.push(post(0.07, 0.07, 1, DARK, 1.4, 1.7, 0, 6));
  return prop(...parts);
}

/** Wind turbine, 100 m to the blade tip: base, tower with a door, nacelle, three red-tipped blades (the 'blades' group spins about z). */
export function turbine() {
  const spin = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.Group();
    blade.add(block(1.6, 26, 0.4, WHITE), block(1.2, 4, 0.42, 0xff3a3a, 0, 26));
    blade.rotation.z = (k * Math.PI * 2) / 3;
    spin.add(blade);
  }
  spin.add(turn(cone(1.4, 2.2, WHITE, 0, 0, 0, 10), Math.PI / 2));
  const blades = new THREE.Group();
  blades.add(...merge(spin));
  blades.name = 'blades';
  blades.position.set(0, 70, 3.6);
  return prop(post(4, 4, 1, 0x9a9aa0, 0, 0, 0, 10), post(2.2, 1.2, 70, WHITE, 0, 1, 0, 12), block(1.2, 2.2, 0.2, DARK, 0, 1, 2.1), post(2.25, 2.25, 0.6, 0x2a6bff, 0, 6, 0, 12), block(3, 3.2, 7, WHITE, 0, 68.4, 0), blades);
}

/** Water tower, ~20 m: four braced legs and a round tank with a cone lid. */
export function waterTower() {
  const steel = 0x8a8f9a, parts: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(block(0.4, 14, 0.4, steel, sx * 2.4, 0, sz * 2.4));
  for (const y of [4, 9]) for (const s of [-1, 1]) parts.push(block(5, 0.2, 0.2, steel, 0, y, s * 2.4), block(0.2, 0.2, 5, steel, s * 2.4, y, 0));
  parts.push(post(4, 4, 5, 0x8ad0ff, 0, 14, 0, 14), post(4.05, 4.05, 0.8, WHITE, 0, 16, 0, 14), cone(4.3, 2, 0xd8342a, 0, 19, 0, 14));
  return prop(...parts);
}

/** American windpump, ~11 m: a lattice tower, a bladed wheel and a tail vane. */
export function windpump() {
  const steel = 0x8a8f9a, parts: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(turn(block(0.15, 9.5, 0.15, steel, sx * 1.2, 0, sz * 1.2), -sz * 0.11, 0, sx * 0.11));
  for (let k = 0; k < 12; k++) parts.push(turn(part(new THREE.BoxGeometry(0.4, 1.4, 0.05).translate(0, 1.1, 0), k % 2 ? WHITE : 0xd8342a, 0, 9.8, 0.4), 0, 0, (k * Math.PI) / 6));
  parts.push(block(0.3, 0.3, 1.2, steel, 0, 9.65, -0.3), block(0.05, 1.2, 1.6, 0xd8342a, 0, 9.2, -1.6));
  return prop(...parts);
}

/** Village church, ~25 m to the spire tip: a nave, a square tower and a slate spire with a gold cross. */
export function church() {
  const r = 9 / Math.sqrt(3), roof = new THREE.CylinderGeometry(r, r, 16, 3).rotateX(-Math.PI / 2);
  const parts: THREE.Object3D[] = [block(8, 7, 16, 0xfff1c8, 0, 0, 2), part(roof, 0x4a5a7a, 0, 7 + r / 2, 2), block(5, 13, 5, 0xfff1c8, 0, 0, -8), cone(3.6, 9, 0x4a5a7a, 0, 13, -8, 4)];
  parts.push(block(0.3, 2, 0.3, 0xffd23f, 0, 22, -8), block(1.2, 0.3, 0.3, 0xffd23f, 0, 23.2, -8), post(1, 1, 0.2, WHITE, 0, 10, -5.4, 12));
  for (const s of [-1, 1]) for (const z of [-2, 2, 6]) parts.push(block(0.12, 2.6, 1, GLASS, s * 4.03, 2.5, z));
  parts.push(block(2, 3.2, 0.15, 0x8a5a3a, 0, 0, -5.5));
  return prop(...parts);
}

/** Log cabin, ~6 m: stacked logs, a steep roof with a snow cap, a stone chimney, a lit window. */
export function cabin() {
  const r = 7 / Math.sqrt(3), roof = new THREE.CylinderGeometry(r, r, 9, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), parts: THREE.Object3D[] = [];
  for (let k = 0; k < 7; k++) parts.push(part(new THREE.CylinderGeometry(0.22, 0.22, 8, 6).rotateZ(Math.PI / 2), k % 2 ? 0x8a5a2a : 0x7a4a22, 0, 0.22 + k * 0.42, 2.6), part(new THREE.CylinderGeometry(0.22, 0.22, 8, 6).rotateZ(Math.PI / 2), k % 2 ? 0x8a5a2a : 0x7a4a22, 0, 0.22 + k * 0.42, -2.6));
  parts.push(block(7.6, 2.95, 5, 0x7a4a22), part(roof, 0x5a3a2a, 0, 2.95 + r / 2, 0), part(roof.clone().scale(1.02, 0.4, 1.02), WHITE, 0, 2.95 + r * 0.95, 0));
  parts.push(block(1, 6, 1, 0x9a9aa8, 3, 0, -1.5), block(1.2, 1.9, 0.1, 0x5a3a2a, -1.5, 0, 2.86), block(1.1, 0.9, 0.1, 0xffd890, 1.5, 1.2, 2.86));
  return prop(...parts);
}

/** Power pylon, 38 m: four splayed legs braced together, two cross-arms along x with insulators, a peak. */
export function pylon() {
  const steel = 0x8a8f9a, H = 38, parts: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(turn(block(0.35, H * 0.92, 0.35, steel, sx * 2.6, 0, sz * 2.6), -sz * 0.07, 0, sx * 0.07));
  for (let k = 1; k < 6; k++) {
    const y = (k * H * 0.75) / 6, half = 2.6 - (y / (H * 0.92)) * 2.6 * 0.95;
    for (const s of [-1, 1]) parts.push(block(half * 2, 0.2, 0.2, steel, 0, y, s * half), block(0.2, 0.2, half * 2, steel, s * half, y, 0));
  }
  parts.push(block(12.4, 0.6, 0.8, steel, 0, H * 0.7, 0), block(9.4, 0.6, 0.8, steel, 0, H * 0.85, 0), cone(0.8, 4, steel, 0, H * 0.92, 0, 4));
  for (const [x, y] of [[-6, 0.7], [6, 0.7], [-4.5, 0.85], [4.5, 0.85]]) parts.push(post(0.15, 0.15, 1.2, 0x4a6aa8, x, H * y - 1.2, 0, 6));
  return prop(...parts);
}

/** Radio mast, 60 m: a thin lattice in red and white bands, a lamp on top. */
export function mast() {
  const parts: THREE.Object3D[] = [block(3, 0.5, 3, 0x9a9aa0)];
  for (let k = 0; k < 6; k++) parts.push(post(0.7 - k * 0.08, 0.62 - k * 0.08, 10, k % 2 ? WHITE : 0xff3a3a, 0, 0.5 + k * 10, 0, 4));
  parts.push(ball(0.5, 0xff3a3a, 0, 61, 0));
  return prop(...parts);
}
