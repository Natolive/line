// BMW M4 CSL (2022). Figures: BMW M press data.
import { SHARED_PHYSICS, type Car } from './types.ts';

export default {
  id: 'bmw', name: 'BMW M4 CSL', year: 2022, model: 'car-bmw',
  specs: { engine: '3.0 L twin-turbo inline-6', gearbox: '8-speed automatic', drive: 'Rear-wheel drive', cylinders: 6, turbo: true },
  real: { zeroTo100: 3.7, topKmh: 307, brake100: 32 },
  physics: {
    ...SHARED_PHYSICS, wheelbase: 2.857, grip: 13, massKg: 1625, powerKw: 405, powerRpm: 6250, torqueNm: 650, redline: 7200,
    gears: [5.0, 3.2, 2.143, 1.72, 1.313, 1.0, 0.823, 0.64], finalDrive: 3.154, wheelRadius: 0.34, driveShare: 0.6,
    cdA: 0.77, brakeDecel: 12, limiterKmh: 307,
  },
} satisfies Car;
