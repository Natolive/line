import { CARRIAGEWAY_HALF, MIRROR, SCORE_TIERS, TRAFFIC } from '../core/config.ts';

/** How many cars should be around the player after driving `km`. */
export const densityAt = (km: number) =>
  Math.min(TRAFFIC.densityMax, Math.round(TRAFFIC.densityStart + km * TRAFFIC.densityPerKm));

/** True once the car's centre at lateral `x` is past a solid edge line, on the hard shoulder. */
export const onShoulder = (x: number) => Math.abs(x) > CARRIAGEWAY_HALF;

/** Score multiplier for driving at `kmh` at lateral `x`: speed is risk, risk is points; the shoulder pays nothing. */
export const multiplierFor = (kmh: number, x = 0) => onShoulder(x) ? 0 : SCORE_TIERS.find(([min]) => kmh >= min)?.[1] ?? 1;

/** A vehicle as the rear-view mirror sees it: road position, lateral position, speed (m/s), size (m), a police car? */
export type Seen = { d: number; x: number; speed: number; w: number; l: number; police?: boolean };

/**
 * What the mirror's frame warns of, for me (`me`) and the vehicles around: `danger` 0..1, how near the closest
 * vehicle behind me, in my path and gaining on me, is (1: touching); `police`, a police car on my tail.
 */
export function mirrorWarning(me: Seen, others: Seen[]) {
  let danger = 0, police = false;
  for (const o of others) {
    const gap = me.d - o.d - (me.l + o.l) / 2;
    if (gap < 0) continue; // ahead of me, or alongside
    if (o.police && gap < MIRROR.policeRange) police = true;
    const inPath = Math.abs(o.x - me.x) < (me.w + o.w) / 2 + 0.3;
    if (inPath && o.speed - me.speed > MIRROR.minClosing && gap < MIRROR.warnGap) danger = Math.max(danger, 1 - gap / MIRROR.warnGap);
  }
  return { danger, police };
}
