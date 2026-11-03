// The endless motorway. The car never moves forward: textures and roadside objects scroll toward it.
import * as THREE from 'three';
import { CARRIAGEWAY_HALF, GUARDRAIL_X, LANE_WIDTH, LANES } from '../core/config.ts';
import { THEMES, type Theme } from '../data/themes.ts';
import { themeIndexAt, toNextBorder } from '../rules/themes.ts';
import type { Surface, World } from './assets.ts';

export const WRAP_Z = 30; // behind the camera: things that pass it wrap to the far end
const LOOP = 240; // lane dashes and rail posts repeat every LOOP meters
const ROAD_W = GUARDRAIL_X * 2 + 1;
const ROAD_LEN = 800;
const ASPHALT_TILE = 6, GROUND_TILE = 12, GROUND_SIZE = 4000;

type Item = { p: THREE.Vector3; s: THREE.Vector3; r: number };
/** Many copies of one mesh that scroll and wrap, drawn in a single call. */
class Strip {
  readonly mesh: THREE.InstancedMesh;
  private items: Item[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[]) {
    this.items = items;
    this.mesh = new THREE.InstancedMesh(geo, mat, items.length);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // instances span the whole strip
    this.update(0);
  }

  update(dz: number) {
    this.items.forEach((it, i) => {
      it.p.z += dz;
      if (it.p.z > WRAP_Z) it.p.z -= LOOP;
      this.mesh.setMatrixAt(i, this.m.compose(it.p, this.q, it.s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const GANTRY_EVERY = 700;

/** A motorway sign panel whose face is drawn on a canvas. */
function signPanel(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * h) / w);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // emissive = its own face, faint by day; at night it glows like retroreflective sheeting
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.6 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const draw = (big: string, small: string) => {
    const g = canvas.getContext('2d')!, W = canvas.width, H = canvas.height;
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

const range = (from: number, to: number, step: number) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Gives a surface its own copy of the textures, tiled every `tile` meters over a w x h plane. */
function tiled(s: Surface, w: number, h: number, tile: number) {
  const copy = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(w / tile, h / tile);
    c.needsUpdate = true;
    return c;
  };
  return { map: copy(s.map), normalMap: copy(s.normalMap), roughnessMap: copy(s.roughnessMap) };
}

/**
 * Ground that shows the current theme up to a border line and the next theme beyond it, with a soft
 * 80 m blend. The border moves toward the player as they drive, so a new landscape rolls in.
 */
function blendedGround(world: World) {
  const grounds = Object.fromEntries(Object.entries(world.surfaces).map(([id, s]) => [id, tiled(s, GROUND_SIZE, GROUND_SIZE, GROUND_TILE).map]));
  const border = { value: -10000 }, next = { value: Object.values(grounds)[0] };
  const tintA = { value: new THREE.Color() }, tintB = { value: new THREE.Color() };
  // pushed back in depth so the road, 1 cm above it, always wins (no grass flickering through the asphalt)
  const mat = new THREE.MeshStandardMaterial({ map: next.value, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.nextMap = next;
    shader.uniforms.border = border;
    shader.uniforms.tintA = tintA;
    shader.uniforms.tintB = tintB;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldZ = (modelMatrix * vec4(transformed, 1.0)).z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D nextMap;\nuniform float border;\nuniform vec3 tintA, tintB;\nvarying float vWorldZ;')
      .replace(
        '#include <map_fragment>',
        `float beyond = smoothstep(border + 40.0, border - 40.0, vWorldZ); // ahead of the border = next theme
         diffuseColor.rgb *= mix(texture2D(map, vMapUv).rgb * tintA, texture2D(nextMap, vMapUv).rgb * tintB, beyond);`,
      );
  };
  return { mat, grounds, border, next, tintA, tintB };
}

export class Road {
  private asphalt: ReturnType<typeof tiled>;
  private ground: ReturnType<typeof blendedGround>;
  private strips: Strip[] = [];
  private gantries: ReturnType<typeof gantry>[] = [];

  constructor(scene: THREE.Scene, world: World) {
    const flat = (w: number, len: number, mat: THREE.Material, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, WRAP_Z - len / 2);
      m.receiveShadow = true;
      scene.add(m);
    };
    this.ground = blendedGround(world);
    flat(GROUND_SIZE, GROUND_SIZE, this.ground.mat, 0, 0);
    this.asphalt = tiled(world.surfaces.asphalt_02, ROAD_W, ROAD_LEN, ASPHALT_TILE);
    flat(ROAD_W, ROAD_LEN, new THREE.MeshStandardMaterial({ ...this.asphalt, color: 0x9a9a9a }), 0, 0.01);

    const paintMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) flat(0.2, ROAD_LEN, paintMat, s * (CARRIAGEWAY_HALF + 0.1), 0.02);

    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.35 });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, ROAD_LEN), metal);
      rail.position.set(s * GUARDRAIL_X, 0.62, WRAP_Z - ROAD_LEN / 2);
      rail.castShadow = rail.receiveShadow = true;
      scene.add(rail);
    }

    const start = WRAP_Z - LOOP;
    // dashed lane lines: 3 m paint, 9 m gap (12 m period)
    const dividers = LANES.slice(1).map((x) => x - LANE_WIDTH / 2);
    const dash = new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2);
    this.add(scene, new Strip(dash, paintMat, dividers.flatMap((x) => range(start, WRAP_Z, 12).map((z) => ({ p: v3(x, 0.02, z), s: v3(1, 1, 1), r: 0 })))));
    const post = new THREE.BoxGeometry(0.12, 0.7, 0.12);
    this.add(scene, new Strip(post, metal, [-1, 1].flatMap((s) => range(start, WRAP_Z, 4).map((z) => ({ p: v3(s * (GUARDRAIL_X + 0.1), 0.35, z), s: v3(1, 1, 1), r: 0 })))));

    // sign gantries: a strong cue for speed, and they tell you what's coming
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d9299, metalness: 0.7, roughness: 0.45 });
    for (const z of [-250, -250 - GANTRY_EVERY / 2]) {
      const g = gantry(steel);
      g.group.position.z = z;
      scene.add(g.group);
      this.gantries.push(g);
    }
  }

  private add(scene: THREE.Scene, s: Strip) {
    scene.add(s.mesh);
    this.strips.push(s);
  }

  /** Ground: theme `current` up to `borderZ` (world z of the next theme border), `next` beyond it. */
  setGround(current: Theme, next: Theme, borderZ: number) {
    const g = this.ground;
    g.mat.map = g.grounds[current.ground];
    g.next.value = g.grounds[next.ground];
    g.tintA.value.set(current.groundTint);
    g.tintB.value.set(next.groundTint);
    g.border.value = borderZ;
  }

  /** Rewrites every sign for a run starting at road distance `dist`. */
  reset(dist: number) {
    for (const g of this.gantries) this.label(g, dist - g.group.position.z);
  }

  /** 0 = day, 1 = night. */
  setNight(n: number) {
    for (const g of this.gantries) for (const m of g.mats) m.emissiveIntensity = 0.08 + n * 0.55;
  }

  update(dz: number, dist: number) {
    for (const t of Object.values(this.asphalt)) t.offset.y += dz / ASPHALT_TILE;
    for (const t of Object.values(this.ground.grounds)) t.offset.y += dz / GROUND_TILE;
    for (const s of this.strips) s.update(dz);
    for (const g of this.gantries) {
      g.group.position.z += dz;
      if (g.group.position.z > WRAP_Z) {
        g.group.position.z -= GANTRY_EVERY;
        this.label(g, dist - g.group.position.z);
      }
    }
  }

  /** Sign at road distance `d`: name of the next area and how far it is from the sign. */
  private label(g: ReturnType<typeof gantry>, d: number) {
    const next = THEMES[(themeIndexAt(d, THEMES.length) + 1) % THEMES.length];
    g.next.draw(next.name.toUpperCase(), `↑ ${(toNextBorder(d) / 1000).toFixed(1)} km`);
  }
}
