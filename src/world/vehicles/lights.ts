// Car lights: tail and brake lights, indicators, headlight halos, and how they react to night.
import * as THREE from 'three';
import { softDot } from '../smoke.ts';
import type { Vehicle } from './prefab.ts';

export type Role = 'tail' | 'lamp' | 'glow' | 'head' | 'blinkL' | 'blinkR';

const MAT = {
  tail: new THREE.MeshStandardMaterial({ color: 0x5a0008, emissive: 0xff1020, emissiveIntensity: 0.6 }),
  brake: new THREE.MeshStandardMaterial({ color: 0xff1020, emissive: 0xff1020, emissiveIntensity: 6 }),
  glow: new THREE.SpriteMaterial({ map: softDot, color: 0xff2030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }),
  // headlight halo: invisible by day, fades in with the night (see setNight)
  head: new THREE.SpriteMaterial({ map: softDot, color: 0xfff1d6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  blink: new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xffa000, emissiveIntensity: 5 }),
};
const lightGeo = new THREE.BoxGeometry(1, 1, 1);

const box = (objs: THREE.Object3D[]) => objs.reduce((b, o) => b.union(new THREE.Box3().setFromObject(o, true)), new THREE.Box3());

function light(parent: THREE.Object3D, role: Role, mat: THREE.Material, size: [number, number, number], pos: [number, number, number], visible = false) {
  const m = mat instanceof THREE.SpriteMaterial ? new THREE.Sprite(mat) : new THREE.Mesh(lightGeo, mat);
  m.scale.set(...size);
  m.position.set(...pos);
  m.visible = visible;
  m.userData.role = role;
  parent.add(m);
}

/**
 * Cuts the triangles of `mesh` that sit behind `rearZ` and above `minY` into a mesh of their own. Many models
 * keep headlights and tail lights in one piece; split, the tail lights can glow on their own.
 * Returns the rear part, the whole mesh if all of it is rear, or null if none of it is.
 */
function splitRear(mesh: THREE.Mesh, rearZ: number, minY: number) {
  const g = mesh.geometry, idx = g.index;
  if (!idx) return null;
  const pos = g.attributes.position, v = new THREE.Vector3(), rear: number[] = [], rest: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    let y = 0, z = 0;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, idx.getX(i + k)).applyMatrix4(mesh.matrixWorld);
      y += v.y / 3;
      z += v.z / 3;
    }
    (z > rearZ && y > minY ? rear : rest).push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  if (!rear.length) return null;
  if (!rest.length) return mesh;
  const part = (tris: number[]) => {
    const p = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) p.setAttribute(name, attr); // shared, not copied
    p.setIndex(tris);
    return p;
  };
  mesh.geometry = part(rest);
  const lamp = new THREE.Mesh(part(rear), mesh.material);
  lamp.matrixAutoUpdate = mesh.matrixAutoUpdate;
  lamp.matrix.copy(mesh.matrix);
  mesh.matrix.decompose(lamp.position, lamp.quaternion, lamp.scale);
  mesh.parent!.add(lamp);
  lamp.updateMatrixWorld(true);
  return lamp;
}

/**
 * The model's own tail lamps, at the back of the car and at lamp height: light units (named lamp, light,
 * optics, brake, tail…; their rear part is cut out) or red parts. Each gets its own glowing material:
 * the lens texture shapes the glow, always tinted red (lamp textures are often white).
 */
function findTailLamps(body: THREE.Group, l: number, h: number) {
  body.updateMatrixWorld(true);
  const rearZ = l / 2 - 0.9, minY = h * 0.35, lamps: THREE.Mesh[] = [], candidates: THREE.Mesh[] = [];
  const wholeRear = (m: THREE.Mesh) => new THREE.Box3().setFromObject(m).min.z > rearZ;
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !('emissive' in mesh.material)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const names = `${mesh.name} ${mesh.parent?.name} ${mat.name}`;
    // "backlight" is car-maker speak for the rear window; a reverse light is white; paint is never a lamp
    const lightUnit = /brake|tail|stop|lamp|light|optic/i.test(names) && !/backlight|reverse/i.test(names);
    // bright enough (linear), and red in hue as seen (sRGB): orange paint (green ~40% of red) is not a lens (green ~0)
    const c = mat.color.clone().convertLinearToSRGB();
    const red = mat.color.r > 0.35 && c.g < c.r * 0.25 && c.b < c.r * 0.3 && !/paint/i.test(mat.name);
    // light units may be cut; a merely red part (paint can be red!) only counts if it sits entirely at the back
    if (lightUnit || (red && wholeRear(mesh))) candidates.push(mesh);
  });
  for (const mesh of candidates) {
    const lamp = splitRear(mesh, rearZ, minY);
    if (!lamp) continue;
    const b = new THREE.Box3().setFromObject(lamp), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
    if (Math.abs(c.x) < 0.2 && sz.x < 0.8) continue; // narrow and centred: number plate, badge
    const mat = (lamp.material as THREE.MeshStandardMaterial).clone();
    mat.emissiveMap = mat.map;
    mat.emissive.set(0xff1a1a);
    mat.color.multiplyScalar(0.25); // a dark, non-metallic lens: the red light dominates instead of sky reflections
    mat.metalness = 0;
    lamp.material = mat;
    lamps.push(lamp);
  }
  return lamps;
}

/**
 * Lights for a normalized car body of length `l` and height `h`: its own tail lamps when it has some,
 * stand-ins at height `y` and half-width `lx` otherwise, plus brake halos, headlight halos and indicators.
 */
export function fitLights(body: THREE.Group, l: number, h: number, y: number, lx: number) {
  // Prefer the model's own tail lamps; add stand-in lamps only when none were found.
  const lamps = findTailLamps(body, l, h);
  for (const lamp of lamps) lamp.userData.role = 'lamp';
  const lampBox = box(lamps), glowX = lamps.length ? lampBox.getSize(new THREE.Vector3()).x / 2 - 0.2 : lx;
  const glowY = lamps.length ? lampBox.getCenter(new THREE.Vector3()).y : y, glowZ = lamps.length ? lampBox.max.z : l / 2;
  for (const side of [-1, 1]) {
    if (!lamps.length) light(body, 'tail', MAT.tail, [0.32, 0.09, 0.04], [side * lx, y, l / 2 + 0.02], true);
    light(body, 'glow', MAT.glow, [1.1, 0.7, 1], [side * glowX, glowY, glowZ + 0.1]);
    light(body, 'head', MAT.head, [1.3, 0.9, 1], [side * lx, y * 0.9, -l / 2 - 0.15], true);
    for (const z of [-l / 2 - 0.02, l / 2 + 0.02]) light(body, side < 0 ? 'blinkL' : 'blinkR', MAT.blink, [0.12, 0.08, 0.04], [side * (lx + 0.18), y, z]);
  }
}

let night = 0;
/** 0 = day, 1 = night: headlights on, tail lights brighter. */
export function setNight(n: number) {
  night = n;
  MAT.head.opacity = n * 0.9;
  MAT.tail.emissiveIntensity = 0.6 + n * 1.5;
}

/** Tail lights always glow dim red; braking makes them bright with a halo. */
export function setBrakeLights(v: Vehicle, on: boolean) {
  for (const t of v.tail) (t as THREE.Mesh).material = on ? MAT.brake : MAT.tail;
  for (const l of v.lamp) ((l as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 8 : 0.6 + night * 1.2;
  for (const g of v.glow) g.visible = on;
}

/** dir: -1 left, 1 right, 0 off. `phase` is the shared on/off beat so all blinkers flash together. */
export function setBlinker(v: Vehicle, dir: -1 | 0 | 1, phase: boolean, hazard = false) {
  for (const b of v.blinkL) b.visible = phase && (hazard || dir < 0);
  for (const b of v.blinkR) b.visible = phase && (hazard || dir > 0);
}
