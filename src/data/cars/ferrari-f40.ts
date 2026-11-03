// Ferrari F40 (1987). Figures: Ferrari (power, torque, 0-100, top speed), period gearbox data; 100-0 from period road tests.
import { SHARED_PHYSICS, type Car } from './types.ts';

export default {
  id: 'f40', name: 'Ferrari F40', year: 1987, model: 'car-f40',
  specs: { engine: '2.9 L twin-turbo V8', gearbox: '5-speed manual', drive: 'Rear-wheel drive', cylinders: 8, turbo: true },
  real: { zeroTo100: 4.1, topKmh: 324, brake100: 36 },
  physics: {
    ...SHARED_PHYSICS, wheelbase: 2.45, grip: 11.5, massKg: 1235, powerKw: 352, powerRpm: 7000, torqueNm: 577, redline: 7750,
    gears: [3.45, 2.14, 1.53, 1.2, 0.95], finalDrive: 2.727, wheelRadius: 0.333, driveShare: 0.55,
    cdA: 0.67, brakeDecel: 10.7, limiterKmh: 324,
  },
} satisfies Car;
