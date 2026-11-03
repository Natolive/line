// Other players' cars: their real models, steered toward what their games report, with a name above them.
import * as THREE from 'three';
import { GARAGE } from '../data/cars/index.ts';
import { pushSample, sampleAt, type Sample } from '../net/interp.ts';
import type { CarState, PlayerInfo } from '../net/protocol.ts';
import type { Rect } from '../rules/collision.ts';
import type { Fleet } from './vehicles/fleet.ts';
import { setBrakeLights } from './vehicles/lights.ts';
import { spawn, spinWheels, type Vehicle } from './vehicles/prefab.ts';

export type Rival = {
  info: PlayerInfo;
  v: Vehicle;
  d: number; // drawn position: a little in the past, smooth
  x: number;
  heading: number;
  speed: number;
  now: { d: number; x: number }; // best guess of where it really is now: used for contact
  score: number;
  alive: boolean;
  samples: Sample[];
};

/** A name tag that always faces the camera. */
function nameTag(text: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(15,18,24,0.6)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 12);
  g.fill();
  g.fillStyle = '#f7f4ee';
  g.font = '700 30px "Chakra Petch", Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText(text, 128, 43);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 10;
  return s;
}

export class Rivals {
  readonly all = new Map<string, Rival>();
  private scene: THREE.Scene;
  private fleet: Fleet;

  constructor(scene: THREE.Scene, fleet: Fleet) {
    this.scene = scene;
    this.fleet = fleet;
  }

  /** Puts a rival's car on the grid at road position (d, x). */
  add(info: PlayerInfo, d: number, x: number) {
    this.remove(info.id);
    const model = GARAGE.find((c) => c.model === info.car)?.model ?? GARAGE[0].model;
    const v = spawn(this.fleet.players[model]);
    const tag = nameTag(info.name);
    tag.position.set(0, 2.2, 0);
    v.mesh.add(tag);
    setBrakeLights(v, false);
    this.scene.add(v.mesh);
    this.all.set(info.id, { info, v, d, x, heading: 0, speed: 0, now: { d, x }, score: 0, alive: true, samples: [] });
  }

  remove(id: string) {
    const r = this.all.get(id);
    if (r) this.scene.remove(r.v.mesh);
    this.all.delete(id);
  }

  clear() {
    for (const id of [...this.all.keys()]) this.remove(id);
  }

  /** A report from the server's snapshot taken at server time `t` (ms). */
  setState(id: string, s: CarState, t: number) {
    const r = this.all.get(id);
    if (!r) return;
    pushSample(r.samples, { t, d: s.d, x: s.x, heading: s.heading, speed: s.speed, steer: s.steer });
    r.score = s.score;
    setBrakeLights(r.v, s.brake);
  }

  /** Eliminated: the car stays where it stopped, as a wreck. */
  out(id: string) {
    const r = this.all.get(id);
    if (r) {
      r.alive = false;
      r.speed = 0;
    }
  }

  /**
   * Draws each rival as it was at server time `renderT` (between two real reports: smooth), and estimates
   * where it is at `nowT` for contact checks. Placed relative to `myD`.
   */
  update(dt: number, myD: number, renderT: number, nowT: number) {
    for (const r of this.all.values()) {
      const s = r.alive ? sampleAt(r.samples, renderT) : null;
      if (s) {
        Object.assign(r, { d: s.d, x: s.x, heading: s.heading, speed: s.speed });
        const n = sampleAt(r.samples, nowT)!;
        r.now = { d: n.d, x: n.x };
        for (const p of r.v.steerPivots) p.rotation.y = -s.steer;
        spinWheels(r.v, r.speed * dt);
      }
      r.v.mesh.position.set(r.x, 0, myD - r.d);
      r.v.mesh.rotation.y = -r.heading;
    }
  }

  /** Rivals still racing, where they are now (not where they're drawn): for traffic and collisions. */
  drivers() {
    return [...this.all.values()].filter((r) => r.alive).map((r) => ({ id: r.info.id, d: r.now.d, x: r.now.x, speed: r.speed, rect: this.rect(r) }));
  }

  private rect(r: Rival): Rect {
    return { x: r.now.x, z: 0, w: r.v.w, l: r.v.l, heading: r.heading };
  }
}
