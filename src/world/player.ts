import * as THREE from 'three';
import { GUARDRAIL_X, LANES } from '../core/config.ts';
import type { Car } from '../data/cars/index.ts';
import type { Rect } from '../rules/collision.ts';
import { stepVehicle, type DriveInput, type VehicleState } from '../rules/vehicle.ts';
import type { Fleet } from './vehicles/fleet.ts';
import { setBrakeLights } from './vehicles/lights.ts';
import { spawn, spinWheels, type Vehicle } from './vehicles/prefab.ts';
import { Suspension } from './suspension.ts';

export class Player {
  car!: Vehicle;
  model!: Car; // the car you see
  spec: Car | null = null; // whose figures it drives with, when a room puts everyone on the same ones
  state: VehicleState = { x: 0, heading: 0, speed: 0, steer: 0 };
  lateralAccel = 0;
  gear = 1;
  rpm = 0;
  private spin = 0;
  private suspension = new Suspension();
  private scene: THREE.Scene;
  private fleet: Fleet;
  // two headlight beams that really light the road; off by day
  private beams = [-1, 1].map(() => new THREE.SpotLight(0xfff1d6, 0, 110, 0.38, 0.6, 1.2));

  constructor(scene: THREE.Scene, fleet: Fleet, choice: Car) {
    this.scene = scene;
    this.fleet = fleet;
    this.choose(choice);
  }

  /** The car whose figures the physics, the gauges and the engine sound follow. */
  get driven() {
    return this.spec ?? this.model;
  }

  get physics() {
    return this.driven.physics;
  }

  /** Swaps in another garage car. */
  choose(choice: Car) {
    if (this.car) this.scene.remove(this.car.mesh);
    this.model = choice;
    this.car = spawn(this.fleet.players[choice.model]);
    this.beams.forEach((b, i) => {
      const side = i ? 1 : -1, front = -this.car.l / 2;
      b.position.set(side * 0.6, 0.7, front);
      b.target.position.set(side * 1.2, 0, front - 30);
      this.car.mesh.add(b, b.target);
    });
    this.scene.add(this.car.mesh);
    setBrakeLights(this.car, false);
    this.reset(0);
  }

  get rect(): Rect {
    return { x: this.state.x, z: 0, w: this.car.w, l: this.car.l, heading: this.state.heading };
  }

  /** Back on the road at lateral position `x` (a lane centre by default), rolling at `speed`. */
  reset(speed: number, x = LANES[2]) {
    this.state = { x, heading: 0, speed, steer: 0 };
    this.spin = 0;
    this.lateralAccel = 0;
    this.suspension.reset(this.car.body);
    this.sync(0);
  }

  crash() {
    this.spin = (Math.random() < 0.5 ? -1 : 1) * 7;
    this.state.speed = 0;
  }

  /** Advances the car. `forward` is how far it travelled down the road this frame. */
  update(dt: number, input: DriveInput) {
    const car = this.car;
    if (this.spin) {
      car.mesh.rotation.y += this.spin * dt;
      this.spin *= Math.max(0, 1 - dt * 2);
      return { forward: 0, scraped: false };
    }

    const r = stepVehicle(this.state, input, dt, this.physics);
    this.gear = r.gear;
    this.rpm = r.rpm;
    let s = r.state, scraped = false;
    // Guardrail: clamp, bleed speed, deflect the nose away from the rail.
    const reach = (car.w / 2) * Math.cos(s.heading) + (car.l / 2) * Math.abs(Math.sin(s.heading));
    const limit = GUARDRAIL_X - 0.1 - reach;
    if (Math.abs(s.x) > limit) {
      const side = Math.sign(s.x);
      s = {
        ...s,
        x: side * limit,
        speed: s.speed * (1 - Math.min(0.5, dt * 1.2)),
        heading: Math.sign(s.heading) === side ? -s.heading * 0.3 : s.heading,
      };
      scraped = true;
    }
    this.state = s;
    this.lateralAccel = r.lateralAccel;

    this.suspension.update(car.body, dt, r.accel, r.lateralAccel, s.speed * dt);
    setBrakeLights(car, input.brake > 0);
    this.sync(s.speed * dt);
    return { forward: r.forward, scraped };
  }

  /** Contact with another player: pushed sideways by `dx` meters, and slowed to `maxSpeed` if given. */
  shove(dx: number, maxSpeed?: number) {
    this.state.x += dx;
    this.state.heading += dx * 0.05;
    if (maxSpeed !== undefined) this.state.speed = Math.min(this.state.speed, Math.max(0, maxSpeed));
  }

  /** 0 = day, 1 = night. */
  setNight(n: number) {
    for (const b of this.beams) b.intensity = n * 150;
  }

  /** Tailpipe position in the world, for exhaust smoke. */
  exhaust() {
    return this.car.mesh.localToWorld(this.car.exhaust.clone());
  }

  /** Rear tyre contact points in the world, for tyre smoke. */
  rearWheels() {
    return this.car.rearWheels.map((p) => this.car.mesh.localToWorld(p.clone()));
  }

  private sync(distance: number) {
    const car = this.car;
    car.mesh.position.set(this.state.x, 0, 0);
    car.mesh.rotation.set(0, -this.state.heading, 0);
    spinWheels(car, distance);
    for (const p of car.steerPivots) p.rotation.y = -this.state.steer;
  }
}
