// Toy-model helpers: merging parts into few meshes, and the black cartoon outline around the cars.
// The outline is the classic inverted hull: back faces pushed out along their normals, drawn black.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const OUTLINE = 0.025; // m, thickness of the outline

const ink = new THREE.MeshBasicMaterial({ color: 0x0a0a12, side: THREE.BackSide });
ink.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
    vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
    mvPosition.xyz += normalize( normalMatrix * normal ) * ${OUTLINE.toFixed(3)};
    gl_Position = projectionMatrix * mvPosition;`);
};
ink.customProgramCacheKey = () => 'ink';

/** Outlines every solid mesh under `root` (not lamps, not glass). */
export function outline(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.role) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    if ([mesh.material].flat().some((m) => m.transparent)) continue;
    mesh.add(new THREE.Mesh(mesh.geometry, ink));
  }
  return root;
}

/**
 * Bakes every mesh under `root` (positioned in root's frame) into one mesh per material: a detailed toy costs
 * a few draw calls instead of one per part.
 */
export function merge(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    let g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    if (g.index) g = g.toNonIndexed(); // primitives mix indexed and not: merge them all as triangle lists
    g.clearGroups();
    if (!byMat.has(mesh.material)) byMat.set(mesh.material, []);
    byMat.get(mesh.material)!.push(g);
  });
  return [...byMat].map(([mat, geos]) => new THREE.Mesh(mergeGeometries(geos), mat));
}
