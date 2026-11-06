// The start line: a chequered strip across the road and a gantry over it with a START banner and two
// traffic lights (red, amber, green from top to bottom) facing the grid. The finish line of a race is the same
// gantry with a FINISH banner and no lights.
import * as THREE from 'three';
import { GUARDRAIL_X } from '../core/config.ts';
import type { TrackView } from './track.ts';

const SPAN = GUARDRAIL_X + 1.2, BEAM = 7; // m: posts' distance from the centre line, beam height
const LIGHTS_X = [-3.4, 3.4]; // m: one light over each pair of lanes
const COLORS = [0xff2a2a, 0xffaa1a, 0x2aff5a]; // red, amber, green

/** A canvas texture `w`×`h` drawn by `draw`. */
function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const chequer = (g: CanvasRenderingContext2D, cell: number) => {
  for (let x = 0; x < g.canvas.width / cell; x++) {
    for (let y = 0; y < g.canvas.height / cell; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
};

export class StartLine {
  private group = new THREE.Group();
  private lamps = COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.3 }));
  private track: TrackView;

  /** `word`: written across the gantry; `lights`: hang the start lights. */
  constructor(track: TrackView, word = 'START', lights = true) {
    this.track = track;
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    // the line itself, painted across the whole road
    const strip = add(new THREE.PlaneGeometry(GUARDRAIL_X * 2, 1.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: canvas(512, 32, (g) => chequer(g, 16)), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 0, 0.02);
    strip.castShadow = false;
    strip.receiveShadow = true;

    // gantry: chequered posts, a beam, the banner
    const posts = new THREE.MeshStandardMaterial({ map: canvas(32, 256, (g) => chequer(g, 16)), roughness: 0.6 });
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.5, BEAM + 0.4, 0.5), posts, s * SPAN, (BEAM + 0.4) / 2);
    add(new THREE.BoxGeometry(SPAN * 2 + 0.5, 0.5, 0.5), mat(0x22232a), 0, BEAM);
    const banner = canvas(512, 96, (g) => {
      g.fillStyle = '#ff2f6e';
      g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#fff';
      g.font = '64px Bungee, "Chakra Petch", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(word, 256, 52);
    });
    add(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ map: banner, emissiveMap: banner, emissive: 0xffffff, emissiveIntensity: 0.25 }), 0, BEAM + 0.85, 0.26);
    add(new THREE.BoxGeometry(6.2, 1.3, 0.2), mat(0x22232a), 0, BEAM + 0.85, 0.12);

    // two traffic lights hanging from the beam, lenses facing the grid (+z), each under a little visor
    for (const x of lights ? LIGHTS_X : []) {
      add(new THREE.BoxGeometry(0.1, 0.6, 0.1), mat(0x22232a), x, BEAM - 0.5);
      add(new THREE.BoxGeometry(0.95, 2.6, 0.6), mat(0x15151a), x, BEAM - 2.1);
      COLORS.forEach((_, i) => {
        const y = BEAM - 1.25 - i * 0.82;
        add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 20).rotateX(Math.PI / 2), this.lamps[i], x, y, 0.32);
        add(new THREE.BoxGeometry(0.8, 0.06, 0.35), mat(0x15151a), x, y + 0.36, 0.45);
      });
    }
    track.root.add(this.group);
    this.lights(null);
  }

  /** Stands the line at road position `d` (call after each new map: the curve changed); null takes it away. */
  set(d: number | null) {
    this.group.visible = d !== null;
    if (d !== null) this.track.place(this.group, d, 0);
  }

  /**
   * Lights `left` seconds before the start: red, then amber for the last `amber` seconds, then green
   * (and it stays green). null: all off.
   */
  lights(left: number | null, amber = 1) {
    const on = left === null ? -1 : left > amber ? 0 : left > 0 ? 1 : 2;
    this.lamps.forEach((m, i) => {
      m.emissiveIntensity = i === on ? 1.5 : 0; // brighter washes out to white
      m.color.set(i === on ? COLORS[i] : 0x2a2a30); // an unlit lens is dark
    });
  }
}
