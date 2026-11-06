// Every vehicle, built from scratch as an arcade toy: a rounded body, a glass cabin with a painted roof, spoked
// wheels, lamps, bumpers, grille, plates, mirrors, door seams. No model files. prefab.ts then fits them like any model (size, wheels, lights).
import * as THREE from 'three';
import { merge } from '../arcade.ts';
import { prefab, type Prefab } from './prefab.ts';

export type Fleet = { players: Record<string, Prefab>; cars: Prefab[]; heavy: Prefab[]; police: Prefab; convoy: Prefab; moto: Prefab };

// Flashing lights of the police car, the wide load and its escorts: shared, so they all flash together (setBeacons).
const beacon = (color: number) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.3 });
export const BEACON = { red: beacon(0xff2030), blue: beacon(0x2a6bff), amber: beacon(0xffa01a) };

/** Flashes every beacon at time `t` (s): police red and blue in turn, amber warning lights pulsing. */
export function setBeacons(t: number) {
  const fast = Math.floor(t * 6) % 2 === 0;
  BEACON.red.emissiveIntensity = fast ? 2 : 0.1;
  BEACON.blue.emissiveIntensity = fast ? 0.1 : 2;
  BEACON.amber.emissiveIntensity = Math.floor(t * 2.5) % 2 ? 2 : 0.15;
}

type Design = {
  length: number; width: number; height: number; // m, overall
  color: number;
  belt: number; // share of the height where the windows start
  nose: number; tail: number; // m: how far the bonnet and the boot slope down at each end
  cabin: [number, number, number, number]; // shares of the length (0 front, 1 rear): windscreen foot, roof front, roof rear, rear window foot
  wheel: number; // m, tyre radius
  stripe?: number; // racing stripes over the bonnet and roof
  wing?: boolean; // rear wing (and twin exhausts)
  intake?: boolean; // air intakes in the flanks, behind the doors (mid-engined)
  scoop?: boolean; // air scoop on the bonnet
  rack?: boolean; // roof bars
  bed?: boolean; // open load bed behind the cabin (pickup)
};

const mats = new Map<number, THREE.MeshStandardMaterial>();
/** One shared plastic-toy material per colour. */
const paint = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => {
  const key = color + (o.emissive ? 0.5 : 0);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, ...o }));
  return mats.get(key)!;
};
const GLASS = new THREE.MeshStandardMaterial({ color: 0x1b2440, roughness: 0.1, metalness: 0.5 });
const MIRROR = new THREE.MeshStandardMaterial({ color: 0xc8e4ff, roughness: 0.05, metalness: 0.9 }); // door mirror glass: reflects the sky
const TYRE = 0x1c1c22, HUB = 0x3a3b44, RIM = 0xdadbe6, DARK = 0x24252c, CHROME = 0xc9ccd6, PLATE = 0xf4f4ee;

/** A side profile (z, y points, front first) extruded `width` across, rounded at the edges. */
function slab(points: [number, number][], width: number, mat: THREE.Material, round = 0.08) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * round, bevelEnabled: true, bevelSize: round, bevelThickness: round, bevelSegments: 2 });
  g.rotateY(-Math.PI / 2).translate(width / 2 - round, 0, 0); // profile's x → z, extruded across x
  return new THREE.Mesh(g, mat);
}

function box(w: number, h: number, l: number, mat: THREE.Material | number, x: number, y: number, z: number, name = '') {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), typeof mat === 'number' ? paint(mat) : mat);
  m.position.set(x, y, z);
  m.name = name;
  return m;
}

/** A cylinder of radius `r` and length `l` lying along `axis`, at (x, y, z). */
function tube(r: number, l: number, color: number, axis: 'x' | 'z', x: number, y: number, z: number) {
  const g = new THREE.CylinderGeometry(r, r, l, 14);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, paint(color));
  m.position.set(x, y, z);
  return m;
}

/** A wheel: tyre, dark rim, five spokes and a hub cap, named so prefab.ts finds it. */
function wheel(r: number, width: number, x: number, z: number) {
  const g = new THREE.Group();
  g.add(tube(r, width, TYRE, 'x', 0, 0, 0), tube(r * 0.64, width + 0.02, HUB, 'x', 0, 0, 0), tube(r * 0.18, width + 0.07, RIM, 'x', 0, 0, 0));
  for (let k = 0; k < 5; k++) {
    const spoke = box(width + 0.04, r * 1.15, 0.07, RIM, 0, 0, 0);
    spoke.rotation.x = (k * Math.PI * 2) / 5;
    g.add(spoke);
  }
  g.position.set(x, r, z);
  g.name = 'wheel';
  return g;
}

/** Tail lamps (named so lights.ts uses them as brake lights) and headlamps, `out` m proud of the end faces (past the body's rounded edge), at height `y`. */
function lamps(parts: THREE.Object3D[], w: number, l: number, y: number, bar = false, out = 0.14) {
  const red = paint(0xff2a2a), white = paint(0xfff4d0, { emissive: 0xfff0c0, emissiveIntensity: 0.6 });
  if (bar) parts.push(box(w - 0.3, 0.1, 0.05, red, 0, y, l / 2 + out, 'taillight'));
  else for (const s of [-1, 1]) parts.push(box(0.4, 0.13, 0.05, red, s * (w / 2 - 0.32), y, l / 2 + out, 'taillight'));
  for (const s of [-1, 1]) {
    parts.push(box(0.38, 0.12, 0.05, white, s * (w / 2 - 0.32), y, -l / 2 - out));
    parts.push(box(0.4, 0.035, 0.05, DARK, s * (w / 2 - 0.32), y + 0.08, -l / 2 - out)); // brow over the lamp
  }
}

/** What every car and van has: bumpers, grille, number plates and door mirrors. */
function trim(parts: THREE.Object3D[], W: number, L: number, low: number, grille: number, mirror: [y: number, z: number], body: THREE.Material) {
  for (const s of [-1, 1]) {
    parts.push(box(W - 0.06, 0.2, 0.14, DARK, 0, low + 0.1, s * (L / 2 + 0.06))); // bumper
    parts.push(box(0.52, 0.12, 0.03, PLATE, 0, low + 0.1, s * (L / 2 + 0.14))); // plate
    // door mirror: a housing in the body colour on a short arm off the door, its glass facing the cars behind
    const mx = s * (W / 2 + 0.16), my = mirror[0] + 0.12, mz = mirror[1];
    parts.push(box(0.16, 0.04, 0.06, DARK, s * (W / 2 + 0.05), my - 0.04, mz + 0.02)); // arm
    parts.push(box(0.22, 0.14, 0.1, body, mx, my, mz)); // housing
    parts.push(box(0.03, 0.14, 0.1, DARK, mx + s * 0.11, my, mz)); // its rim, outboard
    parts.push(box(0.18, 0.1, 0.02, MIRROR, mx, my, mz + 0.055)); // the glass
  }
  parts.push(box(W * 0.45, 0.16, 0.05, DARK, 0, grille, -L / 2 - 0.11));
  for (let k = -1; k <= 1; k++) parts.push(box(W * 0.45, 0.02, 0.06, CHROME, 0, grille + k * 0.05, -L / 2 - 0.11));
}

/** A car facing -z, standing on y = 0. Returns its top-level parts (body pieces and wheels). */
function car(d: Design) {
  const { length: L, width: W, height: H, wheel: r } = d, z = (share: number) => -L / 2 + share * L, half = W / 2;
  const bottom = r * 0.55, belt = H * d.belt, body = paint(d.color), parts: THREE.Object3D[] = [];
  const [c0, c1, c2, c3] = d.cabin, roofMid = (z(c1) + z(c2)) / 2, base = L * 0.31, tw = 0.3;
  parts.push(slab([[-L / 2, bottom], [-L / 2, belt * 0.8], [-L / 2 + d.nose, belt], [L / 2 - d.tail, belt], [L / 2, belt * 0.88], [L / 2, bottom]], W, body, 0.1));
  parts.push(slab([[z(c0), belt], [z(c1), H - 0.06], [z(c2), H - 0.06], [z(c3), belt]], W * 0.84, GLASS, 0.05));
  parts.push(box(W * 0.84 - 0.04, 0.06, z(c2) - z(c1) + 0.08, body, 0, H - 0.05, roofMid)); // roof
  parts.push(box(W * 0.84 + 0.01, H - belt - 0.1, 0.12, body, 0, (belt + H) / 2 - 0.04, roofMid)); // pillars between the side windows
  trim(parts, W, L, bottom, belt * 0.62, [belt, z(c0) + 0.25], body);

  // doors: seams and handles; sills; dark flares over the wheels
  for (const s of [-1, 1]) {
    for (const zz of [z(c0) + 0.12, roofMid + 0.06]) parts.push(box(0.015, belt - bottom - 0.12, 0.025, DARK, s * (half + 0.004), (belt + bottom) / 2, zz));
    parts.push(box(0.025, 0.04, 0.18, DARK, s * (half + 0.01), belt - 0.1, roofMid - 0.2));
    parts.push(box(0.08, 0.12, 2 * base - 2 * r - 0.2, DARK, s * (half + 0.01), bottom + 0.02, 0));
    for (const zz of [-base, base]) parts.push(box(0.1, 0.09, 2 * r + 0.25, DARK, s * (half + 0.02), 2 * r + 0.04, zz));
    if (d.intake) parts.push(box(0.04, 0.22, 0.55, DARK, s * (half + 0.005), belt * 0.62, (z(c2) + z(c3)) / 2));
  }
  for (const s of d.wing ? [-1, 1] : [-1]) parts.push(tube(0.055, 0.24, CHROME, 'z', s * (half - 0.42), bottom + 0.1, L / 2 + 0.12));

  if (d.stripe !== undefined) {
    for (const s of [-1, 1]) {
      parts.push(box(0.16, 0.02, z(c0) + L / 2 - 0.1, d.stripe, s * 0.14, belt + 0.1, (-L / 2 + z(c0)) / 2 + 0.05));
      parts.push(box(0.16, 0.02, z(c2) - z(c1), d.stripe, s * 0.14, H + 0.005, roofMid));
    }
  }
  if (d.scoop) parts.push(box(0.55, 0.1, 0.7, DARK, 0, belt + 0.14, z(c0) - 0.55));
  if (d.wing) {
    const zw = L / 2 - 0.3;
    parts.push(box(W * 0.9, 0.05, 0.38, DARK, 0, belt + 0.32, zw));
    for (const s of [-1, 1]) {
      parts.push(box(0.06, 0.3, 0.2, DARK, s * W * 0.3, belt + 0.15, zw));
      parts.push(box(0.03, 0.2, 0.44, DARK, s * W * 0.45, belt + 0.3, zw)); // end plates
    }
  }
  if (d.rack) {
    for (const zz of [z(c1) + 0.2, z(c2) - 0.2]) parts.push(box(W * 0.9, 0.05, 0.06, DARK, 0, H + 0.12, zz));
    for (const s of [-1, 1]) parts.push(box(0.05, 0.06, z(c2) - z(c1), DARK, s * W * 0.38, H + 0.06, roofMid));
  }
  if (d.bed) parts.push(box(W - 0.3, 0.04, L / 2 - z(c3) - 0.3, DARK, 0, belt + 0.11, (z(c3) + L / 2) / 2));
  lamps(parts, W, L, belt * 0.8);
  for (const zz of [-base, base]) for (const s of [-1, 1]) parts.push(wheel(r, tw, s * (half - tw / 2 + 0.05), zz));
  return parts;
}

/** A box van: one tall body, a sloped windscreen, windows down the sides, a sliding door. */
function van(color: number) {
  const L = 4.9, W = 2, H = 2.45, r = 0.36, body = paint(color), parts: THREE.Object3D[] = [];
  parts.push(slab([[-L / 2, r * 0.6], [-L / 2, 1.1], [-L / 2 + 0.9, H], [L / 2, H], [L / 2, r * 0.6]], W, body, 0.12));
  parts.push(slab([[-L / 2 + 0.25, 1.2], [-L / 2 + 0.88, H - 0.15], [-L / 2 + 1.5, H - 0.15], [-L / 2 + 1.5, 1.2]], W + 0.02, GLASS, 0.03));
  for (const s of [-1, 1]) {
    parts.push(box(0.02, 0.5, 1.7, GLASS, s * (W / 2 + 0.01), 1.85, 0.6));
    parts.push(box(0.03, 0.08, 4, 0x2a6bff, s * (W / 2 + 0.01), 1.3, 0.3)); // a company stripe
    for (const zz of [-0.85, 0.35]) parts.push(box(0.015, 1.4, 0.025, DARK, s * (W / 2 + 0.004), 1.05, zz));
    parts.push(box(0.04, 0.05, 2.6, DARK, s * (W / 2 + 0.02), 2.0, 0.6)); // sliding door rail
  }
  parts.push(box(0.015, 1.7, 0.025, DARK, 0, 1.25, L / 2 + 0.12)); // rear doors
  trim(parts, W, L, r * 0.6, 0.85, [1.25, -L / 2 + 0.6], body);
  lamps(parts, W, L, 0.9);
  for (const z of [-1.55, 1.55]) for (const s of [-1, 1]) parts.push(wheel(r, 0.3, s * (W / 2 - 0.12), z));
  return parts;
}

/** An articulated lorry: cab with deflector and exhaust stacks, fuel tanks, a striped trailer, three axles. */
function truck(cab: number, trailer: number) {
  const W = 2.5, r = 0.52, parts: THREE.Object3D[] = [];
  parts.push(box(W, 2.6, 2.3, cab, 0, 1.3 + r * 0.8, -4.65)); // cab, front at z = -5.8
  parts.push(box(W - 0.2, 0.7, 1.3, cab, 0, 3.4, -4.25)); // roof deflector
  parts.push(box(W - 0.1, 0.9, 0.06, GLASS, 0, 2.9, -5.81));
  parts.push(box(1.6, 0.8, 0.05, CHROME, 0, 1.55, -5.82)); // grille
  parts.push(box(W, 0.35, 0.25, DARK, 0, 0.72, -5.85)); // bumper
  parts.push(box(1, 0.3, 10.4, DARK, 0, 0.75, -0.2)); // chassis
  parts.push(box(W, 3, 9, trailer, 0, 1.5 + r * 1.3, 1.3)); // trailer, back at z = 5.8
  parts.push(box(W, 0.12, 0.05, 0xffd21a, 0, 1.2, 5.82));
  parts.push(box(0.015, 2.8, 0.025, DARK, 0, 3.6, 5.81)); // trailer doors
  for (const s of [-1, 1]) {
    parts.push(box(0.02, 0.8, 1, GLASS, s * (W / 2 + 0.01), 2.9, -5.05));
    parts.push(box(0.08, 0.45, 0.15, DARK, s * (W / 2 + 0.25), 2.8, -5.5)); // mirror
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 12), paint(CHROME));
    stack.position.set(s * 1.05, 3.4, -3.45);
    parts.push(stack); // exhaust stack
    parts.push(tube(0.32, 1.1, CHROME, 'z', s * 0.95, 0.8, -2.8)); // fuel tank
    parts.push(box(0.02, 0.25, 8.6, 0xff3a3a, s * (W / 2 + 0.01), 2.1, 1.3), box(0.02, 0.12, 8.6, 0x2a6bff, s * (W / 2 + 0.01), 1.85, 1.3));
    parts.push(box(0.5, 0.5, 0.03, DARK, s * (W / 2 - 0.25), 0.55, 5.5)); // mud flap
  }
  lamps(parts, W, 11.6, 1.1, true, 0.04);
  for (const z of [-4.6, 3.6, 4.9]) for (const s of [-1, 1]) parts.push(wheel(r, 0.4, s * (W / 2 - 0.2), z));
  return parts;
}

/** A board `w`×`h` m with `text` on it (black on yellow, as on wide loads), facing +z. */
function board(text: string, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd21a';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111';
  g.font = `${Math.round(c.height * 0.6)}px Bungee, "Chakra Petch", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height * 0.55);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.6 }));
}

/** Police car: a white saloon with blue bands and a red-and-blue light bar. */
function police() {
  const d: Design = { length: 4.9, width: 1.86, height: 1.48, color: 0xf4f4f8, belt: 0.55, nose: 0.5, tail: 0.35, cabin: [0.3, 0.42, 0.7, 0.82], wheel: 0.33 };
  const parts = car(d), H = d.height, belt = H * d.belt, roofZ = -d.length / 2 + ((d.cabin[1] + d.cabin[2]) / 2) * d.length;
  for (const s of [-1, 1]) parts.push(box(0.02, 0.22, d.length * 0.8, 0x1f4fff, s * (d.width / 2 + 0.01), belt * 0.62, 0));
  parts.push(box(1.2, 0.1, 0.3, DARK, 0, H + 0.03, roofZ));
  parts.push(box(0.55, 0.13, 0.28, BEACON.red, -0.31, H + 0.14, roofZ), box(0.55, 0.13, 0.28, BEACON.blue, 0.31, H + 0.14, roofZ));
  return parts;
}

/** Wide load: a yellow tractor pulling a low loader with a boat across two lanes, amber lights, WIDE LOAD boards. */
function convoy() {
  const W = 4.6, r = 0.5, parts: THREE.Object3D[] = [];
  parts.push(box(2.5, 2.5, 2.6, 0xffc21a, 0, 1.25 + r * 0.8, -9.2), box(2.4, 0.9, 0.06, GLASS, 0, 2.6, -10.51)); // tractor, front at z = -10.5
  parts.push(box(2.4, 0.3, 0.25, DARK, 0, 0.7, -10.55), box(1.4, 0.7, 0.05, CHROME, 0, 1.4, -10.52));
  for (const s of [-1, 1]) parts.push(box(0.3, 0.2, 0.3, BEACON.amber, s * 0.8, 3.4, -9.4));
  parts.push(box(3, 0.4, 18, DARK, 0, 0.9, 1.4)); // low loader
  // the load: a boat hull, wider than the trailer
  parts.push(slab([[-8, 1.1], [-6.5, 3.4], [8, 3.4], [8, 1.1]], W, paint(0xf4f4f8), 0.2));
  parts.push(box(W + 0.02, 0.35, 15.8, 0x2a6bff, 0, 2.3, 0.2), box(2.6, 1.6, 4.5, 0xf4f4f8, 0, 4.2, 2.5), box(2.62, 0.5, 4.52, GLASS, 0, 4.4, 2.5));
  for (const s of [-1, 1]) {
    for (const z of [-7.5, 8.3]) parts.push(box(0.3, 0.3, 0.3, BEACON.amber, s * (W / 2 - 0.15), 3.7, z));
    parts.push(box(0.08, 0.45, 0.15, DARK, s * 1.5, 2.6, -10.2));
  }
  const front = board('WIDE LOAD', 2.2, 0.5), back = board('WIDE LOAD', 3.4, 0.7);
  front.position.set(0, 3.1, -10.56);
  front.rotation.y = Math.PI; // read by the cars ahead, in their mirrors
  back.position.set(0, 1.6, 10.45); // the low loader runs from z = -7.6 to 10.4
  parts.push(front, back);
  lamps(parts, 3, 20.8, 1.1, true, 0.04);
  for (const s of [-1, 1]) parts.push(wheel(r, 0.4, s * 1.05, -9.4));
  for (const z of [7, 8.3, 9.6]) for (const s of [-1, 1]) parts.push(wheel(r, 0.5, s * (W / 2 - 0.3), z));
  return parts;
}

/** Escort motorbike: rider in white, a blue light on a pole behind the seat. */
function moto() {
  const r = 0.32, parts: THREE.Object3D[] = [];
  parts.push(box(0.3, 0.35, 1.3, 0xf4f4f8, 0, 0.62, 0), box(0.4, 0.25, 0.5, 0x1f4fff, 0, 0.85, -0.25)); // frame, tank
  parts.push(box(0.75, 0.05, 0.05, DARK, 0, 1.05, -0.55), box(0.35, 0.35, 0.05, GLASS, 0, 1.2, -0.62)); // bars, screen
  parts.push(box(0.42, 0.6, 0.3, 0xf4f4f8, 0, 1.25, 0.15), box(0.36, 0.45, 0.2, 0x1f4fff, 0, 0.85, 0.3)); // rider: jacket, trousers
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), paint(0xf4f4f8));
  helmet.position.set(0, 1.72, 0.12);
  parts.push(helmet, box(0.03, 0.5, 0.03, DARK, 0, 1.2, 0.6), box(0.14, 0.12, 0.14, BEACON.blue, 0, 1.5, 0.6));
  parts.push(box(0.22, 0.1, 0.05, 0xff2a2a, 0, 0.75, 0.68, 'taillight'));
  for (const z of [-0.72, 0.72]) parts.push(wheel(r, 0.14, 0, z));
  return parts;
}

/**
 * Fits a built vehicle like any model (prefab measures, centres and lights it), with its parts merged first:
 * one mesh per colour for the body, and per wheel; tail lamps stay apart, each switches on its own.
 */
function fit(parts: THREE.Object3D[], length?: number) {
  const wheels = parts.filter((p) => p.name === 'wheel'), tails = parts.filter((p) => p.name === 'taillight');
  const rest = new THREE.Group();
  rest.add(...parts.filter((p) => !wheels.includes(p) && !tails.includes(p)));
  for (const w of wheels) {
    const merged = merge(w);
    w.clear();
    w.add(...merged);
  }
  const all = [...merge(rest), ...tails, ...wheels], scene = new THREE.Group();
  scene.add(...all);
  scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  return prefab({ parts: all, isWheel: (o) => o.name === 'wheel', forward: [0, -1], length: length ?? size.z });
}

// The garage cars, in their makers' real dimensions (m), drawn as toys. Keys match `model` in src/data/cars/.
const PLAYERS: Record<string, Design> = {
  'car-bmw': { length: 4.8, width: 1.89, height: 1.39, color: 0x1fb6d6, belt: 0.55, nose: 0.6, tail: 0.3, cabin: [0.32, 0.45, 0.72, 0.85], wheel: 0.34, stripe: 0xff3a3a, wing: true },
  'car-porsche': { length: 4.57, width: 1.85, height: 1.28, color: 0xf2f2ee, belt: 0.52, nose: 0.8, tail: 0.5, cabin: [0.3, 0.42, 0.62, 0.92], wheel: 0.34, stripe: 0x2a6bff, wing: true },
  'car-gtr': { length: 4.71, width: 1.9, height: 1.37, color: 0xffc21a, belt: 0.55, nose: 0.6, tail: 0.25, cabin: [0.3, 0.44, 0.68, 0.84], wheel: 0.35, wing: true },
  'car-mustang': { length: 4.82, width: 1.92, height: 1.38, color: 0x1f4fff, belt: 0.58, nose: 0.4, tail: 0.3, cabin: [0.4, 0.52, 0.7, 0.88], wheel: 0.35, stripe: 0xffffff, scoop: true },
  'car-f40': { length: 4.36, width: 1.97, height: 1.13, color: 0xe8101e, belt: 0.5, nose: 1, tail: 0.2, cabin: [0.3, 0.42, 0.56, 0.86], wheel: 0.33, wing: true, intake: true },
  'car-lambo': { length: 5.02, width: 2.07, height: 1.17, color: 0x7dff2a, belt: 0.48, nose: 1.3, tail: 0.3, cabin: [0.28, 0.42, 0.56, 0.8], wheel: 0.35, stripe: 0x15151a, wing: true, intake: true },
};

// Everyday traffic, each in a bright toy colour.
const TRAFFIC: Design[] = [
  { length: 4.7, width: 1.82, height: 1.45, color: 0xff6b6b, belt: 0.55, nose: 0.5, tail: 0.35, cabin: [0.3, 0.42, 0.68, 0.8], wheel: 0.32 }, // sedan
  { length: 4.1, width: 1.78, height: 1.48, color: 0x4dd8ff, belt: 0.55, nose: 0.5, tail: 0.1, cabin: [0.32, 0.45, 0.88, 0.97], wheel: 0.31 }, // hatchback
  { length: 3.7, width: 1.7, height: 1.5, color: 0xffd23f, belt: 0.55, nose: 0.4, tail: 0.1, cabin: [0.3, 0.42, 0.88, 0.97], wheel: 0.3 }, // compact
  { length: 4.9, width: 1.9, height: 1.75, color: 0xa66bff, belt: 0.5, nose: 0.5, tail: 0.05, cabin: [0.22, 0.38, 0.92, 0.98], wheel: 0.33, rack: true }, // minivan
  { length: 5.3, width: 1.95, height: 1.8, color: 0xff8c2a, belt: 0.55, nose: 0.6, tail: 0.1, cabin: [0.3, 0.4, 0.55, 0.6], wheel: 0.38, bed: true }, // pickup
  { length: 4.5, width: 1.84, height: 1.35, color: 0x3fe08a, belt: 0.55, nose: 0.6, tail: 0.3, cabin: [0.34, 0.46, 0.64, 0.84], wheel: 0.33, stripe: 0xffffff }, // coupe
  { length: 4.4, width: 1.9, height: 1.85, color: 0x6f8f3a, belt: 0.55, nose: 0.3, tail: 0.05, cabin: [0.3, 0.38, 0.9, 0.97], wheel: 0.4, rack: true }, // off-roader
  { length: 4.4, width: 1.88, height: 1.25, color: 0xff3dbb, belt: 0.5, nose: 0.9, tail: 0.25, cabin: [0.32, 0.44, 0.6, 0.85], wheel: 0.33, wing: true }, // sports car
];

/** Builds every vehicle. */
export function buildFleet(): Fleet {
  return {
    players: Object.fromEntries(Object.entries(PLAYERS).map(([id, d]) => [id, fit(car(d), d.length)])),
    cars: TRAFFIC.map((d) => fit(car(d), d.length)),
    heavy: [fit(van(0xf4f4f8)), fit(truck(0x2a6bff, 0xf4f4f8))],
    police: fit(police(), 4.9),
    convoy: fit(convoy()),
    moto: fit(moto()),
  };
}
