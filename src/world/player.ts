import * as THREE from 'three';
import { GUARDRAIL_X, IMPACT, LANES, SHOULDER } from '../core/config.ts';
import type { Car } from '../data/cars/index.ts';
import type { Rect } from '../rules/collision.ts';
import { startWreck, stepWreck, type Wreck, type WreckEvents } from '../rules/crash.ts';
import { onShoulder } from '../rules/difficulty.ts';
import { damageEffects, massOf, railImpact, type Moving } from '../rules/impact.ts';
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
  wreck: Wreck | null = null; // set from the crash until the next reset
  damage = 0; // %, from knocks (rules/impact.ts); 100 = wrecked
  private slip = 0; // m/s sideways from a knock, soaked up by the tyres
  private spin = 0; // rad/s of yaw from a knock
  private pullSide = 1; // which way a badly damaged car pulls
  private suspension = new Suspension();
  private scene: THREE.Scene;
  private fleet: Fleet;
  // two headlight beams that really light the road; off by day
  readonly mirror = new THREE.PerspectiveCamera(50, 3.4, 0.3, 6000); // rear-view: rides on the car, looking back; far enough for the sky dome
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

  /** Swaps in another garage car; it drives on where and as fast as the previous one was (the garage keeps rolling). */
  choose(choice: Car) {
    const was = this.car ? { ...this.state } : null;
    if (this.car) this.scene.remove(this.car.mesh);
    this.model = choice;
    this.car = spawn(this.fleet.players[choice.model]);
    this.beams.forEach((b, i) => {
      const side = i ? 1 : -1, front = -this.car.l / 2;
      b.position.set(side * 0.6, 0.7, front);
      b.target.position.set(side * 1.2, 0, front - 30);
      this.car.mesh.add(b, b.target);
    });
    this.mirror.position.set(0, 1.2, this.car.l / 2 + 0.3); // just behind the tail, so the car stays out of shot
    this.mirror.rotation.set(-0.03, Math.PI, 0);
    this.car.mesh.add(this.mirror);
    this.scene.add(this.car.mesh);
    setBrakeLights(this.car, false);
    this.reset(was?.speed ?? 0, was?.x);
    if (was) this.state.heading = was.heading;
  }

  get rect(): Rect {
    return { x: this.state.x, z: 0, w: this.car.w, l: this.car.l, heading: this.state.heading };
  }

  /** Back on the road at lateral position `x` (a lane centre by default), rolling at `speed`. */
  reset(speed: number, x = LANES[2]) {
    this.state = { x, heading: 0, speed, steer: 0 };
    this.wreck = null;
    this.damage = this.slip = this.spin = 0;
    this.lateralAccel = 0;
    this.suspension.reset(this.car.body);
    this.sync(0);
  }

  crash() {
    const s = this.state, h = new THREE.Box3().setFromObject(this.car.body).max.y;
    this.wreck = startWreck(s.x, s.heading, s.speed, this.car.w, h);
    s.speed = 0;
    setBrakeLights(this.car, false);
  }

  /** Mass (kg) and velocity in the road plane (m/s, x right, z back), as impacts see the car. */
  get moving(): Moving {
    const s = this.state;
    return { rect: this.rect, vx: s.speed * Math.sin(s.heading) + this.slip, vz: -s.speed * Math.cos(s.heading), mass: massOf(this.car.w, this.car.l) };
  }

  /** A knock: `dv` the change of velocity (x right, z back), `spin` rad/s of yaw, `damage` % added. */
  knock(dv: [number, number], spin: number, damage: number) {
    const s = this.state;
    s.speed = Math.max(0, s.speed - dv[1] * Math.cos(s.heading) + dv[0] * Math.sin(s.heading));
    this.slip += dv[0] * Math.cos(s.heading) + dv[1] * Math.sin(s.heading);
    this.spin = Math.max(-2.5, Math.min(2.5, this.spin + spin));
    this.hurt(damage);
  }

  private hurt(damage: number) {
    if (this.damage < IMPACT.limpAt && this.damage + damage >= IMPACT.limpAt) this.pullSide = Math.random() < 0.5 ? -1 : 1;
    this.damage = Math.min(100, this.damage + damage);
  }

  /** Where smoke pours out of a badly damaged engine, in the world, or null while it is fine. */
  engineSmoke() {
    return damageEffects(this.damage).smoke ? this.car.mesh.localToWorld(new THREE.Vector3(0, 0.9, -this.car.l / 2 + 0.7)) : null;
  }

  /**
   * Advances the car on a road bending by `curvature` (1/m). `forward` is how far it travelled down the road this
   * frame; `railJolt` (km/h) how hard it just hit a rail, `wrecked` if that, or the damage, finished it.
   */
  update(dt: number, input: DriveInput, curvature = 0): { forward: number; scraped: boolean; railJolt: number; wrecked: boolean; wreck?: WreckEvents } {
    const car = this.car, w = this.wreck;
    if (w) {
      const wreck = stepWreck(w, dt);
      Object.assign(this.state, { x: w.x, heading: w.yaw });
      car.mesh.position.set(w.x, w.y, -w.s);
      car.mesh.rotation.set(0, -w.yaw, w.roll);
      spinWheels(car, w.vs * dt * Math.cos(w.roll)); // wheels turn only while it rides on them
      return { forward: 0, scraped: false, railJolt: 0, wrecked: false, wreck };
    }

    // damage: less power, and a pull to one side
    const fx = damageEffects(this.damage);
    const driven = { ...input, throttle: input.throttle * fx.power, steer: Math.max(-1, Math.min(1, input.steer + fx.pull * this.pullSide)) };
    const r = stepVehicle(this.state, driven, dt, this.physics, curvature);
    this.gear = r.gear;
    this.rpm = r.rpm;
    let s = r.state, scraped = false, railJolt = 0;
    // a knock's sideways shove and spin, soaked up by the tyres
    s = { ...s, x: s.x + this.slip * dt, heading: s.heading + this.spin * dt };
    this.slip -= Math.sign(this.slip) * Math.min(Math.abs(this.slip), this.physics.grip * IMPACT.slipGrip * dt);
    this.spin *= Math.exp(-IMPACT.spinDamp * dt);
    if (onShoulder(s.x)) s = { ...s, speed: Math.max(0, s.speed - SHOULDER.drag * dt) };
    // Guardrail: clamp, bleed speed, deflect the nose away from the rail; a steep hit jolts and damages the car.
    const reach = (car.w / 2) * Math.cos(s.heading) + (car.l / 2) * Math.abs(Math.sin(s.heading));
    const limit = GUARDRAIL_X - 0.1 - reach;
    if (Math.abs(s.x) > limit) {
      const side = Math.sign(s.x), into = side * (s.speed * Math.sin(s.heading) + this.slip);
      const hit = railImpact(into);
      railJolt = hit.jolt;
      this.hurt(hit.damage + IMPACT.scrapePerSec * (s.speed / 27.8) * dt);
      this.slip = 0;
      this.spin *= 0.5;
      s = {
        ...s,
        x: side * limit,
        speed: Math.max(0, s.speed * (1 - Math.min(0.5, dt * 1.2)) - hit.dv * 0.5), // a hard hit also costs speed
        heading: Math.sign(s.heading) === side ? -s.heading * 0.3 : s.heading,
      };
      scraped = true;
    }
    this.state = s;
    this.lateralAccel = r.lateralAccel;

    this.suspension.update(car.body, dt, r.accel, r.lateralAccel, s.speed * dt);
    setBrakeLights(car, input.brake > 0);
    this.sync(s.speed * dt);
    return { forward: r.forward, scraped, railJolt, wrecked: this.damage >= 100 };
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
