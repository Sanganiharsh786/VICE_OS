/**
 * Static geometry accumulator.
 *
 * The old block put one mesh (and often one point light) per object, which is
 * fine for forty objects and fatal for four thousand. Everything static in the
 * city is now welded into a handful of merged buffers instead — one per
 * material — so a district of two hundred buildings is one draw call.
 *
 * Two things fall out of building the geometry by hand rather than instancing
 * a shared box:
 *
 *  - UVs are computed from real-world metres, so a shopfront and a 130-metre
 *    tower share a floor height and a window pitch instead of one being a
 *    stretched copy of the other
 *  - vertex colours carry both per-object tint and a baked ground-up darkening
 *    that stands in for ambient occlusion, which is most of what stops a box
 *    city from looking like a box city
 */

import * as THREE from "three";

const _c = new THREE.Color();

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get isEmpty() {
    return this.idx.length === 0;
  }

  /** Raw quad, wound counter-clockwise from `a`. Normal is derived. */
  quad(
    a: THREE.Vector3Like,
    b: THREE.Vector3Like,
    c: THREE.Vector3Like,
    d: THREE.Vector3Like,
    uvs: [number, number, number, number, number, number, number, number],
    colours: [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation],
  ) {
    const base = this.pos.length / 3;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = d.x - a.x;
    const vy = d.y - a.y;
    const vz = d.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      /*
       * Degenerate quad — two corners coincide, or all four are collinear.
       * A zero normal reaches the standard material's shader as
       * normalize(vec3(0)), which is NaN, and one NaN texel is enough for the
       * bloom blur to smear it across the entire frame and render the whole
       * scene black. Fall back to up; the triangle has no area to shade
       * anyway.
       */
      nx = 0;
      ny = 1;
      nz = 0;
    }

    const pts = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      this.pos.push(pts[i].x, pts[i].y, pts[i].z);
      this.nrm.push(nx, ny, nz);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      _c.set(colours[i]);
      this.col.push(_c.r, _c.g, _c.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * An axis-aligned box.
   *
   * `uvScale` is metres per texture tile — pass the facade tile size and every
   * face gets the right number of windows across it. `ao` darkens the bottom
   * of the vertical faces; `shade` tints each of the four sides differently so
   * a flat-lit box still reads as having corners.
   */
  box(
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    opt: {
      tint?: THREE.ColorRepresentation;
      uvScale?: [number, number];
      /** Snap UV repeats to whole tiles so the texture never seams. */
      snapUv?: boolean;
      /** 0..1 darkening applied at the base of the sides. */
      ao?: number;
      /** Extra per-face shading, on by default. */
      shade?: boolean;
      top?: boolean;
      bottom?: boolean;
      sides?: boolean;
      /** Vertical UV offset in tiles — lifts a band off the ground. */
      uvOffsetY?: number;
    } = {},
  ) {
    const {
      tint = 0xffffff,
      uvScale = [1, 1],
      snapUv = false,
      ao = 0,
      shade = true,
      top = true,
      bottom = false,
      sides = true,
      uvOffsetY = 0,
    } = opt;

    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;

    const rep = (m: number, tile: number) =>
      snapUv ? Math.max(1, Math.round(m / tile)) : m / tile;

    const rw = rep(w, uvScale[0]);
    const rd = rep(d, uvScale[0]);
    const rh = rep(h, uvScale[1]);
    const oy = uvOffsetY;

    const base = new THREE.Color(tint);
    const dark = base.clone().multiplyScalar(1 - ao);
    // Four faces at slightly different values: the city is lit by a low sun
    // and a lot of bounce, so pure flat shading reads as cardboard.
    const face = (k: number) =>
      shade ? base.clone().multiplyScalar(k) : base.clone();
    const faceDark = (k: number) =>
      shade ? dark.clone().multiplyScalar(k) : dark.clone();

    if (sides) {
      // +Z
      this.quad(
        { x: x0, y: y0, z: z1 },
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x0, y: y1, z: z1 },
        [0, oy, rw, oy, rw, oy + rh, 0, oy + rh],
        [faceDark(1.0), faceDark(1.0), face(1.0), face(1.0)],
      );
      // -Z
      this.quad(
        { x: x1, y: y0, z: z0 },
        { x: x0, y: y0, z: z0 },
        { x: x0, y: y1, z: z0 },
        { x: x1, y: y1, z: z0 },
        [0, oy, rw, oy, rw, oy + rh, 0, oy + rh],
        [faceDark(0.84), faceDark(0.84), face(0.84), face(0.84)],
      );
      // +X
      this.quad(
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y0, z: z0 },
        { x: x1, y: y1, z: z0 },
        { x: x1, y: y1, z: z1 },
        [0, oy, rd, oy, rd, oy + rh, 0, oy + rh],
        [faceDark(0.93), faceDark(0.93), face(0.93), face(0.93)],
      );
      // -X
      this.quad(
        { x: x0, y: y0, z: z0 },
        { x: x0, y: y0, z: z1 },
        { x: x0, y: y1, z: z1 },
        { x: x0, y: y1, z: z0 },
        [0, oy, rd, oy, rd, oy + rh, 0, oy + rh],
        [faceDark(0.76), faceDark(0.76), face(0.76), face(0.76)],
      );
    }
    if (top) {
      this.quad(
        { x: x0, y: y1, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x1, y: y1, z: z0 },
        { x: x0, y: y1, z: z0 },
        [0, 0, rw, 0, rw, rd, 0, rd],
        [face(1.06), face(1.06), face(1.06), face(1.06)],
      );
    }
    if (bottom) {
      this.quad(
        { x: x0, y: y0, z: z0 },
        { x: x1, y: y0, z: z0 },
        { x: x1, y: y0, z: z1 },
        { x: x0, y: y0, z: z1 },
        [0, 0, rw, 0, rw, rd, 0, rd],
        [faceDark(0.6), faceDark(0.6), faceDark(0.6), faceDark(0.6)],
      );
    }
  }

  /**
   * A square-section beam between two arbitrary points.
   *
   * `box` can only make axis-aligned volumes, so a diagonal member built with
   * it comes out as the whole bounding box — twenty wheel spokes drawn that
   * way weld into one solid plate the size of the wheel. Anything that isn't
   * on an axis belongs here.
   */
  bar(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    thickness: number,
    tint: THREE.ColorRepresentation = 0xffffff,
  ) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len;
    dy /= len;
    dz /= len;

    // any vector not parallel to the axis will do for the first cross product
    const refX = Math.abs(dy) > 0.9 ? 1 : 0;
    const refY = Math.abs(dy) > 0.9 ? 0 : 1;
    let ux = dy * 0 - dz * refY;
    let uy = dz * refX - dx * 0;
    let uz = dx * refY - dy * refX;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;

    const h = thickness / 2;
    const corner = (
      px: number,
      py: number,
      pz: number,
      su: number,
      sv: number,
    ) => ({
      x: px + ux * su * h + vx * sv * h,
      y: py + uy * su * h + vy * sv * h,
      z: pz + uz * su * h + vz * sv * h,
    });

    const base = new THREE.Color(tint);
    const sides: [number, number, number, number][] = [
      [1, 1, 1, -1],
      [1, -1, -1, -1],
      [-1, -1, -1, 1],
      [-1, 1, 1, 1],
    ];
    sides.forEach(([u0, v0, u1, v1], i) => {
      const c = base.clone().multiplyScalar(0.78 + 0.28 * ((i % 2) + 0.5) * 0.7);
      this.quad(
        corner(ax, ay, az, u0, v0),
        corner(bx, by, bz, u0, v0),
        corner(bx, by, bz, u1, v1),
        corner(ax, ay, az, u1, v1),
        [0, 0, len / thickness, 0, len / thickness, 1, 0, 1],
        [c, c, c, c],
      );
    });
  }

  /** A horizontal quad on the ground plane. Used for roads, sand, markings. */
  ground(
    cx: number,
    cz: number,
    w: number,
    d: number,
    y: number,
    opt: {
      tint?: THREE.ColorRepresentation;
      /** Metres per texture tile. */
      uvScale?: number;
      /** Rotate the quad about Y, radians. */
      rot?: number;
    } = {},
  ) {
    const { tint = 0xffffff, uvScale = 1, rot = 0 } = opt;
    const hx = w / 2;
    const hz = d / 2;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const p = (lx: number, lz: number) => ({
      x: cx + lx * cos - lz * sin,
      y,
      z: cz + lx * sin + lz * cos,
    });
    const ru = w / uvScale;
    const rv = d / uvScale;
    this.quad(
      p(-hx, hz),
      p(hx, hz),
      p(hx, -hz),
      p(-hx, -hz),
      [0, 0, ru, 0, ru, rv, 0, rv],
      [tint, tint, tint, tint],
    );
  }

  /**
   * A vertical billboard quad, rotated about Y. `uv` selects a sub-rectangle
   * of the texture, which is how every shop sign in the city comes off one
   * atlas and therefore one draw call.
   */
  panel(
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    rot: number,
    tint: THREE.ColorRepresentation = 0xffffff,
    uv: [number, number, number, number] = [0, 0, 1, 1],
    doubleSided = false,
  ) {
    const hx = w / 2;
    const hy = h / 2;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const p = (lx: number, ly: number) => ({
      x: cx + lx * cos,
      y: cy + ly,
      z: cz - lx * sin,
    });
    const [u0, v0, u1, v1] = uv;
    this.quad(
      p(-hx, -hy),
      p(hx, -hy),
      p(hx, hy),
      p(-hx, hy),
      [u0, v0, u1, v0, u1, v1, u0, v1],
      [tint, tint, tint, tint],
    );
    if (doubleSided) {
      this.quad(
        p(hx, -hy),
        p(-hx, -hy),
        p(-hx, hy),
        p(hx, hy),
        [u0, v0, u1, v0, u1, v1, u0, v1],
        [tint, tint, tint, tint],
      );
    }
  }

  /** A vertical prism — used for columns, poles, palm trunks, pier piles. */
  cylinder(
    cx: number,
    cy: number,
    cz: number,
    rBottom: number,
    rTop: number,
    h: number,
    sides: number,
    tint: THREE.ColorRepresentation = 0xffffff,
    ao = 0,
  ) {
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    const base = new THREE.Color(tint);
    const dark = base.clone().multiplyScalar(1 - ao);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const shade = 0.72 + 0.34 * (0.5 + 0.5 * Math.cos(a0 - 0.7));
      const cl = base.clone().multiplyScalar(shade);
      const cd = dark.clone().multiplyScalar(shade);
      this.quad(
        { x: cx + Math.cos(a0) * rBottom, y: y0, z: cz + Math.sin(a0) * rBottom },
        { x: cx + Math.cos(a1) * rBottom, y: y0, z: cz + Math.sin(a1) * rBottom },
        { x: cx + Math.cos(a1) * rTop, y: y1, z: cz + Math.sin(a1) * rTop },
        { x: cx + Math.cos(a0) * rTop, y: y1, z: cz + Math.sin(a0) * rTop },
        [i / sides, 0, (i + 1) / sides, 0, (i + 1) / sides, 1, i / sides, 1],
        [cd, cd, cl, cl],
      );
    }
  }

  /**
   * A coarse ellipsoid. Tree canopies, bushes and shrubs — low ring counts on
   * purpose, because six hundred of these are welded into one buffer and the
   * silhouette is all that survives at street distance anyway.
   */
  blob(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    sides: number,
    rings: number,
    tint: THREE.ColorRepresentation,
    jitter = 0,
    rnd: () => number = Math.random,
  ) {
    const base = new THREE.Color(tint);
    const pt = (u: number, v: number) => {
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      const w = 1 + (jitter ? (rnd() - 0.5) * jitter : 0);
      return {
        x: cx + Math.sin(ph) * Math.cos(th) * rx * w,
        y: cy + Math.cos(ph) * ry * w,
        z: cz + Math.sin(ph) * Math.sin(th) * rz * w,
      };
    };
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < sides; s++) {
        const u0 = s / sides;
        const u1 = (s + 1) / sides;
        const v0 = r / rings;
        const v1 = (r + 1) / rings;
        // brighter toward the top, where the sky hits it
        const k0 = 0.62 + 0.5 * (1 - v0);
        const k1 = 0.62 + 0.5 * (1 - v1);
        const c0 = base.clone().multiplyScalar(k0);
        const c1 = base.clone().multiplyScalar(k1);
        this.quad(
          pt(u0, v1),
          pt(u1, v1),
          pt(u1, v0),
          pt(u0, v0),
          [u0, v1, u1, v1, u1, v0, u0, v0],
          [c1, c1, c0, c0],
        );
      }
    }
  }

  /** Append another builder's contents, offset in world space. */
  merge(other: MeshBuilder, dx = 0, dy = 0, dz = 0) {
    const base = this.pos.length / 3;
    for (let i = 0; i < other.pos.length; i += 3) {
      this.pos.push(other.pos[i] + dx, other.pos[i + 1] + dy, other.pos[i + 2] + dz);
    }
    // pushed one at a time on purpose: spreading a million-element array into
    // push() blows the argument limit
    for (const n of other.nrm) this.nrm.push(n);
    for (const n of other.uv) this.uv.push(n);
    for (const n of other.col) this.col.push(n);
    for (const i of other.idx) this.idx.push(i + base);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(
      this.pos.length / 3 > 65535
        ? new THREE.Uint32BufferAttribute(this.idx, 1)
        : new THREE.Uint16BufferAttribute(this.idx, 1),
    );
    g.computeBoundingSphere();
    // free the scratch arrays — some of these run to a million numbers
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    return g;
  }
}

/**
 * A named bucket of static geometry. The generator writes into buckets by
 * material; at the end each non-empty bucket becomes exactly one mesh.
 */
export class MeshBank {
  private banks = new Map<string, { b: MeshBuilder; mat: THREE.Material }>();

  /**
   * Geometry written under the same key ends up in the same mesh. Materials
   * are owned by the material library, not by the bank, so the same material
   * can back several keys (e.g. shadow-casting and non-casting variants).
   */
  bucket(key: string, mat: THREE.Material) {
    let e = this.banks.get(key);
    if (!e) {
      e = { b: new MeshBuilder(), mat };
      this.banks.set(key, e);
    }
    return e.b;
  }

  /** Turn every non-empty bucket into exactly one mesh on `group`. */
  flush(
    group: THREE.Group,
    keep: (d: { dispose: () => void }) => void,
    opts: {
      castShadow?: (key: string) => boolean;
      receiveShadow?: (key: string) => boolean;
      renderOrder?: (key: string) => number;
    } = {},
  ) {
    for (const [key, { b, mat }] of this.banks) {
      const g = b.build();
      if (!g) continue;
      keep(g);
      const m = new THREE.Mesh(g, mat);
      m.name = key;
      m.castShadow = opts.castShadow?.(key) ?? false;
      m.receiveShadow = opts.receiveShadow?.(key) ?? true;
      m.renderOrder = opts.renderOrder?.(key) ?? 0;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
    }
    this.banks.clear();
  }
}
