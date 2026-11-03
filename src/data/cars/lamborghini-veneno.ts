// Lamborghini Veneno (2013). Figures: Lamborghini press data; gear ratios from the Aventador's ISR gearbox.
import { SHARED_PHYSICS, type Car } from './types.ts';

export default {
  id: 'lambo', name: 'Lamborghini Veneno', year: 2013, model: 'car-lambo',
  specs: { engine: '6.5 L naturally aspirated V12', gearbox: '7-speed ISR', drive: 'All-wheel drive', cylinders: 12, turbo: false },
  real: { zeroTo100: 2.8, topKmh: 355, brake100: 30 },
  physics: {
    ...SHARED_PHYSICS, wheelbase: 2.7, grip: 14, massKg: 1550, powerKw: 552, powerRpm: 8400, torqueNm: 690, redline: 8500,
    gears: [3.909, 2.438, 1.81, 1.458, 1.185, 0.967, 0.844], finalDrive: 2.867, wheelRadius: 0.35, driveShare: 0.8,
    cdA: 0.78, brakeDecel: 12.8, limiterKmh: 355,
  },
} satisfies Car;
