// Renderer and chase camera. Sky, sun and fog live in environment.ts.
import * as THREE from 'three';

const FOV = 58, FOV_BOOST = 14; // camera widens with speed

// Cel shading for every lit material: sunlight falls in two flat bands (lit, shade) instead of a smooth falloff.
const chunk = THREE.ShaderChunk.lights_physical_pars_fragment, smoothLight = 'vec3 irradiance = dotNL * directLight.color;';
if (!chunk.includes(smoothLight)) throw new Error('three.js lighting changed: update the cel shading in stage.ts');
THREE.ShaderChunk.lights_physical_pars_fragment = chunk.replace(smoothLight, 'vec3 irradiance = mix(0.3, 1.0, smoothstep(0.18, 0.24, dotNL)) * step(0.0001, dotNL) * directLight.color;');

export class Stage {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 6000);
  private chase = { x: 0, heading: 0, back: 7, height: 2.3 };
  private look = new THREE.Vector3();
  private want = new THREE.Vector3();
  // rear-view mirror: rendered into a texture, then drawn flipped (as a mirror is) into the glass
  private mirrorRT = new THREE.WebGLRenderTarget(1, 1);
  private overlay = new THREE.Scene();
  private overlayCam = new THREE.OrthographicCamera(0, 1, 0, -1, -1, 1); // CSS pixels, y down
  private glass: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private mask = document.createElement('canvas'); // rounded corners of the glass, as an alpha map
  private maskKey = '';
  private mirrorFrame = 0;

  constructor(root: HTMLElement) {
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NeutralToneMapping; // keeps colours saturated, unlike ACES
    root.appendChild(r.domElement);
    const map = this.mirrorRT.texture;
    map.repeat.x = -1; // left-right flip
    map.offset.x = 1;
    const alphaMap = new THREE.CanvasTexture(this.mask);
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map, alphaMap, transparent: true, depthTest: false }));
    this.overlay.add(this.glass);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    this.renderer.setSize(w, h);
    Object.assign(this.overlayCam, { right: w, bottom: -h });
    this.overlayCam.updateProjectionMatrix();
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

  /** Crash camera: hangs back and swings round to keep the tumbling wreck in frame. */
  watch(target: THREE.Vector3, dt: number) {
    const cam = this.camera;
    this.want.set(target.x * 0.6 + 3, 2.6, target.z + 8);
    cam.position.lerp(this.want, 1 - Math.exp(-dt * 5));
    this.look.lerp(target, Math.min(1, dt * 8));
    cam.lookAt(this.look);
    cam.fov += (FOV - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
    this.chase.x = target.x;
    this.chase.heading = 0;
  }

  /** Slow orbit around the car (at x, z) for menus. */
  orbit(t: number, x: number, z = 0) {
    const a = t * 0.25, cam = this.camera;
    this.chase.x = x;
    this.chase.heading = 0;
    cam.position.set(x + Math.sin(a) * 7.5, 2.2, z + Math.cos(a) * 7.5);
    cam.lookAt(x, -0.5, z); // aim below the car so it sits above the garage card
    cam.fov = FOV;
    cam.updateProjectionMatrix();
  }

  /** Draws the frame; `mirror`, if given, is the rear-view camera and where its glass is on screen (CSS pixels). */
  render(shake: number, mirror: { camera: THREE.PerspectiveCamera; rect: { x: number; y: number; w: number; h: number; radius: number } } | null = null) {
    const r = this.renderer, p = this.camera.position;
    const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
    p.x += jx;
    p.y += jy;
    r.render(this.scene, this.camera);
    p.x -= jx;
    p.y -= jy;
    if (!mirror || mirror.rect.w < 1) return;

    // ponytail: a second full scene render; at 1× resolution and every other frame it costs ~half. Cull scenery by distance if it still bites.
    const { camera, rect } = mirror, pr = 1;
    const tw = Math.round(rect.w * pr), th = Math.round(rect.h * pr);
    if (this.mirrorRT.width !== tw || this.mirrorRT.height !== th) this.mirrorRT.setSize(tw, th);
    if (camera.aspect !== rect.w / rect.h) {
      camera.aspect = rect.w / rect.h;
      camera.updateProjectionMatrix();
    }
    if (this.mirrorFrame++ % 2 === 0) {
      r.shadowMap.autoUpdate = false; // the main view just drew the shadows
      r.setRenderTarget(this.mirrorRT);
      r.render(this.scene, camera);
      r.setRenderTarget(null);
      r.shadowMap.autoUpdate = true;
    }
    const key = `${tw}x${th}r${rect.radius}`;
    if (key !== this.maskKey) {
      this.maskKey = key;
      Object.assign(this.mask, { width: tw, height: th });
      const g = this.mask.getContext('2d')!;
      g.fillStyle = '#fff';
      g.beginPath();
      g.roundRect(0, 0, tw, th, rect.radius * pr);
      g.fill();
      this.glass.material.alphaMap!.needsUpdate = true;
    }
    this.glass.scale.set(rect.w, rect.h, 1);
    this.glass.position.set(rect.x + rect.w / 2, -(rect.y + rect.h / 2), 0);
    r.autoClear = false;
    r.render(this.overlay, this.overlayCam);
    r.autoClear = true;
  }
}
