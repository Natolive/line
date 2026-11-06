// The catalogue of roadside props, each built once from code as a low-poly toy (world/props/); the scenery
// places copies of them (geometry and materials shared). No model files.
import type * as THREE from 'three';
import { barn, cabin, church, cow, fence, hay, house, mast, pylon, sheep, tractor, turbine, waterTower, windpump } from './props/country.ts';
import { arch, birch, boulder, bush, cactus, deadTree, flowers, lilies, mesa, palm, pine, reeds, stones, stump, tree } from './props/nature.ts';
import { billboard, containers, crane, factory, petrol, towers } from './props/town.ts';
import { boat, buoy, lighthouse } from './props/water.ts';

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
  flowers: THREE.Object3D[]; // meadow patches, ~4 m across
  fences: THREE.Object3D[]; // one 12 m paddock fence span along x
  cows: THREE.Object3D[];
  sheep: THREE.Object3D[];
  tractors: THREE.Object3D[];
  stumps: THREE.Object3D[]; // stumps, fallen logs, toadstools
  palms: THREE.Object3D[];
  billboards: THREE.Object3D[]; // panel faces +z
  waterTowers: THREE.Object3D[];
  windpumps: THREE.Object3D[];
  deadTrees: THREE.Object3D[];
  cabins: THREE.Object3D[];
  masts: THREE.Object3D[]; // red and white radio masts, 60 m
  churches: THREE.Object3D[];
  containers: THREE.Object3D[]; // stacks of shipping containers
  cranes: THREE.Object3D[]; // tower cranes, ~50 m
  boats: THREE.Object3D[]; // afloat: waterline at y = 0.4
  buoys: THREE.Object3D[]; // afloat: waterline at y = 0.4
  lilies: THREE.Object3D[]; // flat on the water
  reeds: THREE.Object3D[]; // on the bank
  lighthouses: THREE.Object3D[];
};

const range = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

/** Builds every prop. */
export function buildWorld(): World {
  return {
    trees: range(8, tree),
    bushes: range(5, bush),
    rocks: range(3, stones),
    buildings: towers(8),
    pines: range(4, pine),
    birches: range(2, birch),
    houses: range(3, house),
    barns: [barn()],
    hay: [hay()],
    turbines: [turbine()],
    pylons: [pylon()],
    cacti: range(3, cactus),
    mesas: [mesa(28, 0), mesa(20, 1), arch()],
    boulders: range(2, boulder),
    petrol: [petrol()],
    factories: [factory(18, 0), factory(14, 1)],
    flowers: range(4, flowers),
    fences: [fence()],
    cows: range(3, cow),
    sheep: [sheep()],
    tractors: range(2, tractor),
    stumps: range(3, stump),
    palms: range(4, palm),
    billboards: range(5, billboard),
    waterTowers: [waterTower()],
    windpumps: [windpump()],
    deadTrees: range(3, deadTree),
    cabins: [cabin()],
    masts: [mast()],
    churches: [church()],
    containers: range(3, containers),
    cranes: range(2, crane),
    boats: range(3, boat),
    buoys: range(2, buoy),
    lilies: range(2, lilies),
    reeds: range(3, reeds),
    lighthouses: [lighthouse()],
  };
}
