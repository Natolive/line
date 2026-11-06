// Worlds that paint every prop in their own colour (candy trees, frozen pines, neon towers).
import * as THREE from 'three';

export class Tinter {
  private cache = new Map<string, THREE.Material>();
  private glowing: Set<THREE.MeshStandardMaterial>;

  /** `glowing`: materials lit at night (windows); their recoloured copies join it. */
  constructor(glowing: Set<THREE.MeshStandardMaterial>) {
    this.glowing = glowing;
  }

  /**
   * Repaints a prop in one colour, keeping its texture's light and shade (and cut-outs). Recoloured materials
   * are shared, one per material and colour.
   */
  recolour(obj: THREE.Object3D, color: number) {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => this.swap(m, color)) : this.swap(mesh.material, color);
    });
  }

  private swap(m: THREE.Material, color: number) {
    const key = `${m.uuid}:${color}`;
    let t = this.cache.get(key);
    if (!t) {
      t = m.clone();
      const tint = new THREE.Color(color);
      t.onBeforeCompile = (shader) => {
        shader.uniforms.tint = { value: tint };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 tint;')
          .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = min(vec3(1.0), dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * 2.2 * tint);');
      };
      t.customProgramCacheKey = () => 'tint';
      if (this.glowing.has(m as THREE.MeshStandardMaterial)) this.glowing.add(t as THREE.MeshStandardMaterial);
      this.cache.set(key, t);
    }
    return t;
  }
}
