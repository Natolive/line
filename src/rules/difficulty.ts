import { CARRIAGEWAY_HALF, SCORE_TIERS, TRAFFIC } from '../core/config.ts';

/** How many cars should be around the player after driving `km`. */
export const densityAt = (km: number) =>
  Math.min(TRAFFIC.densityMax, Math.round(TRAFFIC.densityStart + km * TRAFFIC.densityPerKm));

/** True once the car's centre at lateral `x` is past a solid edge line, on the hard shoulder. */
export const onShoulder = (x: number) => Math.abs(x) > CARRIAGEWAY_HALF;

/** Score multiplier for driving at `kmh` at lateral `x`: speed is risk, risk is points; the shoulder pays nothing. */
export const multiplierFor = (kmh: number, x = 0) => onShoulder(x) ? 0 : SCORE_TIERS.find(([min]) => kmh >= min)?.[1] ?? 1;
