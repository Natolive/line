// Debris, sparks and camera shake.
import * as THREE from 'three';

const bitGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const mats = new Map<number, THREE.MeshStandardMaterial>();
const glow = (color: number) => {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 })));
  return m;
};

type Bit = { mesh: THREE.Mesh; v: THREE.Vector3; life: number };

export class Effects {
  shake = 0;
  private scene: THREE.Scene;
  private bits: Bit[] = [];
  private bounce = new THREE.Vector3(0.7, -0.35, 0.7);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  burst(at: THREE.Vector3, colors: number[], count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(bitGeo, glow(colors[i % colors.length]));
      mesh.position.copy(at);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).normalize();
      this.scene.add(mesh);
      this.bits.push({ mesh, v: dir.multiplyScalar(power * (0.4 + Math.random())), life: 0.5 + Math.random() * 0.9 });
    }
  }

  /** dz: how far the world scrolled this frame, so debris stays on the road. */
  update(dt: number, dz: number) {
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.bits = this.bits.filter((b) => {
      b.life -= dt;
      b.v.y -= 22 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.position.z += dz;
      if (b.mesh.position.y < 0.07) {
        b.mesh.position.y = 0.07;
        b.v.multiply(this.bounce);
      }
      b.mesh.rotation.x += dt * 8;
      b.mesh.scale.setScalar(Math.min(1, b.life * 2));
      if (b.life > 0) return true;
      this.scene.remove(b.mesh);
      return false;
    });
  }
}
