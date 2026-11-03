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
};

const BASE = import.meta.env.BASE_URL;
const TREE_SCALE = 0.55; // the pack's trees are 18-33 m tall; real roadside trees are 10-18 m
const BUILDING_SCALE = 40; // the city pack is a 1:40 miniature

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

/** Wraps a node from a model pack: centred on x/z, standing on y = 0, at real-world scale. */
function prop(node: THREE.Object3D, scale: number) {
  const outer = new THREE.Group(), inner = new THREE.Group();
  inner.matrixAutoUpdate = false;
  inner.matrix.copy(node.parent!.matrixWorld);
  inner.add(node.clone());
  outer.add(inner);
  outer.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(outer), c = b.getCenter(new THREE.Vector3());
  inner.matrix.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z)));
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

const objectsIn = (scene: THREE.Object3D) => {
  scene.updateMatrixWorld(true);
  let n = scene;
  while (n.children.length === 1) n = n.children[0]; // skip single-child wrappers
  return n.children;
};

/** Loads everything the scenery needs. onProgress gets 0..1. */
export async function loadWorld(onProgress: (fraction: number) => void): Promise<World> {
  const skyIds = [...new Set(THEMES.map((t) => t.sky))];
  const surfaceIds = [...new Set([...THEMES.map((t) => t.ground), 'asphalt_02'])];
  let done = 0;
  const total = skyIds.length + surfaceIds.length * 3 + 2;
  const tick = <T,>(p: Promise<T>) => p.then((v) => (onProgress(++done / total), v));

  const hdr = new HDRLoader(), tex = new THREE.TextureLoader(), gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const image = (id: string, map: string, srgb: boolean) =>
    tick(tex.loadAsync(`${BASE}textures/${id}_${map}.jpg`)).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });

  const [skies, surfaces, trees, city] = await Promise.all([
    Promise.all(skyIds.map((id) => tick(hdr.loadAsync(`${BASE}sky/${id}.hdr`)).then((t) => [id, { texture: t, ...analyzeSky(t) }] as const))),
    Promise.all(surfaceIds.map(async (id) => [id, { map: await image(id, 'color', true), normalMap: await image(id, 'normal', false), roughnessMap: await image(id, 'rough', false) }] as const)),
    tick(gltf.loadAsync(`${BASE}models/trees.glb`)).then((g) => objectsIn(g.scene)),
    tick(gltf.loadAsync(`${BASE}models/city.glb`)).then((g) => objectsIn(g.scene)),
  ]);

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
  };
}
