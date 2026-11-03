// Body motion on springs: heave over road bumps, pitch under braking/acceleration, roll in corners.
import type * as THREE from 'three';
import { SUSPENSION as S } from '../core/config.ts';
import { stepSpring } from '../rules/spring.ts';

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

export class Suspension {
  private heave = { x: 0, v: 0 };
  private pitch = { x: 0, v: 0 };
  private roll = { x: 0, v: 0 };
  private nextBump = Math.random() * S.bumpEvery;

  /** accel: m/s² along the car, lateral: m/s² sideways, distance: meters driven this frame. */
  update(body: THREE.Object3D, dt: number, accel: number, lateral: number, distance: number) {
    this.nextBump -= distance;
    if (this.nextBump <= 0) {
      this.nextBump = S.bumpEvery * (0.5 + Math.random());
      const hit = S.bumpKick * Math.min(1.5, distance / dt / 30) * (0.5 + Math.random());
      this.heave.v -= hit;
      this.pitch.v += (Math.random() - 0.5) * hit * 0.6;
      this.roll.v += (Math.random() - 0.5) * hit * 0.4;
    }
    stepSpring(this.heave, 0, S.frequency, S.damping, dt);
    stepSpring(this.pitch, clamp(accel * S.pitchPerAccel, S.maxTilt), S.frequency, S.damping, dt);
    stepSpring(this.roll, clamp(lateral * S.rollPerAccel, S.maxTilt), S.frequency, S.damping, dt);
    body.position.y = this.heave.x;
    body.rotation.x = this.pitch.x; // + = nose up
    body.rotation.z = this.roll.x; // + = leans left, i.e. out of a right turn
  }

  reset(body: THREE.Object3D) {
    this.heave = { x: 0, v: 0 };
    this.pitch = { x: 0, v: 0 };
    this.roll = { x: 0, v: 0 };
    body.position.y = 0;
    body.rotation.set(0, 0, 0);
  }
}
