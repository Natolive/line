// The land around the road (heights from rules/terrain.ts), in 80 m pieces kept built well past the fog
// ahead and behind: hills, mountains with snow on top, rock on steep slopes, lakes and rivers.
import * as THREE from 'three';
import { ROADSIDE } from '../core/config.ts';
import { THEMES, ZONE_LENGTH, type Theme } from '../data/themes.ts';
import { floorHeight, smooth, terrainHeight, waterLevel } from '../rules/terrain.ts';
import { themeIndexAt } from '../rules/themes.ts';
import { overpassesIn, rowsIn, structuresIn } from '../rules/track.ts';
import { Mesher } from './mesher.ts';
import { PieceFrame, Ring, type TrackView } from './track.ts';

const LEN = 80, ROW = 4, TILE = 12, PERIOD = 1200; // m; texture v restarts every PERIOD m (a whole number of tiles and pieces)
const C = ROADSIDE.corridor;
// columns from the corridor out to past the fog, denser near the road
const XS = [C, 20, 25, 31, 38, 47, 58, 72, 90, 112, 140, 175, 220, 275, 345, 430, 540, 680, 850, 1060, 1320, 1650];
const BEHIND = 520, AHEAD = 1700;

/** Texture v at road position `d` for a piece starting at `d0` (continuous from piece to piece). */
export const texV = (d0: number, d: number) => (((d0 % PERIOD) + PERIOD) % PERIOD) + d - d0;

/**
 * Which two themes a piece starting at `d0` blends between, and how far each point has gone into the second
 * (an 80 m crossfade centred on the zone border).
 */
export function themePair(d0: number) {
  const z = Math.floor((d0 - 40) / ZONE_LENGTH), border = (z + 1) * ZONE_LENGTH;
  const a = THEMES[themeIndexAt(z * ZONE_LENGTH, THEMES.length)], b = THEMES[themeIndexAt(border, THEMES.length)];
  return { a, b, blend: (d: number) => smooth(border - 40, border + 40, d) };
}

const SNOW = 0xf4f8ff, STRIPE = 16; // m: land is mowed in bands, half of them a shade darker
const materials = new Map<string, THREE.MeshStandardMaterial>();
/** Land material between themes `a` and `b`: flat colours, faceted, rock where it is steep, snow above the snow line. */
export function landMaterial(a: Theme, b: Theme) {
  const key = `${a.id}>${b.id}`;
  let m = materials.get(key);
  if (m) return m;
  const color = (hex: number) => ({ value: new THREE.Color(hex) });
  const u = {
    groundA: color(a.ground), groundB: color(b.ground), rockA: color(a.rock), rockB: color(b.rock), snowColor: color(SNOW),
    snowA: { value: a.snowLine }, snowB: { value: b.snowLine },
  };
  // pushed back in depth so the road and verges laid over it always win
  m = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float blend;\nvarying float vBlend, vUp, vH, vD;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBlend = blend; vUp = normal.y; vH = position.y; vD = uv.y * ${TILE.toFixed(1)};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 groundA, groundB, rockA, rockB, snowColor;
        uniform float snowA, snowB;
        varying float vBlend, vUp, vH, vD;`)
      .replace('#include <map_fragment>', `
        float steep = step(vUp, 0.78); // rock on slopes steeper than ~38°
        vec3 col = mix(mix(groundA, groundB, vBlend), mix(rockA, rockB, vBlend), steep);
        col *= 1.0 - 0.07 * step(0.5, fract(vD / ${(STRIPE * 2).toFixed(1)}));
        float line = mix(snowA, snowB, vBlend);
        col = mix(col, snowColor, step(line, vH) * step(0.6, vUp));
        diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'land';
  materials.set(key, m);
  return m;
}

/** Gently rippling water: a procedural normal map, scrolled over time. */
function ripples() {
  const n = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d')!, img = g.createImageData(n, n);
  const waves = Array.from({ length: 10 }, (_, i) => ({ kx: Math.round(Math.cos(i * 2.4) * (2 + i)), ky: Math.round(Math.sin(i * 2.4) * (2 + i)), a: 0.5 / (1 + i * 0.4), p: i * 1.7 }));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const c = Math.cos(((w.kx * x + w.ky * y) / n) * 2 * Math.PI + w.p) * w.a;
        dx += c * w.kx * 0.05;
        dy += c * w.ky * 0.05;
      }
      const i = (y * n + x) * 4;
      img.data.set([128 + dx * 127, 128 + dy * 127, 255, 255], i);
    }
  }
  g.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(canvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  return normalMap;
}

const waters = new Map<string, THREE.MeshStandardMaterial>();
/** Each world's water: its own colour, glowing for lava and toxic pools. */
function waterMaterial(t: Theme, normalMap: THREE.Texture) {
  let m = waters.get(t.id);
  if (!m) {
    const { color, glow } = t.water;
    m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.1, metalness: 0.1, normalMap, normalScale: new THREE.Vector2(0.35, 0.35) });
    waters.set(t.id, m);
  }
  return m;
}

type Piece = { group: THREE.Group; geos: THREE.BufferGeometry[] };

export class Terrain {
  private ring: Ring<Piece>;
  private ripples = ripples();
  private asphalt: THREE.Material;

  constructor(track: TrackView, asphalt: THREE.Material) {
    this.asphalt = asphalt;
    this.ring = new Ring<Piece>(LEN, BEHIND, AHEAD, (d0) => {
      const p = this.build(d0);
      track.place(p.group, d0, 0);
      track.root.add(p.group);
      return p;
    }, (p) => {
      track.root.remove(p.group);
      for (const g of p.geos) g.dispose();
    });
  }

  /** Drops every piece, to be built again (a new map). */
  clear() {
    this.ring.clear();
  }

  update(d: number, dt = 0) {
    this.ring.update(d);
    this.ripples.offset.x += dt * 0.004;
    this.ripples.offset.y += dt * 0.006;
  }

  private build(d0: number): Piece {
    const pf = new PieceFrame(d0), d1 = d0 + LEN, ds = rowsIn(d0, d1, ROW);
    const { a, b, blend } = themePair(d0), group = new THREE.Group(), geos: THREE.BufferGeometry[] = [];
    const add = (m: Mesher, mat: THREE.Material, shadow = true) => {
      if (m.empty) return;
      const g = m.geometry(), mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = shadow;
      group.add(mesh);
      geos.push(g);
    };

    const land = new Mesher(pf), e = 1.5;
    for (const side of [-1, 1]) {
      const xs = side < 0 ? XS.map((x) => -x).reverse() : XS;
      for (const d of ds) {
        for (const x of xs) {
          land.vertex(d, x, terrainHeight(d, x), x / TILE, texV(d0, d) / TILE, blend(d));
          const hx = (terrainHeight(d, x + e) - terrainHeight(d, x - e)) / (2 * e), hd = (terrainHeight(d + e, x) - terrainHeight(d - e, x)) / (2 * e);
          land.normal(-hx, 1, -hd, d);
        }
      }
      land.grid(ds.length, xs.length);
    }
    const near = structuresIn(d0 - 300, d1 + 300);
    // under bridges you can see the ground beneath the road
    if (near.some((s) => s.kind !== 'tunnel')) {
      for (const d of ds) {
        for (const x of [-C - 0.5, 0, C + 0.5]) {
          land.vertex(d, x, floorHeight(d), x / TILE, texV(d0, d) / TILE, blend(d));
          land.normal(0, 1, 0, d);
        }
      }
      land.grid(ds.length, 3);
    }
    add(land, landMaterial(a, b));

    const water = new Mesher(pf), wet = near.find((s) => s.water);
    if (wet) {
      const y = waterLevel(wet), xs = [-1650, -600, -200, -C, 0, C, 200, 600, 1650];
      for (const d of [d0, d0 + LEN / 2, d1]) for (const x of xs) water.vertex(d, x, y, x / 40, texV(d0, d) / 40);
      water.grid(3, xs.length);
    }
    add(water, waterMaterial(a, this.ripples));

    // the local roads that cross on overpasses run on along their embankments
    const lane = new Mesher(pf);
    for (const o of overpassesIn(d0, d1)) {
      for (const side of [-1, 1]) {
        const xs: number[] = [];
        for (let x = C + 8; x <= 420; x += 10) xs.push(side * x);
        for (const x of xs) for (const dd of side > 0 ? [4.5, -4.5] : [-4.5, 4.5]) lane.vertex(o + dd, x, terrainHeight(o, x) + 0.08, dd / 6, x / 6);
        lane.grid(xs.length, 2);
      }
    }
    add(lane, this.asphalt);
    return { group, geos };
  }
}
