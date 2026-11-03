// The garage, in display order. Add a car: one file here, its model in scripts/fetch-assets.mjs,
// and how to read that model in world/vehicles/fleet.ts.
import bmw from './bmw-m4-csl.ts';
import lambo from './lamborghini-veneno.ts';

export type { Car, CarPhysics } from './types.ts';
export const GARAGE = [bmw, lambo];
