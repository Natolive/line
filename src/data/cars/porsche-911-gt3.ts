// Porsche 911 GT3 (992, 2021), PDK. Figures: Porsche technical data (PDK ratios and final drive from its spec sheet).
import { SHARED_PHYSICS, type Car } from './types.ts';

export default {
  id: 'porsche', name: 'Porsche 911 GT3', year: 2021, model: 'car-porsche',
  specs: { engine: '4.0 L naturally aspirated flat-6', gearbox: '7-speed PDK', drive: 'Rear-wheel drive', cylinders: 6, turbo: false },
  real: { zeroTo100: 3.4, topKmh: 318, brake100: 31 },
  physics: {
    ...SHARED_PHYSICS, wheelbase: 2.457, grip: 14, massKg: 1435, powerKw: 375, powerRpm: 8400, torqueNm: 470, redline: 9000,
    gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], finalDrive: 4.19, wheelRadius: 0.361, driveShare: 0.67,
    cdA: 0.75, brakeDecel: 12.4, limiterKmh: 318,
  },
} satisfies Car;
