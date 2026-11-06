// What lines the road itself rather than the land: street lamps with their pools of light, and power lines.
import * as THREE from 'three';
import { GUARDRAIL_X } from '../../core/config.ts';
import { terrainHeight, waterAt } from '../../rules/terrain.ts';
import { structureAt } from '../../rules/track.ts';
import { softDot } from '../smoke.ts';
import type { PieceFrame } from '../track.ts';

const PYLON_EVERY = 280; // m between pylons of the power lines
const SAG = 6; // m the cables hang down mid-span
// cable ends on the pylon's arms (props/country.ts): ±6 m at 70 % of its height, ±4.5 m at 85 %
const ARMS = [[-6, 0.7], [6, 0.7], [-4.5, 0.85], [4.5, 0.85]];

export class Roadside {
  private lampHead = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 0.3 });
  private lampPool = new THREE.MeshBasicMaterial({ map: softDot, color: 0xffc879, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private metal = new THREE.MeshStandardMaterial({ color: 0x6e737a, metalness: 0.8, roughness: 0.4 });
  private cable = new THREE.LineBasicMaterial({ color: 0x2a2c30 });
  private lamp = this.streetLamp();
  private pylon: THREE.Object3D;

  constructor(pylon: THREE.Object3D) {
    this.pylon = pylon;
  }

  /** 0 = day, 1 = night. */
  setNight(n: number) {
    this.lampHead.emissiveIntensity = 0.3 + n * 6;
    this.lampPool.opacity = n * 0.6;
  }

  /** The pylon of a power line `x` m from the road, if one falls in [d0, d1), and its sagging cables to the next. */
  powerLine(pf: PieceFrame, group: THREE.Group, d0: number, d1: number, x: number) {
    const d = Math.ceil(d0 / PYLON_EVERY) * PYLON_EVERY;
    if (d >= d1 || structureAt(d) || waterAt(d) !== null) return;
    const h = this.pylon.userData.height as number, y0 = terrainHeight(d, x), y1 = terrainHeight(d + PYLON_EVERY, x);
    group.add(pf.place(this.pylon.clone(), d, x, y0 - 0.2, 0));
    const pts: number[] = [];
    for (const [dx, k] of ARMS) {
      for (let i = 0; i < 12; i++) {
        for (const t of [i / 12, (i + 1) / 12]) pf.write(pts, pts.length, d + t * PYLON_EVERY, x + dx, y0 + (y1 - y0) * t + h * k - SAG * 4 * t * (1 - t));
      }
    }
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(geo, this.cable));
  }

  /** Street lamp on side `side` (-1 left, 1 right) at `d`, its arm over the road; none in tunnels or on bridges. */
  lampAt(pf: PieceFrame, group: THREE.Group, side: number, d: number) {
    if (structureAt(d)) return; // tunnels and bridges have their own lighting
    const lamp = this.lamp.clone();
    lamp.scale.x = side; // mirrored for the left side
    group.add(pf.place(lamp, d, 0, 0));
  }

  /** A street lamp prototype: pole on the verge, arm over the road, and the pool of light it throws (visible at night). */
  private streetLamp() {
    const g = new THREE.Group(), x = GUARDRAIL_X + 1.2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 9, 8).translate(0, 4.5, 0), this.metal);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.14), this.metal), head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.35), this.lampHead);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), this.lampPool);
    pole.position.set(x, 0, 0);
    arm.position.set(x - 1.6, 8.95, 0);
    head.position.set(x - 3.1, 8.85, 0);
    pool.position.set(x - 4, 0.04, 0);
    pole.castShadow = arm.castShadow = true;
    g.add(pole, arm, head, pool);
    return g;
  }
}
