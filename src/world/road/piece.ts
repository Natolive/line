// What every part of the road shares: its cross-section sizes, and the context of the 80 m piece being built.
import type * as THREE from 'three';
import { GUARDRAIL_X, ROADSIDE } from '../../core/config.ts';
import type { Structure } from '../../rules/track.ts';
import type { Mesher, Profile } from '../mesher.ts';
import type { PieceFrame } from '../track.ts';

export const RH = GUARDRAIL_X + 0.5; // m, half width of the asphalt, out past the rails
export const C = ROADSIDE.corridor, TH = ROADSIDE.tunnelHalf;
export const VAULT = 4.6; // m: tunnel walls rise straight to VAULT, then arch to tunnelHeight
export const DECK = 1.6; // m, depth of a bridge deck
export const ASPHALT_TILE = 6, LAND_TILE = 12, CONCRETE_TILE = 4; // m per texture tile

export type Mode = 'open' | 'tunnel' | 'bridge';
export const modeOf = (s: Structure | null): Mode => (!s ? 'open' : s.kind === 'tunnel' ? 'tunnel' : 'bridge');

/** Box cross-section, traced so its faces point outward. */
export const box = (xl: number, xr: number, yb: number, yt: number): Profile => [[xl, yt], [xr, yt], [xr, yb], [xl, yb], [xl, yt]];
/** A box cross-section on side `s` (-1 left, 1 right), from `inner` to `outer` m from the centre line. */
export const sideBox = (s: number, inner: number, outer: number, yb: number, yt: number) => (s < 0 ? box(-outer, -inner, yb, yt) : box(inner, outer, yb, yt));

/** The piece being built: its frame, its group, a mesher per material, and its stretches by mode. */
export type Build = {
  pf: PieceFrame;
  group: THREE.Group;
  d0: number;
  d1: number;
  mesher: (mat: THREE.Material) => Mesher;
  /** Rows of each stretch where `want(mode)` holds, as lists of road positions. */
  runs: (want: (m: Mode) => boolean) => number[][];
  /** Texture v at the start of a stretch, continuous from piece to piece. */
  v0: (rows: number[]) => number;
  land: THREE.Material;
  blend: (d: number) => number;
};

/** Road positions every `step` m inside [from, to). */
export function every(step: number, from: number, to: number, offset = 0) {
  const out: number[] = [];
  for (let d = Math.ceil((from - offset) / step) * step + offset; d < to; d += step) out.push(d);
  return out;
}
