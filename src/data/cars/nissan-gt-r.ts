// Nissan GT-R (R35, 2017). Figures: Nissan specifications (GR6 gearbox ratios and final drive, Japanese spec sheet).
import { SHARED_PHYSICS, type Car } from './types.ts';

export default {
  id: 'gtr', name: 'Nissan GT-R', year: 2017, model: 'car-gtr',
  specs: { engine: '3.8 L twin-turbo V6', gearbox: '6-speed dual-clutch', drive: 'All-wheel drive', cylinders: 6, turbo: true },
  real: { zeroTo100: 2.9, topKmh: 315, brake100: 33 },
  physics: {
    ...SHARED_PHYSICS, wheelbase: 2.78, grip: 13.5, massKg: 1750, powerKw: 419, powerRpm: 6800, torqueNm: 637, redline: 7100,
    gears: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796], finalDrive: 3.7, wheelRadius: 0.354, driveShare: 0.91,
    cdA: 0.86, brakeDecel: 11.7, limiterKmh: 315,
  },
} satisfies Car;
