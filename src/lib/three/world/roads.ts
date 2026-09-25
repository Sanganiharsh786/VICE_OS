/**
 * The road network — as data first, geometry second.
 *
 * Roads run along every cell boundary of the city grid, which means the
 * network is fully described by two boolean tables (which north-south and
 * east-west segments exist) plus the intersections where they cross. A
 * segment exists when at least one of the cells beside it is land, so the grid
 * ends naturally at the shoreline instead of running off into the sea.
 *
 * Everything else is derived from that: lane centre lines for the traffic
 * simulation, stop lines and signal placement, crossings for pedestrians, and
 * the painted markings. Vehicles navigate this table rather than wandering,
 * which is the difference between traffic and drifting boxes.
 */

import * as THREE from "three";
import {
  CELL,
  GRID,
  HALF,
  LANE_W,
  isAvenue,
  isLand,
  roadWidth,
  terrainAt,
} from "./layout";
import type { MeshBank } from "./builder";
import type { Materials } from "./materials";
import type { CollisionGrid } from "./collision";

/** Line indices run -HALF..HALF; array indices add HALF. */
export const LINES = GRID + 1;

export type Signal = {
  /** Line indices of the two roads that cross here. */
  k: number;
  m: number;
  x: number;
  z: number;
  /** Seconds of offset into the global cycle — makes a green wave. */
  offset: number;
};

export type RoadNet = {
  /** ns[k + HALF][j] — north-south segment on line k crossing cell row j. */
  ns: boolean[][];
  /** ew[m + HALF][i] — east-west segment on line m crossing cell column i. */
  ew: boolean[][];
  /** node[k + HALF][m + HALF] — an intersection exists here. */
  node: boolean[][];
  signals: Signal[];
  /** Quick lookup: is (k, m) signalised? */
  signalAt: (k: number, m: number) => Signal | null;
};

export const lineX = (k: number) => k * CELL;
export const lineZ = (m: number) => m * CELL;

/** Lane centre offset from the road's centre line, for lane `n` (0 = kerb). */
export function laneOffset(line: number, n: number) {
  return LANE_W / 2 + n * LANE_W + (isAvenue(line) ? 0.9 : 0);
}

/** How many lanes each direction gets on this road. */
export function laneCount(line: number) {
  return isAvenue(line) ? 2 : 1;
}

export function buildRoadNet(): RoadNet {
  const ns: boolean[][] = [];
  const ew: boolean[][] = [];

  for (let ki = 0; ki < LINES; ki++) {
    ns[ki] = [];
    for (let j = 0; j < GRID; j++) {
      const west = ki - 1;
      const east = ki;
      ns[ki][j] =
        (west >= 0 && isLand(terrainAt(west, j))) ||
        (east < GRID && isLand(terrainAt(east, j)));
    }
  }
  for (let mi = 0; mi < LINES; mi++) {
    ew[mi] = [];
    for (let i = 0; i < GRID; i++) {
      const north = mi - 1;
      const south = mi;
      ew[mi][i] =
        (north >= 0 && isLand(terrainAt(i, north))) ||
        (south < GRID && isLand(terrainAt(i, south)));
    }
  }

  const node: boolean[][] = [];
  const signals: Signal[] = [];
  const byKey = new Map<number, Signal>();

  for (let ki = 0; ki < LINES; ki++) {
    node[ki] = [];
    for (let mi = 0; mi < LINES; mi++) {
      const arms =
        (mi - 1 >= 0 && ns[ki][mi - 1] ? 1 : 0) +
        (mi < GRID && ns[ki][mi] ? 1 : 0) +
        (ki - 1 >= 0 && ew[mi][ki - 1] ? 1 : 0) +
        (ki < GRID && ew[mi][ki] ? 1 : 0);
      node[ki][mi] = arms >= 2;

      const k = ki - HALF;
      const m = mi - HALF;
      // Signals go where an avenue is involved and it is a real crossroads.
      if (node[ki][mi] && arms >= 3 && (isAvenue(k) || isAvenue(m))) {
        const s: Signal = {
          k,
          m,
          x: lineX(k),
          z: lineZ(m),
          offset: (Math.abs(k) * 1.7 + Math.abs(m) * 1.1) % 16,
        };
        signals.push(s);
        byKey.set(ki * 64 + mi, s);
      }
    }
  }

  return {
    ns,
    ew,
    node,
    signals,
    signalAt: (k, m) => byKey.get((k + HALF) * 64 + (m + HALF)) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

const Y_ROAD = 0.0;
const Y_MARK = 0.035;
const Y_POOL = 0.05;

export type RoadCtx = {
  bank: MeshBank;
  mat: Materials;
  grid: CollisionGrid;
  /** Sidewalk nodes pedestrians and the crowd walk between. */
  walk: THREE.Vector3[];
  /** Places a street lamp casts a pool of light. */
  lamps: { x: number; z: number; h: number }[];
};

/**
 * Lays down the carriageway, the paint and the street furniture that belongs
 * to the road rather than to a block: lamp columns, signal masts, hydrants.
 */
export function buildRoads(ctx: RoadCtx, net: RoadNet) {
  const { bank, mat } = ctx;
  const road = bank.bucket("road", mat.road);
  const mark = bank.bucket("mark", mat.marking);
  const prop = bank.bucket("prop", mat.prop);
  const neon = bank.bucket("neon", mat.neon);
  const pool = bank.bucket("pool", mat.pool);

  /* ---- carriageway: one quad per segment, so nothing overlaps ---- */

  for (let ki = 0; ki < LINES; ki++) {
    const k = ki - HALF;
    const w = roadWidth(k);
    for (let j = 0; j < GRID; j++) {
      if (!net.ns[ki][j]) continue;
      const mTop = j - HALF;
      const mBot = j - HALF + 1;
      const z0 = lineZ(mTop) + roadWidth(mTop) / 2;
      const z1 = lineZ(mBot) - roadWidth(mBot) / 2;
      const len = z1 - z0;
      if (len <= 0) continue;
      road.ground(lineX(k), (z0 + z1) / 2, w, len, Y_ROAD, { uvScale: 9 });
      paintSegment(ctx, k, "ns", lineX(k), z0, z1, w);
    }
  }

  for (let mi = 0; mi < LINES; mi++) {
    const m = mi - HALF;
    const w = roadWidth(m);
    for (let i = 0; i < GRID; i++) {
      if (!net.ew[mi][i]) continue;
      const kL = i - HALF;
      const kR = i - HALF + 1;
      const x0 = lineX(kL) + roadWidth(kL) / 2;
      const x1 = lineX(kR) - roadWidth(kR) / 2;
      const len = x1 - x0;
      if (len <= 0) continue;
      road.ground((x0 + x1) / 2, lineZ(m), len, w, Y_ROAD, { uvScale: 9 });
      paintSegment(ctx, m, "ew", lineZ(m), x0, x1, w);
    }
  }

  /* ---- intersections ---- */

  for (let ki = 0; ki < LINES; ki++) {
    for (let mi = 0; mi < LINES; mi++) {
      if (!net.node[ki][mi]) continue;
      const k = ki - HALF;
      const m = mi - HALF;
      const wk = roadWidth(k);
      const wm = roadWidth(m);
      const x = lineX(k);
      const z = lineZ(m);
      road.ground(x, z, wk, wm, Y_ROAD, { uvScale: 9 });

      // zebra on every arm that exists
      const arms: [number, number, boolean][] = [
        [0, -1, mi - 1 >= 0 && net.ns[ki][mi - 1]],
        [0, 1, mi < GRID && net.ns[ki][mi]],
        [-1, 0, ki - 1 >= 0 && net.ew[mi][ki - 1]],
        [1, 0, ki < GRID && net.ew[mi][ki]],
      ];
      for (const [ax, az, exists] of arms) {
        if (!exists) continue;
        zebra(mark, x, z, ax, az, wk, wm);
      }

      const sig = net.signalAt(k, m);
      if (sig) {
        for (const [ax, az, exists] of arms) {
          if (!exists) continue;
          signalMast(ctx, x, z, ax, az, wk, wm, prop, neon);
        }
      }
    }
  }

  /* ---- street lamps down every segment ---- */

  for (let ki = 0; ki < LINES; ki++) {
    const k = ki - HALF;
    const w = roadWidth(k);
    for (let j = 0; j < GRID; j++) {
      if (!net.ns[ki][j]) continue;
      const z0 = lineZ(j - HALF) + roadWidth(j - HALF) / 2;
      const z1 = lineZ(j - HALF + 1) - roadWidth(j - HALF + 1) / 2;
      for (let z = z0 + 16; z < z1 - 8; z += 30) {
        const side = ((z / 30) | 0) % 2 === 0 ? 1 : -1;
        streetLamp(ctx, lineX(k) + side * (w / 2 + 1.4), z, -side * Math.PI / 2, prop, neon, pool);
      }
    }
  }
  for (let mi = 0; mi < LINES; mi++) {
    const m = mi - HALF;
    const w = roadWidth(m);
    for (let i = 0; i < GRID; i++) {
      if (!net.ew[mi][i]) continue;
      const x0 = lineX(i - HALF) + roadWidth(i - HALF) / 2;
      const x1 = lineX(i - HALF + 1) - roadWidth(i - HALF + 1) / 2;
      for (let x = x0 + 16; x < x1 - 8; x += 30) {
        const side = ((x / 30) | 0) % 2 === 0 ? 1 : -1;
        streetLamp(ctx, x, lineZ(m) + side * (w / 2 + 1.4), side > 0 ? 0 : Math.PI, prop, neon, pool);
      }
    }
  }
}

/** Centre line, lane divisions and the odd arrow. */
function paintSegment(
  ctx: RoadCtx,
  line: number,
  axis: "ns" | "ew",
  fixed: number,
  a: number,
  b: number,
  width: number,
) {
  const mark = ctx.bank.bucket("mark", ctx.mat.marking);
  const rot = axis === "ns" ? 0 : Math.PI / 2;
  const at = (t: number) =>
    axis === "ns" ? ([fixed, t] as const) : ([t, fixed] as const);

  // double yellow down the middle of an avenue, dashed white on a street
  if (isAvenue(line)) {
    for (const o of [-0.45, 0.45]) {
      const len = b - a;
      const [cx, cz] = at((a + b) / 2);
      mark.ground(
        axis === "ns" ? cx + o : cx,
        axis === "ns" ? cz : cz + o,
        axis === "ns" ? 0.22 : len,
        axis === "ns" ? len : 0.22,
        Y_MARK,
        { tint: 0xe8c65a },
      );
    }
    // lane divider between the two lanes each way
    for (const o of [-LANE_W - 0.9, LANE_W + 0.9]) {
      for (let t = a + 2; t < b - 4; t += 9) {
        const [cx, cz] = at(t + 2.25);
        mark.ground(
          axis === "ns" ? cx + o : cx,
          axis === "ns" ? cz : cz + o,
          axis === "ns" ? 0.18 : 4.5,
          axis === "ns" ? 4.5 : 0.18,
          Y_MARK,
          { tint: 0xd8d4c4 },
        );
      }
    }
  } else {
    for (let t = a + 2; t < b - 5; t += 10) {
      const [cx, cz] = at(t + 2.5);
      mark.ground(
        cx,
        cz,
        axis === "ns" ? 0.2 : 5,
        axis === "ns" ? 5 : 0.2,
        Y_MARK,
        { tint: 0xd8d4c4 },
      );
    }
  }

  // solid kerb-side edge line
  for (const s of [-1, 1]) {
    const o = s * (width / 2 - 0.55);
    const len = b - a;
    const [cx, cz] = at((a + b) / 2);
    mark.ground(
      axis === "ns" ? cx + o : cx,
      axis === "ns" ? cz : cz + o,
      axis === "ns" ? 0.16 : len,
      axis === "ns" ? len : 0.16,
      Y_MARK,
      { tint: 0xbfbbac },
    );
  }
  void rot;
}

function zebra(
  mark: ReturnType<MeshBank["bucket"]>,
  x: number,
  z: number,
  ax: number,
  az: number,
  wk: number,
  wm: number,
) {
  // the crossing sits just outside the junction box on the given arm
  const along = ax !== 0 ? wk / 2 + 2.4 : wm / 2 + 2.4;
  const cx = x + ax * along;
  const cz = z + az * along;
  const span = ax !== 0 ? wk : wm;
  const stripes = Math.max(4, Math.round(span / 1.5));
  for (let s = 0; s < stripes; s++) {
    const t = (s / (stripes - 1) - 0.5) * (span - 1.2);
    if (ax !== 0) {
      mark.ground(cx, cz + t, 3.6, 0.62, Y_MARK, { tint: 0xe6e2d4 });
    } else {
      mark.ground(cx + t, cz, 0.62, 3.6, Y_MARK, { tint: 0xe6e2d4 });
    }
  }
  // stop line behind the crossing
  const stop = along + 2.6;
  if (ax !== 0) {
    mark.ground(x + ax * stop, z + (az || 1) * 0, 0.4, span * 0.48, Y_MARK, {
      tint: 0xe6e2d4,
    });
  } else {
    mark.ground(x, z + az * stop, span * 0.48, 0.4, Y_MARK, { tint: 0xe6e2d4 });
  }
}

/**
 * A signal head on a mast arm reaching over the carriageway. The lamps
 * themselves are instanced separately so their colour can change; what gets
 * welded here is the column, the arm and the dark visor box.
 */
function signalMast(
  ctx: RoadCtx,
  x: number,
  z: number,
  ax: number,
  az: number,
  wk: number,
  wm: number,
  prop: ReturnType<MeshBank["bucket"]>,
  neon: ReturnType<MeshBank["bucket"]>,
) {
  const off = ax !== 0 ? wk / 2 + 2.2 : wm / 2 + 2.2;
  // the mast stands on the near-right kerb of the approach
  const lat = (ax !== 0 ? wm : wk) / 2 + 1.6;
  const px = x + ax * off + (ax !== 0 ? 0 : lat) * 0;
  const pz = z + az * off;
  const bx = ax !== 0 ? px : px + lat;
  const bz = ax !== 0 ? pz + lat : pz;

  prop.cylinder(bx, 3.1, bz, 0.16, 0.13, 6.2, 6, 0x3b3d47, 0.35);
  ctx.grid.box(bx, bz, 0.5, 0.5, 6.2);

  // arm reaching toward the middle of the road
  const reach = 4.2;
  const dx = ax !== 0 ? 0 : -1;
  const dz = ax !== 0 ? -1 : 0;
  prop.box(bx + dx * reach * 0.5, 6.0, bz + dz * reach * 0.5, ax !== 0 ? 0.14 : reach, 0.14, ax !== 0 ? reach : 0.14, { tint: 0x3b3d47 });

  const hx = bx + dx * reach;
  const hz = bz + dz * reach;
  prop.box(hx, 5.35, hz, 0.42, 1.24, 0.42, { tint: 0x1a1b22 });
  void neon;
  ctx.lamps.push({ x: hx, z: hz, h: 5.35 });
}

/**
 * Street lamp: column, arm, a lit head and — the part that does the real work
 * — an additive disc on the tarmac underneath. That pool is what sells a lit
 * street at night without a single dynamic light in the scene.
 */
function streetLamp(
  ctx: RoadCtx,
  x: number,
  z: number,
  facing: number,
  prop: ReturnType<MeshBank["bucket"]>,
  neon: ReturnType<MeshBank["bucket"]>,
  pool: ReturnType<MeshBank["bucket"]>,
) {
  const h = 8.4;
  prop.cylinder(x, h / 2, z, 0.19, 0.12, h, 7, 0x35323f, 0.4);
  const reach = 2.4;
  const dx = Math.cos(facing) * reach;
  const dz = -Math.sin(facing) * reach;
  prop.box(x + dx * 0.5, h - 0.35, z + dz * 0.5, Math.abs(dx) || 0.16, 0.16, Math.abs(dz) || 0.16, {
    tint: 0x35323f,
  });
  const hx = x + dx;
  const hz = z + dz;
  prop.box(hx, h - 0.62, hz, 0.7, 0.2, 0.44, { tint: 0x2a2833 });
  // the lit lens
  neon.box(hx, h - 0.76, hz, 0.58, 0.1, 0.34, { tint: 0xffd9a0, shade: false });
  // spill on the ground — uvScale matches the quad so the disc fills it once
  pool.ground(hx, hz, 17, 17, Y_POOL, { tint: 0x6b4a22, uvScale: 17 });
  ctx.grid.box(x, z, 0.5, 0.5, h);
  ctx.lamps.push({ x: hx, z: hz, h });
}
