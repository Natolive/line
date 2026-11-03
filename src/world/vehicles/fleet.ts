// Loads every vehicle model, with what's special about each file (where its wheels are, which way it faces).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { prefab, type Prefab, type Spec } from './prefab.ts';

export type Fleet = { players: Record<string, Prefab>; cars: Prefab[]; heavy: Prefab[] };

// The traffic pack holds 8 cars arranged in a circle, all facing its center.
// [body node prefix, wheel node letter, real length in m]
const PACK: [string, string, number][] = [
  ['sedan', 'A', 4.7], ['hatchback', 'B', 4.1], ['compact', 'C', 3.7], ['minivan', 'D', 4.9],
  ['pickup', 'E', 5.3], ['coupe', 'F', 4.5], ['offroad', 'G', 4.4], ['sport', 'H', 4.4],
];

const children = (scene: THREE.Object3D, container: string) => {
  scene.updateMatrixWorld(true);
  return scene.getObjectByName(container)!.children;
};
const plain = (name: string) => name.replace(/[^A-Za-z0-9]/g, ''); // GLTFLoader strips dots from node names

// How to read each garage car's file. Keys match `model` in src/data/cars/.
const PLAYER_SPECS: Record<string, (scene: THREE.Object3D) => Spec> = {
  'car-lambo': (s) => {
    const wheels = new Set(['wheel2', '94', 'wheel119', '9120']); // tyres and rims, each axle merged into one piece
    return {
      parts: children(s, 'GLTF_SceneRootNode'), isWheel: (o) => wheels.has(plain(o.name)), forward: [0, 1], length: 5.02, lightHeight: 0.72,
      flipWinding: true,
    };
  },
  'car-bmw': (s) => {
    const root = children(s, 'RootNode'), empty = root.find((o) => o.name === 'Empty')!;
    const wheels = new Set(['Circle070', 'Circle068', 'Object442', 'Line005']);
    return { parts: [...root.filter((o) => o !== empty), ...empty.children], isWheel: (o) => wheels.has(plain(o.name)), forward: [1, 0], length: 4.8, lightHeight: 0.71 };
  },
};

/** One car of the traffic pack: its body plus the wheels that sit under it (the pack reuses wheel names elsewhere). */
function packCar(parts: THREE.Object3D[], bodyName: string, letter: string) {
  const body = parts.find((o) => o.name.toLowerCase().startsWith(bodyName))!;
  const outline = new THREE.Box3().setFromObject(body).expandByScalar(0.3);
  const wheels = parts.filter((o) => o.name.startsWith(`Wheel_${letter}`) && outline.containsPoint(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())));
  return [body, ...wheels];
}

/** Loads every model. onProgress gets 0..1 as bytes arrive. */
export async function loadFleet(onProgress: (fraction: number) => void): Promise<Fleet> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = [...Object.keys(PLAYER_SPECS), 'traffic', 'van', 'truck'];
  const bytes = files.map(() => ({ loaded: 0, total: 1 }));
  const report = () => onProgress(bytes.reduce((a, b) => a + b.loaded, 0) / bytes.reduce((a, b) => a + b.total, 0));
  const scenes = await Promise.all(
    files.map((name, i) =>
      loader
        .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`, (e) => {
          bytes[i] = { loaded: e.loaded, total: e.total || e.loaded };
          report();
        })
        .then((g) => {
          bytes[i].loaded = bytes[i].total;
          report();
          return g.scene;
        }),
    ),
  );
  const byName = Object.fromEntries(files.map((f, i) => [f, scenes[i]]));
  const packParts = children(byName.traffic, 'RootNode');
  const [van, truck] = [byName.van, byName.truck];
  return {
    players: Object.fromEntries(Object.entries(PLAYER_SPECS).map(([file, spec]) => [file, prefab(spec(byName[file]))])),
    cars: PACK.map(([bodyName, letter, length]) =>
      prefab({
        parts: packCar(packParts, bodyName, letter),
        isWheel: (o) => o.name.startsWith('Wheel_'),
        forward: 'center',
        length,
      }),
    ),
    heavy: [
      prefab({ parts: children(van, 'RootNode'), isWheel: (o) => o.name.includes('WheelStock'), forward: [1, 0], length: 4.9 }),
      prefab({ parts: children(truck, 'RootNode'), isWheel: (o) => /wheel|tire/i.test(o.name), forward: [0, 1], wheelDiameter: 1.05, maxWidth: 2.55, lightHeight: 0.3 }),
    ],
  };
}

