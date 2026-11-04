// Roadside scenery in 40 m sections, kept filled from just behind the car to past the fog, standing on the
// land (rules/terrain.ts). Each section is filled with the landscape of its spot on the road; across a zone
// border each prop picks one side or the other as the land blends, so landscapes merge instead of cutting.
import * as THREE from 'three';
import { GUARDRAIL_X, ROADSIDE } from '../core/config.ts';
import type { Scenery as Kind, Theme } from '../data/themes.ts';
import { terrainHeight, waterAt } from '../rules/terrain.ts';
import { hash, overpassesIn, randomFor, structureAt } from '../rules/track.ts';
import type { World } from './assets.ts';
import { softDot } from './smoke.ts';
import { themePair } from './terrain.ts';
import { PieceFrame, Ring, type TrackView } from './track.ts';

const SECTION = 40, BEHIND = 140, AHEAD = 1340;
const PYLON_EVERY = 280, PYLON_X = 78; // m between pylons of the power lines, m from the road
// each section draws from its own stream of the map's seed: the same scenery every time it is built, for every player
let random = Math.random;
const pick = <T,>(a: T[]) => a[Math.floor(random() * a.length)];
const rand = (a: number, b: number) => a + random() * (b - a);

type Section = { group: THREE.Group; blades: THREE.Object3D[] };

export class Scenery {
  private ring: Ring<Section>;
  private world: World;
  // ponytail: props are clones (one draw call per mesh, ~1000 in all). Switch to InstancedMesh pools if fps suffers.
  private lampHead = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 0.3 });
  private lampPool = new THREE.MeshBasicMaterial({ map: softDot, color: 0xffc879, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private metal = new THREE.MeshStandardMaterial({ color: 0x6e737a, metalness: 0.8, roughness: 0.4 });
  private cable = new THREE.LineBasicMaterial({ color: 0x2a2c30 });
  private windows = new Set<THREE.MeshStandardMaterial>();
  private lamp: THREE.Group;
  private spin = 0;

  constructor(track: TrackView, world: World) {
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
    this.lamp = this.streetLamp();
    this.ring = new Ring<Section>(SECTION, BEHIND, AHEAD, (d0) => {
      const s = this.fill(d0);
      track.place(s.group, d0, 0);
      track.root.add(s.group);
      return s;
    }, (s) => {
      track.root.remove(s.group);
      s.group.traverse((o) => { if ((o as THREE.Line).isLine) (o as THREE.Line).geometry.dispose(); });
    });
  }

  /** Drops every section, to be filled again (a new map). */
  clear() {
    this.ring.clear();
  }

  update(d: number, dt = 0) {
    this.ring.update(d);
    this.spin += dt * 1.6; // rad/s: a big turbine's ~15 rpm
    for (const s of this.ring.pieces()) for (const b of s.blades) b.rotation.z = this.spin;
  }

  /** 0 = day, 1 = night. */
  setNight(n: number) {
    this.lampHead.emissiveIntensity = 0.3 + n * 6;
    this.lampPool.opacity = n * 0.6;
    for (const m of this.windows) m.emissiveIntensity = n * 0.9;
  }

  /** Fills the section that starts at road position `d0`. */
  private fill(d0: number): Section {
    random = randomFor(Math.round(d0 / SECTION));
    const pf = new PieceFrame(d0), group = new THREE.Group(), blades: THREE.Object3D[] = [], w = this.world;
    const { a, b, blend } = themePair(d0), water = waterAt(d0 + SECTION / 2);
    const overpasses = overpassesIn(d0 - 20, d0 + SECTION + 20);
    const themeAt = (d: number): Theme => (random() < blend(d) ? b : a);

    /** Stands a copy of `proto` on the land at (d, x); `size` is its footprint radius, to sit it down on slopes. */
    const put = (proto: THREE.Object3D, d: number, x: number, o: { scale?: number; yaw?: number; size?: number } = {}) => {
      if (Math.abs(x) < ROADSIDE.corridor + (o.size ?? 0) * 0.7) return null;
      if (overpasses.some((p) => Math.abs(p - d) < 14 + (o.size ?? 0)) && Math.abs(x) < 460) return null; // the crossing road's embankment
      const r = o.size ?? 0;
      let y = terrainHeight(d, x);
      if (r) for (const [dd, dx] of [[-r, -r], [-r, r], [r, -r], [r, r]]) y = Math.min(y, terrainHeight(d + dd, x + dx));
      if (water !== null && y < water + 0.4) return null;
      const obj = proto.clone();
      if (o.scale) obj.scale.multiplyScalar(o.scale);
      group.add(pf.place(obj, d, x, y - (r ? 0.3 : 0.05), o.yaw ?? rand(0, Math.PI * 2)));
      return obj;
    };
    const along = () => d0 + rand(0, SECTION);
    const out = (near: number, far: number, bias = 1.6) => near + rand(0, 1) ** bias * (far - near);
    const slot = (every: number, salt: number, side: number) => {
      // one candidate spot every `every` meters on each side; returns its road position if it falls in this section
      const j = Math.floor(d0 / every), d = j * every + hash(j, salt + side) * every * 0.5;
      return d >= d0 && d < d0 + SECTION ? { d, roll: hash(j, salt + 2 + side) } : null;
    };

    for (const side of [-1, 1]) {
      const kind: Kind = themeAt(d0 + SECTION / 2).scenery;
      const n = (avg: number) => Math.floor(avg) + (random() < avg % 1 ? 1 : 0);
      const trees = (count: number, protos: THREE.Object3D[], near = 7, far = 110, snowLine = 9999) => {
        for (let i = n(count); i > 0; i--) {
          const d = along(), x = side * (GUARDRAIL_X + out(near, far));
          if (terrainHeight(d, x) < snowLine - 15) put(pick(protos), d, x, { scale: rand(0.75, 1.25) });
        }
      };
      const village = (chance: number) => {
        const j = Math.floor(d0 / 240);
        if (hash(j, 30 + side) > chance) return;
        for (let i = n(1.3); i > 0; i--) put(pick(w.houses), along(), side * out(38, 120, 1), { yaw: Math.floor(rand(0, 4)) * (Math.PI / 2) + rand(-0.2, 0.2), size: 6 });
      };
      if (kind === 'forest') {
        trees(7, w.trees);
        for (let i = n(4); i > 0; i--) put(pick(w.bushes), along(), side * (GUARDRAIL_X + rand(3, 14)), { scale: rand(0.7, 1.3) });
        for (let i = n(0.6); i > 0; i--) put(pick(w.rocks), along(), side * (GUARDRAIL_X + rand(2.5, 8)));
        village(0.25);
      } else if (kind === 'farm') {
        trees(1.5, w.trees, 10, 160);
        for (let i = n(2.5); i > 0; i--) put(pick(w.hay), along(), side * out(24, 170, 1), { size: 1.5 });
        const farm = slot(320, 40, side);
        if (farm && farm.roll < 0.45) {
          const x = side * rand(48, 90);
          put(pick(w.barns), farm.d, x, { yaw: Math.floor(rand(0, 4)) * (Math.PI / 2), size: 9 });
          put(pick(w.houses), farm.d + rand(-14, 14), x + side * 24, { yaw: rand(-0.3, 0.3), size: 6 });
        }
        const turbine = slot(170, 50, side);
        if (turbine && turbine.roll < 0.45) {
          const t = put(pick(w.turbines), turbine.d, side * rand(170, 460), { yaw: Math.PI / 2 + rand(-0.2, 0.2), size: 4 });
          if (t) blades.push(t.getObjectByName('blades')!);
        }
        if (side > 0) this.powerLine(pf, group, d0, PYLON_X);
        village(0.12);
      } else if (kind === 'lake') {
        trees(3, w.birches, 6, 90);
        trees(2, w.trees, 10, 140);
        for (let i = n(0.5); i > 0; i--) put(pick(w.rocks), along(), side * (GUARDRAIL_X + rand(3, 20)));
        village(0.15);
      } else if (kind === 'mountain') {
        const snow = a.snowLine;
        trees(4, w.trees, 8, 200, snow);
        trees(1.2, w.pines, 8, 200, snow); // tall Scots pines: few, they are sparse
        for (let i = n(0.5); i > 0; i--) put(pick(w.boulders), along(), side * out(20, 160), { scale: rand(0.6, 2.4) });
      } else if (kind === 'desert') {
        for (let i = n(2.5); i > 0; i--) put(pick(w.cacti), along(), side * out(20, 160), { scale: rand(0.6, 1.5) });
        for (let i = n(0.4); i > 0; i--) put(pick(w.rocks), along(), side * (GUARDRAIL_X + rand(4, 30)), { scale: rand(1, 2.5) });
        const mesa = slot(260, 60, side);
        if (mesa && mesa.roll < 0.55) put(pick(w.mesas), mesa.d, side * rand(140, 520), { scale: rand(0.8, 2.2), size: 10 });
        const petrol = slot(2400, 70, side);
        if (petrol && petrol.roll < 0.7) put(pick(w.petrol), petrol.d, side * 34, { yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, size: 8 });
      } else if (kind === 'industrial') {
        if (random() < 0.7) put(pick(w.factories), along(), side * out(32, 140, 1), { yaw: Math.floor(rand(0, 4)) * (Math.PI / 2), size: 12, scale: rand(0.8, 1.4) });
        trees(1, w.trees, 6, 40);
        if (side > 0) this.powerLine(pf, group, d0, PYLON_X + 20);
        this.lampAt(pf, group, side, d0 + (side < 0 ? 0 : SECTION / 2));
      } else {
        // three rows of buildings: low ones near the road, towers behind
        const all = w.buildings, low = all.slice(0, Math.ceil(all.length / 2));
        for (let row = 0; row < 3; row++) {
          if (random() > 0.9) continue;
          put(pick(row === 0 ? low : all), along(), side * (GUARDRAIL_X + 16 + row * 34 + rand(0, 8)), { yaw: Math.floor(rand(0, 4)) * (Math.PI / 2), size: 8 });
        }
        this.lampAt(pf, group, side, d0 + (side < 0 ? 0 : SECTION / 2));
      }
    }
    return { group, blades };
  }

  /** Pylons of a power line running beside the road, and the sagging cables to the next one. */
  private powerLine(pf: PieceFrame, group: THREE.Group, d0: number, x: number) {
    const j = Math.ceil(d0 / PYLON_EVERY), d = j * PYLON_EVERY;
    if (d >= d0 + SECTION) return;
    const h = this.world.pylons[0].userData.height as number, y0 = terrainHeight(d, x), y1 = terrainHeight(d + PYLON_EVERY, x);
    if (structureAt(d) || waterAt(d) !== null) return;
    group.add(pf.place(this.world.pylons[0].clone(), d, x, y0 - 0.2, Math.PI / 2));
    // ponytail: cable ends guessed from the model's shape (arms at ~70 % and ~85 % of its height); measure the mesh if they look off
    const pts: number[] = [];
    for (const [dx, k] of [[-6, 0.7], [6, 0.7], [-4.5, 0.85], [4.5, 0.85]]) {
      for (let i = 0; i < 12; i++) {
        for (const t of [i / 12, (i + 1) / 12]) {
          const sag = 6 * 4 * t * (1 - t), y = y0 + (y1 - y0) * t + h * k - sag;
          pf.write(pts, pts.length, d + t * PYLON_EVERY, x + dx, y);
        }
      }
    }
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(geo, this.cable));
  }

  /** A street lamp prototype: pole on the verge, arm over the road, and the pool of light it throws (visible at night). */
  private streetLamp() {
    const g = new THREE.Group(), x = GUARDRAIL_X + 1.2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 9, 8).translate(0, 4.5, 0), this.metal);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.14), this.metal), head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.35), this.lampHead);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), this.lampPool);
    pole.position.set(x, 0, 0);
    arm.position.set(x - 1.6, 8.95, 0);
    head.position.set(x - 3.1, 8.85, 0);
    pool.position.set(x - 4, 0.04, 0);
    pole.castShadow = arm.castShadow = true;
    g.add(pole, arm, head, pool);
    return g;
  }

  /** Street lamp on side `side` (-1 left, 1 right), its arm over the road. */
  private lampAt(pf: PieceFrame, group: THREE.Group, side: number, d: number) {
    if (structureAt(d)) return; // tunnels and bridges have their own lighting
    const lamp = this.lamp.clone();
    lamp.scale.x = side; // mirrored for the left side
    group.add(pf.place(lamp, d, 0, 0));
  }
}
