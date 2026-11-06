// What road events put on the road (rules/events.ts): cones, warning signs and the flashing arrow trailer of
// roadworks, the boxes and tyres of a lost load and the lorry that shed them, two wrecked cars and a warning
// triangle, the machines of a roadworks site. Built in sections kept complete ahead of the car like the scenery;
// what you hit is knocked flying, tumbles, bounces and stays lying where it lands.
import * as THREE from 'three';
import { EVENTS } from '../core/config.ts';
import { eventsIn, type EventKind, type Thing, type ThingKind } from '../rules/events.ts';
import { block, cone, part, post, prop, turn } from './assets.ts';
import { PieceFrame, Ring, type TrackView } from './track.ts';
import { BEACON, type Fleet } from './vehicles/fleet.ts';
import { setBlinker } from './vehicles/lights.ts';
import { spawn, type Vehicle } from './vehicles/prefab.ts';

const SECTION = 40, BEHIND = 140, AHEAD = 1340; // m, as the scenery
const ORANGE = 0xff6a1a, WHITE = 0xf6f6f2, DARK = 0x24252c, SITE = 0xffc21a, GLASS = 0x1b2440, STEEL = 0xb8bcc8;
const GRAVITY = 9.81; // m/s²
/** How what was knocked flying comes to rest: tipped over (rad) and how high its base then sits (m). */
const REST: Partial<Record<ThingKind, { tilt: number; y: number }>> = { cone: { tilt: Math.PI / 2, y: 0.22 }, sign: { tilt: Math.PI / 2, y: 0.1 }, triangle: { tilt: Math.PI / 2, y: 0.04 } };

type Section = { group: THREE.Group; ids: string[]; vehicles: Vehicle[] };
/** Something knocked flying: its velocity and spin in its section's frame (-z down the road). */
type Flyer = { obj: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; rest: { tilt: number; y: number } };

const wheelGeo = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2);

/** Excavator, ~6.5 m: tracks, a turning body with its cab, the boom and stick reaching forward, the bucket down. */
function digger() {
  return prop(
    block(0.6, 0.8, 4, DARK, -1, 0, 0), block(0.6, 0.8, 4, DARK, 1, 0, 0),
    block(2.4, 1.3, 2.8, SITE, 0, 0.8, 0.4), block(2.4, 0.8, 0.6, DARK, 0, 1, 1.9),
    block(1, 1.6, 1.2, SITE, -0.6, 2.1, -0.4), block(1.02, 0.9, 1.1, GLASS, -0.6, 2.6, -0.42), block(0.25, 0.2, 0.25, BEACON.amber, -0.6, 3.7, -0.4),
    turn(block(0.4, 3.2, 0.5, SITE, 0.5, 1.8, -0.8), -0.9), turn(block(0.3, 2.2, 0.35, SITE, 0.5, 3.79, -3.3), Math.PI + 0.3), block(0.9, 0.6, 0.7, DARK, 0.5, 1.1, -4.1),
  );
}

/** Road roller, ~4.6 m: the big steel drum in front, a canopy over the seat. */
function roller() {
  const parts: THREE.Object3D[] = [part(wheelGeo(0.75, 2.1), STEEL, 0, 0.75, -1.5), block(2.2, 0.3, 1, SITE, 0, 1.45, -1.5), block(1.8, 1, 2.6, SITE, 0, 0.6, 0.8)];
  for (const s of [-1, 1]) {
    parts.push(part(wheelGeo(0.6, 0.4), DARK, s * 0.9, 0.6, 1.5));
    for (const z of [0.1, 1.5]) parts.push(block(0.08, 1.4, 0.08, DARK, s * 0.75, 1.6, z));
  }
  parts.push(block(1.9, 0.1, 1.7, SITE, 0, 3, 0.8), block(0.6, 0.5, 0.6, DARK, 0, 1.6, 0.9), block(0.25, 0.2, 0.25, BEACON.amber, 0, 3.1, 0.8));
  return prop(...parts);
}

/** Dump truck, ~7.5 m: a cab, an orange tipper heaped with gravel, three axles. */
function dumper() {
  const parts: THREE.Object3D[] = [block(1.2, 0.4, 7, DARK, 0, 0.55, 0.1), block(2.4, 2, 2, SITE, 0, 0.9, -2.6), block(2.2, 0.8, 0.06, GLASS, 0, 1.9, -3.62)];
  parts.push(block(2.5, 1.3, 4.6, ORANGE, 0, 1, 1.1), cone(1.3, 0.9, 0x8a7a6a, 0, 2.3, 1.1, 7), block(0.25, 0.2, 0.25, BEACON.amber, 0, 2.9, -2.6));
  for (const z of [-2.6, 1.3, 2.7]) for (const s of [-1, 1]) parts.push(part(wheelGeo(0.55, 0.45), DARK, s * 1.05, 0.55, z));
  return prop(...parts);
}

/** A board `w`×`h` m facing +z (the drivers coming), drawn on a canvas by `draw`. */
function board(w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, glow?: THREE.Color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  draw(c.getContext('2d')!, c.width, c.height);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.6, ...(glow ? { emissiveMap: map, emissive: glow, emissiveIntensity: 0 } : {}) });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

/** A warning sign on two legs: `text` under a red-rimmed triangle, on white. */
function sign(text: string) {
  const face = board(1.4, 1.6, (g, W, H) => {
    g.fillStyle = '#f6f6f2';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8202a';
    g.beginPath();
    g.moveTo(W / 2, H * 0.06);
    g.lineTo(W * 0.92, H * 0.66);
    g.lineTo(W * 0.08, H * 0.66);
    g.fill();
    g.fillStyle = '#f6f6f2';
    g.beginPath();
    g.moveTo(W / 2, H * 0.2);
    g.lineTo(W * 0.78, H * 0.59);
    g.lineTo(W * 0.22, H * 0.59);
    g.fill();
    g.fillStyle = '#111';
    g.font = `${Math.round(H * 0.11)}px Bungee, "Chakra Petch", sans-serif`;
    g.textAlign = 'center';
    g.fillText('!', W / 2, H * 0.55);
    g.fillText(text, W / 2, H * 0.86);
  });
  face.position.set(0, 1.9, 0.06);
  return prop(post(0.05, 0.05, 1.2, 0x8a8f9a, -0.5), post(0.05, 0.05, 1.2, 0x8a8f9a, 0.5), block(1.45, 1.65, 0.08, 0x8a8f9a, 0, 1.08), face);
}

/** The arrow trailer at the head of roadworks: a board of amber chevrons pointing to the open lanes (`left`). */
function arrowTrailer(left: boolean, glow: THREE.Color, boards: THREE.MeshStandardMaterial[]) {
  const face = board(2, 1.4, (g, W, H) => {
    g.fillStyle = '#15151a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffa01a';
    for (const x of [0.22, 0.47, 0.72]) {
      const cx = W * (left ? 1 - x : x), s = left ? -1 : 1;
      g.beginPath();
      g.moveTo(cx - s * W * 0.08, H * 0.2);
      g.lineTo(cx + s * W * 0.06, H * 0.5);
      g.lineTo(cx - s * W * 0.08, H * 0.8);
      g.lineTo(cx - s * W * 0.02, H * 0.8);
      g.lineTo(cx + s * W * 0.12, H * 0.5);
      g.lineTo(cx - s * W * 0.02, H * 0.2);
      g.fill();
    }
  }, glow);
  boards.push(face.material as THREE.MeshStandardMaterial);
  face.position.set(0, 2.4, 0.08);
  const parts: THREE.Object3D[] = [block(2.2, 0.5, 3.2, ORANGE, 0, 0.45), block(2.2, 0.15, 3.2, WHITE, 0, 0.95), face, block(2.15, 1.55, 0.12, DARK, 0, 1.65, 0)];
  for (const x of [-0.6, 0.6]) parts.push(block(0.12, 1.1, 0.12, DARK, x, 0.95, 0.4));
  for (const s of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 14).rotateZ(Math.PI / 2), DARK, s * 1.05, 0.4, 0.5));
  return prop(...parts);
}

export class Events {
  private ring: Ring<Section>;
  private fleet: Fleet;
  private knocked = new Set<string>(); // ids knocked flying this race: gone for good
  private shown = new Map<string, THREE.Object3D>();
  private clock = 0;
  private boards: THREE.MeshStandardMaterial[] = []; // the arrow boards, flashing together
  private protos: Record<string, THREE.Object3D>;
  private flyers: Flyer[] = [];

  constructor(track: TrackView, fleet: Fleet) {
    this.fleet = fleet;
    const glow = new THREE.Color(0xffa01a);
    const tyre = new THREE.CylinderGeometry(0.4, 0.4, 0.26, 14);
    this.protos = {
      cone: prop(block(0.45, 0.05, 0.45, ORANGE), cone(0.2, 0.72, ORANGE, 0, 0.05, 0, 10), post(0.135, 0.105, 0.14, WHITE, 0, 0.32, 0, 10)),
      'sign:works': sign('ROADWORKS'),
      'sign:accident': sign('ACCIDENT'),
      triangle: prop(turn(part(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 3).rotateX(-Math.PI / 2), 0xe8202a, 0, 0.35), 0), block(0.5, 0.04, 0.3, DARK)),
      tyre: prop(part(tyre, 0x1c1c22, 0, 0.13), part(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10), 0xb8bcc8, 0, 0.13)),
      box: prop(block(1.1, 1.1, 1.1, 0xffa42a), block(1.12, 0.12, 1.12, DARK, 0, 0.2), block(1.12, 0.12, 1.12, DARK, 0, 0.8), block(0.12, 1.12, 1.12, DARK)),
      'arrow:left': arrowTrailer(true, glow, this.boards),
      'arrow:right': arrowTrailer(false, glow, this.boards),
      digger: digger(),
      roller: roller(),
      dumper: dumper(),
    };
    this.ring = new Ring<Section>(SECTION, BEHIND, AHEAD, (d0) => {
      const s = this.fill(d0);
      track.place(s.group, d0, 0);
      track.root.add(s.group);
      return s;
    }, (s) => {
      track.root.remove(s.group);
      for (const id of s.ids) this.shown.delete(id);
    });
  }

  /** A new race (a new map): everything stands again. */
  clear() {
    this.knocked.clear();
    this.flyers = [];
    this.ring.clear();
  }

  update(d: number, dt: number) {
    this.ring.update(d);
    this.clock += dt;
    const on = Math.floor(this.clock * 2.5) % 2 === 0;
    for (const m of this.boards) m.emissiveIntensity = on ? 1.6 : 0.05;
    for (const s of this.ring.pieces()) for (const v of s.vehicles) setBlinker(v, 0, on, true);
    this.fly(dt);
  }

  /** Moves what was knocked flying: thrown, tumbling, bouncing, then sliding to rest on its side. */
  private fly(dt: number) {
    const F = EVENTS.fling;
    this.flyers = this.flyers.filter((f) => {
      const { obj, v, spin } = f;
      if (!obj.parent?.parent) return false; // its section was dropped behind the car
      v.y -= GRAVITY * dt;
      obj.position.addScaledVector(v, dt);
      obj.rotation.x += spin.x * dt;
      obj.rotation.z += spin.z * dt;
      if (obj.position.y > f.rest.y) return true;
      obj.position.y = f.rest.y;
      if (v.y < -2) {
        v.y *= -F.bounce; // a bounce, losing most of its height
        spin.multiplyScalar(0.6);
        return true;
      }
      v.y = 0;
      // on the ground: slides to a stop and settles, tipped over
      const h = Math.hypot(v.x, v.z), slow = Math.max(0, h - F.rollDrag * dt);
      v.x *= h ? slow / h : 0;
      v.z *= h ? slow / h : 0;
      const k = Math.min(1, dt * 8), wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)); // the same pose, without the turns it made
      obj.rotation.x = f.rest.tilt + wrap(obj.rotation.x - f.rest.tilt);
      obj.rotation.z = wrap(obj.rotation.z);
      obj.rotation.x += (f.rest.tilt - obj.rotation.x) * k;
      obj.rotation.z += (0 - obj.rotation.z) * k;
      return slow > 0.05 || Math.abs(f.rest.tilt - obj.rotation.x) > 0.01;
    });
  }

  isKnocked(id: string) {
    return this.knocked.has(id);
  }

  /**
   * Thing `id` (of `kind`, `mass` kg) was hit by a car at `speed` m/s and shoved sideways towards `side`
   * (-1 left, 1 right): it is knocked flying down the road, the lighter the further, and stays where it lands.
   */
  knock(id: string, kind: ThingKind, mass: number, speed: number, side: number) {
    this.knocked.add(id);
    const obj = this.shown.get(id);
    if (!obj) return;
    const F = EVENTS.fling, k = Math.min(1, 20 / mass), r = () => Math.random() - 0.5;
    obj.rotation.order = 'YXZ'; // its heading first, then the tumble about its own axes
    this.flyers.push({
      obj,
      v: new THREE.Vector3(side * (1 + speed * 0.08) + r() * 2, (1 + Math.random() * F.lift) * Math.min(1, speed / 25) * k + 0.5, -speed * F.share * k),
      spin: new THREE.Vector3(-(4 + Math.random() * F.spin), 0, r() * F.spin),
      rest: REST[kind] ?? { tilt: 0, y: 0 },
    });
  }

  /** Builds what stands in the section starting at road position `d0`. */
  private fill(d0: number): Section {
    const pf = new PieceFrame(d0), s: Section = { group: new THREE.Group(), ids: [], vehicles: [] };
    for (const e of eventsIn(d0, d0 + SECTION)) {
      for (const t of e.things) {
        if (t.d < d0 || t.d >= d0 + SECTION || this.knocked.has(t.id)) continue;
        const obj = this.make(t, e.kind, s);
        s.group.add(pf.place(obj, t.d, t.x, 0, t.yaw));
        this.shown.set(t.id, obj);
        s.ids.push(t.id);
      }
    }
    return s;
  }

  private make(t: Thing, kind: EventKind, s: Section): THREE.Object3D {
    if (t.kind === 'wreck' || t.kind === 'truck') {
      const [k, i] = t.id.split(':').map(Number);
      const v = spawn(t.kind === 'truck' ? this.fleet.heavy[1] : this.fleet.cars[(k * 3 + i) % this.fleet.cars.length]);
      if (t.kind === 'wreck') {
        v.body.rotation.z = (i % 2 ? 1 : -1) * 0.06; // crumpled onto one side
        v.body.position.y = -0.05;
      }
      s.vehicles.push(v);
      return v.mesh;
    }
    const key = t.kind === 'sign' ? `sign:${kind}` : t.kind === 'arrow' ? `arrow:${t.x > 0 ? 'left' : 'right'}` : t.kind;
    return this.protos[key].clone();
  }
}
