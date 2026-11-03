// Ford Mustang Shelby GT500 (2020). Figures: Ford (power, torque, 3.73 final drive), TREMEC TR-9070 product sheet (ratio set A).
import { SHARED_PHYSICS, type Car } from './types.ts';

export default {
  id: 'mustang', name: 'Ford Mustang Shelby GT500', year: 2020, model: 'car-mustang',
  specs: { engine: '5.2 L supercharged V8', gearbox: '7-speed dual-clutch', drive: 'Rear-wheel drive', cylinders: 8, turbo: false },
  real: { zeroTo100: 3.6, topKmh: 290, brake100: 33 },
  physics: {
    ...SHARED_PHYSICS, wheelbase: 2.72, grip: 13, massKg: 1916, powerKw: 567, powerRpm: 7300, torqueNm: 847, redline: 7500,
    gears: [3.14, 2.05, 1.43, 1.1, 0.86, 0.68, 0.56], finalDrive: 3.73, wheelRadius: 0.349, driveShare: 0.62,
    cdA: 0.9, brakeDecel: 11.7, limiterKmh: 290,
  },
} satisfies Car;
