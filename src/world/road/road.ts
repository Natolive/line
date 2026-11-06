// The motorway, built in 80 m pieces along its curve (rules/track.ts) and kept built from behind the
// rear-view mirror's reach to past the fog. Each part of a piece is built by its own module: the carriageway
// and verges, tunnels, bridges, overpasses; this file runs them and keeps the sign gantries.
import * as THREE from 'three';
import { THEMES } from '../../data/themes.ts';
import { themeIndexAt, toNextBorder } from '../../rules/themes.ts';
import { gantriesIn, rowsIn, structureAt } from '../../rules/track.ts';
import { Mesher } from '../mesher.ts';
import { landMaterial, texV, themePair } from '../terrain.ts';
import { PieceFrame, Ring, type TrackView } from '../track.ts';
import { bridges } from './bridges.ts';
import { carriageway, chevrons, verges } from './carriageway.ts';
import { overpasses } from './overpass.ts';
import { lightPaints, roadPaints, shadowCasters } from './paints.ts';
import { modeOf, type Build, type Mode } from './piece.ts';
import { gantry, type Gantry } from './signs.ts';
import { tunnels } from './tunnel.ts';

const LEN = 80, ROW = 4, BEHIND = 420, AHEAD = 1500; // m per piece, m between rows, m kept built behind and ahead
const PARTS = [carriageway, verges, tunnels, bridges, overpasses, chevrons];

type Piece = { group: THREE.Group; geos: THREE.BufferGeometry[]; gantries: Gantry[] };

export class Road {
  private ring: Ring<Piece>;
  private paints = roadPaints();
  readonly asphalt = this.paints.asphalt;
  private spare: Gantry[] = [];
  private live = new Set<Gantry>();
  private night = 0;

  constructor(track: TrackView) {
    this.ring = new Ring<Piece>(LEN, BEHIND, AHEAD, (d0) => {
      const p = this.build(d0);
      track.place(p.group, d0, 0);
      track.root.add(p.group);
      return p;
    }, (p) => {
      track.root.remove(p.group);
      for (const g of p.geos) g.dispose();
      for (const g of p.gantries) {
        this.live.delete(g);
        this.spare.push(g);
      }
    });
  }

  update(d: number) {
    this.ring.update(d);
  }

  /** Drops every piece, to be built again (a new map). */
  clear() {
    this.ring.clear();
  }

  /** 0 = day, 1 = night. */
  setNight(n: number) {
    this.night = n;
    for (const g of this.live) this.lightGantry(g);
    lightPaints(this.paints, n);
  }

  private build(d0: number): Piece {
    const pf = new PieceFrame(d0), d1 = d0 + LEN, ds = rowsIn(d0, d1, ROW), group = new THREE.Group();
    const meshers = new Map<THREE.Material, Mesher>();
    const modes = ds.slice(0, -1).map((d, i) => modeOf(structureAt((d + ds[i + 1]) / 2)));
    const { a, b, blend } = themePair(d0);
    const build: Build = {
      pf, group, d0, d1, blend,
      land: landMaterial(a, b),
      mesher: (mat) => {
        let m = meshers.get(mat);
        if (!m) meshers.set(mat, (m = new Mesher(pf)));
        return m;
      },
      runs: (want: (m: Mode) => boolean) => {
        const out: number[][] = [];
        modes.forEach((m, i) => {
          if (!want(m)) return;
          if (i > 0 && want(modes[i - 1])) out[out.length - 1].push(ds[i + 1]);
          else out.push([ds[i], ds[i + 1]]);
        });
        return out;
      },
      v0: (rows) => texV(d0, rows[0]),
    };
    for (const part of PARTS) part(build, this.paints);
    const gantries = gantriesIn(d0, d1).map((d) => this.placeGantry(build, d));

    const geos: THREE.BufferGeometry[] = [], casters = shadowCasters(this.paints);
    for (const [mat, m] of meshers) {
      if (m.empty) continue;
      const g = m.geometry(), mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = casters.includes(mat);
      group.add(mesh);
      geos.push(g);
    }
    return { group, geos, gantries };
  }

  /** A sign gantry at `d`, from the pool, naming the next area and how far it is. */
  private placeGantry(b: Build, d: number) {
    const g = this.spare.pop() ?? gantry(this.paints.steel);
    const next = THEMES[(themeIndexAt(d, THEMES.length) + 1) % THEMES.length];
    g.next.draw(next.name.toUpperCase(), `↑ ${(toNextBorder(d) / 1000).toFixed(1)} km`);
    this.lightGantry(g);
    b.group.add(b.pf.place(g.group, d, 0));
    this.live.add(g);
    return g;
  }

  private lightGantry(g: Gantry) {
    for (const m of g.mats) m.emissiveIntensity = 0.08 + this.night * 0.55;
  }
}
