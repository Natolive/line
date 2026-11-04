// Car physics: kinematic bicycle model with a grip limit, driven by a real engine and gearbox.
// x: lateral position (+ = right). heading: 0 = straight down the road, + = turned right. Pure, so it is unit-testable.
import type { CarPhysics } from '../data/cars/index.ts';

export type VehicleState = { x: number; heading: number; speed: number; steer: number };
export type DriveInput = { steer: number; throttle: number; brake: number }; // steer -1..1, pedals 0..1

const G = 9.81, AIR = 1.225, TYRE_GRIP = 1.3; // gravity, air density (kg/m³), tyre-road friction under traction
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rpmToRad = (rpm: number) => (rpm * 2 * Math.PI) / 60;

/** Engine torque at `rpm`: full torque until the power limit, then constant power (torque = P / ω). */
export const torqueAt = (c: CarPhysics, rpm: number) => Math.min(c.torqueNm, (c.powerKw * 1000) / rpmToRad(Math.max(rpm, 1)));

const engineRpm = (c: CarPhysics, speed: number, gear: number) => (speed / c.wheelRadius) * (60 / (2 * Math.PI)) * c.gears[gear] * c.finalDrive;

/**
 * Automatic gearbox: on the throttle it holds the gear that pushes hardest (shifting near redline, like a
 * launch-mode box); off the throttle it cruises in the tallest gear that keeps the engine above 1,600 rpm.
 */
export function pickGear(c: CarPhysics, speed: number, throttle: number) {
  let best = 0, bestForce = -1;
  for (let g = 0; g < c.gears.length; g++) {
    const rpm = engineRpm(c, speed, g);
    if (rpm > c.redline) continue;
    if (throttle > 0) {
      const force = torqueAt(c, Math.max(rpm, c.idleRpm)) * c.gears[g];
      // at constant power (past peak power) every gear pushes the same: take the taller one, not a rounding error's pick
      if (force >= bestForce * (1 - 1e-9)) [best, bestForce] = [g, force];
    } else if (rpm >= 1600 || g === 0) best = g;
  }
  // pulling away: the clutch slips, so the engine sits around 3,500 rpm instead of idling
  const rpm = Math.max(engineRpm(c, speed, best), best === 0 && throttle > 0 ? 3500 : c.idleRpm);
  return { gear: best + 1, rpm: Math.min(rpm, c.redline) };
}

/**
 * `curvature` (1/m, + = bending right) is the road's under the car: heading is measured from the road, so
 * as the road turns under a car that goes straight, the car points out of the bend and drifts to the outside.
 */
export function stepVehicle(s: VehicleState, input: DriveInput, dt: number, c: CarPhysics, curvature = 0) {
  const v = s.speed;
  // Speed-sensitive steering: full lock at any speed puts you right at the grip limit, not past it.
  const steerLimit = Math.min(c.maxSteer, Math.atan((c.grip * 1.1 * c.wheelbase) / Math.max(v * v, 1)));
  const target = clamp(input.steer, -1, 1) * steerLimit;
  const step = c.steerRate * dt;
  const steer = clamp(clamp(target, s.steer - step, s.steer + step), -steerLimit, steerLimit);

  const maxYaw = c.grip / Math.max(v, 1);
  const yaw = clamp((v / c.wheelbase) * Math.tan(steer), -maxYaw, maxYaw);
  let heading = s.heading + yaw * dt;
  if (input.steer === 0) heading -= heading * Math.min(1, c.stabilityAssist * dt);
  heading -= curvature * v * Math.cos(s.heading) * dt;
  heading = clamp(heading, -c.maxHeading, c.maxHeading);

  // engine → gearbox → wheels, capped by what the driven tyres can put down, cut at the limiter
  const { gear, rpm } = pickGear(c, v, input.throttle);
  const wheelForce = (torqueAt(c, rpm) * c.gears[gear - 1] * c.finalDrive * c.efficiency) / c.wheelRadius;
  const traction = TYRE_GRIP * G * c.massKg * c.driveShare;
  const drive = v * 3.6 >= c.limiterKmh ? 0 : input.throttle * Math.min(wheelForce, traction);
  const resist = v > 0 ? 0.5 * AIR * c.cdA * v * v + c.rollingCoeff * c.massKg * G : 0;
  const accel = (drive - resist) / c.massKg - input.brake * c.brakeDecel;
  const speed = Math.max(0, v + accel * dt);

  return {
    state: { x: s.x + speed * Math.sin(heading) * dt, heading, speed, steer },
    forward: speed * Math.cos(heading) * dt, // how far down the road we moved
    lateralAccel: speed * yaw,
    accel,
    gear,
    rpm,
  };
}

/** Flat-out run from standstill, then a full stop from 100 km/h: what the garage shows. */
export function measure(c: CarPhysics) {
  const dt = 1 / 120;
  let s: VehicleState = { x: 0, heading: 0, speed: 0, steer: 0 };
  let zeroTo100 = Infinity;
  for (let t = 0; t < 120; t += dt) {
    s = stepVehicle(s, { steer: 0, throttle: 1, brake: 0 }, dt, c).state;
    if (zeroTo100 === Infinity && s.speed >= 100 / 3.6) zeroTo100 = t + dt;
  }
  const topKmh = s.speed * 3.6;
  let stop: VehicleState = { x: 0, heading: 0, speed: 100 / 3.6, steer: 0 }, brake100 = 0;
  while (stop.speed > 0) {
    const r = stepVehicle(stop, { steer: 0, throttle: 0, brake: 1 }, dt, c);
    brake100 += r.forward;
    stop = r.state;
  }
  return { zeroTo100, topKmh, brake100 };
}
