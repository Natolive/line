// What a garage car is made of. Pure data: no imports, nothing to run.

// Car physics: real specifications. Acceleration comes from the engine's torque through the real gear
// ratios, capped by tyre traction; top speed from power against air drag (see rules/vehicle.ts).
export type CarPhysics = {
  // handling
  wheelbase: number; // m
  grip: number; // max cornering acceleration, m/s²
  maxSteer: number; // front wheel angle when parked, rad
  steerRate: number; // how fast the wheels turn, rad/s
  maxHeading: number; // rad
  stabilityAssist: number; // straightens the car when you let go of steering; 0 = raw physics
  // powertrain
  massKg: number;
  powerKw: number;
  powerRpm: number; // where peak power arrives
  torqueNm: number;
  idleRpm: number;
  redline: number;
  gears: number[]; // gearbox ratios, 1st first
  finalDrive: number;
  wheelRadius: number; // m
  driveShare: number; // weight on the driven wheels when launching: 1 = all-wheel drive, ~0.6 = rear-wheel drive
  efficiency: number; // engine to wheels
  // resistance and brakes
  cdA: number; // drag coefficient × frontal area, m²
  rollingCoeff: number;
  brakeDecel: number; // m/s², from the real 100-0 km/h stopping distance
  limiterKmh: number; // electronic top speed limit (or the real top speed if none)
};

export type Car = {
  id: string;
  name: string;
  year: number;
  model: string; // file in public/models/, without .glb
  specs: { engine: string; gearbox: string; drive: string; cylinders: number; turbo: boolean }; // shown in the garage, drives the engine sound
  real: { zeroTo100: number; topKmh: number; brake100: number }; // maker's figures; a test checks the physics land on them
  physics: CarPhysics;
};

/** Values every car shares unless it overrides them. */
export const SHARED_PHYSICS = { maxSteer: 0.5, steerRate: 2.6, maxHeading: 0.7, stabilityAssist: 0.9, idleRpm: 900, efficiency: 0.88, rollingCoeff: 0.012 };
