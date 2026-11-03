// Sky, sun, ambient light, fog and reflections, blended between two themes.
import * as THREE from 'three';
import type { Theme } from '../data/themes.ts';
import type { World } from './assets.ts';

// Sky dome that crossfades two HDRI photos. Uses three.js's own equirect mapping so the sky
// lines up with the reflections (scene.environment) and the sun direction read from the photo.
const domeShader = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D skyA, skyB;
    uniform float blend, gainA, gainB;
    uniform vec3 fogColor;
    varying vec3 vDir;
    vec2 equirect(vec3 d) { return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }
    void main() {
      vec3 d = normalize(vDir);
      vec2 uv = equirect(d);
      vec3 sky = mix(texture2D(skyA, uv).rgb * gainA, texture2D(skyB, uv).rgb * gainB, blend);
      // the low sky dissolves into the fog colour, so far-away scenery fades into the horizon instead of popping in
      sky = mix(sky, fogColor, smoothstep(0.14, 0.0, d.y));
      gl_FragColor = vec4(sky, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Environment {
  /** 0 = day, 1 = night. Drives street lamps, lit windows and headlights. */
  night = 0;
  readonly sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private envs: Record<string, THREE.Texture> = {};
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private world: World;
  private fog = new THREE.Fog(0xffffff, 60, 600);
  private c = new THREE.Color();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, world: World) {
    this.scene = scene;
    this.renderer = renderer;
    this.world = world;
    const pmrem = new THREE.PMREMGenerator(renderer);
    for (const [id, sky] of Object.entries(world.skies)) this.envs[id] = pmrem.fromEquirectangular(sky.texture).texture;
    pmrem.dispose();

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 48, 24),
      new THREE.ShaderMaterial({
        ...domeShader,
        uniforms: { skyA: { value: null }, skyB: { value: null }, blend: { value: 0 }, gainA: { value: 1 }, gainB: { value: 1 }, fogColor: { value: new THREE.Color() } },
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: true,
      }),
    );
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

  /** Blends everything between theme `a` and `b` (t: 0 → a, 1 → b). */
  apply(a: Theme, b: Theme, t: number, camera: THREE.Camera, playerX: number) {
    const skyA = this.world.skies[a.sky], skyB = this.world.skies[b.sky];
    const u = this.dome.material.uniforms;
    u.skyA.value = skyA.texture;
    u.skyB.value = skyB.texture;
    u.blend.value = t;
    u.gainA.value = a.skyGain;
    u.gainB.value = b.skyGain;
    this.dome.position.copy(camera.position);

    this.scene.environment = this.envs[t < 0.5 ? a.sky : b.sky];
    this.scene.environmentIntensity = lerp(a.envIntensity, b.envIntensity, t);
    this.renderer.toneMappingExposure = lerp(a.exposure, b.exposure, t);
    this.night = lerp(a.night, b.night, t);

    // fog takes the colour of the horizon in the sky photo, so the ground melts into the sky
    this.fog.color.copy(skyA.horizon).multiplyScalar(a.skyGain).lerp(this.c.copy(skyB.horizon).multiplyScalar(b.skyGain), t);
    u.fogColor.value.copy(this.fog.color);
    this.fog.near = lerp(a.fog.near, b.fog.near, t);
    this.fog.far = lerp(a.fog.far, b.fog.far, t);

    // sun where the photo's sun is (kept a little above the horizon so shadows stay readable)
    const dir = skyA.sunDir.clone().lerp(skyB.sunDir, t).normalize();
    dir.y = Math.max(dir.y, 0.25);
    dir.normalize();
    this.sun.intensity = lerp(a.sun.intensity, b.sun.intensity, t);
    this.sun.color.set(a.sun.color).lerp(this.c.set(b.sun.color), t);
    this.sun.target.position.set(playerX, 0, -15);
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 150);

    this.hemi.intensity = lerp(a.ambient, b.ambient, t);
    this.hemi.color.copy(this.fog.color).multiplyScalar(1.5);
    this.hemi.groundColor.set(0x2a2a26);
  }
}
