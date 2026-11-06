// Sky, sun, ambient light, fog and reflections, blended between two themes. Arcade skies: a painted gradient,
// a big sun disc and stars, no photos. Reflections on the cars are rendered from that same sky.
import * as THREE from 'three';
import { THEMES, type Theme } from '../data/themes.ts';

const domeShader = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 top, horizon, sunColor, sunDir, fogColor;
    uniform float stars;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 sky = mix(horizon, top, pow(max(d.y, 0.0), 0.55));
      float s = dot(d, sunDir);
      sky += sunColor * (smoothstep(0.9965, 0.998, s) * 3.0 + pow(max(s, 0.0), 24.0) * 0.5);
      vec3 cell = floor(d * 260.0);
      float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      sky += stars * step(0.996, r) * smoothstep(0.04, 0.3, d.y);
      // the low sky dissolves into the fog colour, so far-away scenery fades into the horizon instead of popping in
      sky = mix(sky, fogColor, smoothstep(0.12, 0.0, d.y));
      gl_FragColor = vec4(sky, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const UP = new THREE.Vector3(0, 1, 0);
const TUNNEL_GLOW = 0xffc98a; // sodium-ish tunnel lamps

/** Where theme `t`'s sun is before the road turns it (azimuth 0: straight down the road, -z). */
const sunDir = (t: Theme) => {
  const { elevation: e, azimuth: a } = t.sun;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
};

const domeMaterial = () =>
  new THREE.ShaderMaterial({
    ...domeShader,
    uniforms: {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() }, fogColor: { value: new THREE.Color() }, stars: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
  });
type Uniforms = ReturnType<typeof domeMaterial>['uniforms'];

const c = new THREE.Color();
/** Paints the sky between themes `a` and `b` (t: 0 → a, 1 → b). */
function paintSky(u: Uniforms, a: Theme, b: Theme, t: number) {
  u.top.value.set(a.sky.top).lerp(c.set(b.sky.top), t);
  u.horizon.value.set(a.sky.horizon).lerp(c.set(b.sky.horizon), t);
  u.sunColor.value.set(a.sun.color).lerp(c.set(b.sun.color), t);
  u.sunDir.value.copy(sunDir(a)).lerp(sunDir(b), t).normalize();
  u.stars.value = lerp(a.stars, b.stars, t);
  u.fogColor.value.copy(u.horizon.value);
}

export class Environment {
  /** 0 = day, 1 = night. Drives street lamps, lit windows and headlights. */
  night = 0;
  readonly sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  private dome: THREE.Mesh<THREE.SphereGeometry, ReturnType<typeof domeMaterial>>;
  private envs: Record<string, THREE.Texture> = {};
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private fog = new THREE.Fog(0xffffff, 60, 600);

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    // each theme's reflections: its own sky, rendered once into an environment map
    const pmrem = new THREE.PMREMGenerator(renderer), probe = new THREE.Scene(), ball = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), domeMaterial());
    probe.add(ball);
    for (const t of THEMES) {
      paintSky(ball.material.uniforms, t, t, 0);
      this.envs[t.id] = pmrem.fromScene(probe, 0, 0.1, 200).texture;
    }
    pmrem.dispose();

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), domeMaterial());
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;

    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0004;
    Object.assign(s.shadow.camera, { left: -30, right: 30, top: 40, bottom: -40, near: 1, far: 300 });
    scene.add(this.dome, s, s.target, this.hemi);
    scene.fog = this.fog;
  }

  /**
   * Blends everything between theme `a` and `b` (t: 0 → a, 1 → b). `heading` is the road's direction where
   * the view is (the sky and sun stay put while the road turns under them); `shade` 0..1 is how deep in a
   * tunnel the view is: daylight gives way to the warm light of its lamps.
   */
  apply(a: Theme, b: Theme, t: number, camera: THREE.Camera, playerX: number, heading = 0, shade = 0) {
    const u = this.dome.material.uniforms;
    paintSky(u, a, b, t);
    this.dome.position.copy(camera.position);
    this.dome.rotation.y = heading;
    this.scene.environmentRotation.y = heading;

    this.scene.environment = this.envs[(t < 0.5 ? a : b).id];
    this.scene.environmentIntensity = 1 - 0.8 * shade;
    this.renderer.toneMappingExposure = lerp(a.exposure, b.exposure, t);
    this.night = lerp(a.night, b.night, t);

    // fog takes the colour of the horizon, so the ground melts into the sky
    this.fog.color.copy(u.horizon.value).lerp(c.set(TUNNEL_GLOW).multiplyScalar(0.25), shade * 0.6);
    this.fog.near = lerp(a.fog.near, b.fog.near, t);
    this.fog.far = lerp(a.fog.far, b.fog.far, t);

    // light comes from the painted sun (kept a little above the horizon so shadows stay readable)
    const dir = u.sunDir.value.clone();
    dir.y = Math.max(dir.y, 0.25);
    dir.normalize().applyAxisAngle(UP, heading);
    this.sun.intensity = lerp(a.sun.intensity, b.sun.intensity, t) * (1 - shade);
    this.sun.color.copy(u.sunColor.value);
    this.sun.target.position.set(playerX, 0, -15);
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 150);

    this.hemi.intensity = lerp(lerp(a.ambient, b.ambient, t), 0.5, shade);
    this.hemi.color.copy(u.top.value).lerp(u.horizon.value, 0.6).lerp(c.set(TUNNEL_GLOW), shade);
    this.hemi.groundColor.set(a.ground).lerp(c.set(b.ground), t).multiplyScalar(0.5);
  }
}
