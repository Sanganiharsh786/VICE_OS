/**
 * Broad-phase collision for a city with a few thousand boxes in it.
 *
 * The previous block scanned every collider for every actor, every frame.
 * That is fine at forty boxes and quadratic misery at four thousand, so
 * colliders are bucketed into a uniform grid: an actor only ever tests the
 * handful of boxes in the cells it actually overlaps.
 *
 * The same structure answers "is there a wall between these two points",
 * which is what the third-person camera uses to avoid clipping through
 * buildings and what the shutter uses to decide whether a face was actually
 * visible. Both used to be full scene raycasts.
 */

import * as THREE from "three";

export type Collider = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Top of the box. Actors clear anything shorter than a kerb. */
  top: number;
};

const BUCKET = 40;

export class CollisionGrid {
  private cells = new Map<number, Collider[]>();
  private list: Collider[] = [];

  private key(cx: number, cz: number) {
    return (cx + 4096) * 16384 + (cz + 4096);
  }

  add(c: Collider) {
    this.list.push(c);
    const x0 = Math.floor(c.minX / BUCKET);
    const x1 = Math.floor(c.maxX / BUCKET);
    const z0 = Math.floor(c.minZ / BUCKET);
    const z1 = Math.floor(c.maxZ / BUCKET);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(c);
      }
    }
  }

  box(
    cx: number,
    cz: number,
    w: number,
    d: number,
    top = 40,
  ) {
    this.add({
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      top,
    });
  }

  get count() {
    return this.list.length;
  }

  /** Colliders in the bucket containing (x, z), plus its eight neighbours. */
  near(x: number, z: number, out: Collider[]) {
    out.length = 0;
    const cx = Math.floor(x / BUCKET);
    const cz = Math.floor(z / BUCKET);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this.cells.get(this.key(cx + i, cz + j));
        if (!arr) continue;
        for (const c of arr) if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }

  /**
   * Slab test against every box on the segment's path. Returns the distance
   * to the first hit, or -1. Boxes shorter than `minTop` are ignored, so a
   * kerb never blocks the camera or a line of sight.
   */
  rayHit(
    from: THREE.Vector3,
    to: THREE.Vector3,
    minTop = 1.2,
  ): number {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return -1;

    const steps = Math.min(48, Math.max(2, Math.ceil(len / (BUCKET * 0.5))));
    const seen = new Set<Collider>();
    let best = -1;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = from.x + dx * t;
      const pz = from.z + dz * t;
      const cx = Math.floor(px / BUCKET);
      const cz = Math.floor(pz / BUCKET);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const arr = this.cells.get(this.key(cx + i, cz + j));
          if (!arr) continue;
          for (const c of arr) {
            if (c.top < minTop || seen.has(c)) continue;
            seen.add(c);
            const hit = slab(from, dx, dy, dz, c);
            if (hit >= 0 && (best < 0 || hit < best)) best = hit;
          }
        }
      }
      if (best >= 0 && best < t) break;
    }
    return best < 0 ? -1 : best * Math.hypot(dx, dy, dz);
  }

  blocked(from: THREE.Vector3, to: THREE.Vector3, slack = 0.3) {
    const hit = this.rayHit(from, to);
    return hit >= 0 && hit < from.distanceTo(to) - slack;
  }

  /** Push a capsule out of every box it overlaps. Returns true if it moved. */
  resolve(pos: THREE.Vector3, radius: number, scratch: Collider[]) {
    this.near(pos.x, pos.z, scratch);
    let moved = false;
    for (const c of scratch) {
      // anything you can step over doesn't push you around
      if (c.top < 0.55) continue;
      if (
        pos.x < c.minX - radius ||
        pos.x > c.maxX + radius ||
        pos.z < c.minZ - radius ||
        pos.z > c.maxZ + radius
      )
        continue;

      const dxMin = pos.x - (c.minX - radius);
      const dxMax = c.maxX + radius - pos.x;
      const dzMin = pos.z - (c.minZ - radius);
      const dzMax = c.maxZ + radius - pos.z;
      const m = Math.min(dxMin, dxMax, dzMin, dzMax);
      if (m === dxMin) pos.x = c.minX - radius;
      else if (m === dxMax) pos.x = c.maxX + radius;
      else if (m === dzMin) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
      moved = true;
    }
    return moved;
  }
}

/** Ray/AABB slab intersection in the XZ plane, with a Y height check. */
function slab(
  from: THREE.Vector3,
  dx: number,
  dy: number,
  dz: number,
  c: Collider,
) {
  let t0 = 0;
  let t1 = 1;

  for (const [o, d, lo, hi] of [
    [from.x, dx, c.minX, c.maxX],
    [from.z, dz, c.minZ, c.maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  // the ray has to actually pass below the top of the box to be stopped by it
  const y = from.y + dy * t0;
  if (y > c.top) return -1;
  return t0;
}
