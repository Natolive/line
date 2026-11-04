// Loads the environment: HDRI skies, PBR textures, trees and buildings (credits in public/models/CREDITS.md).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { THEMES } from '../data/themes.ts';

export type Sky = { texture: THREE.DataTexture; sunDir: THREE.Vector3; horizon: THREE.Color };
export type Surface = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };
export type World = {
  skies: Record<string, Sky>;
  surfaces: Record<string, Surface>;
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
  pylons: THREE.Object3D[];
  cacti: THREE.Object3D[];
  mesas: THREE.Object3D[]; // big desert rock formations
  boulders: THREE.Object3D[]; // mountain rocks
  petrol: THREE.Object3D[];
  factories: THREE.Object3D[];
};

const BASE = import.meta.env.BASE_URL;
const TREE_SCALE = 0.55; // the pack's trees are 18-33 m tall; real roadside trees are 10-18 m
const BUILDING_SCALE = 40; // the city pack is a 1:40 miniature
// the other packs, each normalised to a real height when loaded (see loadWorld)
const MORE = ['pines', 'birch', 'house-1', 'house-2', 'house-3', 'barn', 'hay', 'turbine', 'pylon', 'cactus', 'desert-rock-1', 'desert-rock-2', 'desert-arch', 'alpine-rock-1', 'alpine-rock-2', 'petrol', 'factory', 'factory-2'];

/** Reads the sky photo to find where the sun is and what colour the horizon is (for fog that matches the sky). */
function analyzeSky(tex: THREE.DataTexture): Omit<Sky, 'texture'> {
  const { data, width: w, height: h } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const read = (i: number) => (data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < h / 2; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4, lum = read(i) + read(i + 1) + read(i + 2);
      if (lum > best) [best, bx, by] = [lum, x, y];
    }
  }
  // equirect pixel → direction, matching three.js's equirectUv()
  const lat = (0.5 - (by + 0.5) / h) * Math.PI, lon = ((bx + 0.5) / w - 0.5) * 2 * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat));

  const horizon = new THREE.Color(0, 0, 0), row = Math.floor(h * 0.47); // just above the horizon line
  for (let x = 0; x < w; x += 4) {
    const i = (row * w + x) * 4;
    horizon.r += read(i);
    horizon.g += read(i + 1);
    horizon.b += read(i + 2);
  }
  return { sunDir, horizon: horizon.multiplyScalar(4 / w) };
}

/**
 * Wraps nodes from a model pack as one prop: centred on x/z, standing on y = 0, at real-world scale
 * (`scale`, or whatever makes it `height` meters tall).
 */
function prop(nodes: THREE.Object3D | THREE.Object3D[], scale: number, height?: number) {
  const outer = new THREE.Group();
  for (const node of [nodes].flat()) {
    const inner = new THREE.Group();
    inner.matrixAutoUpdate = false;
    inner.matrix.copy(node.parent?.matrixWorld ?? new THREE.Matrix4());
    inner.add(node.clone());
    outer.add(inner);
  }
  outer.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(outer), c = b.getCenter(new THREE.Vector3());
  if (height) scale = height / (b.max.y - b.min.y);
  const fit = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z));
  for (const inner of outer.children) inner.matrix.premultiply(fit);
  outer.traverse((o) => { o.castShadow = o.receiveShadow = (o as THREE.Mesh).isMesh === true; });
  outer.userData.height = (b.max.y - b.min.y) * scale;
  return outer;
}

/**
 * The tree pack ships its leaves as see-through glass-like material, which made nearby trees invisible.
 * Use plain foliage instead: the leaf texture's alpha cuts out the shape, both faces shown (they're cards).
 */
const foliage = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function treeFix(o: THREE.Object3D) {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    const map = (mesh.material as THREE.MeshStandardMaterial).map!;
    if (!foliage.has(map)) foliage.set(map, new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }));
    mesh.material = foliage.get(map)!;
  });
  return o;
}

/** Leaves and other cut-out cards exported as blended glass: draw them as solid cut-outs, both faces. */
function cutouts(o: THREE.Object3D) {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
      if (!m.transparent && m.alphaTest === 0) continue;
      if (/glass/i.test(m.name)) continue;
      // their opacity is often lowered for the blend: back to opaque, the texture's alpha cuts the shape
      Object.assign(m, { transparent: false, opacity: 1, alphaTest: 0.45, side: THREE.DoubleSide, depthWrite: true });
    }
  });
  return o;
}

const objectsIn = (scene: THREE.Object3D) => {
  scene.updateMatrixWorld(true);
  let n = scene;
  while (n.children.length === 1) n = n.children[0]; // skip single-child wrappers
  return n.children;
};

/** Loads everything the scenery needs. onProgress gets 0..1. */
export async function loadWorld(onProgress: (fraction: number) => void): Promise<World> {
  const skyIds = [...new Set(THEMES.map((t) => t.sky))];
  const surfaceIds = [...new Set([...THEMES.flatMap((t) => [t.ground, t.rock]), 'asphalt_02', 'snow_02', 'concrete_wall_008'])];
  let done = 0;
  const total = skyIds.length + surfaceIds.length * 3 + 2 + MORE.length;
  const tick = <T,>(p: Promise<T>) => p.then((v) => (onProgress(++done / total), v));

  const hdr = new HDRLoader(), tex = new THREE.TextureLoader(), gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const image = (id: string, map: string, srgb: boolean) =>
    tick(tex.loadAsync(`${BASE}textures/${id}_${map}.jpg`)).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });

  const model = (name: string) => tick(gltf.loadAsync(`${BASE}models/${name}.glb`)).then((g) => (g.scene.updateMatrixWorld(true), g.scene));
  const [skies, surfaces, trees, city, more] = await Promise.all([
    Promise.all(skyIds.map((id) => tick(hdr.loadAsync(`${BASE}sky/${id}.hdr`)).then((t) => [id, { texture: t, ...analyzeSky(t) }] as const))),
    Promise.all(surfaceIds.map(async (id) => [id, { map: await image(id, 'color', true), normalMap: await image(id, 'normal', false), roughnessMap: await image(id, 'rough', false) }] as const)),
    model('trees').then(objectsIn),
    model('city').then(objectsIn),
    Promise.all(MORE.map(model)).then((scenes) => Object.fromEntries(MORE.map((n, i) => [n, scenes[i]]))),
  ]);
  const whole = (name: string, height: number) => cutouts(prop(more[name], 1, height));
  // the pine pack is one file of numbered trees, each split into trunk, branches and foliage
  const pineParts = new Map<string, THREE.Object3D[]>();
  // (the pack also holds the ground plane of its preview: not a numbered tree, left out)
  for (const o of objectsIn(more.pines)) if (/^\d+_/.test(o.name)) pineParts.set(o.name.split('_')[0], [...(pineParts.get(o.name.split('_')[0]) ?? []), o]);
  const turbine = whole('turbine', 100);
  let blades: THREE.Object3D | undefined;
  turbine.traverse((o) => { if (!blades && /blades/i.test(o.name)) blades = o; });
  blades!.name = 'blades';

  const named = (prefix: string, from: number, to: number) =>
    trees.filter((o) => o.name.startsWith(prefix)).filter((_, i) => i >= from && i <= to).map((o) => treeFix(prop(o, TREE_SCALE)));
  const buildings = city
    .map((o) => prop(o, BUILDING_SCALE))
    .filter((b) => b.userData.height > 14) // skip the pack's ground plate and street clutter
    .sort((a, b) => a.userData.height - b.userData.height);

  return {
    skies: Object.fromEntries(skies),
    surfaces: Object.fromEntries(surfaces),
    trees: named('Background_Tree_Atlas', 0, 7),
    bushes: named('Background_Tree_Atlas', 8, 12),
    rocks: trees.filter((o) => o.name.startsWith('Rocks')).map((o) => prop(o, 1.4)),
    buildings,
    pines: [...pineParts.values()].map((parts) => cutouts(prop(parts, 1, 19))),
    birches: [whole('birch', 15)],
    houses: ['house-1', 'house-2', 'house-3'].map((n) => whole(n, 8.5)),
    barns: [whole('barn', 11)],
    hay: [whole('hay', 1.5)],
    turbines: [turbine],
    pylons: [whole('pylon', 38)],
    cacti: objectsIn(more.cactus).map((o) => prop(o, 1, 5)),
    mesas: [whole('desert-rock-1', 28), whole('desert-rock-2', 20), whole('desert-arch', 18)],
    boulders: [whole('alpine-rock-1', 5), whole('alpine-rock-2', 4)],
    petrol: [whole('petrol', 7)],
    factories: [whole('factory', 18), whole('factory-2', 14)],
  };
}
