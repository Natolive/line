// What a knock does: two cars (or a car and a rail) meet, swap momentum along the contact, and each is jolted
// by its change of speed. A light jolt scrapes paint, a harder one damages the car, a violent one wrecks it.
// Pure, so it is unit-testable. Road plane: x right, z back (forward is -z), as in rules/collision.ts.
import { IMPACT } from '../core/config.ts';
import { contact, type Rect } from './collision.ts';

/** A car as an impact sees it: where it is, its velocity (m/s, x right, z back) and its mass (kg). */
export type Moving = { rect: Rect; vx: number; vz: number; mass: number };

export type Hit = {
  normal: [number, number]; // from b to a
  depth: number; // m of overlap, to push them apart
  dva: [number, number]; // a's change of velocity (m/s)
  dvb: [number, number];
  jolt: number; // km/h: a's change of speed
  damage: number; // % added to a
  wreck: boolean; // a is wrecked
  spin: number; // rad/s of yaw given to a (+ = turning right): pushed off its centre, it turns
};

/** Mass of a vehicle of footprint w × l (m). */
export const massOf = (w: number, l: number) => w * l * IMPACT.massPerM2;

/** Damage (%) from a jolt of `kmh`: none below a scratch, growing with its square (energy), 100 % from `wreckKmh`. */
export function joltDamage(kmh: number, wreckKmh = IMPACT.wreckKmh) {
  if (kmh <= IMPACT.scratchKmh) return 0;
  if (kmh >= wreckKmh) return 100;
  return IMPACT.damageAtWreck * ((kmh - IMPACT.scratchKmh) / (wreckKmh - IMPACT.scratchKmh)) ** 2;
}

/** How `a` and `b` knock each other, if they touch. Momentum is shared out by mass; only `a`'s damage is judged. */
export function impact(a: Moving, b: Moving): Hit | null {
  const c = contact(a.rect, b.rect);
  if (!c) return null;
  const [nx, nz] = c.normal;
  const closing = -((a.vx - b.vx) * nx + (a.vz - b.vz) * nz); // > 0: a is moving into b
  const j = closing > 0 ? ((1 + IMPACT.restitution) * closing) / (1 / a.mass + 1 / b.mass) : 0;
  const dva: [number, number] = [(nx * j) / a.mass, (nz * j) / a.mass], dvb: [number, number] = [(-nx * j) / b.mass, (-nz * j) / b.mass];
  const jolt = Math.hypot(...dva) * 3.6, damage = joltDamage(jolt);
  // the push lands halfway between the two centres; off a's centre it turns a (torque = r × impulse)
  const rx = (b.rect.x - a.rect.x) / 2, rz = (b.rect.z - a.rect.z) / 2, inertia = (a.mass * (a.rect.l ** 2 + a.rect.w ** 2)) / 12;
  const spin = (rx * dva[1] * a.mass - rz * dva[0] * a.mass) / inertia;
  return { normal: c.normal, depth: c.depth, dva, dvb, jolt, damage, wreck: damage >= 100, spin };
}

/**
 * A car meeting a rail: `into` is its speed toward the rail (m/s, its speed × the sine of its angle to it).
 * The rail doesn't move; it gives a little, so it takes a harder jolt to wreck against it than against a car.
 */
export function railImpact(into: number) {
  const dv = into > 0 ? (1 + IMPACT.railRestitution) * into : 0, jolt = dv * 3.6;
  const damage = joltDamage(jolt, IMPACT.railWreckKmh);
  return { dv, jolt, damage, wreck: damage >= 100 };
}

/** What damage does to the car: share of power left, steering pull (share of full lock), and whether it smokes. */
export function damageEffects(damage: number) {
  const limp = Math.max(0, Math.min(1, (damage - IMPACT.limpAt) / (100 - IMPACT.limpAt)));
  return { power: 1 - limp * (1 - IMPACT.limpPower), pull: limp * IMPACT.limpPull, smoke: damage >= IMPACT.smokeAt };
}
