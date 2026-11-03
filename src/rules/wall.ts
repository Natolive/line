// The battle royale wall: a storm that follows the pack and speeds up. Its position depends only on the
// race clock, so every player computes the same wall without sending it over the network.
import { WALL } from '../core/config.ts';

/** Wall speed (m/s) `t` seconds after the start. */
export const wallSpeedAt = (t: number) => Math.min(WALL.maxKmh, WALL.startKmh + Math.max(0, t) * WALL.rampKmhPerSec) / 3.6;

/** Wall position (meters from the start line) `t` seconds after the start: integral of its speed. */
export function wallAt(t: number) {
  if (t <= 0) return WALL.startD;
  const v0 = WALL.startKmh / 3.6, a = WALL.rampKmhPerSec / 3.6, tMax = (WALL.maxKmh - WALL.startKmh) / WALL.rampKmhPerSec;
  if (t <= tMax) return WALL.startD + v0 * t + (a * t * t) / 2;
  return WALL.startD + v0 * tMax + (a * tMax * tMax) / 2 + (WALL.maxKmh / 3.6) * (t - tMax);
}
