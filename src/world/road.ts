// The motorway, built in 80 m pieces along its curve (rules/track.ts) and kept built from behind the
// rear-view mirror's reach to past the fog: asphalt, markings, rails, verges, and whatever the road runs
// through or under: tunnels, viaducts, the lake bridge, overpasses, sign gantries, chevrons, noise walls.
import * as THREE from 'three';
import { CARRIAGEWAY_HALF, GUARDRAIL_X, LANE_WIDTH, LANES, ROADSIDE } from '../core/config.ts';
import { THEMES } from '../data/themes.ts';
import { floorHeight, terrainHeight, waterLevel } from '../rules/terrain.ts';
import { themeIndexAt, toNextBorder } from '../rules/themes.ts';
import { curvatureAt, gantriesIn, hash, overpassesIn, rowsIn, structureAt, structuresIn, type Structure } from '../rules/track.ts';
import type { World } from './assets.ts';
import { Mesher, type Profile } from './mesher.ts';
import { landMaterial, texV, themePair } from './terrain.ts';
import { PieceFrame, Ring, type TrackView } from './track.ts';

const LEN = 80, ROW = 4, BEHIND = 420, AHEAD = 1500;
const RH = GUARDRAIL_X + 0.5; // half width of the asphalt, out past the rails
const C = ROADSIDE.corridor, TH = ROADSIDE.tunnelHalf, VAULT = 4.6; // m: walls rise straight to VAULT, then arch to tunnelHeight
const DECK = 1.6; // m, depth of a bridge deck
const ASPHALT_TILE = 6, LAND_TILE = 12, CONCRETE_TILE = 4;

type Mode = 'open' | 'tunnel' | 'bridge';
const modeOf = (s: Structure | null): Mode => (!s ? 'open' : s.kind === 'tunnel' ? 'tunnel' : 'bridge');

/** Box cross-section, traced so its faces point outward. */
const box = (xl: number, xr: number, yb: number, yt: number): Profile => [[xl, yt], [xr, yt], [xr, yb], [xl, yb], [xl, yt]];

/** Inside of the tunnel: floor stubs, walls and vault, traced so every face looks into the tube. */
const VAULT_PROFILE: Profile = [
  [RH, 0], [TH, 0], [TH, VAULT],
  ...Array.from({ length: 11 }, (_, i): [number, number] => {
    const a = (Math.PI * (i + 1)) / 12;
    return [TH * Math.cos(a), VAULT + (ROADSIDE.tunnelHeight - VAULT) * Math.sin(a)];
  }),
  [-TH, VAULT], [-TH, 0], [-RH, 0],
];

/** A canvas-faced sign: a face that glows faintly by day, like retroreflective sheeting at night. */
function canvasMaterial(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.6 });
  return { mat, map, g: canvas.getContext('2d')! };
}

/** A motorway sign panel whose face is drawn on a canvas. */
function signPanel(w: number, h: number) {
  const { mat, map, g } = canvasMaterial(512, Math.round((512 * h) / w));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const draw = (big: string, small: string) => {
    const W = g.canvas.width, H = g.canvas.height;
    g.fillStyle = '#0b5d3b';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = 8;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.fillStyle = '#f2f2f2';
    g.textAlign = 'center';
    g.font = `700 ${Math.round(H * 0.34)}px "Chakra Petch", Arial, sans-serif`;
    g.fillText(big, W / 2, H * 0.48);
    g.font = `500 ${Math.round(H * 0.24)}px "Chakra Petch", Arial, sans-serif`;
    g.fillText(small, W / 2, H * 0.82);
    map.needsUpdate = true;
  };
  return { mesh, mat, draw };
}

/** Steel gantry spanning the road with two signs: the next area ahead, and the road's name. */
function gantry(steel: THREE.Material) {
  const group = new THREE.Group(), span = (GUARDRAIL_X + 0.6) * 2;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7.6, 0.35), steel);
    post.position.set((s * span) / 2, 3.8, 0);
    group.add(post);
  }
  for (const y of [7.4, 5.8]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, 0.22), steel);
    beam.position.set(0, y, -0.15);
    group.add(beam);
  }
  const next = signPanel(7, 2.4), road = signPanel(5, 2.4);
  next.mesh.position.set(-3.4, 6.6, 0.05);
  road.mesh.position.set(4.2, 6.6, 0.05);
  road.draw('LINE', 'No exit');
  group.add(next.mesh, road.mesh);
  group.traverse((o) => { o.castShadow = true; });
  return { group, next, mats: [next.mat, road.mat] };
}
type Gantry = ReturnType<typeof gantry>;

/** Red chevron board (bend ahead), arrows pointing right; mirrored by its texture for left bends. */
function chevronMaterials() {
  const { mat, map, g } = canvasMaterial(256, 256);
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffffff';
  for (const x of [40, 130]) {
    g.beginPath();
    g.moveTo(x, 40);
    g.lineTo(x + 50, 40);
    g.lineTo(x + 110, 128);
    g.lineTo(x + 50, 216);
    g.lineTo(x, 216);
    g.lineTo(x + 60, 128);
    g.closePath();
    g.fill();
  }
  map.needsUpdate = true;
  const leftMap = map.clone();
  leftMap.repeat.x = -1;
  leftMap.offset.x = 1;
  leftMap.wrapS = THREE.RepeatWrapping;
  const left = mat.clone();
  left.map = left.emissiveMap = leftMap;
  return { right: mat, left };
}

type Piece = { group: THREE.Group; geos: THREE.BufferGeometry[]; gantries: Gantry[] };

export class Road {
  private ring: Ring<Piece>;
  private world: World;
  readonly asphalt: THREE.MeshStandardMaterial;
  private paint = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.35 });
  private steel = new THREE.MeshStandardMaterial({ color: 0x8d9299, metalness: 0.7, roughness: 0.45 });
  private concrete: THREE.MeshStandardMaterial;
  private headwall: THREE.MeshStandardMaterial;
  private lamp = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc070, emissiveIntensity: 3 });
  private chevron = chevronMaterials();
  private sign = new THREE.PlaneGeometry(1.1, 1.1);
  private signPost = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).translate(0, 0.8, 0);
  private spare: Gantry[] = [];
  private live = new Set<Gantry>();
  private night = 0;

  constructor(track: TrackView, world: World) {
    this.world = world;
    const s = world.surfaces;
    this.asphalt = new THREE.MeshStandardMaterial({ map: s.asphalt_02.map, normalMap: s.asphalt_02.normalMap, roughnessMap: s.asphalt_02.roughnessMap, color: 0x9a9a9a });
    this.concrete = new THREE.MeshStandardMaterial({ map: s.concrete_wall_008.map, normalMap: s.concrete_wall_008.normalMap, roughnessMap: s.concrete_wall_008.roughnessMap, color: 0xc9c6bf });
    this.headwall = this.concrete.clone();
    this.headwall.side = THREE.DoubleSide; // seen from the approach and, through the mouth, from inside
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
    for (const g of this.live) for (const m of g.mats) m.emissiveIntensity = 0.08 + n * 0.55;
    this.chevron.left.emissiveIntensity = this.chevron.right.emissiveIntensity = 0.1 + n * 0.6;
  }

  private build(d0: number): Piece {
    const pf = new PieceFrame(d0), d1 = d0 + LEN, ds = rowsIn(d0, d1, ROW);
    const group = new THREE.Group(), geos: THREE.BufferGeometry[] = [], gantries: Gantry[] = [];
    const meshers = new Map<THREE.Material, Mesher>();
    const mesher = (mat: THREE.Material) => {
      let m = meshers.get(mat);
      if (!m) meshers.set(mat, (m = new Mesher(pf)));
      return m;
    };
    const modes = ds.slice(0, -1).map((d, i) => modeOf(structureAt((d + ds[i + 1]) / 2)));
    /** Rows of each stretch where `want(mode)` holds, as lists of road positions. */
    const runs = (want: (m: Mode) => boolean) => {
      const out: number[][] = [];
      modes.forEach((m, i) => {
        if (!want(m)) return;
        if (i > 0 && want(modes[i - 1])) out[out.length - 1].push(ds[i + 1]);
        else out.push([ds[i], ds[i + 1]]);
      });
      return out;
    };
    const v0 = (rows: number[]) => texV(d0, rows[0]);
    const all = () => true;

    // asphalt, edge lines, lane dashes (3 m paint, 9 m gap), rails and their posts: everywhere
    for (const rows of runs(all)) {
      mesher(this.asphalt).sweep(rows, () => [[-RH, 0], [RH, 0]], ASPHALT_TILE, v0(rows));
      for (const s of [-1, 1]) {
        const x = s * (CARRIAGEWAY_HALF + 0.1);
        mesher(this.paint).sweep(rows, () => [[x - 0.1, 0.015], [x + 0.1, 0.015]], 1);
        mesher(this.metal).sweepFlat(rows, () => box(s * GUARDRAIL_X - 0.04, s * GUARDRAIL_X + 0.04, 0.45, 0.79), 1);
      }
    }
    for (const x of LANES.slice(1).map((l) => l - LANE_WIDTH / 2)) {
      for (let d = Math.floor(d0 / 12) * 12; d < d1; d += 12) {
        const a = Math.max(d, d0), b = Math.min(d + 3, d1);
        if (b > a) mesher(this.paint).sweep([a, b], () => [[x - 0.075, 0.015], [x + 0.075, 0.015]], 1);
      }
    }
    const post = new THREE.BoxGeometry(0.12, 0.7, 0.12).translate(0, 0.35, 0);
    for (let d = Math.ceil(d0 / 4) * 4; d < d1; d += 4) for (const s of [-1, 1]) this.solid(mesher(this.metal), post, d, s * (GUARDRAIL_X + 0.1), 0);

    // verges in the open: from the road edge to where the land starts, as a cutting or an embankment
    const { a, b, blend } = themePair(d0), land = landMaterial(this.world, a, b);
    for (const rows of runs((m) => m === 'open')) {
      const m = mesher(land);
      for (const s of [-1, 1]) {
        const pts = (d: number): Profile => {
          const h = terrainHeight(d, s * C), ditch: [number, number] = [s * (RH + 0.6), Math.min(0, h) * 0.15 - 0.25];
          return s < 0 ? [[-C, h], ditch, [-RH, -0.02]] : [[RH, -0.02], ditch, [C, h]];
        };
        for (const d of rows) for (const [x, y] of pts(d)) m.vertex(d, x, y, x / LAND_TILE, texV(d0, d) / LAND_TILE, blend(d));
        m.grid(rows.length, 3);
      }
      // noise walls along some stretches in town
      for (const s of [-1, 1]) {
        const x = s * (GUARDRAIL_X + 1.7), share = THEMES[themeIndexAt(rows[0], THEMES.length)].structures.noiseWalls;
        const walled = rows.filter((d) => hash(Math.floor(d / 200), s > 0 ? 11 : 12) < share);
        if (walled.length > 1) mesher(this.concrete).sweepFlat(walled, () => box(x - 0.12, x + 0.12, -0.5, 4), CONCRETE_TILE);
      }
    }

    // tunnels: the tube, its lamps, the hill closed over it, and a concrete headwall at each portal
    for (const rows of runs((m) => m === 'tunnel')) {
      mesher(this.concrete).sweep(rows, () => VAULT_PROFILE, CONCRETE_TILE, v0(rows));
      const m = mesher(land);
      for (const d of rows) {
        const l = terrainHeight(d, -C), r = terrainHeight(d, C);
        for (const [x, y] of [[-C, l], [0, (l + r) / 2 + 1], [C, r]]) m.vertex(d, x, y, x / LAND_TILE, texV(d0, d) / LAND_TILE, blend(d));
      }
      m.grid(rows.length, 3);
      const lampBox = new THREE.BoxGeometry(0.35, 0.1, 1.6);
      for (let d = Math.ceil(rows[0] / 10) * 10; d < rows[rows.length - 1]; d += 10) for (const x of [-3.2, 3.2]) this.solid(mesher(this.lamp), lampBox, d, x, ROADSIDE.tunnelHeight - 0.55);
    }
    for (const s of structuresIn(d0, d1)) {
      if (s.kind === 'tunnel') {
        for (const e of [s.from, s.to]) if (e >= d0 && e < d1) this.portal(mesher(this.headwall), e);
      } else this.bridgeSupports(mesher(this.concrete), s, d0, d1);
    }

    // bridges: the deck under the road and a concrete parapet on each edge
    for (const rows of runs((m) => m === 'bridge')) {
      mesher(this.concrete).sweepFlat(rows, () => [[RH + 0.35, 0], [RH + 0.35, -DECK], [-RH - 0.35, -DECK], [-RH - 0.35, 0]], CONCRETE_TILE, v0(rows));
      for (const s of [-1, 1]) mesher(this.concrete).sweepFlat(rows, () => box(s * RH + (s < 0 ? -0.35 : 0), s * RH + (s < 0 ? 0 : 0.35), -0.05, 1), CONCRETE_TILE);
    }

    for (const d of overpassesIn(d0, d1)) this.overpass(mesher(this.concrete), mesher(this.asphalt), d);

    // chevrons on the outside of tight bends
    for (let d = Math.ceil(d0 / 50) * 50; d < d1; d += 50) {
      const k = curvatureAt(d);
      if (Math.abs(k) < 1 / ROADSIDE.chevronRadius || modeOf(structureAt(d)) !== 'open') continue;
      const x = -Math.sign(k) * (GUARDRAIL_X + 0.9), board = new THREE.Mesh(this.sign, k > 0 ? this.chevron.right : this.chevron.left);
      board.position.y = 1.8;
      const pole = new THREE.Mesh(this.signPost, this.steel), sign = new THREE.Group();
      sign.add(board, pole);
      group.add(pf.place(sign, d, x));
    }

    for (const d of gantriesIn(d0, d1)) {
      const g = this.spare.pop() ?? gantry(this.steel);
      const next = THEMES[(themeIndexAt(d, THEMES.length) + 1) % THEMES.length];
      g.next.draw(next.name.toUpperCase(), `↑ ${(toNextBorder(d) / 1000).toFixed(1)} km`);
      for (const m of g.mats) m.emissiveIntensity = 0.08 + this.night * 0.55;
      group.add(pf.place(g.group, d, 0));
      gantries.push(g);
      this.live.add(g);
    }

    for (const [mat, m] of meshers) {
      if (m.empty) continue;
      const g = m.geometry(), mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = mat === this.metal || mat === this.concrete || mat === this.headwall;
      group.add(mesh);
      geos.push(g);
    }
    return { group, geos, gantries };
  }

  /** Adds a solid (built around its own origin, -z down the road) at road point (d, x, y). */
  private solid(m: Mesher, geo: THREE.BufferGeometry, d: number, x: number, y: number) {
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
    const before = m.vertexCount;
    for (let i = 0; i < p.count; i++) {
      m.vertex(d - p.getZ(i), x + p.getX(i), y + p.getY(i), uv.getX(i), uv.getY(i));
      m.normal(n.getX(i), n.getY(i), -n.getZ(i), d);
    }
    m.indices(geo.index?.array ?? Array.from({ length: p.count }, (_, i) => i), before);
  }

  /** Headwall around a tunnel mouth at road position `d`: a ring of concrete from the vault out to the hill's face. */
  private portal(m: Mesher, d: number) {
    const l = terrainHeight(d, -C), r = terrainHeight(d, C), mid = (l + r) / 2 + 2;
    const top = (x: number) => (x < 0 ? mid + (l + 1 - mid) * (-x / C) : mid + (r + 1 - mid) * (x / C));
    const inner = VAULT_PROFILE.slice(1, -1), pairs: [number, number, number, number][] = [];
    for (const [x, y] of inner) {
      const ox = (x / TH) * C;
      if (y <= VAULT) {
        pairs.push([x, y, ox, y === 0 ? -0.5 : y]);
        if (y === VAULT) pairs.push([x, y, ox, top(ox)]); // up the side to the top corner
      } else pairs.push([x, y, ox, top(ox)]);
    }
    // the right wall's corner comes before its arch, the left wall's after: put the left corner pair after the arch
    const ordered = [...pairs.slice(0, 3), ...pairs.slice(3, -3), pairs[pairs.length - 2], pairs[pairs.length - 3], pairs[pairs.length - 1]];
    for (const [x, y, ox, oy] of ordered) {
      m.vertex(d, x, y, x / CONCRETE_TILE, y / CONCRETE_TILE);
      m.vertex(d, ox, oy, ox / CONCRETE_TILE, oy / CONCRETE_TILE);
    }
    m.grid(ordered.length, 2);
  }

  /** Abutments at both ends of a bridge and piers every ~40 m, down to the valley floor or the lake bed. */
  private bridgeSupports(m: Mesher, s: Structure, d0: number, d1: number) {
    const n = Math.max(1, Math.round((s.to - s.from) / 40)), step = (s.to - s.from) / n;
    for (let i = 0; i <= n; i++) {
      const d = s.from + i * step;
      if (d < d0 || d >= d1) continue;
      const bottom = Math.min(floorHeight(d), s.water ? waterLevel(s) - 4 : Infinity) - 2, top = -DECK;
      const h = top - bottom;
      if (h <= 0) continue;
      if (i === 0 || i === n) {
        const wall = new THREE.BoxGeometry(2 * RH + 0.7, h, 2.5).translate(0, bottom + h / 2, 0);
        this.solid(m, wall, d + (i === 0 ? 1.25 : -1.25), 0, 0);
        continue;
      }
      const cap = new THREE.BoxGeometry(2 * RH - 2, 1.2, 2.6).translate(0, top - 0.6, 0);
      this.solid(m, cap, d, 0, 0);
      for (const x of [-5, 5]) this.solid(m, new THREE.BoxGeometry(2.2, h - 1.2, 2.2).translate(0, bottom + (h - 1.2) / 2, 0), d, x, 0);
    }
  }

  /** A local road crossing over the motorway on a concrete bridge, from embankment to embankment. */
  private overpass(m: Mesher, top: Mesher, d: number) {
    const clear = ROADSIDE.overpassClear, span = 2 * (C + 8);
    this.solid(m, new THREE.BoxGeometry(span, 1.4, 10).translate(0, clear + 0.7, 0), d, 0, 0);
    this.solid(top, new THREE.BoxGeometry(span, 0.04, 9).translate(0, clear + 1.42, 0), d, 0, 0);
    for (const s of [-1, 1]) {
      this.solid(m, new THREE.BoxGeometry(span, 1, 0.3).translate(0, clear + 1.9, s * 4.85), d, 0, 0);
      this.solid(m, new THREE.BoxGeometry(1.2, clear, 7).translate(0, clear / 2, 0), d, s * (GUARDRAIL_X + 1.8), 0);
      this.solid(m, new THREE.BoxGeometry(5, clear + 2.4, 11).translate(0, (clear + 1.4) / 2 - 0.5, 0), d, s * (C + 6), 0);
    }
  }
}
