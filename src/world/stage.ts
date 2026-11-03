// Renderer and chase camera. Sky, sun and fog live in environment.ts.
import * as THREE from 'three';

const FOV = 58, FOV_BOOST = 14; // camera widens with speed

export class Stage {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 6000);
  private chase = { x: 0, heading: 0, back: 7, height: 2.3 };
  private look = new THREE.Vector3();

  constructor(root: HTMLElement) {
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    root.appendChild(r.domElement);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    this.renderer.setSize(w, h);
    this.camera.aspect = aspect;
    // Portrait screens: pull back so the road around you stays in view.
    const k = Math.max(1, 0.9 / aspect);
    this.chase.back = 7 * k;
    this.chase.height = 2.3 * k;
    this.camera.updateProjectionMatrix();
  }

  /** Third-person camera that lags behind the car's position and heading. */
  follow(x: number, heading: number, speedRatio: number, dt: number) {
    const c = this.chase, cam = this.camera;
    c.heading += (heading - c.heading) * Math.min(1, dt * 3);
    c.x += (x - c.x) * Math.min(1, dt * 6);
    const h = c.heading * 0.6; // swing only part of the way, it reads better
    cam.position.set(c.x - Math.sin(h) * c.back, c.height, Math.cos(h) * c.back);
    this.look.set(c.x + Math.sin(h) * 14, 1.0, -14 * Math.cos(h));
    cam.lookAt(this.look);
    cam.fov = FOV + speedRatio * FOV_BOOST;
    cam.updateProjectionMatrix();
  }

  /** Slow orbit around the car for menus. */
  orbit(t: number, x: number) {
    const a = t * 0.25, cam = this.camera;
    this.chase.x = x;
    this.chase.heading = 0;
    cam.position.set(x + Math.sin(a) * 7.5, 2.2, Math.cos(a) * 7.5);
    cam.lookAt(x, -0.5, 0); // aim below the car so it sits above the garage card
    cam.fov = FOV;
    cam.updateProjectionMatrix();
  }

  render(shake: number) {
    const p = this.camera.position;
    const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
    p.x += jx;
    p.y += jy;
    this.renderer.render(this.scene, this.camera);
    p.x -= jx;
    p.y -= jy;
  }
}
