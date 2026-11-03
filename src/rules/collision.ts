// Rotated rectangle overlap on the road plane (separating axis test).
export type Rect = { x: number; z: number; w: number; l: number; heading: number };

export function rectsOverlap(a: Rect, b: Rect) {
  const axesOf = (r: Rect) => {
    const s = Math.sin(r.heading), c = Math.cos(r.heading);
    return { right: [c, s], fwd: [s, -c] }; // vehicles drive toward -z
  };
  const A = axesOf(a), B = axesOf(b);
  const d = [b.x - a.x, b.z - a.z];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1];
  const radius = (r: Rect, ax: { right: number[]; fwd: number[] }, n: number[]) =>
    Math.abs(dot(ax.right, n)) * r.w / 2 + Math.abs(dot(ax.fwd, n)) * r.l / 2;
  for (const n of [A.right, A.fwd, B.right, B.fwd]) {
    if (Math.abs(dot(d, n)) >= radius(a, A, n) + radius(b, B, n)) return false;
  }
  return true;
}
