// Toy-model kit for every roadside prop: primitives in shared flat colours, merged into one mesh per colour.
import * as THREE from 'three';
import { merge } from '../arcade.ts';

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
export const rnd = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Turns a part about x, y, z (rad); returns it. */
export const turn = <T extends THREE.Object3D>(o: T, x: number, y = 0, z = 0) => (o.rotation.set(x, y, z), o);

/**
 * Wraps parts as one prop standing on y = 0, centred on x/z, merged into one mesh per colour (a 'blades'
 * group stays apart, it spins); remembers its height and its footprint.
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
  out.userData.half = [(b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2]; // m, half its footprint along x and z
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

export const rock = (r: number, seed: number, color: number, x = 0, y = 0, z = 0, flat = 0.7) => part(rockGeo(r, seed, flat), color, x, y, z);

export const GREENS = [0x3fbf4a, 0x2ea84a, 0x5fd35a, 0x46b83a];

export const BARK = 0x7a4a2a, WHITE = 0xf6f6f2, DARK = 0x3a3a46, GLASS = 0x7fd8ff, FLOWERS = [0xff4a6a, 0xffd23f, 0xff8ad8, 0xffffff];
