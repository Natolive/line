// Draws the curved road around the player. Everything placed along the road lives under `root`, at its
// real place on the curve (rules/track.ts); root is moved so the view point sits at the origin, its lane
// pointing down -z. The player, the camera and effects stay in that local frame: near the car the world
// looks just like the old straight scroll, and the bends are real geometry further out.
import * as THREE from 'three';
import { frameAt, lateral } from '../rules/track.ts';

const UP = new THREE.Vector3(0, 1, 0);

export class TrackView {
  readonly root = new THREE.Group();
  /** Road heading at the view point (rad): the sky and sun turn by it. */
  heading = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Puts road position `d` at the origin, facing -z. */
  setView(d: number) {
    const f = frameAt(d);
    this.heading = f.heading;
    this.root.rotation.y = f.heading;
    this.root.position.set(-f.x, 0, -f.z).applyAxisAngle(UP, f.heading);
    this.root.updateMatrix();
  }

  /** World position (under root) of road position `d`, `x` meters right of the centre line, `y` up. */
  point(d: number, x: number, y = 0, out = new THREE.Vector3()) {
    const f = frameAt(d), l = lateral(x, f.curvature);
    return out.set(f.x + Math.cos(f.heading) * l, y, f.z + Math.sin(f.heading) * l);
  }

  /** Places `obj` (a child of root) at road position (d, x), turned `yaw` from the road's direction (+ = right). */
  place(obj: THREE.Object3D, d: number, x: number, yaw = 0, y = 0) {
    this.point(d, x, y, obj.position);
    obj.rotation.set(0, -(frameAt(d).heading + yaw), 0);
  }

  /** The same, for an object that is not under root: in the view's local frame. */
  placeLocal(obj: THREE.Object3D, d: number, x: number, yaw = 0, y = 0) {
    this.point(d, x, y, obj.position).applyMatrix4(this.root.matrix);
    obj.rotation.set(0, -(frameAt(d).heading - this.heading + yaw), 0);
  }
}

/**
 * Keeps road pieces `len` meters long built from `behind` meters behind the view to `ahead` meters in front,
 * whatever happens: driving builds the next ones as the last ones fall behind, a jump (restart, spectating
 * someone else) rebuilds the lot. So the road and its scenery are always complete around the camera.
 */
export class Ring<T> {
  private live = new Map<number, T>();
  private len: number;
  private behind: number;
  private ahead: number;
  private build: (d0: number, i: number) => T;
  private free: (piece: T) => void;

  constructor(len: number, behind: number, ahead: number, build: (d0: number, i: number) => T, free: (piece: T) => void) {
    this.len = len;
    this.behind = behind;
    this.ahead = ahead;
    this.build = build;
    this.free = free;
  }

  update(d: number) {
    const lo = Math.floor((d - this.behind) / this.len), hi = Math.floor((d + this.ahead) / this.len);
    for (const [i, piece] of this.live) {
      if (i >= lo && i <= hi) continue;
      this.free(piece);
      this.live.delete(i);
    }
    for (let i = lo; i <= hi; i++) if (!this.live.has(i)) this.live.set(i, this.build(i * this.len, i));
  }

  /** Rebuilds every piece (e.g. once the assets they use have changed). */
  clear() {
    for (const piece of this.live.values()) this.free(piece);
    this.live.clear();
  }

  pieces() {
    return this.live.values();
  }
}

/**
 * Turns road coordinates into the local space of a piece built at `d0`: geometry stays small
 * numbers near its own origin (precise on the GPU), and the piece is placed on the curve as a whole.
 */
export class PieceFrame {
  private ox: number;
  private oz: number;
  private c: number;
  private s: number;
  readonly heading: number;

  constructor(d0: number) {
    const f = frameAt(d0);
    this.ox = f.x;
    this.oz = f.z;
    this.heading = f.heading;
    this.c = Math.cos(f.heading);
    this.s = Math.sin(f.heading);
  }

  /** Local position of road point (d, x, y), written into `out` at `i` (xyz). */
  write(out: number[] | Float32Array, i: number, d: number, x: number, y: number) {
    const f = frameAt(d), l = lateral(x, f.curvature);
    const wx = f.x + Math.cos(f.heading) * l - this.ox, wz = f.z + Math.sin(f.heading) * l - this.oz;
    out[i] = wx * this.c + wz * this.s;
    out[i + 1] = y;
    out[i + 2] = -wx * this.s + wz * this.c;
  }

  /** Puts `obj` (a child of the piece) at road point (d, x, y), turned `yaw` from the road (+ = right). */
  place(obj: THREE.Object3D, d: number, x: number, y = 0, yaw = 0) {
    const p = [0, 0, 0];
    this.write(p, 0, d, x, y);
    obj.position.set(p[0], p[1], p[2]);
    obj.rotation.set(0, -(frameAt(d).heading - this.heading + yaw), 0);
    return obj;
  }
}
