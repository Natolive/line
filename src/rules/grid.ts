// The starting grid of an online race: where each player stands when the lights come on. Pure, so it is unit-tested.
import { LANES, START } from '../core/config.ts';

/** Grid slot `i` (the server's grid order): four abreast, one per lane, rows `START.rowGap` apart behind the line. */
export const gridSlot = (i: number) => ({ d: 0 - Math.floor(i / LANES.length) * START.rowGap, x: LANES[i % LANES.length] });
