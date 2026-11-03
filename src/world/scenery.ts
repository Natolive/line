// Roadside scenery in 40 m sections. Each section is filled, far ahead in the fog, with the scenery of
// the theme at its spot on the road, so a new landscape rolls in instead of popping.
import * as THREE from 'three';
import { GUARDRAIL_X } from '../core/config.ts';
import { THEMES, ZONE_LENGTH } from '../data/themes.ts';
import { themeIndexAt } from '../rules/themes.ts';
import type { World } from './assets.ts';
import { WRAP_Z } from './road.ts';
import { softDot } from './smoke.ts';

const SECTION = 40;
const COUNT = 26; // ~1 km: sections are filled well past the fog, where they melt into the horizon
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Scenery {
  private sections: THREE.Group[] = [];
  private world: World;
  // ponytail: props are clones (one draw call each, ~400 total). Switch to InstancedMesh pools if fps suffers.
  private lampHead = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 0.3 });
  private lampPool = new THREE.MeshBasicMaterial({ map: softDot, color: 0xffc879, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private metal = new THREE.MeshStandardMaterial({ color: 0x6e737a, metalness: 0.8, roughness: 0.4 });
  private windows = new Set<THREE.MeshStandardMaterial>();
  private pole = new THREE.CylinderGeometry(0.09, 0.14, 9, 8).translate(0, 4.5, 0);
  private arm = new THREE.BoxGeometry(3.4, 0.12, 0.14);
  private head = new THREE.BoxGeometry(0.9, 0.15, 0.35);
  private pool = new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2);

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    // buildings' own facade texture doubles as their night lighting: windows glow when it gets dark
    for (const b of world.buildings) {
      b.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!mat?.map) return;
        mat.emissiveMap = mat.map;
        mat.emissive.set(0xffd9a0);
        mat.emissiveIntensity = 0;
        this.windows.add(mat);
      });
    }
    for (let i = 0; i < COUNT; i++) {
      const g = new THREE.Group();
      g.position.z = WRAP_Z - (i + 1) * SECTION;
      scene.add(g);
      this.sections.push(g);
    }
  }

  /** Refills every section for a run starting at road distance `dist`. */
  reset(dist: number) {
    for (const g of this.sections) this.fill(g, dist - g.position.z);
  }

  update(dz: number, dist: number) {
    for (const g of this.sections) {
      g.position.z += dz;
      if (g.position.z > WRAP_Z) {
        g.position.z -= COUNT * SECTION;
        this.fill(g, dist - g.position.z);
      }
    }
  }

  /** 0 = day, 1 = night. */
  setNight(n: number) {
    this.lampHead.emissiveIntensity = 0.3 + n * 6;
    this.lampPool.opacity = n * 0.6;
    for (const m of this.windows) m.emissiveIntensity = n * 0.9;
  }

  /** Populates one section; `d` is its distance down the road. */
  private fill(g: THREE.Group, d: number) {
    g.clear();
    const theme = THEMES[themeIndexAt(d, THEMES.length)];
    const into = ((d % ZONE_LENGTH) + ZONE_LENGTH) % ZONE_LENGTH;
    // scenery thickens over the first 300 m of a zone and thins near its end: landscapes merge, not cut
    const fadeIn = d < ZONE_LENGTH ? 1 : into / 300; // the very first zone starts full
    const density = Math.min(1, fadeIn, (ZONE_LENGTH - into) / 200 + 0.25);
    const place = (proto: THREE.Object3D, x: number, z: number, scale = 1) => {
      const o = proto.clone();
      o.position.set(x, 0, z);
      o.rotation.y = rand(0, Math.PI * 2);
      o.scale.multiplyScalar(scale);
      g.add(o);
    };

    for (const side of [-1, 1]) {
      if (theme.scenery === 'forest') {
        for (let i = 0; i < Math.round(7 * density); i++) place(pick(this.world.trees), side * (GUARDRAIL_X + 7 + rand(0, 1) ** 1.6 * 110), rand(0, SECTION), rand(0.8, 1.2));
        for (let i = 0; i < Math.round(4 * density); i++) place(pick(this.world.bushes), side * (GUARDRAIL_X + rand(3, 14)), rand(0, SECTION), rand(0.7, 1.3));
        if (Math.random() < 0.6 * density) place(pick(this.world.rocks), side * (GUARDRAIL_X + rand(2.5, 8)), rand(0, SECTION));
      } else {
        // three rows of buildings: low ones near the road, towers behind
        const all = this.world.buildings, low = all.slice(0, Math.ceil(all.length / 2));
        for (let row = 0; row < 3; row++) {
          if (Math.random() > density) continue;
          const b = pick(row === 0 ? low : all).clone();
          b.position.set(side * (GUARDRAIL_X + 16 + row * 34 + rand(0, 8)), 0, rand(0, SECTION));
          b.rotation.y = Math.floor(rand(0, 4)) * (Math.PI / 2);
          g.add(b);
        }
        this.lamp(g, side, side < 0 ? 0 : SECTION / 2);
      }
    }
  }

  /** Street lamp on the verge, arm over the road, and the pool of light it throws (visible at night). */
  private lamp(g: THREE.Group, side: number, z: number) {
    const x = side * (GUARDRAIL_X + 1.2);
    const pole = new THREE.Mesh(this.pole, this.metal), arm = new THREE.Mesh(this.arm, this.metal), head = new THREE.Mesh(this.head, this.lampHead);
    pole.position.set(x, 0, z);
    arm.position.set(x - side * 1.6, 8.95, z);
    head.position.set(x - side * 3.1, 8.85, z);
    const pool = new THREE.Mesh(this.pool, this.lampPool);
    pool.position.set(x - side * 4, 0.04, z);
    pole.castShadow = arm.castShadow = true;
    g.add(pole, arm, head, pool);
  }
}
