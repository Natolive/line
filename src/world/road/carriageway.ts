// The motorway itself, everywhere: asphalt, markings, guard rails; in the open, its verges, noise walls and bend chevrons.
import * as THREE from 'three';
import { CARRIAGEWAY_HALF, GUARDRAIL_X, LANE_WIDTH, LANES, ROADSIDE } from '../../core/config.ts';
import { THEMES } from '../../data/themes.ts';
import { terrainHeight } from '../../rules/terrain.ts';
import { themeIndexAt } from '../../rules/themes.ts';
import { curvatureAt, hash, structureAt } from '../../rules/track.ts';
import type { Profile } from '../mesher.ts';
import { texV } from '../terrain.ts';
import type { RoadPaints } from './paints.ts';
import { ASPHALT_TILE, box, C, CONCRETE_TILE, every, LAND_TILE, modeOf, RH, type Build } from './piece.ts';

const DASH = 3, DASH_EVERY = 12; // m of paint, m from one lane dash to the next
const RAIL_POST = new THREE.BoxGeometry(0.12, 0.7, 0.12).translate(0, 0.35, 0);
const CHEVRON = new THREE.PlaneGeometry(1.1, 1.1), CHEVRON_POST = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).translate(0, 0.8, 0);

/** Asphalt, edge lines, lane dashes, rails and their posts: under every stretch, open, tunnel or bridge. */
export function carriageway(b: Build, p: RoadPaints) {
  for (const rows of b.runs(() => true)) {
    b.mesher(p.asphalt).sweep(rows, () => [[-RH, 0], [RH, 0]], ASPHALT_TILE, b.v0(rows));
    for (const s of [-1, 1]) {
      const x = s * (CARRIAGEWAY_HALF + 0.1);
      b.mesher(p.paint).sweep(rows, () => [[x - 0.1, 0.015], [x + 0.1, 0.015]], 1);
      b.mesher(p.metal).sweepFlat(rows, () => box(s * GUARDRAIL_X - 0.04, s * GUARDRAIL_X + 0.04, 0.45, 0.79), 1);
    }
  }
  for (const x of LANES.slice(1).map((l) => l - LANE_WIDTH / 2)) {
    for (const d of every(DASH_EVERY, b.d0 - DASH, b.d1)) {
      const from = Math.max(d, b.d0), to = Math.min(d + DASH, b.d1);
      if (to > from) b.mesher(p.paint).sweep([from, to], () => [[x - 0.075, 0.015], [x + 0.075, 0.015]], 1);
    }
  }
  for (const d of every(4, b.d0, b.d1)) for (const s of [-1, 1]) b.mesher(p.metal).solid(RAIL_POST, d, s * (GUARDRAIL_X + 0.1), 0);
}

/** In the open: verges from the road edge to the land, as a cutting or an embankment, and noise walls in town. */
export function verges(b: Build, p: RoadPaints) {
  for (const rows of b.runs((m) => m === 'open')) {
    const m = b.mesher(b.land);
    for (const s of [-1, 1]) {
      const pts = (d: number): Profile => {
        const h = terrainHeight(d, s * C), ditch: [number, number] = [s * (RH + 0.6), Math.min(0, h) * 0.15 - 0.25];
        return s < 0 ? [[-C, h], ditch, [-RH, -0.02]] : [[RH, -0.02], ditch, [C, h]];
      };
      for (const d of rows) for (const [x, y] of pts(d)) m.vertex(d, x, y, x / LAND_TILE, texV(b.d0, d) / LAND_TILE, b.blend(d));
      m.grid(rows.length, 3);
    }
    for (const s of [-1, 1]) {
      const x = s * (GUARDRAIL_X + 1.7), share = THEMES[themeIndexAt(rows[0], THEMES.length)].structures.noiseWalls;
      const walled = rows.filter((d) => hash(Math.floor(d / 200), s > 0 ? 11 : 12) < share);
      if (walled.length > 1) b.mesher(p.concrete).sweepFlat(walled, () => box(x - 0.12, x + 0.12, -0.5, 4), CONCRETE_TILE);
    }
  }
}

/** Red chevron boards on the outside of tight bends, in the open. */
export function chevrons(b: Build, p: RoadPaints) {
  for (const d of every(50, b.d0, b.d1)) {
    const k = curvatureAt(d);
    if (Math.abs(k) < 1 / ROADSIDE.chevronRadius || modeOf(structureAt(d)) !== 'open') continue;
    const board = new THREE.Mesh(CHEVRON, k > 0 ? p.chevron.right : p.chevron.left), sign = new THREE.Group();
    board.position.y = 1.8;
    sign.add(board, new THREE.Mesh(CHEVRON_POST, p.steel));
    b.group.add(b.pf.place(sign, d, -Math.sign(k) * (GUARDRAIL_X + 0.9)));
  }
}
