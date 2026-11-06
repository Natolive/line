// Living and rocky things: trees, bushes, flowers, cacti, mesas, reeds, water lilies.
import * as THREE from 'three';
import { part, block, post, ball, cone, rnd, turn, prop, rock, GREENS, BARK, WHITE, FLOWERS } from './toy.ts';

/** Round broadleaf tree, 10-16 m: a trunk, two branches and a crown of leafy balls, lighter on top; some bear fruit. */
export function tree(i: number) {
  const h = 10 + 6 * rnd(i), green = GREENS[i % GREENS.length], light = GREENS[(i + 2) % GREENS.length], r = h * 0.26;
  const parts: THREE.Object3D[] = [post(0.4, 0.25, h * 0.6, BARK), cone(0.8, 0.8, BARK, 0, 0, 0, 6)];
  for (const s of [-1, 1]) parts.push(turn(post(0.14, 0.08, r * 1.3, BARK, s * 0.2, h * 0.4, 0, 5), 0, 0, -s * 0.8));
  const crown: [number, number, number, number][] = [[0, h - r, 0, 1], [r * 0.7, h - r * 1.5, 0.3, 0.7], [-r * 0.65, h - r * 1.4, -0.4, 0.7], [0.2, h - r * 1.6, r * 0.6, 0.6]];
  crown.slice(0, 2 + (i % 3)).forEach(([x, y, z, k], j) => parts.push(ball(r * k, j ? green : light, x, y, z, 1)));
  if (i % 4 === 0) for (let k = 0; k < 7; k++) parts.push(ball(0.22, 0xff3a3a, Math.cos(k * 2.4) * r * 0.85, h - r * (0.6 + 0.5 * rnd(k + i)), Math.sin(k * 2.4) * r * 0.85));
  return prop(...parts);
}

/** Christmas-tree pine, ~19 m: a trunk and five stacked cones, each turned a little. */
export function pine(i: number) {
  const h = 16 + 5 * rnd(i + 40), parts: THREE.Object3D[] = [post(0.45, 0.3, h * 0.3, BARK), cone(0.9, 0.7, BARK, 0, 0, 0, 5)];
  for (let k = 0; k < 5; k++) parts.push(turn(cone(h * (0.22 - k * 0.035), h * 0.3, k % 2 ? 0x1f7a4a : 0x268a52, 0, h * (0.16 + k * 0.14)), 0, k * 0.5));
  return prop(...parts);
}

/** Birch, ~15 m: a white trunk ringed with black, a light, airy crown. */
export function birch(i: number) {
  const parts: THREE.Object3D[] = [post(0.25, 0.18, 10, WHITE, 0, 0, 0, 8)];
  for (let k = 0; k < 6; k++) parts.push(post(0.25 - k * 0.012, 0.25 - k * 0.012, 0.12, 0x2a2a2a, 0, 1 + k * 1.4 + rnd(k + i) * 0.5, 0, 8));
  parts.push(ball(3, 0x9ae05a, 0, 11.5, 0, 1), ball(2.2, 0x8ad04a, 1.4, 9.6, 0.4, 1), ball(1.8, 0xaaf06a, -1.2, 10, -0.6, 1));
  return prop(...parts);
}

/** Bush, ~1.5 m, sometimes in flower. */
export function bush(i: number) {
  const parts: THREE.Object3D[] = [ball(1 + rnd(i + 20) * 0.6, GREENS[i % 4], 0, 0.8, 0, 1), ball(0.8, GREENS[(i + 1) % 4], 0.9, 0.6, 0.2, 1), ball(0.7, GREENS[(i + 2) % 4], -0.7, 0.5, 0.4, 1)];
  if (i % 2) for (let k = 0; k < 6; k++) parts.push(ball(0.13, FLOWERS[i % 4], Math.cos(k) * 0.9, 1.2 + rnd(k) * 0.4, Math.sin(k) * 0.9));
  return prop(...parts);
}

/** Meadow patch, ~4 m: grass tufts and a dozen flowers in two colours. */
export function flowers(i: number) {
  const parts: THREE.Object3D[] = [];
  for (let k = 0; k < 14; k++) {
    const a = k * 2.4 + i, r = 2 * Math.sqrt(rnd(k + i * 20)), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (k % 3 === 0) parts.push(cone(0.3, 0.6, GREENS[(i + k) % 4], x, 0, z, 5));
    else parts.push(post(0.03, 0.03, 0.5, 0x2ea84a, x, 0, z, 4), ball(0.16, FLOWERS[(i + (k % 2)) % 4], x, 0.55, z));
  }
  return prop(...parts);
}

/** Forest floor: a stump, a fallen log, or a ring of red toadstools. */
export function stump(i: number) {
  if (i === 0) return prop(post(0.55, 0.45, 0.7, BARK, 0, 0, 0, 8), post(0.44, 0.44, 0.04, 0xe0b070, 0, 0.7, 0, 8));
  if (i === 1) return prop(part(new THREE.CylinderGeometry(0.4, 0.45, 5, 8).rotateZ(Math.PI / 2), BARK, 0, 0.4), ball(0.3, GREENS[0], 1.8, 0.75, 0.1), ball(0.25, GREENS[2], -1, 0.75, -0.1));
  const parts: THREE.Object3D[] = [];
  for (let k = 0; k < 6; k++) {
    const x = Math.cos(k) * 1.2, z = Math.sin(k) * 1.2, h = 0.4 + rnd(k) * 0.5;
    parts.push(post(0.1, 0.12, h, WHITE, x, 0, z, 6), part(new THREE.SphereGeometry(0.35 + h * 0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xff2a2a, x, h, z));
  }
  return prop(...parts);
}

/** Coconut palm, 9-12 m: a leaning trunk in rings, drooping fronds, coconuts. */
export function palm(i: number) {
  const h = 9 + 3 * rnd(i + 60), lean = 1.5 + rnd(i + 61) * 1.5, parts: THREE.Object3D[] = [];
  for (let k = 0; k < 8; k++) parts.push(post(0.32 - k * 0.015, 0.3 - k * 0.015, h / 8 + 0.05, k % 2 ? 0xa0703a : 0x8a5a2a, lean * (k / 8) ** 2, (k * h) / 8, 0, 7));
  for (let k = 0; k < 8; k++) {
    const f = part(new THREE.BoxGeometry(0.9, 0.08, 5).translate(0, 0, 2.5), GREENS[k % 4], lean, h, 0);
    f.rotation.set(0.45 + rnd(k + i) * 0.3, (k * Math.PI * 2) / 8, 0, 'YXZ');
    parts.push(f);
  }
  for (let k = 0; k < 3; k++) parts.push(ball(0.25, 0x6a4a2a, lean + Math.cos(k * 2) * 0.4, h - 0.3, Math.sin(k * 2) * 0.4));
  return prop(...parts);
}

/** Dead tree, ~6 m: a bare grey trunk and crooked branches. */
export function deadTree(i: number) {
  const wood = 0x8a7a6a, parts: THREE.Object3D[] = [post(0.3, 0.15, 6, wood, 0, 0, 0, 6)];
  for (let k = 0; k < 4; k++) parts.push(turn(post(0.1, 0.04, 2 + rnd(k + i) * 1.5, wood, 0, 2.5 + k, 0, 5), 0, k * 1.9 + i, (k % 2 ? 1 : -1) * (0.6 + rnd(k) * 0.4)));
  return prop(...parts);
}

/** Saguaro cactus, ~5 m: a trunk and one or two arms, pink flowers on top. */
export function cactus(i: number) {
  const g = 0x3fa85a, parts: THREE.Object3D[] = [post(0.45, 0.45, 5, g, 0, 0, 0, 8), ball(0.45, g, 0, 5, 0, 1), ball(0.15, 0xff6ab8, 0.2, 5.4, 0), ball(0.15, 0xffd23f, -0.2, 5.35, 0.15)];
  for (const s of i % 2 ? [-1, 1] : [1]) {
    const y = 2 + i * 0.3;
    parts.push(block(1.2, 0.6, 0.6, g, s * 0.8, y, 0), post(0.35, 0.35, 1.8, g, s * 1.3, y, 0, 8), ball(0.35, g, s * 1.3, y + 1.8, 0, 1), ball(0.13, 0xff6ab8, s * 1.3, y + 2.15, 0));
  }
  return prop(...parts);
}

/** Desert mesa, flat-topped, in three bands, with fallen rocks at its foot; `h` m tall. */
export function mesa(h: number, i: number) {
  const r = h * 0.9, parts = [post(r, r * 0.8, h * 0.4, 0xe0703a, 0, 0, 0, 7 + i), post(r * 0.8, r * 0.7, h * 0.3, 0xf09a5a, 0, h * 0.4, 0, 7 + i), post(r * 0.7, r * 0.62, h * 0.3, 0xd85a2a, 0, h * 0.7, 0, 7 + i)];
  for (let k = 0; k < 5; k++) parts.push(rock(1.5 + rnd(k + i) * 2, k + i, 0xc8602a, Math.cos(k * 1.3) * r * 1.05, 0.5, Math.sin(k * 1.3) * r * 1.05));
  return prop(...parts);
}

/** Rock arch, 18 m, with rubble below. */
export function arch() {
  const c = 0xe0703a;
  return prop(post(3, 2.2, 14, c, -7, 0, 0, 6), post(3, 2.2, 14, c, 7, 0, 0, 6), block(19, 4, 5, 0xf09a5a, 0, 14, 0), rock(2, 3, 0xc8602a, -2, 0.6, 3), rock(1.4, 5, 0xc8602a, 3, 0.4, -3));
}

/** Reeds and bulrushes, ~2 m, in a clump. */
export function reeds(i: number) {
  const parts: THREE.Object3D[] = [];
  for (let k = 0; k < 12; k++) {
    const a = k * 2.4 + i, r = rnd(k + i * 5) * 1.2, h = 1.4 + rnd(k + 3) * 0.9, x = Math.cos(a) * r, z = Math.sin(a) * r;
    parts.push(turn(post(0.04, 0.02, h, k % 2 ? 0x6aa83a : 0x8ac04a, x, 0, z, 4), (rnd(k) - 0.5) * 0.3, 0, (rnd(k + 1) - 0.5) * 0.3));
    if (k % 3 === 0) parts.push(post(0.07, 0.07, 0.35, 0x6a3a1a, x, h - 0.4, z, 6));
  }
  return prop(...parts);
}

/** Water lilies: a few round pads and pink flowers. */
export function lilies(i: number) {
  const parts: THREE.Object3D[] = [];
  for (let k = 0; k < 7; k++) {
    const a = k * 2.3 + i, r = 0.4 + rnd(k + i * 9) * 2.2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    parts.push(post(0.35 + rnd(k) * 0.25, 0.35 + rnd(k) * 0.25, 0.04, GREENS[k % 4], x, 0, z, 9));
    if (k % 3 === 0) parts.push(cone(0.18, 0.2, 0xff8ad8, x + 0.1, 0.04, z, 6));
  }
  return prop(...parts);
}

/** Roadside stones: a rock with two pebbles. */
export function stones(i: number) {
  return prop(rock(0.9, i, 0x9a9aa8, 0, 0.4), rock(0.35, i + 5, 0x8a8a98, 0.9, 0.1, 0.3), rock(0.25, i + 8, 0xaaaab8, -0.7, 0.1, -0.4));
}

/** Mountain boulder, ~5 m, with a smaller one beside it. */
export function boulder(i: number) {
  return i
    ? prop(rock(2.4, 9, 0x9aa2b8, 0, 1.6, 0, 0.9), rock(0.8, 13, 0x8a96b0, -2, 0.4, 0.8))
    : prop(rock(3, 7, 0x8a96b0, 0, 2, 0, 0.8), rock(1, 11, 0x7a86a0, 2.6, 0.5, 1));
}
