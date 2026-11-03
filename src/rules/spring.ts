// Damped spring, used for suspension. Pure, so it is unit-testable.
export type Spring = { x: number; v: number };

/** Moves `s` toward `target`. damping < 1 overshoots (bouncy), 1 settles without overshoot. */
export function stepSpring(s: Spring, target: number, frequencyHz: number, damping: number, dt: number) {
  const w = 2 * Math.PI * frequencyHz;
  s.v += (-w * w * (s.x - target) - 2 * damping * w * s.v) * dt;
  s.x += s.v * dt;
}
