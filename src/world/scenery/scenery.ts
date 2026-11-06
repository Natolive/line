// Roadside scenery in 40 m sections, kept filled from just behind the car to past the fog, standing on the
// land (rules/terrain.ts). Each side of a section is filled with the landscape of its spot on the road
// (landscapes.ts); across a zone border each side picks one theme or the other as the land blends, so
// landscapes merge instead of cutting.
import * as THREE from 'three';
import type { Theme } from '../../data/themes.ts';
import { waterAt } from '../../rules/terrain.ts';
import { overpassesIn, randomFor } from '../../rules/track.ts';
import type { World } from '../assets.ts';
import { themePair } from '../terrain.ts';
import { PieceFrame, Ring, type TrackView } from '../track.ts';
import { LANDSCAPES, shore } from './landscapes.ts';
import { Plot, SECTION, type SectionContext } from './plot.ts';
import { Roadside } from './roadside.ts';
import { Tinter } from './tint.ts';

const BEHIND = 140, AHEAD = 1340; // m kept filled behind and ahead
const TURBINE_SPIN = 1.6; // rad/s: a big turbine's ~15 rpm

type Section = { group: THREE.Group; blades: THREE.Object3D[] };

export class Scenery {
  // ponytail: props are clones (one draw call per mesh, ~1000 in all). Switch to InstancedMesh pools if fps suffers.
  private ring: Ring<Section>;
  private world: World;
  private windows = new Set<THREE.MeshStandardMaterial>();
  private tinter = new Tinter(this.windows);
  private roadside: Roadside;
  private spin = 0;

  constructor(track: TrackView, world: World) {
    this.world = world;
    this.roadside = new Roadside(world.pylons[0]);
    // buildings' own facade texture doubles as their night lighting: windows glow when it gets dark
    for (const b of world.buildings) {
      b.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!mat?.map) return;
        mat.emissiveMap ??= mat.map; // towers bring their own: only the windows glow
        mat.emissive.set(0xffd9a0);
        mat.emissiveIntensity = 0;
        this.windows.add(mat);
      });
    }
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
    this.spin += dt * TURBINE_SPIN;
    for (const s of this.ring.pieces()) for (const b of s.blades) b.rotation.z = this.spin;
  }

  /** 0 = day, 1 = night. */
  setNight(n: number) {
    this.roadside.setNight(n);
    for (const m of this.windows) m.emissiveIntensity = n * 0.9;
  }

  /** Fills the section that starts at road position `d0`. */
  private fill(d0: number): Section {
    const random = randomFor(Math.round(d0 / SECTION)), { a, b, blend } = themePair(d0);
    const c: SectionContext = {
      d0, random,
      pf: new PieceFrame(d0),
      group: new THREE.Group(),
      water: waterAt(d0 + SECTION / 2),
      overpasses: overpassesIn(d0 - 20, d0 + SECTION + 20),
      world: this.world,
      roadside: this.roadside,
      recolour: (obj, color) => this.tinter.recolour(obj, color),
      blades: [],
    };
    for (const side of [-1, 1]) {
      const theme: Theme = random() < blend(d0 + SECTION / 2) ? b : a, plot = new Plot(c, side, theme);
      if (c.water !== null) shore(plot, c.water);
      LANDSCAPES[theme.scenery](plot);
    }
    return { group: c.group, blades: c.blades };
  }
}
