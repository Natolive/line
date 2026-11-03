// Snapshot interpolation: remote cars are drawn a little in the past, between two real reports,
// so late packets never make them stutter. Pure, so it is unit-testable.

export type Sample = { t: number; d: number; x: number; heading: number; speed: number; steer: number };

/** How far in the past remote cars are drawn (ms): ~3 server ticks of margin against jitter. */
export const INTERP_DELAY = 100;
const MAX_EXTRAPOLATE = 250; // ms: past the newest report, keep driving straight for at most this long
const PACE_WINDOW = 300; // ms of recent reports used to measure how fast a car really advances

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

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
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      return { t, d: lerp(a.d, b.d, k), x: lerp(a.x, b.x, k), heading: lerp(a.heading, b.heading, k), speed: lerp(a.speed, b.speed, k), steer: lerp(a.steer, b.steer, k) };
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
