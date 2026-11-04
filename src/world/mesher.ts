// Builds road and land geometry from road coordinates: grids of vertices along the road, swept profiles.
// Faces point to the left of the profile's direction, seen looking down the road: a profile drawn left to
// right faces up, one drawn upward on the right-hand side faces the road.
import * as THREE from 'three';
import { frameAt } from '../rules/track.ts';
import type { PieceFrame } from './track.ts';

export type Profile = [x: number, y: number][];

export class Mesher {
  private pos: number[] = [];
  private uv: number[] = [];
  private nor: number[] = [];
  private blend: number[] = [];
  private idx: number[] = [];
  private pf: PieceFrame;

  constructor(pf: PieceFrame) {
    this.pf = pf;
  }

  get empty() {
    return this.idx.length === 0;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  /** Triangles from a list of vertex indices counted from `base`. */
  indices(list: ArrayLike<number>, base: number) {
    for (let i = 0; i < list.length; i++) this.idx.push(base + list[i]);
  }

  /** One vertex at road point (d, x, y), texture coordinates (u, v), and how far it has blended into the next theme. */
  vertex(d: number, x: number, y: number, u: number, v: number, blend = 0) {
    this.pf.write(this.pos, this.pos.length, d, x, y);
    this.uv.push(u, v);
    this.blend.push(blend);
  }

  /** Normal of the last vertex, in road terms: `nx` toward +x, `ny` up, `nd` down the road (else computed from faces). */
  normal(nx: number, ny: number, nd: number, d: number) {
    const t = frameAt(d).heading - this.pf.heading, c = Math.cos(t), s = Math.sin(t), len = Math.hypot(nx, ny, nd) || 1;
    // right = (cos t, sin t), forward = (sin t, -cos t) in the piece's x/z
    this.nor.push((nx * c + nd * s) / len, ny / len, (nx * s - nd * c) / len);
  }

  /** Joins the last rows × cols vertices (added row by row, rows down the road) into quads. */
  grid(rows: number, cols: number) {
    const base = this.pos.length / 3 - rows * cols;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = base + r * cols + c, b = a + 1, e = a + cols, f = e + 1;
        this.idx.push(a, b, e, b, f, e);
      }
    }
  }

  /**
   * Sweeps a cross-section along the road through road positions `ds`. `profile(d)` gives its points;
   * texture u runs along the profile, v down the road, both in tiles of `tile` meters (v from `v0`).
   */
  sweep(ds: number[], profile: (d: number) => Profile, tile: number, v0 = 0, blend: (d: number) => number = () => 0) {
    let cols = 0;
    for (const d of ds) {
      const p = profile(d);
      cols = p.length;
      let u = 0;
      p.forEach(([x, y], i) => {
        if (i) u += Math.hypot(x - p[i - 1][0], y - p[i - 1][1]);
        this.vertex(d, x, y, u / tile, (v0 + d - ds[0]) / tile, blend(d));
      });
    }
    this.grid(ds.length, cols);
  }

  /** Sweeps each segment of the profile on its own, so the edges between them stay sharp (boxes, walls). */
  sweepFlat(ds: number[], profile: (d: number) => Profile, tile: number, v0 = 0) {
    const n = profile(ds[0]).length;
    for (let i = 0; i < n - 1; i++) this.sweep(ds, (d) => profile(d).slice(i, i + 2), tile, v0);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('blend', new THREE.Float32BufferAttribute(this.blend, 1));
    g.setIndex(this.idx);
    if (this.nor.length === this.pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    else g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
