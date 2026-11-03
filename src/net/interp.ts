// Remote cars, the way racing games draw them: where they are NOW, predicted from their newest report
// (dead reckoning), and when a report proves the guess wrong, the gap fades out over a few frames
// instead of snapping. Cars have so much inertia that a 100 ms guess is rarely off by more than a few cm.
// Pure, so it is unit-testable.

export type Sample = { t: number; d: number; x: number; heading: number; speed: number; steer: number };

/** A remote car: its recent reports, and the correction still being faded out (drawn = predicted + err). */
export type Track = { samples: Sample[]; err: { d: number; x: number; heading: number } };

const MAX_PREDICT = 1000; // ms: past the newest report, keep predicting at most this long, then hold (silent player)
const TREND = 0.25; // s: acceleration and yaw rate are trusted this far ahead; past that, straight on at constant speed
const RATE_WINDOW = 100; // ms of recent reports used for acceleration and yaw rate (short: reacts fast)
const PACE_WINDOW = 300; // ms of recent reports used to measure how fast a car really advances
const MAX_YAW_RATE = 1; // rad/s: a car on a motorway never turns faster; guards against a glitched report
const FADE = 0.1; // s: time constant of the correction fade (~95% gone in 0.3 s)
const SNAP = 5; // m: a correction bigger than this is a teleport (crash, respawn): jump, don't slide

export const track = (): Track => ({ samples: [], err: { d: 0, x: 0, heading: 0 } });

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Cubic between a and b with end slopes ma, mb (per unit k): no kink at each report, unlike a straight line. */
function hermite(a: number, b: number, ma: number, mb: number, k: number) {
  const k2 = k * k, k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * a + (k3 - 2 * k2 + k) * ma + (-2 * k3 + 3 * k2) * b + (k3 - k2) * mb;
}

/**
 * Rate of change at sample i (per ms), from its neighbours (Catmull-Rom). Not the reported speed:
 * a sender below 20 fps clamps its dt, so its reports advance slower than its speedometer says.
 */
function slope(samples: Sample[], i: number, key: 'd' | 'x') {
  const p = samples[Math.max(0, i - 1)], n = samples[Math.min(samples.length - 1, i + 1)];
  return (n[key] - p[key]) / Math.max(1, n.t - p.t);
}

/** The oldest report within `window` ms of the newest (the newest itself if it's alone). */
const since = (samples: Sample[], window: number) => samples.find((s) => s.t >= samples[samples.length - 1].t - window)!;

/**
 * State at time `t`: between two reports, a smooth curve through them; past the newest, a prediction
 * from it with the car's measured acceleration and yaw rate (x moves as speed × sin(heading), as in
 * rules/vehicle.ts).
 */
export function sampleAt(samples: Sample[], t: number): Sample | null {
  if (!samples.length) return null;
  const last = samples[samples.length - 1];
  if (t >= last.t) {
    const from = since(samples, PACE_WINDOW), r = since(samples, RATE_WINDOW);
    // a game below 20 fps clamps its dt: its car covers less road than its speedometer says. Scale by that.
    // (compared with the average reported speed over the same reports, so braking or accelerating doesn't skew it)
    const pace = from === last ? 0 : ((last.d - from.d) * 1000) / (last.t - from.t), dial = (from.speed + last.speed) / 2;
    const scale = from !== last && dial > 1 ? Math.max(0, Math.min(1.2, pace / dial)) : 1;
    const span = (last.t - r.t) / 1000;
    const accel = span > 0 ? (last.speed - r.speed) / span : 0;
    const yawRate = span > 0 ? Math.max(-MAX_YAW_RATE, Math.min(MAX_YAW_RATE, (last.heading - r.heading) / span)) : 0;
    const tau = Math.min(t - last.t, MAX_PREDICT) / 1000, v = last.speed, h = last.heading;
    // the trend (braking, turning) holds for TREND at most, and braking stops at 0 rather than reversing
    const ta = Math.min(tau, TREND, accel < 0 ? v / -accel : Infinity), speed = v + accel * ta, heading = h + yawRate * ta;
    const travel = v * ta + 0.5 * accel * ta * ta + speed * (tau - ta);
    // lateral: integral of v·sin(h + ω·τ), to second order, then straight on
    const lateral = v * (Math.sin(h) * ta + 0.5 * Math.cos(h) * yawRate * ta * ta) + speed * Math.sin(heading) * (tau - ta);
    return { ...last, t, d: last.d + travel * scale, x: last.x + lateral * scale, heading, speed };
  }
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1], b = samples[i];
    if (t >= a.t) {
      const h = Math.max(1, b.t - a.t), k = (t - a.t) / h;
      const curve = (key: 'd' | 'x') => hermite(a[key], b[key], slope(samples, i - 1, key) * h, slope(samples, i, key) * h, k);
      return { t, d: curve('d'), x: curve('x'), heading: lerp(a.heading, b.heading, k), speed: lerp(a.speed, b.speed, k), steer: lerp(a.steer, b.steer, k) };
    }
  }
  return { ...samples[0], t };
}

/** Adds a sample in time order and forgets ones older than one second before it. False if it was dropped. */
export function pushSample(samples: Sample[], s: Sample) {
  if (samples.length && s.t <= samples[samples.length - 1].t) return false; // duplicate or out of order
  samples.push(s);
  while (samples.length > 2 && samples[1].t < s.t - 1000) samples.shift();
  return true;
}

/**
 * A report arrives at time `now`: the prediction jumps to account for it, and that jump becomes a
 * correction that fades out (see `present`), so the drawn car never teleports. Returns the jump (m).
 */
export function addReport(tr: Track, s: Sample, now: number) {
  const before = sampleAt(tr.samples, now);
  if (!pushSample(tr.samples, s) || !before) return 0;
  const after = sampleAt(tr.samples, now)!, dd = before.d - after.d, dx = before.x - after.x;
  tr.err.d += dd;
  tr.err.x += dx;
  tr.err.heading += before.heading - after.heading;
  if (Math.hypot(tr.err.d, tr.err.x) > SNAP) tr.err = { d: 0, x: 0, heading: 0 };
  return Math.hypot(dd, dx);
}

/** Where to draw the car at `now`: its predicted state plus what's left of the last corrections. */
export function present(tr: Track, now: number, dt: number): Sample | null {
  const p = sampleAt(tr.samples, now);
  if (!p) return null;
  const k = Math.exp(-dt / FADE), e = tr.err;
  e.d *= k;
  e.x *= k;
  e.heading *= k;
  return { ...p, d: p.d + e.d, x: p.x + e.x, heading: p.heading + e.heading };
}
