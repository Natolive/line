// Every roadside prop, built from scratch as a low-poly toy: trees, rocks, houses, towers, turbines... No model
// files. Each is built once; the scenery places copies (geometry and materials shared).
import * as THREE from 'three';
import { merge } from './arcade.ts';

export type World = {
  trees: THREE.Object3D[];
  bushes: THREE.Object3D[];
  rocks: THREE.Object3D[];
  buildings: THREE.Object3D[]; // shortest first
  pines: THREE.Object3D[];
  birches: THREE.Object3D[];
  houses: THREE.Object3D[];
  barns: THREE.Object3D[];
  hay: THREE.Object3D[];
  turbines: THREE.Object3D[]; // blades: the child named 'blades', turning about its own z
  pylons: THREE.Object3D[]; // cross-arms along x: at ~70 % of the height (±6 m) and ~85 % (±4.5 m)
  cacti: THREE.Object3D[];
  mesas: THREE.Object3D[]; // big desert rock formations
  boulders: THREE.Object3D[]; // mountain rocks
  petrol: THREE.Object3D[];
  factories: THREE.Object3D[];
};

const mats = new Map<number, THREE.MeshStandardMaterial>();
/** One shared flat-shaded material per colour. */
const mat = (color: number) => {
  if (!mats.has(color)) mats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
  return mats.get(color)!;
};
/** A mesh of `geo` in colour `color`, at (x, y, z). */
export const part = (geo: THREE.BufferGeometry, color: number | THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y, z);
  return m;
};
export const block = (w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0) => part(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, x, y, z);
export const post = (r0: number, r1: number, h: number, color: number, x = 0, y = 0, z = 0, sides = 7) => part(new THREE.CylinderGeometry(r1, r0, h, sides).translate(0, h / 2, 0), color, x, y, z);
export const ball = (r: number, color: number, x = 0, y = 0, z = 0, detail = 0) => part(new THREE.IcosahedronGeometry(r, detail), color, x, y, z);
export const cone = (r: number, h: number, color: number, x = 0, y = 0, z = 0, sides = 7) => part(new THREE.ConeGeometry(r, h, sides).translate(0, h / 2, 0), color, x, y, z);

/** A deterministic 0..1 for variant `i` (the same props on every game). */
const rnd = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Turns a part about x, y, z (rad); returns it. */
export const turn = <T extends THREE.Object3D>(o: T, x: number, y = 0, z = 0) => (o.rotation.set(x, y, z), o);

/**
 * Wraps parts as one prop standing on y = 0, centred on x/z, merged into one mesh per colour (a 'blades'
 * group stays apart, it spins); remembers its height.
 */
export function prop(...parts: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.add(...parts);
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new THREE.Vector3());
  for (const p of parts) p.position.sub(new THREE.Vector3(c.x, b.min.y, c.z));
  const spinning = parts.filter((p) => p.name === 'blades'), solid = new THREE.Group(), out = new THREE.Group();
  solid.add(...parts.filter((p) => !spinning.includes(p)));
  out.add(...merge(solid), ...spinning);
  out.traverse((o) => { o.castShadow = o.receiveShadow = (o as THREE.Mesh).isMesh === true; });
  out.userData.height = b.max.y - b.min.y;
  return out;
}

/** A rock: an icosahedron with its corners pulled about. */
function rockGeo(r: number, seed: number, flat = 0.7) {
  const g = new THREE.IcosahedronGeometry(r, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // icosahedron corners come duplicated per face: pull each by its position, so the copies stay together
    const k = 0.75 + 0.5 * rnd(seed * 7 + Math.round((p.getX(i) * 3 + p.getY(i) * 5 + p.getZ(i) * 11) * 10));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * flat, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
const rock = (r: number, seed: number, color: number, x = 0, y = 0, z = 0, flat = 0.7) => part(rockGeo(r, seed, flat), color, x, y, z);

const GREENS = [0x3fbf4a, 0x2ea84a, 0x5fd35a, 0x46b83a];
const BARK = 0x7a4a2a, WHITE = 0xf6f6f2, DARK = 0x3a3a46, GLASS = 0x7fd8ff, FLOWERS = [0xff4a6a, 0xffd23f, 0xff8ad8, 0xffffff];

/** Round broadleaf tree, 10-16 m: a trunk, two branches and a crown of leafy balls, lighter on top; some bear fruit. */
function tree(i: number) {
  const h = 10 + 6 * rnd(i), green = GREENS[i % GREENS.length], light = GREENS[(i + 2) % GREENS.length], r = h * 0.26;
  const parts: THREE.Object3D[] = [post(0.4, 0.25, h * 0.6, BARK), cone(0.8, 0.8, BARK, 0, 0, 0, 6)];
  for (const s of [-1, 1]) parts.push(turn(post(0.14, 0.08, r * 1.3, BARK, s * 0.2, h * 0.4, 0, 5), 0, 0, -s * 0.8));
  const crown: [number, number, number, number][] = [[0, h - r, 0, 1], [r * 0.7, h - r * 1.5, 0.3, 0.7], [-r * 0.65, h - r * 1.4, -0.4, 0.7], [0.2, h - r * 1.6, r * 0.6, 0.6]];
  crown.slice(0, 2 + (i % 3)).forEach(([x, y, z, k], j) => parts.push(ball(r * k, j ? green : light, x, y, z, 1)));
  if (i % 4 === 0) for (let k = 0; k < 7; k++) parts.push(ball(0.22, 0xff3a3a, Math.cos(k * 2.4) * r * 0.85, h - r * (0.6 + 0.5 * rnd(k + i)), Math.sin(k * 2.4) * r * 0.85));
  return prop(...parts);
}

/** Christmas-tree pine, ~19 m: a trunk and five stacked cones, each turned a little. */
function pine(i: number) {
  const h = 16 + 5 * rnd(i + 40), parts: THREE.Object3D[] = [post(0.45, 0.3, h * 0.3, BARK), cone(0.9, 0.7, BARK, 0, 0, 0, 5)];
  for (let k = 0; k < 5; k++) parts.push(turn(cone(h * (0.22 - k * 0.035), h * 0.3, k % 2 ? 0x1f7a4a : 0x268a52, 0, h * (0.16 + k * 0.14)), 0, k * 0.5));
  return prop(...parts);
}

/** Birch, ~15 m: a white trunk ringed with black, a light, airy crown. */
function birch(i: number) {
  const parts: THREE.Object3D[] = [post(0.25, 0.18, 10, WHITE, 0, 0, 0, 8)];
  for (let k = 0; k < 6; k++) parts.push(post(0.25 - k * 0.012, 0.25 - k * 0.012, 0.12, 0x2a2a2a, 0, 1 + k * 1.4 + rnd(k + i) * 0.5, 0, 8));
  parts.push(ball(3, 0x9ae05a, 0, 11.5, 0, 1), ball(2.2, 0x8ad04a, 1.4, 9.6, 0.4, 1), ball(1.8, 0xaaf06a, -1.2, 10, -0.6, 1));
  return prop(...parts);
}

/** Bush, ~1.5 m, sometimes in flower. */
function bush(i: number) {
  const parts: THREE.Object3D[] = [ball(1 + rnd(i + 20) * 0.6, GREENS[i % 4], 0, 0.8, 0, 1), ball(0.8, GREENS[(i + 1) % 4], 0.9, 0.6, 0.2, 1), ball(0.7, GREENS[(i + 2) % 4], -0.7, 0.5, 0.4, 1)];
  if (i % 2) for (let k = 0; k < 6; k++) parts.push(ball(0.13, FLOWERS[i % 4], Math.cos(k) * 0.9, 1.2 + rnd(k) * 0.4, Math.sin(k) * 0.9));
  return prop(...parts);
}

/** House, ~9 m: walls on a plinth, a pitched roof with eaves, a chimney, framed windows with shutters, a door and a garden fence. */
function house(i: number) {
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

/** Barn, ~12 m: red walls with white trim, big X-braced doors, a hay loft, and a silo beside it. */
function barn() {
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
function hay() {
  const roll = (r: number, l: number, c: number, x: number) => part(new THREE.CylinderGeometry(r, r, l, 14).rotateZ(Math.PI / 2), c, x, 0.75);
  return prop(roll(0.75, 1.4, 0xf0c84a, 0), roll(0.77, 0.08, 0xc89a2a, -0.35), roll(0.77, 0.08, 0xc89a2a, 0.35));
}

/** Wind turbine, 100 m to the blade tip: base, tower with a door, nacelle, three red-tipped blades (the 'blades' group spins about z). */
function turbine() {
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

/** Power pylon, 38 m: four splayed legs braced together, two cross-arms along x with insulators, a peak. */
function pylon() {
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

/** Saguaro cactus, ~5 m: a trunk and one or two arms, pink flowers on top. */
function cactus(i: number) {
  const g = 0x3fa85a, parts: THREE.Object3D[] = [post(0.45, 0.45, 5, g, 0, 0, 0, 8), ball(0.45, g, 0, 5, 0, 1), ball(0.15, 0xff6ab8, 0.2, 5.4, 0), ball(0.15, 0xffd23f, -0.2, 5.35, 0.15)];
  for (const s of i % 2 ? [-1, 1] : [1]) {
    const y = 2 + i * 0.3;
    parts.push(block(1.2, 0.6, 0.6, g, s * 0.8, y, 0), post(0.35, 0.35, 1.8, g, s * 1.3, y, 0, 8), ball(0.35, g, s * 1.3, y + 1.8, 0, 1), ball(0.13, 0xff6ab8, s * 1.3, y + 2.15, 0));
  }
  return prop(...parts);
}

/** Desert mesa, flat-topped, in three bands, with fallen rocks at its foot; `h` m tall. */
function mesa(h: number, i: number) {
  const r = h * 0.9, parts = [post(r, r * 0.8, h * 0.4, 0xe0703a, 0, 0, 0, 7 + i), post(r * 0.8, r * 0.7, h * 0.3, 0xf09a5a, 0, h * 0.4, 0, 7 + i), post(r * 0.7, r * 0.62, h * 0.3, 0xd85a2a, 0, h * 0.7, 0, 7 + i)];
  for (let k = 0; k < 5; k++) parts.push(rock(1.5 + rnd(k + i) * 2, k + i, 0xc8602a, Math.cos(k * 1.3) * r * 1.05, 0.5, Math.sin(k * 1.3) * r * 1.05));
  return prop(...parts);
}

/** Rock arch, 18 m, with rubble below. */
function arch() {
  const c = 0xe0703a;
  return prop(post(3, 2.2, 14, c, -7, 0, 0, 6), post(3, 2.2, 14, c, 7, 0, 0, 6), block(19, 4, 5, 0xf09a5a, 0, 14, 0), rock(2, 3, 0xc8602a, -2, 0.6, 3), rock(1.4, 5, 0xc8602a, 3, 0.4, -3));
}

/** Petrol station, ~9 m: a canopy on posts over two pumps, a shop with big windows, a price sign. */
function petrol() {
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
function factory(h: number, i: number) {
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

/** Builds every prop. */
export function buildWorld(): World {
  const day = windows(false), night = windows(true);
  return {
    trees: Array.from({ length: 8 }, (_, i) => tree(i)),
    bushes: Array.from({ length: 5 }, (_, i) => bush(i)),
    rocks: Array.from({ length: 3 }, (_, i) => prop(rock(0.9, i, 0x9a9aa8, 0, 0.4), rock(0.35, i + 5, 0x8a8a98, 0.9, 0.1, 0.3), rock(0.25, i + 8, 0xaaaab8, -0.7, 0.1, -0.4))),
    buildings: Array.from({ length: 8 }, (_, i) => tower(i, day, night)),
    pines: Array.from({ length: 4 }, (_, i) => pine(i)),
    birches: [birch(0), birch(1)],
    houses: [0, 1, 2].map(house),
    barns: [barn()],
    hay: [hay()],
    turbines: [turbine()],
    pylons: [pylon()],
    cacti: [0, 1, 2].map(cactus),
    mesas: [mesa(28, 0), mesa(20, 1), arch()],
    boulders: [prop(rock(3, 7, 0x8a96b0, 0, 2, 0, 0.8), rock(1, 11, 0x7a86a0, 2.6, 0.5, 1)), prop(rock(2.4, 9, 0x9aa2b8, 0, 1.6, 0, 0.9), rock(0.8, 13, 0x8a96b0, -2, 0.4, 0.8))],
    petrol: [petrol()],
    factories: [factory(18, 0), factory(14, 1)],
  };
}
