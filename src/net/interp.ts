// Snapshot interpolation: remote cars are drawn a little in the past, between two real reports,
// so late packets never make them stutter. Pure, so it is unit-testable.

export type Sample = { t: number; d: number; x: number; heading: number; speed: number; steer: number };

/** How far in the past remote cars are drawn (ms), at least: ~3 server ticks of margin against jitter. */
export const INTERP_DELAY = 100;
const MAX_DELAY = 300; // ms: past this, a laggy player is extrapolated rather than delaying everyone more
const DELAY_MARGIN = 20; // ms kept above the latest report seen recently
const PEAK_DECAY = 20; // ms per second: how fast the worst recent lateness is forgotten
const WARP = 0.1; // the render clock runs at most 10% fast or slow while the delay adapts: unnoticeable

/**
 * Jitter buffer: `peak` is the worst lateness (render clock − report time) seen recently, decaying slowly;
 * the delay eases toward it plus a margin, so reports are almost always in hand before they're drawn
 * (interpolation), yet a good connection keeps the delay low.
 */
export function adaptDelay(delay: number, peak: number, dt: number) {
  const want = Math.min(MAX_DELAY, Math.max(INTERP_DELAY, peak + DELAY_MARGIN)), step = dt * 1000 * WARP;
  return { delay: delay + Math.max(-step, Math.min(step, want - delay)), peak: Math.max(0, peak - dt * PEAK_DECAY) };
}
const MAX_EXTRAPOLATE = 250; // ms: past the newest report, keep driving straight for at most this long
const PACE_WINDOW = 300; // ms of recent reports used to measure how fast a car really advances

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

/** State at time `t` from samples sorted by time: interpolated between neighbours, or extrapolated a little. */
export function sampleAt(samples: Sample[], t: number): Sample | null {
  if (!samples.length) return null;
  const last = samples[samples.length - 1];
  if (t >= last.t) {
    // extrapolate at the pace the reports actually advance, not the reported speed: a game below 20 fps
    // clamps its dt, so its car covers less road than its speedometer says, and each report would snap it back
    const from = samples.find((s) => s.t >= last.t - PACE_WINDOW)!;
    const pace = from === last ? last.speed : ((last.d - from.d) * 1000) / (last.t - from.t);
    const ahead = Math.min(t - last.t, MAX_EXTRAPOLATE) / 1000;
    return { ...last, t, d: last.d + pace * ahead };
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

/** Adds a sample in time order and forgets ones older than one second before it. */
export function pushSample(samples: Sample[], s: Sample) {
  if (samples.length && s.t <= samples[samples.length - 1].t) return; // duplicate or out of order
  samples.push(s);
  while (samples.length > 2 && samples[1].t < s.t - 1000) samples.shift();
}
