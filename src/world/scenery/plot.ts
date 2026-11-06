// One side of one 40 m section of scenery being filled: where things may stand, and the dice that place them.
// The dice come from the map's seed, so a section is the same every time it is built, for every player.
import * as THREE from 'three';
import { GUARDRAIL_X, ROADSIDE } from '../../core/config.ts';
import type { Theme } from '../../data/themes.ts';
import { terrainHeight } from '../../rules/terrain.ts';
import { hash } from '../../rules/track.ts';
import type { World } from '../assets.ts';
import type { PieceFrame } from '../track.ts';
import type { Roadside } from './roadside.ts';

export const SECTION = 40; // m of road per section
const CLEAR = 1.5; // m kept free of props beyond the guard rail

/** How far a prop turned `yaw` from the road reaches sideways from its centre (m). */
export function reach(proto: THREE.Object3D, yaw: number) {
  const [hx, hz] = (proto.userData.half as [number, number] | undefined) ?? [0, 0];
  return hx * Math.abs(Math.cos(yaw)) + hz * Math.abs(Math.sin(yaw));
}

export type PutOptions = {
  scale?: number;
  yaw?: number; // rad from the road; random when left out
  size?: number; // m, footprint radius: the prop sits down to the lowest ground under it
  afloat?: boolean; // on the water, 0.4 m deep, instead of on the land
};
export type Spot = { d: number; roll: number };

/** What a section shares between its two sides. */
export type SectionContext = {
  d0: number;
  pf: PieceFrame;
  group: THREE.Group;
  random: () => number;
  water: number | null; // m, the level of a lake or river nearby
  overpasses: number[];
  world: World;
  roadside: Roadside;
  recolour: (obj: THREE.Object3D, color: number) => void;
  blades: THREE.Object3D[]; // turbine rotors placed, to be turned
};

export class Plot {
  readonly side: number; // -1 left, 1 right
  readonly theme: Theme;
  readonly world: World;
  readonly water: number | null;
  private c: SectionContext;

  constructor(c: SectionContext, side: number, theme: Theme) {
    this.c = c;
    this.side = side;
    this.theme = theme;
    this.world = c.world;
    this.water = c.water;
  }

  // dice
  rand(a: number, b: number) {
    return a + this.c.random() * (b - a);
  }
  chance(p: number) {
    return this.c.random() < p;
  }
  pick<T>(list: T[]) {
    return list[Math.floor(this.c.random() * list.length)];
  }
  /** A whole count averaging `avg`. */
  count(avg: number) {
    return Math.floor(avg) + (this.chance(avg % 1) ? 1 : 0);
  }
  /** A yaw square to the road. */
  square() {
    return Math.floor(this.rand(0, 4)) * (Math.PI / 2);
  }

  // where
  /** A road position inside the section. */
  along() {
    return this.c.d0 + this.rand(0, SECTION);
  }
  /** Signed x, `near`..`far` m beyond the guard rail, evenly. */
  verge(near: number, far: number) {
    return this.side * (GUARDRAIL_X + this.rand(near, far));
  }
  /** Signed x, `near`..`far` m from the centre line, more often near (`bias` > 1). */
  away(near: number, far: number, bias = 1.6) {
    return this.side * (near + this.rand(0, 1) ** bias * (far - near));
  }
  /**
   * One candidate spot every `every` m on this side, if it falls in this section: its road position and a roll
   * (0..1) to decide whether anything stands there. `salt` keeps each kind of landmark on its own spots.
   */
  slot(every: number, salt: number): Spot | null {
    const j = Math.floor(this.c.d0 / every), d = j * every + hash(j, salt + this.side) * every * 0.5;
    return d >= this.c.d0 && d < this.c.d0 + SECTION ? { d, roll: hash(j, salt + 2 + this.side) } : null;
  }
  /** Whether the `every` m stretch of road this section lies in is kept on this side, with chance `chance`. */
  stretch(every: number, salt: number, chance: number) {
    return hash(Math.floor(this.c.d0 / every), salt + this.side) < chance;
  }
  /** Runs `at` on this side's landmark spot of `every` m, kept with chance `chance`. */
  landmark(every: number, salt: number, chance: number, at: (s: Spot) => void) {
    const s = this.slot(every, salt);
    if (s && s.roll < chance) at(s);
  }

  // placing
  /** Stands a copy of `proto` at (d, x) on the land, or afloat; null where it may not stand. */
  put(proto: THREE.Object3D, d: number, x: number, o: PutOptions = {}) {
    const r = o.size ?? 0, water = this.c.water;
    if (Math.abs(x) < ROADSIDE.corridor + r * 0.7) return null;
    const yaw = o.yaw ?? this.rand(0, Math.PI * 2);
    if (Math.abs(x) - reach(proto, yaw) * (o.scale ?? 1) < GUARDRAIL_X + CLEAR) return null; // nothing reaches over the rail
    if (this.c.overpasses.some((p) => Math.abs(p - d) < 14 + r) && Math.abs(x) < 460) return null; // the crossing road's embankment
    let y = terrainHeight(d, x);
    if (r) for (const [dd, dx] of [[-r, -r], [-r, r], [r, -r], [r, r]]) y = Math.min(y, terrainHeight(d + dd, x + dx));
    if (o.afloat) {
      if (water === null || y > water - 1) return null; // too shallow or dry
      y = water - 0.4 + (r ? 0.3 : 0.05);
    } else if (water !== null && y < water + 0.4) return null;
    const obj = proto.clone();
    if (this.theme.tint !== undefined) this.c.recolour(obj, this.theme.tint);
    if (o.scale) obj.scale.multiplyScalar(o.scale);
    this.c.group.add(this.c.pf.place(obj, d, x, y - (r ? 0.3 : 0.05), yaw));
    return obj;
  }
  /** About `avg` copies of `protos`, each somewhere along the section at `x()`. */
  scatter(avg: number, protos: THREE.Object3D[], x: () => number, o: () => PutOptions = () => ({})) {
    for (let i = this.count(avg); i > 0; i--) this.put(this.pick(protos), this.along(), x(), o());
  }
  /** A turbine (or anything with a 'blades' child) whose rotor turns. */
  spinning(obj: THREE.Object3D | null) {
    const blades = obj?.getObjectByName('blades');
    if (blades) this.c.blades.push(blades);
  }

  // along the road
  /** A power line `x` m out on this side. */
  powerLine(x: number) {
    this.c.roadside.powerLine(this.c.pf, this.c.group, this.c.d0, this.c.d0 + SECTION, this.side * x);
  }
  /** A street lamp on this side; the two sides alternate. */
  streetLamp() {
    this.c.roadside.lampAt(this.c.pf, this.c.group, this.side, this.c.d0 + (this.side < 0 ? 0 : SECTION / 2));
  }
}
