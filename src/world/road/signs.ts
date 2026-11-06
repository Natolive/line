// Road signs whose faces are drawn on canvases: area gantries, bend chevrons, the tunnel sign.
import * as THREE from 'three';
import { GUARDRAIL_X } from '../../core/config.ts';

/** A canvas-faced sign: a face that glows faintly by day, like retroreflective sheeting at night. */
function canvasMaterial(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.6 });
  return { mat, map, g: canvas.getContext('2d')! };
}

/** A motorway sign panel whose face is drawn on a canvas. */
function signPanel(w: number, h: number) {
  const { mat, map, g } = canvasMaterial(512, Math.round((512 * h) / w));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const draw = (big: string, small: string) => {
    const W = g.canvas.width, H = g.canvas.height;
    g.fillStyle = '#0b5d3b';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = 8;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.fillStyle = '#f2f2f2';
    g.textAlign = 'center';
    g.font = `700 ${Math.round(H * 0.34)}px "Chakra Petch", Arial, sans-serif`;
    g.fillText(big, W / 2, H * 0.48);
    g.font = `500 ${Math.round(H * 0.24)}px "Chakra Petch", Arial, sans-serif`;
    g.fillText(small, W / 2, H * 0.82);
    map.needsUpdate = true;
  };
  return { mesh, mat, draw };
}

/** Steel gantry spanning the road with two signs: the next area ahead, and the road's name. */
export function gantry(steel: THREE.Material) {
  const group = new THREE.Group(), span = (GUARDRAIL_X + 0.6) * 2;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7.6, 0.35), steel);
    post.position.set((s * span) / 2, 3.8, 0);
    group.add(post);
  }
  for (const y of [7.4, 5.8]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, 0.22), steel);
    beam.position.set(0, y, -0.15);
    group.add(beam);
  }
  const next = signPanel(7, 2.4), road = signPanel(5, 2.4);
  next.mesh.position.set(-3.4, 6.6, 0.05);
  road.mesh.position.set(4.2, 6.6, 0.05);
  road.draw('LINE', 'No exit');
  group.add(next.mesh, road.mesh);
  group.traverse((o) => { o.castShadow = true; });
  return { group, next, mats: [next.mat, road.mat] };
}
export type Gantry = ReturnType<typeof gantry>;

/** Red chevron board (bend ahead), arrows pointing right; mirrored by its texture for left bends. */
export function chevronMaterials() {
  const { mat, map, g } = canvasMaterial(256, 256);
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffffff';
  for (const x of [40, 130]) {
    g.beginPath();
    g.moveTo(x, 40);
    g.lineTo(x + 50, 40);
    g.lineTo(x + 110, 128);
    g.lineTo(x + 50, 216);
    g.lineTo(x, 216);
    g.lineTo(x + 60, 128);
    g.closePath();
    g.fill();
  }
  map.needsUpdate = true;
  const leftMap = map.clone();
  leftMap.repeat.x = -1;
  leftMap.offset.x = 1;
  leftMap.wrapS = THREE.RepeatWrapping;
  const left = mat.clone();
  left.map = left.emissiveMap = leftMap;
  return { right: mat, left };
}

/** Blue tunnel sign: a white arch over a road, as on European motorways. */
export function tunnelSignMaterial() {
  const { mat, map, g } = canvasMaterial(256, 128);
  g.fillStyle = '#1f4fd8';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = g.fillStyle = '#ffffff';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 240, 112);
  g.beginPath();
  g.moveTo(68, 108);
  g.lineTo(68, 64);
  g.arc(128, 64, 60, Math.PI, 0);
  g.lineTo(188, 108);
  g.lineTo(166, 108);
  g.lineTo(166, 68);
  g.arc(128, 68, 38, 0, Math.PI, true);
  g.lineTo(90, 108);
  g.closePath();
  g.fill();
  map.needsUpdate = true;
  return mat;
}
