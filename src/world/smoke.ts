// Soft smoke puffs (exhaust, tyre smoke, crash smoke) from a fixed pool of sprites.
import * as THREE from 'three';

/** Round soft-edged dot, shared by smoke and light glows. */
export const softDot = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

type Puff = { sprite: THREE.Sprite; v: THREE.Vector3; life: number; max: number; size: number; grow: number; alpha: number };
export type PuffOptions = { color: number; size: number; grow: number; life: number; alpha: number; velocity: THREE.Vector3 };

const POOL = 160; // ponytail: fixed pool, oldest puff is recycled when full

export class Smoke {
  private puffs: Puff[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, v: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 0, alpha: 0 });
    }
  }

  emit(at: THREE.Vector3, o: PuffOptions) {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % POOL;
    p.sprite.position.copy(at);
    p.sprite.material.color.setHex(o.color);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
    p.v.copy(o.velocity);
    p.life = p.max = o.life * (0.8 + Math.random() * 0.4);
    p.size = o.size;
    p.grow = o.grow;
    p.alpha = o.alpha;
  }

  /** dz: how far the world scrolled this frame; smoke stays where it was puffed out. */
  update(dt: number, dz: number) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const t = 1 - p.life / p.max; // 0 → 1 over the puff's life
      p.v.multiplyScalar(1 - Math.min(1, dt * 1.5)); // air drag
      p.sprite.position.addScaledVector(p.v, dt);
      p.sprite.position.y += dt * 0.4; // warm gas rises
      p.sprite.position.z += dz;
      p.sprite.scale.setScalar(p.size + p.grow * t);
      p.sprite.material.opacity = p.alpha * (1 - t) * Math.min(1, t * 8);
    }
  }
}
