// The road's materials, shared by every piece: flat arcade colours, and the lamps and signs that light up at night.
import * as THREE from 'three';
import { chevronMaterials, tunnelSignMaterial } from './signs.ts';

export function roadPaints() {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xe8e2f2, roughness: 0.8 }), headwall = concrete.clone();
  headwall.side = THREE.DoubleSide; // seen from the approach and, through the mouth, from inside
  return {
    asphalt: new THREE.MeshStandardMaterial({ color: 0x3b3f52, roughness: 0.85 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xffc21a, metalness: 0.2, roughness: 0.5 }), // yellow rails
    steel: new THREE.MeshStandardMaterial({ color: 0xff3d6e, metalness: 0.2, roughness: 0.5 }), // pink gantries, posts, bands
    concrete,
    headwall,
    lamp: new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc070, emissiveIntensity: 3 }), // tunnel lamps, always on
    fan: new THREE.MeshStandardMaterial({ color: 0x8a8f9a, metalness: 0.6, roughness: 0.4 }),
    sos: new THREE.MeshStandardMaterial({ color: 0xff8a1a, emissive: 0xff7a10, emissiveIntensity: 1.2 }), // emergency niches
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2c34, roughness: 0.7 }),
    streetLamp: new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 0.3 }), // lit at night
    tunnelSign: tunnelSignMaterial(),
    chevron: chevronMaterials(),
  };
}
export type RoadPaints = ReturnType<typeof roadPaints>;

/** Lamps and sign faces at night `n` (0 day … 1 night). */
export function lightPaints(p: RoadPaints, n: number) {
  p.chevron.left.emissiveIntensity = p.chevron.right.emissiveIntensity = 0.1 + n * 0.6;
  p.streetLamp.emissiveIntensity = 0.3 + n * 6;
  p.tunnelSign.emissiveIntensity = 0.1 + n * 0.6;
}

/** Materials whose solids cast shadows. */
export const shadowCasters = (p: RoadPaints): THREE.Material[] => [p.metal, p.concrete, p.headwall];
