// Which theme the road is in, and how far a transition has progressed. Pure, so it is unit-testable.
import { TRANSITION_LENGTH, ZONE_LENGTH } from '../data/themes.ts';

const mod = (a: number, n: number) => ((a % n) + n) % n;

let first = 0; // the theme the start line is in: each run's map starts somewhere else (rules/track.ts setSeed)
export const setFirstTheme = (i: number) => { first = i; };

/** Theme index for a point `d` meters down the road (hard border, used for scenery and ground). */
export const themeIndexAt = (d: number, count: number) => mod(Math.floor(d / ZONE_LENGTH) + first, count);

/** Distance from `d` to the next theme border. */
export const toNextBorder = (d: number) => ZONE_LENGTH - mod(d, ZONE_LENGTH);

/**
 * The two themes the sky and light at `d` sit between, and the blend `t` (0 = `from`, 1 = `to`),
 * eased so the change starts and ends gently. Away from a border, from === to and t = 0.
 */
export function themeBlend(d: number, count: number) {
  const zone = Math.floor(d / ZONE_LENGTH), into = d - zone * ZONE_LENGTH, half = TRANSITION_LENGTH / 2;
  let from = zone, to = zone, t = 0;
  if (into < half && zone > 0) {
    from = zone - 1;
    t = 0.5 + into / TRANSITION_LENGTH;
  } else if (ZONE_LENGTH - into < half) {
    to = zone + 1;
    t = 0.5 - (ZONE_LENGTH - into) / TRANSITION_LENGTH;
  }
  return { from: mod(from + first, count), to: mod(to + first, count), t: t * t * (3 - 2 * t) };
}
