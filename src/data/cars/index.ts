// The garage, in display order. Add a car: one file here and its toy design in world/vehicles/fleet.ts.
import bmw from './bmw-m4-csl.ts';
import f40 from './ferrari-f40.ts';
import mustang from './ford-mustang-shelby-gt500.ts';
import lambo from './lamborghini-veneno.ts';
import gtr from './nissan-gt-r.ts';
import porsche from './porsche-911-gt3.ts';

export type { Car, CarPhysics } from './types.ts';
export const GARAGE = [bmw, porsche, gtr, mustang, f40, lambo];
