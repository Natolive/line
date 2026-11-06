// Afloat or on the shore: boats, buoys, a lighthouse.
import * as THREE from 'three';
import { part, block, post, ball, cone, turn, prop, rock, BARK, WHITE, DARK, GLASS } from './toy.ts';

/** Hull, `l` m long along z: a box with a wedge bow, `c` the topsides, white deck. */
function hull(l: number, w: number, c: number) {
  // a triangular prism, point forward (-z): spans z -r..r/2, squashed to l/4
  const r = w / Math.sqrt(3), k = (l * 0.25) / (1.5 * r), bow = new THREE.CylinderGeometry(r, r, 1, 3).rotateY(Math.PI).scale(1, 1, k).translate(0, 0.5, 0);
  return [block(w, 1, l * 0.75, c, 0, 0, l * 0.125), part(bow, c, 0, 0, -l * 0.25 - (r / 2) * k), block(w - 0.2, 0.1, l * 0.7, WHITE, 0, 1, l * 0.13)];
}

/** Boats afloat (waterline at 0.4 m): a sailing boat, a rowing boat, a little motor launch with a cabin. */
export function boat(i: number) {
  if (i === 0) {
    const sail = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 1.6, 0.6, 0, 10.5, 0.5, 0, 1.6, 3.2, 0, 8.5, 0.2, 0, 1.4, 0.1, 0, 1.4, -3.2], 3));
    sail.computeVertexNormals();
    const cloth = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
    return prop(...hull(7, 2.2, 0x2a6bff), post(0.07, 0.07, 10, 0xcfd2dc, 0, 1, 0.4, 5), part(sail, cloth), block(0.8, 0.5, 1.4, 0xffc21a, 0, 1, 2));
  }
  if (i === 1) return prop(...hull(3.5, 1.3, 0xd8342a), block(1.3, 0.1, 0.3, BARK, 0, 0.8, 0.3), turn(block(0.08, 0.06, 2.6, BARK, 0.9, 0.8, 0.2), 0, 0.4, 0.1));
  return prop(...hull(6, 2.2, WHITE), block(1.8, 1.2, 2, 0xff3a5a, 0, 1, 0.6), block(1.82, 0.5, 1.6, GLASS, 0, 1.5, 0.5), block(2, 0.15, 2.4, WHITE, 0, 2.2, 0.6), block(0.5, 0.8, 0.6, DARK, 0, 0.6, 3.1));
}

/** Navigation buoy, 2 m above the water: red cylinder or green cone, a light on top. */
export function buoy(i: number) {
  const c = i ? 0x2ac87a : 0xff3a3a;
  return prop(post(0.6, 0.6, 1.2, c, 0, 0, 0, 10), post(0.62, 0.62, 0.2, WHITE, 0, 0.9, 0, 10), i ? cone(0.45, 1, c, 0, 1.2, 0, 8) : post(0.35, 0.35, 0.9, c, 0, 1.2, 0, 8), ball(0.15, 0xffe08a, 0, 2.2, 0));
}

/** Lighthouse, ~22 m: a rock base, a striped tapering tower, a gallery and a glowing lantern under a red dome. */
export function lighthouse() {
  const parts: THREE.Object3D[] = [rock(4, 21, 0x9a9aa8, 0, 0.5, 0, 0.5), post(3, 3, 1.5, 0xcfd2dc, 0, 1, 0, 12)];
  for (let k = 0; k < 5; k++) parts.push(post(2.2 - k * 0.2, 2 - k * 0.2, 3.4, k % 2 ? WHITE : 0xff3a3a, 0, 2.5 + k * 3.4, 0, 12));
  parts.push(post(1.8, 1.8, 0.3, DARK, 0, 19.5, 0, 12), post(0.9, 0.9, 1.8, 0xffe08a, 0, 19.8, 0, 10), part(new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xff3a3a, 0, 21.6, 0));
  for (let k = 0; k < 3; k++) parts.push(block(0.5, 0.8, 0.1, GLASS, 0, 5 + k * 4.5, 2.1 - k * 0.3));
  return prop(...parts);
}
