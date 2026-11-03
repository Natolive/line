import { SCORE_TIERS, TRAFFIC } from '../core/config.ts';

/** How many cars should be around the player after driving `km`. */
export const densityAt = (km: number) =>
  Math.min(TRAFFIC.densityMax, Math.round(TRAFFIC.densityStart + km * TRAFFIC.densityPerKm));

/** Score multiplier for driving at `kmh`: speed is risk, risk is points. */
export const multiplierFor = (kmh: number) => SCORE_TIERS.find(([min]) => kmh >= min)?.[1] ?? 1;
