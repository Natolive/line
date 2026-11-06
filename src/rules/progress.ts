// The stretch of road the progress line on the right shows. The whole race would make every dot crawl (5 km on a few
// hundred pixels): the line zooms on the pack instead. Pure, so it is unit-tested.
import { PROGRESS } from '../core/config.ts';

/**
 * Race: all drivers (road positions `ds`) with PROGRESS.pad m of road around them, at least PROGRESS.minSpan m long,
 * never before the start, and stopping just past the finish line `goal` once the pack gets near it.
 */
export function raceWindow(ds: number[], goal: number) {
  const a = Math.min(...ds) - PROGRESS.pad, b = Math.max(...ds) + PROGRESS.pad, span = Math.max(PROGRESS.minSpan, b - a);
  const lo = Math.max(0, Math.min((a + b) / 2 - span / 2, goal + PROGRESS.pad - span));
  return { lo, hi: lo + span };
}

/** Battle royale: from the storm wall to just past the leader. */
export const stormWindow = (ds: number[], wall: number) => ({ lo: wall, hi: Math.max(wall + PROGRESS.minSpan, Math.max(...ds) + PROGRESS.pad) });
