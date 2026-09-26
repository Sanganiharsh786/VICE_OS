/**
 * What fills a city block.
 *
 * Buildings are placed as a perimeter wall fronting the pavement on all four
 * sides, with whatever is left in the middle becoming a car park, a courtyard
 * or an alley. That is how real blocks are organised, and it is why the street
 * reads as a street: you walk down a continuous frontage of shopfronts rather
 * than past a field of detached boxes.
 *
 * Every building is a stack of four things — a ground-floor band carrying the
 * shopfront, a shaft carrying the facade, a roof cap, and rooftop clutter.
 * The facade's UV repeat comes from the building's real dimensions, so floor
 * heights agree across the whole city.
 */

import * as THREE from "three";
import { MeshBank } from "./builder";
import type { Materials } from "./materials";
import type { CollisionGrid } from "./collision";
import { TILE_H, TILE_W, atlasUv, type TextureLib } from "./textures";
import {
  CELL,
  DISTRICTS,
  GRID,
  HALF,
  isAvenue,
  roadWidth,
  terrainAt,
  type DistrictSpec,
  type Terrain,
} from "./layout";
import { cellRng, irange, pick, range, type Rnd } from "./rng";
import type { AdSite, EvidenceTag } from "./types";

/** Pavement width on an ordinary street / on an avenue. */
const PAVE = 4.4;
const PAVE_AVE = 5.8;
const PAVE_Y = 0.19;
/** Height of the ground-floor band that carries the shopfront. */
const BASE_H = 4.3;

/**
 * The coast. The road grid's last line is at x = 320, so the beach lives
 * entirely seaward of it: boardwalk, then sand, then water. Keeping the sand
 * outside the grid means no block has to be half-built.
 */
export const SHORE_X = 400;
/** Sand runs from here out to the water. */
export const SAND_X = 330;

export type WorldCtx = {
  bank: MeshBank;
  mat: Materials;
  tex: TextureLib;
  grid: CollisionGrid;
  /** Pavement nodes the crowd and the pedestrian AI walk between. */
  walk: THREE.Vector3[];
  lamps: { x: number; z: number; h: number }[];
  /** Static vehicles: kerbside and car-park. */
  parked: { x: number; z: number; rot: number; kind: number }[];
  evidence: EvidenceTag[];
  /** Tagged walls — the surfaces the Image Lab's work belongs on. */
  tags: { x: number; y: number; z: number; rot: number; label: string }[];
  /** Rooftop and gable-wall advertising pitches, built later by `ads.ts`. */
  ads: AdSite[];
  group: THREE.Group;
  keep: (d: { dispose: () => void }) => void;
};

/** Interior rectangle of a cell, i.e. the block between the four roads. */
export function blockRect(i: number, j: number) {
  const kW = i - HALF;
  const kE = i - HALF + 1;
  const mN = j - HALF;
  const mS = j - HALF + 1;
  return {
    x0: kW * CELL + roadWidth(kW) / 2,
    x1: kE * CELL - roadWidth(kE) / 2,
    z0: mN * CELL + roadWidth(mN) / 2,
    z1: mS * CELL - roadWidth(mS) / 2,
    paveN: isAvenue(mN) ? PAVE_AVE : PAVE,
    paveS: isAvenue(mS) ? PAVE_AVE : PAVE,
    paveW: isAvenue(kW) ? PAVE_AVE : PAVE,
    paveE: isAvenue(kE) ? PAVE_AVE : PAVE,
  };
}

/* ------------------------------------------------------------------ */
/* pavement                                                            */
/* ------------------------------------------------------------------ */

/**
 * The raised slab the block sits on, plus a darker kerb lip at its edge and
 * the walk nodes that the crowd navigates by.
 */
function pavement(ctx: WorldCtx, i: number, j: number, rnd: Rnd) {
  const r = blockRect(i, j);
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;

  const pave = ctx.bank.bucket("pave", ctx.mat.pavement);
  pave.box(cx, PAVE_Y / 2, cz, w, PAVE_Y, d, {
    uvScale: [4, 4],
    tint: 0xffffff,
    ao: 0,
    shade: false,
  });
  // kerb: a darker band standing slightly proud of the slab
  const kerb = ctx.bank.bucket("prop", ctx.mat.prop);
  for (const [ex, ez, ew, ed] of [
    [cx, r.z0 + 0.15, w, 0.3],
    [cx, r.z1 - 0.15, w, 0.3],
    [r.x0 + 0.15, cz, 0.3, d],
    [r.x1 - 0.15, cz, 0.3, d],
  ] as const) {
    kerb.box(ex, PAVE_Y / 2 + 0.02, ez, ew, PAVE_Y + 0.04, ed, {
      tint: 0x6a6578,
      shade: false,
    });
  }
  ctx.grid.box(cx, cz, w, d, PAVE_Y);

  // walk nodes down the middle of each pavement
  const step = 9;
  for (let x = r.x0 + 6; x < r.x1 - 4; x += step) {
    ctx.walk.push(new THREE.Vector3(x + rnd() * 2, PAVE_Y, r.z0 + r.paveN / 2));
    ctx.walk.push(new THREE.Vector3(x + rnd() * 2, PAVE_Y, r.z1 - r.paveS / 2));
  }
  for (let z = r.z0 + 6; z < r.z1 - 4; z += step) {
    ctx.walk.push(new THREE.Vector3(r.x0 + r.paveW / 2, PAVE_Y, z + rnd() * 2));
    ctx.walk.push(new THREE.Vector3(r.x1 - r.paveE / 2, PAVE_Y, z + rnd() * 2));
  }
}

/* ------------------------------------------------------------------ */
/* one building                                                        */
/* ------------------------------------------------------------------ */

const TINTS = [0xffffff, 0xf2e8e2, 0xe6ecf5, 0xf5ece0, 0xe8e2f0, 0xfff2e0];

type Facing = 0 | 1 | 2 | 3; // 0=+Z 1=-Z 2=+X 3=-X

const FACE_DIR: Record<Facing, [number, number]> = {
  0: [0, 1],
  1: [0, -1],
  2: [1, 0],
  3: [-1, 0],
};
/**
 * Rotation that makes a panel's face point the given way.
 *
 * `MeshBuilder.panel` winds its quad so the front normal is
 * `(sin rot, 0, cos rot)`, and the two X entries here were the wrong way round:
 * every shop sign, blade sign and awning on a frontage facing ±X was turned to
 * look *into* its own building. The sign material is single-sided, so those
 * were being back-face culled — about half the city's signage was simply not
 * drawn, on every north-south street.
 */
const FACE_ROT: Record<Facing, number> = {
  0: 0,
  1: Math.PI,
  2: Math.PI / 2,
  3: -Math.PI / 2,
};

function building(
  ctx: WorldCtx,
  rnd: Rnd,
  spec: DistrictSpec,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  facing: Facing,
  terrain: Terrain,
) {
  const { bank, mat } = ctx;
  const kind = spec.facade;
  const variant = irange(rnd, 0, mat.facade[kind].length - 1);
  const shaft = bank.bucket(`facade:${kind}:${variant}`, mat.facade[kind][variant]);
  const roofB = bank.bucket("roof", mat.roof);
  const propB = bank.bucket("prop", mat.prop);
  const neonB = bank.bucket("neon", mat.neon);
  const tint = pick(rnd, TINTS);

  /* -------- shaft, with setbacks on anything tall -------- */
  let y = 0;
  let cw = w;
  let cd = d;
  let left = h;
  let stage = 0;
  while (left > 1 && stage < 4) {
    const seg = stage === 0 ? Math.min(left, h > 70 ? h * 0.55 : h) : left * (0.5 + rnd() * 0.35);
    shaft.box(cx, y + seg / 2, cz, cw, seg, cd, {
      tint,
      uvScale: [TILE_W, TILE_H],
      snapUv: true,
      ao: stage === 0 ? 0.3 : 0.1,
    });
    // roof cap / parapet lip for this stage
    roofB.box(cx, y + seg + 0.3, cz, cw + 0.5, 0.6, cd + 0.5, {
      tint: 0xd8d4e0,
      uvScale: [6, 6],
      shade: true,
    });
    y += seg + 0.6;
    left = h - y;
    if (left < 8 || h < 55) break;
    cw *= 0.66 + rnd() * 0.14;
    cd *= 0.66 + rnd() * 0.14;
    stage++;
  }
  const topY = Math.max(y, h);

  ctx.grid.box(cx, cz, w, d, topY);

  /* -------- ground floor -------- */
  const service = kind === "warehouse";
  const baseIdx = service
    ? irange(rnd, 0, mat.service.length - 1)
    : irange(rnd, 0, mat.storefront.length - 1);
  const baseB = bank.bucket(
    service ? `service:${baseIdx}` : `shop:${baseIdx}`,
    service ? mat.service[baseIdx] : mat.storefront[baseIdx],
  );
  const bh = Math.min(BASE_H, h * 0.85);
  baseB.box(cx, bh / 2, cz, w + 0.55, bh, d + 0.55, {
    tint: 0xffffff,
    uvScale: [8.5, bh],
    snapUv: false,
    shade: true,
    top: true,
  });

  /* -------- rooftop clutter -------- */
  if (rnd() > 0.35 && cw > 6) {
    const n = irange(rnd, 1, 3);
    for (let a = 0; a < n; a++) {
      const bw = range(rnd, 1.2, Math.min(4, cw * 0.3));
      const bd = range(rnd, 1.2, Math.min(4, cd * 0.3));
      propB.box(
        cx + range(rnd, -cw / 2 + bw, cw / 2 - bw),
        topY + 0.8,
        cz + range(rnd, -cd / 2 + bd, cd / 2 - bd),
        bw,
        1.5,
        bd,
        { tint: 0x55525f },
      );
    }
  }
  if (rnd() > 0.7 && cw > 5) {
    // water tank on a frame
    propB.cylinder(cx, topY + 3.4, cz, 1.3, 1.1, 3.2, 8, 0x6b5a48, 0.3);
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) {
      propB.box(cx + ox, topY + 1.1, cz + oz, 0.16, 2.2, 0.16, { tint: 0x3a3540 });
    }
  }
  if (h > 45 && rnd() > 0.4) {
    const ah = range(rnd, 6, 18);
    propB.cylinder(cx, topY + ah / 2, cz, 0.22, 0.08, ah, 5, 0x4a4754, 0.2);
    // aircraft warning light
    neonB.box(cx, topY + ah + 0.3, cz, 0.7, 0.7, 0.7, {
      tint: 0xff2b2b,
      shade: false,
    });
  }

  /* -------- street-facing signage -------- */
  const [fx, fz] = FACE_DIR[facing];
  const faceW = facing < 2 ? w : d;

  /*
   * Advertising pitches.
   *
   * Only the site is recorded — every board in the city is built by `ads.ts`
   * into one screen mesh so they can share an atlas and a shader. This is the
   * one place that knows a building's real height, its top-stage footprint and
   * which way it faces the street, which is why the choice is made here.
   *
   * Both are capped below the setback threshold (55m): above it the shaft steps
   * in, and a board sized to the base footprint would hang off the side of a
   * storey that isn't there any more.
   */
  const roofFaceW = facing < 2 ? cw : cd;
  if (topY > 9 && topY < 52 && roofFaceW > 10 && rnd() < 0.22) {
    const bw = Math.min(roofFaceW * 0.88, 16);
    const bh = Math.min(bw * 0.42, 7);
    ctx.ads.push({
      x: cx + fx * ((facing < 2 ? cd : cw) / 2 - 0.5),
      y: topY + 1.3 + bh / 2,
      z: cz + fz * ((facing < 2 ? cd : cw) / 2 - 0.5),
      rot: FACE_ROT[facing],
      w: bw,
      h: bh,
      kind: "roof",
    });
  } else if (h > 26 && h < 52 && faceW > 11 && rnd() < 0.16) {
    // a portrait superside painted up the gable, the way a real one is
    const bw = Math.min(faceW * 0.66, 11);
    const bh = Math.min(bw * 1.45, h - BASE_H - 6);
    if (bh > 6) {
      ctx.ads.push({
        x: cx + fx * ((facing < 2 ? d : w) / 2 + 0.3),
        y: BASE_H + 2.5 + bh / 2,
        z: cz + fz * ((facing < 2 ? d : w) / 2 + 0.3),
        rot: FACE_ROT[facing],
        w: bw,
        h: bh,
        kind: "wall",
      });
    }
  }
  if (rnd() < spec.neon && faceW > 5 && terrain !== "park") {
    const signB = bank.bucket("sign", mat.sign);
    const poolB = bank.bucket("pool", mat.pool);
    const slot = irange(rnd, 0, 31);
    const sw = Math.min(faceW * 0.82, 9);
    const sh = sw * 0.34;
    const sy = bh + 0.6 + rnd() * 2.2;
    const px = cx + fx * ((facing < 2 ? d : w) / 2 + 0.55);
    const pz = cz + fz * ((facing < 2 ? d : w) / 2 + 0.55);
    signB.panel(px, sy, pz, sw, sh, FACE_ROT[facing], 0xffffff, atlasUv(slot));
    poolB.ground(px + fx * 2.5, pz + fz * 2.5, 13, 13, PAVE_Y + 0.03, {
      tint: 0x3a2038,
      uvScale: 13,
    });

    // a blade sign hanging off the corner on some of them
    if (rnd() > 0.6) {
      const bladeRot = FACE_ROT[facing] + Math.PI / 2;
      const bx = px + fx * 1.4;
      const bz = pz + fz * 1.4;
      signB.panel(bx, sy + 2.6, bz, 3.6, 1.3, bladeRot, 0xffffff, atlasUv(slot + 7), true);
      propB.box(bx, sy + 3.4, bz, 0.12, 0.12, 0.12, { tint: 0x2a2833 });
    }
  }

  /* -------- fire escape on the alley side of older stock -------- */
  if ((kind === "apartment" || kind === "colonial") && h > 12 && rnd() > 0.55) {
    const back: Facing = (facing ^ 1) as Facing;
    const [bxd, bzd] = FACE_DIR[back];
    const ox = cx + bxd * ((back < 2 ? d : w) / 2 + 0.5);
    const oz = cz + bzd * ((back < 2 ? d : w) / 2 + 0.5);
    for (let fy = 4.5; fy < Math.min(h - 2, 20); fy += 3.4) {
      propB.box(ox, fy, oz, back < 2 ? 3.4 : 1.1, 0.14, back < 2 ? 1.1 : 3.4, {
        tint: 0x2e2b36,
      });
      propB.box(ox + bxd * 0.5, fy + 0.55, oz + bzd * 0.5, back < 2 ? 3.4 : 0.1, 1.1, back < 2 ? 0.1 : 3.4, {
        tint: 0x2e2b36,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* a row of buildings along one block edge                             */
/* ------------------------------------------------------------------ */

function edgeRow(
  ctx: WorldCtx,
  rnd: Rnd,
  spec: DistrictSpec,
  terrain: Terrain,
  axis: "x" | "z",
  from: number,
  to: number,
  fixed: number,
  depth: number,
  facing: Facing,
) {
  const span = to - from;
  if (span < 6) return;
  // a tall one per block so the skyline has a rhythm rather than a plateau
  const peakAt = from + rnd() * span;

  let t = from;
  while (t < to - 5) {
    const w = Math.min(range(rnd, spec.width[0], spec.width[1]), to - t);
    if (w < 5) break;
    const built = rnd() < spec.density;
    if (built) {
      const near = 1 - Math.min(1, Math.abs(t + w / 2 - peakAt) / (span * 0.35));
      const hMix = Math.pow(rnd(), 1.7) + near * 0.55;
      const h = Math.min(
        spec.height[1],
        spec.height[0] + hMix * (spec.height[1] - spec.height[0]),
      );
      const cAlong = t + w / 2;
      const cx = axis === "x" ? cAlong : fixed;
      const cz = axis === "x" ? fixed : cAlong;
      building(
        ctx,
        rnd,
        spec,
        cx,
        cz,
        axis === "x" ? w : depth,
        axis === "x" ? depth : w,
        h,
        facing,
        terrain,
      );
    }
    t += w + (built ? range(rnd, 0, spec.density > 0.8 ? 0.6 : 3.5) : range(rnd, 4, 9));
  }
}

/* ------------------------------------------------------------------ */
/* block interiors                                                     */
/* ------------------------------------------------------------------ */

function carPark(ctx: WorldCtx, rnd: Rnd, x0: number, x1: number, z0: number, z1: number) {
  const w = x1 - x0;
  const d = z1 - z0;
  if (w < 12 || d < 12) return;
  const road = ctx.bank.bucket("road", ctx.mat.road);
  const mark = ctx.bank.bucket("mark", ctx.mat.marking);
  road.ground((x0 + x1) / 2, (z0 + z1) / 2, w, d, PAVE_Y + 0.01, { uvScale: 9 });

  // bays down both long edges, nose in
  const alongX = w >= d;
  const bays = Math.floor((alongX ? w : d) / 2.9);
  for (let s = 0; s < bays; s++) {
    const t = (alongX ? x0 : z0) + 1.4 + s * 2.9;
    for (const side of [-1, 1] as const) {
      const off = ((alongX ? d : w) / 2 - 2.9) * side;
      const px = alongX ? t : (x0 + x1) / 2 + off;
      const pz = alongX ? (z0 + z1) / 2 + off : t;
      mark.ground(px, pz, alongX ? 0.14 : 5.4, alongX ? 5.4 : 0.14, PAVE_Y + 0.04, {
        tint: 0xd8d4c4,
      });
      // a little over a third of the bays taken — a full lot reads as a wall
      if (rnd() > 0.62) {
        ctx.parked.push({
          x: px + (alongX ? 1.45 : 0),
          z: pz + (alongX ? 0 : 1.45),
          rot: alongX ? 0 : Math.PI / 2,
          kind: irange(rnd, 0, 5),
        });
      }
    }
  }
  // a couple of lamp columns in the middle of the lot
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);
  const pool = ctx.bank.bucket("pool", ctx.mat.pool);
  for (let n = 0; n < 2; n++) {
    const px = x0 + w * (0.3 + n * 0.4);
    const pz = (z0 + z1) / 2;
    prop.cylinder(px, 4.5, pz, 0.16, 0.12, 9, 6, 0x3a3742, 0.4);
    neon.box(px, 9.1, pz, 0.8, 0.22, 0.8, { tint: 0xcfe0ff, shade: false });
    pool.ground(px, pz, 20, 20, PAVE_Y + 0.06, { tint: 0x303a52, uvScale: 20 });
    ctx.lamps.push({ x: px, z: pz, h: 9 });
  }
}

function courtyard(
  ctx: WorldCtx,
  rnd: Rnd,
  spec: DistrictSpec,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
) {
  const w = x1 - x0;
  const d = z1 - z0;
  if (w < 8 || d < 8) return;
  const grassB = ctx.bank.bucket("grass", ctx.mat.grass);
  grassB.ground((x0 + x1) / 2, (z0 + z1) / 2, w, d, PAVE_Y + 0.01, { uvScale: 7 });
  const n = Math.min(6, Math.floor((w * d) / 90));
  for (let t = 0; t < n; t++) {
    tree(ctx, rnd, range(rnd, x0 + 2, x1 - 2), range(rnd, z0 + 2, z1 - 2), spec);
  }
  // wheelie bins and a skip against the back wall
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  for (let b = 0; b < irange(rnd, 1, 4); b++) {
    const bx = range(rnd, x0 + 1, x1 - 1);
    const bz = rnd() > 0.5 ? z0 + 0.9 : z1 - 0.9;
    prop.box(bx, PAVE_Y + 0.65, bz, 1.5, 1.3, 1.1, {
      tint: pick(rnd, [0x2f5d4a, 0x4a3a6b, 0x6b3a3a]),
    });
    ctx.grid.box(bx, bz, 1.5, 1.1, 1.5);
  }
}

/**
 * The alley that falls out between the front and back of a block. Wet tarmac,
 * bins, and a tagged wall — these are the quiet corners the photograph loop
 * sends you looking for.
 */
function alley(
  ctx: WorldCtx,
  rnd: Rnd,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  label: string,
) {
  const w = x1 - x0;
  const d = z1 - z0;
  const road = ctx.bank.bucket("road", ctx.mat.road);
  road.ground((x0 + x1) / 2, (z0 + z1) / 2, w, d, PAVE_Y + 0.01, { uvScale: 7 });

  const gi = irange(rnd, 0, ctx.mat.graffiti.length - 1);
  const tagB = ctx.bank.bucket(`tag:${gi}`, ctx.mat.graffiti[gi]);
  const alongX = w >= d;
  const tw = Math.min(alongX ? w : d, 14);
  const ty = 3.2;
  const tx = alongX ? (x0 + x1) / 2 : x0 + 0.3;
  const tz = alongX ? z0 + 0.3 : (z0 + z1) / 2;
  tagB.panel(tx, ty, tz, tw, 5.4, alongX ? Math.PI : Math.PI / 2, 0xffffff);
  ctx.tags.push({ x: tx, y: ty, z: tz, rot: alongX ? Math.PI : Math.PI / 2, label });

  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  for (let b = 0; b < irange(rnd, 2, 5); b++) {
    const bx = alongX ? range(rnd, x0 + 2, x1 - 2) : (x0 + x1) / 2;
    const bz = alongX ? (z0 + z1) / 2 : range(rnd, z0 + 2, z1 - 2);
    prop.box(bx, PAVE_Y + 0.8, bz, 2.2, 1.6, 1.3, {
      tint: pick(rnd, [0x2f5d4a, 0x3a3f6b, 0x6b2f3a]),
    });
    ctx.grid.box(bx, bz, 2.2, 1.3, 1.9);
  }
}

/* ------------------------------------------------------------------ */
/* trees + pavement furniture                                          */
/* ------------------------------------------------------------------ */

export function tree(ctx: WorldCtx, rnd: Rnd, x: number, z: number, spec: DistrictSpec) {
  const fol = ctx.bank.bucket("foliage", ctx.mat.foliage);
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const palm = spec.facade === "resort" || spec.facade === "shop" || rnd() > 0.55;

  if (palm) {
    const h = range(rnd, 6.5, 11);
    // a slight lean, because a dead-straight palm reads as a lamp post
    const leanA = rnd() * Math.PI * 2;
    const lean = range(rnd, 0, 0.55);
    const tipX = x + Math.cos(leanA) * lean;
    const tipZ = z + Math.sin(leanA) * lean;
    const tipY = PAVE_Y + h;
    prop.cylinder(
      (x + tipX) / 2,
      PAVE_Y + h / 2,
      (z + tipZ) / 2,
      0.22,
      0.14,
      h,
      6,
      0x5a4632,
      0.3,
    );

    /*
     * Fronds arc downward in three tapering segments. Flat radial planes —
     * which is what these were — read from underneath as a ring of dark slabs
     * hanging in the sky, because a single quad has one normal and no
     * silhouette.
     */
    const n = irange(rnd, 7, 9);
    for (let f = 0; f < n; f++) {
      const a = (f / n) * Math.PI * 2 + rnd() * 0.25;
      const len = range(rnd, 2.6, 4.0);
      const droop = range(rnd, 0.9, 1.9);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const segs = 3;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        // outward distance and height along the arc
        const r0 = len * t0;
        const r1 = len * t1;
        const y0 = tipY + 0.35 - droop * t0 * t0;
        const y1 = tipY + 0.35 - droop * t1 * t1;
        // half-width tapers to a point at the tip
        const w0 = 0.42 * (1 - t0 * 0.85);
        const w1 = 0.42 * (1 - t1 * 0.85);
        const px = -sa;
        const pz = ca;
        const shade = 0.8 + 0.35 * (1 - t0);
        const col = new THREE.Color(0x2f9160).multiplyScalar(shade).getHex();
        fol.quad(
          { x: tipX + ca * r0 - px * w0, y: y0, z: tipZ + sa * r0 - pz * w0 },
          { x: tipX + ca * r1 - px * w1, y: y1, z: tipZ + sa * r1 - pz * w1 },
          { x: tipX + ca * r1 + px * w1, y: y1, z: tipZ + sa * r1 + pz * w1 },
          { x: tipX + ca * r0 + px * w0, y: y0, z: tipZ + sa * r0 + pz * w0 },
          [0, t0, 0, t1, 1, t1, 1, t0],
          [col, col, col, col],
        );
      }
    }
    // coconuts / crown
    fol.blob(tipX, tipY + 0.15, tipZ, 0.55, 0.45, 0.55, 5, 2, 0x3f7a4a, 0.3, rnd);
  } else {
    const h = range(rnd, 4.5, 8);
    prop.cylinder(x, PAVE_Y + h * 0.4, z, 0.26, 0.18, h * 0.8, 6, 0x453528, 0.35);
    const r = range(rnd, 1.9, 3.1);
    fol.blob(x, PAVE_Y + h * 0.85, z, r, r * 0.86, r, 7, 3, 0x2d6b3f, 0.35, rnd);
    if (rnd() > 0.5)
      fol.blob(x + rnd() - 0.5, PAVE_Y + h * 1.1, z + rnd() - 0.5, r * 0.6, r * 0.55, r * 0.6, 6, 2, 0x357a48, 0.3, rnd);
  }
  ctx.grid.box(x, z, 0.6, 0.6, 1.6);
}

/** Benches, bins, hydrants, bus stops and post boxes along a pavement run. */
function furniture(
  ctx: WorldCtx,
  rnd: Rnd,
  spec: DistrictSpec,
  axis: "x" | "z",
  from: number,
  to: number,
  fixed: number,
  facing: Facing,
) {
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const sign = ctx.bank.bucket("sign", ctx.mat.sign);
  const [fx, fz] = FACE_DIR[facing];

  const span = to - from;
  const count = Math.max(1, Math.round((span / 26) * (1 + spec.crowd)));
  for (let n = 0; n < count; n++) {
    const t = from + ((n + 0.5) / count) * span + range(rnd, -4, 4);
    const x = axis === "x" ? t : fixed;
    const z = axis === "x" ? fixed : t;
    const roll = rnd();

    /*
     * Every piece of this is solid. None of it used to be — the bus shelter was
     * the only thing on the pavement with a collider, so a bench, a bin, a
     * hydrant and a stack of news boxes were all scenery you walked straight
     * through. Tops are the real height of the prop, which is what decides
     * whether you have to go round it or can jump it.
     */
    if (roll < 0.26) {
      // bench facing the road
      prop.box(x, PAVE_Y + 0.46, z, axis === "x" ? 1.8 : 0.6, 0.1, axis === "x" ? 0.6 : 1.8, {
        tint: 0x6b5030,
      });
      prop.box(
        x - fx * 0.24,
        PAVE_Y + 0.74,
        z - fz * 0.24,
        axis === "x" ? 1.8 : 0.12,
        0.56,
        axis === "x" ? 0.12 : 1.8,
        { tint: 0x6b5030 },
      );
      ctx.grid.box(x, z, axis === "x" ? 1.8 : 0.72, axis === "x" ? 0.72 : 1.8, 1.02);
    } else if (roll < 0.48) {
      prop.cylinder(x, PAVE_Y + 0.55, z, 0.34, 0.38, 1.1, 8, 0x3f3b4a, 0.3);
      ctx.grid.box(x, z, 0.76, 0.76, 0.93);
    } else if (roll < 0.58) {
      prop.cylinder(x, PAVE_Y + 0.38, z, 0.17, 0.15, 0.76, 6, 0xc23a2a, 0.2);
      prop.box(x, PAVE_Y + 0.8, z, 0.5, 0.14, 0.2, { tint: 0xc23a2a });
      ctx.grid.box(x, z, 0.5, 0.5, 0.87);
    } else if (roll < 0.68 && spec.crowd > 0.6) {
      // bus shelter, glazed back, lit panel
      prop.box(x, PAVE_Y + 1.35, z, axis === "x" ? 4.2 : 1.6, 0.1, axis === "x" ? 1.6 : 4.2, {
        tint: 0x2c2a36,
      });
      for (const s of [-1, 1] as const) {
        prop.box(
          axis === "x" ? x + s * 2 : x,
          PAVE_Y + 0.7,
          axis === "x" ? z : z + s * 2,
          0.14,
          1.4,
          0.14,
          { tint: 0x3a3744 },
        );
      }
      sign.panel(
        x - fx * 0.7,
        PAVE_Y + 1.0,
        z - fz * 0.7,
        1.3,
        1.7,
        FACE_ROT[facing],
        0xffffff,
        atlasUv(irange(rnd, 0, 31)),
      );
      ctx.grid.box(x, z, axis === "x" ? 4.2 : 1.6, axis === "x" ? 1.6 : 4.2, 1.4);
    } else if (roll < 0.76) {
      // parking / street sign on a post
      prop.cylinder(x, PAVE_Y + 1.2, z, 0.06, 0.06, 2.4, 5, 0x6e6a78, 0.2);
      prop.box(x, PAVE_Y + 2.2, z, axis === "x" ? 0.7 : 0.06, 0.5, axis === "x" ? 0.06 : 0.7, {
        tint: 0xb8b2c0,
      });
      // thin enough to walk round, not thin enough to walk through, and tall
      // enough that a jump can't leave you standing on top of a pole
      ctx.grid.box(x, z, 0.34, 0.34, 2.4);
    } else if (roll < 0.84) {
      // newspaper boxes, clustered
      for (let b = 0; b < 3; b++) {
        prop.box(
          x + (axis === "x" ? b * 0.65 : 0),
          PAVE_Y + 0.5,
          z + (axis === "x" ? 0 : b * 0.65),
          0.55,
          1.0,
          0.55,
          { tint: pick(rnd, [0xc4392a, 0x2a6bc4, 0x2ac47a]) },
        );
      }
      ctx.grid.box(
        x + (axis === "x" ? 0.65 : 0),
        z + (axis === "x" ? 0 : 0.65),
        axis === "x" ? 1.85 : 0.55,
        axis === "x" ? 0.55 : 1.85,
        0.99,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* kerbside parking                                                    */
/* ------------------------------------------------------------------ */

function kerbParking(
  ctx: WorldCtx,
  rnd: Rnd,
  spec: DistrictSpec,
  axis: "x" | "z",
  from: number,
  to: number,
  roadCentre: number,
  side: -1 | 1,
  width: number,
) {
  if (spec.traffic < 0.25) return;
  const lane = roadCentre + side * (width / 2 - 1.9);
  // gaps at the kerb, so the street has somewhere to step off into
  for (let t = from + 6; t < to - 6; t += range(rnd, 7.5, 14)) {
    if (rnd() > 0.32) continue;
    ctx.parked.push({
      x: axis === "x" ? t : lane,
      z: axis === "x" ? lane : t,
      rot: axis === "x" ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : side > 0 ? Math.PI : 0,
      kind: irange(rnd, 0, 5),
    });
  }
}

/* ------------------------------------------------------------------ */
/* the cell dispatcher                                                 */
/* ------------------------------------------------------------------ */

export function buildCell(ctx: WorldCtx, i: number, j: number) {
  const terrain = terrainAt(i, j);
  if (terrain === "water") return;
  const spec = DISTRICTS[terrain];
  const rnd = cellRng(i, j, 17);
  const r = blockRect(i, j);

  if (terrain === "park") {
    buildPark(ctx, rnd, spec, r);
    return;
  }

  pavement(ctx, i, j, rnd);

  // Coastal cells give up their seaward half to sand; the rest builds as normal.
  const seaward = r.x1 > SAND_X;
  const bx1Limit = seaward ? Math.min(r.x1 - r.paveE, SAND_X) : r.x1 - r.paveE;

  const bx0 = r.x0 + r.paveW;
  const bx1 = bx1Limit;
  const bz0 = r.z0 + r.paveN;
  const bz1 = r.z1 - r.paveS;
  if (bx1 - bx0 < 10 || bz1 - bz0 < 10) return;

  const dN = range(rnd, spec.depth[0], spec.depth[1]);
  const dS = range(rnd, spec.depth[0], spec.depth[1]);
  const dW = range(rnd, spec.depth[0], spec.depth[1]);
  const dE = range(rnd, spec.depth[0], spec.depth[1]);

  edgeRow(ctx, rnd, spec, terrain, "x", bx0, bx1, bz0 + dN / 2, dN, 1);
  edgeRow(ctx, rnd, spec, terrain, "x", bx0, bx1, bz1 - dS / 2, dS, 0);
  const wz0 = bz0 + dN;
  const wz1 = bz1 - dS;
  if (wz1 - wz0 > 8) {
    edgeRow(ctx, rnd, spec, terrain, "z", wz0, wz1, bx0 + dW / 2, dW, 3);
    if (!seaward) edgeRow(ctx, rnd, spec, terrain, "z", wz0, wz1, bx1 - dE / 2, dE, 2);
  }

  /* -------- what's left in the middle -------- */
  const ix0 = bx0 + dW;
  const ix1 = seaward ? bx1 : bx1 - dE;
  const iz0 = bz0 + dN;
  const iz1 = bz1 - dS;
  const iw = ix1 - ix0;
  const id = iz1 - iz0;
  if (iw > 10 && id > 10) {
    const roll = rnd();
    if (roll < spec.parking) carPark(ctx, rnd, ix0, ix1, iz0, iz1);
    else if (roll < spec.parking + 0.32)
      alley(ctx, rnd, ix0, ix1, iz0, iz1, `${spec.name} ALLEY`);
    else courtyard(ctx, rnd, spec, ix0, ix1, iz0, iz1);
  } else if (iw > 4 && id > 4) {
    alley(ctx, rnd, ix0, ix1, iz0, iz1, `${spec.name} ALLEY`);
  }

  /* -------- pavement life -------- */
  furniture(ctx, rnd, spec, "x", r.x0 + 4, r.x1 - 4, r.z0 + r.paveN / 2, 1);
  furniture(ctx, rnd, spec, "x", r.x0 + 4, r.x1 - 4, r.z1 - r.paveS / 2, 0);
  furniture(ctx, rnd, spec, "z", r.z0 + 4, r.z1 - 4, r.x0 + r.paveW / 2, 3);
  if (!seaward) furniture(ctx, rnd, spec, "z", r.z0 + 4, r.z1 - 4, r.x1 - r.paveE / 2, 2);

  if (spec.trees > 0) {
    const treeStep = Math.max(9, 60 / spec.trees);
    for (let x = r.x0 + 6; x < r.x1 - 5; x += treeStep) {
      tree(ctx, rnd, x, r.z0 + 1.6, spec);
      const back = x + treeStep * 0.5;
      if (back < r.x1 - 5) tree(ctx, rnd, back, r.z1 - 1.6, spec);
    }
  }

  /* -------- kerbside parking on the roads around the block -------- */
  kerbParking(ctx, rnd, spec, "x", r.x0, r.x1, r.z0 - roadWidth(j - HALF) / 2, 1, roadWidth(j - HALF));
  kerbParking(ctx, rnd, spec, "z", r.z0, r.z1, r.x0 - roadWidth(i - HALF) / 2, 1, roadWidth(i - HALF));
}

/* ------------------------------------------------------------------ */
/* parks                                                               */
/* ------------------------------------------------------------------ */

function buildPark(
  ctx: WorldCtx,
  rnd: Rnd,
  spec: DistrictSpec,
  r: ReturnType<typeof blockRect>,
) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;

  const grassB = ctx.bank.bucket("grass", ctx.mat.grass);
  grassB.box(cx, 0.1, cz, w, 0.2, d, { uvScale: [8, 8], shade: false });
  ctx.grid.box(cx, cz, w, d, 0.2);

  // diagonal paths meeting at a plaza in the middle
  const pave = ctx.bank.bucket("pave", ctx.mat.pavement);
  pave.ground(cx, cz, w, 5, 0.22, { uvScale: 4 });
  pave.ground(cx, cz, 5, d, 0.22, { uvScale: 4 });
  pave.ground(cx, cz, 15, 15, 0.23, { uvScale: 4 });

  // fountain
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);
  prop.cylinder(cx, 0.55, cz, 4.2, 4.0, 0.9, 14, 0x8d8798, 0.2);
  neon.cylinder(cx, 0.75, cz, 3.6, 3.6, 0.1, 14, 0x2a6bb0);
  prop.cylinder(cx, 1.6, cz, 0.8, 0.5, 2.2, 8, 0x9a94a6, 0.2);
  ctx.grid.box(cx, cz, 8.4, 8.4, 1.1);

  // trees, thickest at the edges
  const n = Math.round((w * d) / 260);
  for (let t = 0; t < n; t++) {
    const x = range(rnd, r.x0 + 3, r.x1 - 3);
    const z = range(rnd, r.z0 + 3, r.z1 - 3);
    if (Math.abs(x - cx) < 9 && Math.abs(z - cz) < 9) continue;
    tree(ctx, rnd, x, z, spec);
  }

  // benches round the plaza, lamps down the paths
  const pool = ctx.bank.bucket("pool", ctx.mat.pool);
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const bx = cx + Math.cos(ang) * 11;
    const bz = cz + Math.sin(ang) * 11;
    prop.box(bx, 0.68, bz, 1.9, 0.1, 0.62, { tint: 0x6b5030 });
    ctx.walk.push(new THREE.Vector3(bx, 0.2, bz));
  }
  for (const [lx, lz] of [
    [cx - w * 0.3, cz],
    [cx + w * 0.3, cz],
    [cx, cz - d * 0.3],
    [cx, cz + d * 0.3],
  ] as const) {
    prop.cylinder(lx, 2.4, lz, 0.13, 0.1, 4.8, 6, 0x35323f, 0.4);
    neon.blob(lx, 5.0, lz, 0.32, 0.4, 0.32, 6, 2, 0xffe6bd);
    pool.ground(lx, lz, 14, 14, 0.24, { tint: 0x4a3a1c, uvScale: 14 });
    ctx.lamps.push({ x: lx, z: lz, h: 5 });
  }

  for (let x = r.x0 + 8; x < r.x1 - 6; x += 10) {
    ctx.walk.push(new THREE.Vector3(x, 0.2, cz + range(rnd, -2, 2)));
  }
  for (let z = r.z0 + 8; z < r.z1 - 6; z += 10) {
    ctx.walk.push(new THREE.Vector3(cx + range(rnd, -2, 2), 0.2, z));
  }
}

export { PAVE_Y, GRID };
