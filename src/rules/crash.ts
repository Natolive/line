// The wreck after a crash: it slides on, spins, and at speed rolls over, bouncing until friction stops it
// on its wheels or its roof. Pure (no three, randomness injected), so it is unit-testable.
import { CRASH, GUARDRAIL_X } from '../core/config.ts';

const G = 9.81;

/**
 * s: meters slid down the road since the impact (+ = forward). x: lateral (+ = right). y: height of the car's
 * base (its floor when upright). yaw: heading (+ = right). roll: about the car's long axis. w, h: body size (m).
 */
export type Wreck = {
  x: number; s: number; y: number;
  vx: number; vs: number; vy: number;
  yaw: number; yawRate: number;
  roll: number; rollRate: number;
  w: number; h: number;
};

/** What happened this step, for sparks, dust and sounds. */
export type WreckEvents = { landed: boolean; scrape: boolean; rail: boolean };

/** How violent a crash at `speed` is: 0 at a standstill, 1 at CRASH.fullSpeed, 2 at most. */
export const crashSeverity = (speed: number) => Math.min(2, Math.max(0, speed / CRASH.fullSpeed));

export function startWreck(x: number, heading: number, speed: number, w: number, h: number, rand = Math.random): Wreck {
  const v = speed * CRASH.keep, side = rand() < 0.5 ? -1 : 1;
  const k = crashSeverity(speed), over = Math.min(2, Math.max(0, (speed - CRASH.rollSpeed) / (CRASH.fullSpeed - CRASH.rollSpeed)));
  return {
    x, s: 0, y: 0,
    vx: side * v * CRASH.sideKick, vs: v, vy: CRASH.launch * over * (0.8 + 0.4 * rand()),
    yaw: heading, yawRate: side * CRASH.spin * k * (0.7 + 0.6 * rand()),
    roll: 0, rollRate: side * CRASH.rollRate * over * (0.8 + 0.4 * rand()),
    w, h,
  };
}

/** A body on the road: `d` meters from the start, `speed` m/s forward, `l` meters long. */
export type Body = { d: number; speed: number; l: number };

/**
 * The wreck and a car it touches: if the one behind is closing in, both end up at their shared speed (equal masses,
 * the bodies crumple: no bounce) and the one behind is pushed back out of the one in front. In place.
 */
export function shunt(a: Body, b: Body) {
  const [back, front] = a.d < b.d ? [a, b] : [b, a];
  if (back.speed <= front.speed) return;
  back.speed = front.speed = (back.speed + front.speed) / 2;
  back.d = Math.min(back.d, front.d - (back.l + front.l) / 2);
}

/** Base height that puts the lowest corner of the body's cross-section on the ground, at this roll. */
export const groundLift = (w: number, h: number, roll: number) => {
  const s = Math.sin(roll), c = Math.cos(roll);
  return -Math.min(...[-w / 2, w / 2].flatMap((x) => [x * s, x * s + h * c]));
};

/** Advances the wreck `dt` seconds (in place). */
export function stepWreck(c: Wreck, dt: number): WreckEvents {
  const ev = { landed: false, scrape: false, rail: false };
  c.vy -= G * dt;
  c.x += c.vx * dt;
  c.s += c.vs * dt;
  c.y += c.vy * dt;
  c.yaw += c.yawRate * dt;
  c.roll += c.rollRate * dt;

  const lift = groundLift(c.w, c.h, c.roll);
  if (c.y < lift) {
    if (c.vy < -CRASH.landingSpeed) {
      ev.landed = true;
      c.vy = -c.vy * CRASH.bounce;
      c.rollRate *= 0.7;
      c.yawRate *= 0.8;
    } else c.vy = 0;
    c.y = lift;
  }
  const grounded = c.y <= lift + 0.02, speed = Math.hypot(c.vx, c.vs);
  if (grounded) {
    // sliding friction on tyres, body or roof
    const k = speed > 0 ? Math.max(0, speed - CRASH.friction * G * dt) / speed : 0;
    c.vx *= k;
    c.vs *= k;
    c.yawRate *= Math.exp(-CRASH.spinDamp * dt);
    c.rollRate *= Math.exp(-CRASH.rollDamp * dt);
    // too slow to tip over again: settle on the wheels or the roof, whichever is nearer
    if (Math.abs(c.rollRate) < CRASH.settleRate) c.rollRate = (Math.round(c.roll / Math.PI) * Math.PI - c.roll) * 5;
    ev.scrape = speed > 2 && Math.cos(c.roll) < 0.9;
  }
  const limit = GUARDRAIL_X - c.w / 2;
  if (Math.abs(c.x) > limit) {
    c.x = Math.sign(c.x) * limit;
    c.vx = -c.vx * 0.3;
    c.vs *= 0.8;
    ev.rail = true;
  }
  return ev;
}
