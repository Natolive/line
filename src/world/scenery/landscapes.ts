// What fills each kind of landscape (Theme.scenery), one side of a section at a time, and the shores of lakes
// and rivers. A new landscape is one more entry in LANDSCAPES.
import type * as THREE from 'three';
import { GUARDRAIL_X } from '../../core/config.ts';
import type { Scenery as Kind } from '../../data/themes.ts';
import { terrainHeight } from '../../rules/terrain.ts';
import type { Plot } from './plot.ts';

const PYLON_X = 78; // m from the road to the power lines

// Salts: each kind of landmark draws its own spots (Plot.slot).
const SALT = { village: 30, farm: 40, turbine: 50, mesa: 60, petrol: 70, paddock: 90, tank: 100, cabin: 110, pump: 120, crane: 130, billboard: 140, church: 150, mast: 160, lighthouse: 170 };

/** About `avg` trees, `near`..`far` m past the rail (more near), none above the snow line. */
function trees(p: Plot, avg: number, protos: THREE.Object3D[], near = 7, far = 110, snowLine = 9999) {
  for (let i = p.count(avg); i > 0; i--) {
    const d = p.along(), x = p.side * GUARDRAIL_X + p.away(near, far);
    if (terrainHeight(d, x) < snowLine - 15) p.put(p.pick(protos), d, x, { scale: p.rand(0.75, 1.25) });
  }
}
const meadow = (p: Plot, avg: number, near: number, far: number) => p.scatter(avg, p.world.flowers, () => p.verge(near, far), () => ({ scale: p.rand(0.8, 1.4) }));
const village = (p: Plot, chance: number) => {
  // a village is a 240 m stretch of houses on one side
  if (!p.stretch(240, SALT.village, chance)) return;
  for (let i = p.count(1.3); i > 0; i--) p.put(p.pick(p.world.houses), p.along(), p.away(38, 120, 1), { yaw: p.square() + p.rand(-0.2, 0.2), size: 6 });
};
const billboard = (p: Plot, every: number, chance: number) =>
  p.landmark(every, SALT.billboard, chance, (s) => p.put(p.pick(p.world.billboards), s.d, p.verge(10, 20), { yaw: -p.side * p.rand(0.2, 0.5), size: 3 }));
const church = (p: Plot, chance: number) =>
  p.landmark(900, SALT.church, chance, (s) => p.put(p.world.churches[0], s.d, p.side * p.rand(50, 130), { yaw: p.square(), size: 9 }));
const mast = (p: Plot, chance: number) => p.landmark(1500, SALT.mast, chance, (s) => p.put(p.world.masts[0], s.d, p.side * p.rand(150, 400), { size: 1.5 }));
const waterTower = (p: Plot, every: number, chance: number, near: number, far: number) =>
  p.landmark(every, SALT.tank, chance, (s) => p.put(p.world.waterTowers[0], s.d, p.side * p.rand(near, far), { size: 3 }));
const crane = (p: Plot, every: number, near: number, far: number) =>
  p.landmark(every, SALT.crane, 0.4, (s) => p.put(p.pick(p.world.cranes), s.d, p.side * p.rand(near, far), { size: 3 }));

function forest(p: Plot) {
  const w = p.world;
  trees(p, 7, w.trees);
  p.scatter(4, w.bushes, () => p.verge(3, 14), () => ({ scale: p.rand(0.7, 1.3) }));
  p.scatter(0.6, w.rocks, () => p.verge(2.5, 8));
  meadow(p, 1.5, 4, 40);
  p.scatter(1, w.stumps, () => p.verge(3, 25), () => ({ scale: p.rand(0.8, 1.3) }));
  village(p, 0.25);
  church(p, 0.2);
  billboard(p, 600, 0.3);
}

function farm(p: Plot) {
  const w = p.world;
  trees(p, 1.5, w.trees, 10, 160);
  p.scatter(2.5, w.hay, () => p.away(24, 170, 1), () => ({ size: 1.5 }));
  p.landmark(320, SALT.farm, 0.45, (s) => {
    const x = p.side * p.rand(48, 90);
    p.put(p.pick(w.barns), s.d, x, { yaw: p.square(), size: 9 });
    p.put(p.pick(w.houses), s.d + p.rand(-14, 14), x + p.side * 24, { yaw: p.rand(-0.3, 0.3), size: 6 });
  });
  p.landmark(170, SALT.turbine, 0.45, (s) => p.spinning(p.put(p.pick(w.turbines), s.d, p.side * p.rand(170, 460), { yaw: Math.PI / 2 + p.rand(-0.2, 0.2), size: 4 })));
  if (p.side > 0) p.powerLine(PYLON_X);
  meadow(p, 2, 4, 60);
  p.landmark(200, SALT.paddock, 0.5, (s) => {
    // a fence along the road, cows or sheep grazing behind it
    const x = p.side * p.rand(22, 34), herd = s.roll < 0.25 ? w.cows : w.sheep;
    for (let k = 0; k < 3; k++) p.put(w.fences[0], s.d + k * 12, x, { yaw: Math.PI / 2 });
    for (let i = p.count(4); i > 0; i--) p.put(p.pick(herd), s.d + p.rand(0, 36), x + p.side * p.rand(3, 25));
  });
  p.scatter(0.15, w.tractors, () => p.away(26, 120, 1));
  waterTower(p, 900, 0.4, 60, 160);
  mast(p, 0.4);
  village(p, 0.12);
  church(p, 0.3);
  billboard(p, 500, 0.35);
}

function lake(p: Plot) {
  const w = p.world;
  trees(p, 3, w.birches, 6, 90);
  trees(p, 2, w.trees, 10, 140);
  trees(p, 3, w.palms, 6, 80);
  p.scatter(0.5, w.rocks, () => p.verge(3, 20));
  meadow(p, 1, 4, 30);
  village(p, 0.15);
  church(p, 0.15);
  billboard(p, 700, 0.25);
}

function mountain(p: Plot) {
  const w = p.world, snow = p.theme.snowLine;
  trees(p, 4, w.trees, 8, 200, snow);
  trees(p, 1.2, w.pines, 8, 200, snow); // tall Scots pines: few, they are sparse
  trees(p, 0.4, w.deadTrees, 6, 60, snow);
  p.scatter(0.5, w.boulders, () => p.away(20, 160), () => ({ scale: p.rand(0.6, 2.4) }));
  p.landmark(400, SALT.cabin, 0.35, (s) => p.put(w.cabins[0], s.d, p.side * p.rand(30, 90), { yaw: p.square(), size: 5 }));
  mast(p, 0.5);
}

function desert(p: Plot) {
  const w = p.world;
  p.scatter(2.5, w.cacti, () => p.away(20, 160), () => ({ scale: p.rand(0.6, 1.5) }));
  p.scatter(0.4, w.rocks, () => p.verge(4, 30), () => ({ scale: p.rand(1, 2.5) }));
  trees(p, 0.5, w.deadTrees, 8, 120);
  p.landmark(260, SALT.mesa, 0.55, (s) => p.put(p.pick(w.mesas), s.d, p.side * p.rand(140, 520), { scale: p.rand(0.8, 2.2), size: 10 }));
  p.landmark(500, SALT.pump, 0.4, (s) => p.put(w.windpumps[0], s.d, p.side * p.rand(30, 120), { size: 2 }));
  waterTower(p, 1100, 0.3, 50, 140);
  billboard(p, 500, 0.4);
  p.landmark(2400, SALT.petrol, 0.7, (s) => p.put(p.pick(w.petrol), s.d, p.side * 34, { yaw: -p.side * (Math.PI / 2), size: 8 }));
}

function industrial(p: Plot) {
  const w = p.world;
  if (p.chance(0.7)) p.put(p.pick(w.factories), p.along(), p.away(32, 140, 1), { yaw: p.square(), size: 12, scale: p.rand(0.8, 1.4) });
  trees(p, 1, w.trees, 6, 40);
  p.scatter(0.6, w.containers, () => p.away(26, 120, 1), () => ({ yaw: Math.floor(p.rand(0, 2)) * (Math.PI / 2), size: 6 }));
  crane(p, 300, 50, 140);
  waterTower(p, 700, 0.4, 40, 120);
  billboard(p, 400, 0.4);
  if (p.side > 0) p.powerLine(PYLON_X + 20);
  p.streetLamp();
}

function city(p: Plot) {
  // three rows of buildings: low ones near the road, towers behind
  const all = p.world.buildings, low = all.slice(0, Math.ceil(all.length / 2));
  for (let row = 0; row < 3; row++) {
    if (p.chance(0.1)) continue;
    p.put(p.pick(row === 0 ? low : all), p.along(), p.verge(16 + row * 34, 24 + row * 34), { yaw: p.square(), size: 8 });
  }
  crane(p, 250, 110, 180);
  billboard(p, 160, 0.5);
  p.streetLamp();
}

export const LANDSCAPES: Record<Kind, (p: Plot) => void> = { forest, farm, lake, mountain, desert, industrial, city };

/** On a lake or river and along its banks. Boats and lilies only on real water, not on lava or toxic pools. */
export function shore(p: Plot, water: number) {
  const w = p.world, calm = p.theme.water.glow < 0.5;
  if (calm) {
    p.scatter(0.25, w.boats, () => p.away(40, 500, 1.3), () => ({ afloat: true, size: 0.1 }));
    p.scatter(0.2, w.buoys, () => p.side * p.rand(30, 120), () => ({ afloat: true }));
    p.scatter(1, w.lilies, () => p.side * p.rand(20, 200), () => ({ afloat: true }));
  }
  for (let k = 0; k < 10; k++) {
    // banks: where the land comes down to within a metre of the water
    const d = p.along(), x = p.away(18, 300, 1.4), y = terrainHeight(d, x);
    if (Math.abs(y - water - 0.7) > 0.7) continue;
    p.put(calm && p.chance(0.7) ? p.pick(w.reeds) : p.pick(w.rocks), d, x, { scale: p.rand(0.8, 1.5) });
  }
  if (!calm) return;
  p.landmark(1600, SALT.lighthouse, 0.6, (s) => {
    // on the first bit of shore out from the road
    for (let x = 40; x < 500; x += 15) {
      const y = terrainHeight(s.d, p.side * x);
      if (y > water + 0.5 && y < water + 3) {
        p.put(w.lighthouses[0], s.d, p.side * x, { size: 3 });
        return;
      }
    }
  });
}
