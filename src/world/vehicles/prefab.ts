// Turns a built car (fleet.ts) into a normalized vehicle: faces -z, sits on y = 0, centered, real size,
// wheels that spin and steer, lights fitted.
import * as THREE from 'three';
import { outline } from '../arcade.ts';
import { fitLights, type Role } from './lights.ts';

export type Vehicle = {
  mesh: THREE.Group; // positioned and yawed by gameplay
  body: THREE.Group; // rolls and pitches; wheels stay planted
  w: number;
  l: number;
  wheelR: number;
  wheels: THREE.Object3D[];
  steerPivots: THREE.Object3D[];
  exhaust: THREE.Vector3; // tailpipe, in vehicle space
  rearWheels: THREE.Vector3[]; // contact patches, in vehicle space
} & Record<Role, THREE.Object3D[]>;

export type Prefab = { root: THREE.Group; w: number; l: number; wheelR: number; exhaust: THREE.Vector3; rearWheels: THREE.Vector3[] };

export type Spec = {
  parts: THREE.Object3D[]; // the model's top-level pieces (body panels and wheels)
  isWheel: (o: THREE.Object3D) => boolean;
  forward: 'center' | [x: number, z: number]; // which way the source model faces
  length: number; // scale so the body is this long (m)
  lightHeight?: number; // brake light height as a fraction of body height
};


const box = (objs: THREE.Object3D[]) => objs.reduce((b, o) => b.union(new THREE.Box3().setFromObject(o, true)), new THREE.Box3());

/** Copies a source node into our space, keeping its full world transform (no geometry baking: meshes are quantized). */
function place(n: THREE.Object3D, pre: THREE.Matrix4) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.multiplyMatrices(pre, n.parent!.matrixWorld);
  g.add(n.clone());
  return g;
}

export function prefab(s: Spec): Prefab {
  const bodyParts = s.parts.filter((p) => !s.isWheel(p)), wheelParts = s.parts.filter(s.isWheel);
  const bodyBox = box(bodyParts), c = bodyBox.getCenter(new THREE.Vector3());
  const ground = box(s.parts).min.y;
  const [fx, fz] = s.forward === 'center' ? [-c.x, -c.z] : s.forward;
  const rt = new THREE.Matrix4()
    .makeRotationY(Math.PI - Math.atan2(fx, fz))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -ground, -c.z));

  // measure in the rotated frame, then pick the scale
  const probe = new THREE.Group();
  bodyParts.forEach((p) => probe.add(place(p, rt)));
  probe.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(probe, true).getSize(new THREE.Vector3());
  const wheelH = wheelParts.length ? new THREE.Box3().setFromObject(wheelParts[0], true).getSize(new THREE.Vector3()).y : 0.66;
  const k = s.length / size.z;
  const m = new THREE.Matrix4().makeScale(k, k, k).multiply(rt);

  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  bodyParts.forEach((p) => body.add(place(p, m)));

  let trackHalf = 0;
  const rearWheels: THREE.Vector3[] = [];
  for (const p of wheelParts) {
    const wb = new THREE.Box3().setFromObject(p, true);
    const center = wb.getCenter(new THREE.Vector3()).applyMatrix4(m);
    const tyreWidth = wb.clone().applyMatrix4(m).getSize(new THREE.Vector3()).x; // measured after rotation into vehicle space
    trackHalf = Math.max(trackHalf, Math.abs(center.x) + tyreWidth / 2);
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.position.copy(center);
    spin.add(place(p, new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z).multiply(m)));
    spin.userData.wheel = true;
    pivot.userData.steer = center.z < 0 && tyreWidth < 1; // front wheels; a merged axle (both wheels in one piece) can't steer
    if (center.z > 0) rearWheels.push(new THREE.Vector3(center.x, 0.05, center.z));
    pivot.add(spin);
    root.add(pivot);
  }

  const w = Math.min(size.x * k, trackHalf * 2 + 0.25), l = size.z * k, h = size.y * k;
  const y = h * (s.lightHeight ?? 0.55), lx = Math.min(w / 2, trackHalf) - 0.42; // inboard: rears taper at light height
  fitLights(body, l, h, y, lx);
  root.traverse((o) => { o.castShadow = o.receiveShadow = (o as THREE.Mesh).isMesh === true; });
  outline(root); // after the shadows: outlines cast none
  const exhaust = new THREE.Vector3(-Math.max(0.3, lx - 0.15), Math.min(0.35, y * 0.6), l / 2 + 0.05);
  return { root, w, l, wheelR: (wheelH * k) / 2, exhaust, rearWheels };
}

/** A new independent copy of a prefab; geometry and materials stay shared (except tail lamps, which each car switches on its own). */
export function spawn(p: Prefab): Vehicle {
  const mesh = p.root.clone(true);
  const v: Vehicle = {
    mesh, body: mesh.children[0] as THREE.Group, w: p.w, l: p.l, wheelR: p.wheelR, exhaust: p.exhaust, rearWheels: p.rearWheels,
    wheels: [], steerPivots: [], tail: [], lamp: [], glow: [], head: [], blinkL: [], blinkR: [],
  };
  mesh.traverse((o) => {
    if (o.userData.wheel) v.wheels.push(o);
    if (o.userData.steer) v.steerPivots.push(o);
    const role = o.userData.role as Role | undefined;
    if (role === 'lamp') (o as THREE.Mesh).material = ((o as THREE.Mesh).material as THREE.Material).clone();
    if (role) v[role].push(o);
  });
  return v;
}

export function spinWheels(v: Vehicle, distance: number) {
  for (const w of v.wheels) w.rotation.x -= distance / v.wheelR;
}

