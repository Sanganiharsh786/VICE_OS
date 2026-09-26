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
import { stopLineAt, type SignalLamp } from "./signals";
import type { AdSite } from "./types";

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
  /** Every animated signal lens the masts below put up. */
  heads: SignalLamp[];
  /** Kerbside advertising hoardings, filled in by `ads.ts`. */
  ads: AdSite[];
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
  const metal = bank.bucket("metal", mat.metal);
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
          signalMast(ctx, sig, ax, az, wk, wm, prop, metal);
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

  /* ---- where the city sells its wall space ---- */
  billboardSites(ctx, net);
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
  // stop line behind the crossing — the same number traffic.ts brakes to
  const stop = stopLineAt(ax !== 0 ? wk : wm);
  if (ax !== 0) {
    mark.ground(x + ax * stop, z + (az || 1) * 0, 0.4, span * 0.48, Y_MARK, {
      tint: 0xe6e2d4,
    });
  } else {
    mark.ground(x, z + az * stop, span * 0.48, 0.4, Y_MARK, { tint: 0xe6e2d4 });
  }
}

/**
 * One signalised approach, built like the real thing.
 *
 * The old version was a pole, a plain beam and a single 42cm box, and the three
 * coloured lamps were positioned by a completely separate piece of arithmetic
 * in `city.ts` that disagreed with it — so what the player actually saw was a
 * dark box on a stick with a vertical row of glowing dots hanging in the air a
 * few metres to one side. This builds the whole assembly in one place and
 * publishes the lens positions it used, which is the only way the two can't
 * drift apart again.
 *
 * What a signal head needs to read as a signal head, in rough order of how
 * much each one buys:
 *
 *  - a **backplate**: the wide dark board with a bright surround. Against a
 *    daylit sky the housing alone is a silhouette; the board is what gives the
 *    lenses something to be bright against
 *  - **visors**: a hood over each lens, with cheeks down either side. These are
 *    what stop it looking like three dots painted on a panel
 *  - a **mast arm** long enough to put the head over the lane rather than over
 *    the kerb, with a gusset under it so it doesn't look welded on
 *  - a **pedestrian head** on the pole, facing across the crossing
 *
 * `ax`/`az` point out along the approach, so traffic arrives travelling `-a`
 * and everything here faces `+a`.
 */
function signalMast(
  ctx: RoadCtx,
  sig: Signal,
  ax: number,
  az: number,
  wk: number,
  wm: number,
  prop: ReturnType<MeshBank["bucket"]>,
  metal: ReturnType<MeshBank["bucket"]>,
) {
  const { x, z } = sig;
  const axis: 0 | 1 = ax === 0 ? 0 : 1;
  /** Junction extent along the approach, i.e. the width of the cross road. */
  const crossW = ax !== 0 ? wk : wm;
  /** The approach road's own width. */
  const roadW = ax !== 0 ? wm : wk;

  /*
   * Right hand of the traffic coming in. Heading is (-ax, -az), and `place()`
   * in traffic.ts has a car driving +z keeping to -x, which makes right
   * (-hz, hx) — so (az, -ax) here.
   */
  const rx = az;
  const rz = -ax;

  // the mast stands on the near-right kerb, just behind the stop line
  const along = stopLineAt(crossW) + 0.7;
  const poleOff = roadW / 2 + 1.5;
  // the head hangs over the middle of the lanes that are approaching us
  const headOff = roadW * 0.22;

  const at = (a: number, lat: number) =>
    [x + ax * a + rx * lat, z + az * a + rz * lat] as const;

  /**
   * A box measured in (along-approach, up, across-approach). `turned` swaps the
   * first and last, for the pedestrian head that looks across the road rather
   * than down it.
   */
  const slab = (
    cx: number,
    cy: number,
    cz: number,
    sAlong: number,
    sUp: number,
    sAcross: number,
    tint: number,
    turned = false,
  ) => {
    const alongX = turned ? ax === 0 : ax !== 0;
    if (alongX) prop.box(cx, cy, cz, sAlong, sUp, sAcross, { tint });
    else prop.box(cx, cy, cz, sAcross, sUp, sAlong, { tint });
  };

  /* ---- foundation, pole ---- */
  const POLE_H = 6.5;
  const [px, pz] = at(along, poleOff);
  prop.cylinder(px, 0.24, pz, 0.34, 0.3, 0.48, 10, 0x2d2f38, 0.25);
  prop.cylinder(px, 0.48 + POLE_H / 2, pz, 0.15, 0.115, POLE_H, 10, 0x434654, 0.35);
  ctx.grid.box(px, pz, 0.58, 0.58, 0.48 + POLE_H);

  /* ---- mast arm and its gusset ---- */
  const armY = 6.34;
  const [hx, hz] = at(along, headOff);
  const [tipX, tipZ] = at(along, headOff - 0.55);
  metal.bar(px, armY, pz, tipX, armY, tipZ, 0.15, 0x4e5262);
  const [gx, gz] = at(along, poleOff - (poleOff - headOff) * 0.36);
  metal.bar(px, armY - 1.25, pz, gx, armY - 0.07, gz, 0.085, 0x4e5262);
  // the drop tube the housing hangs from
  slab(hx, armY - 0.44, hz, 0.12, 0.74, 0.12, 0x434654);

  /* ---- backplate: bright surround, dark board ---- */
  const headY = 5.02;
  slab(hx + ax * 0.015, headY, hz + az * 0.015, 0.05, 1.94, 1.2, 0xdcb229);
  slab(hx + ax * 0.055, headY, hz + az * 0.055, 0.05, 1.78, 1.04, 0x14151b);

  /* ---- housing, with a visor over every lens ---- */
  /** Red on top, amber, green — the offsets the lenses sit at. */
  const LENS_Y = [0.585, 0, -0.585];
  slab(hx + ax * 0.2, headY, hz + az * 0.2, 0.3, 1.82, 0.54, 0x191a21);
  for (const dy of LENS_Y) {
    const y = headY + dy;
    // hood
    slab(hx + ax * 0.42, y + 0.27, hz + az * 0.42, 0.46, 0.055, 0.54, 0x0f1016);
    // cheeks either side of the lens
    for (const s of [-1, 1] as const) {
      slab(
        hx + rx * s * 0.25 + ax * 0.42,
        y + 0.07,
        hz + rz * s * 0.25 + az * 0.42,
        0.46,
        0.44,
        0.04,
        0x0f1016,
      );
    }
  }

  const yaw = Math.atan2(ax, az);
  LENS_Y.forEach((dy, slot) => {
    ctx.heads.push({
      x: hx + ax * 0.44,
      y: headY + dy,
      z: hz + az * 0.44,
      rot: yaw,
      r: 0.148,
      axis,
      offset: sig.offset,
      slot: slot as 0 | 1 | 2,
    });
  });

  /* ---- pedestrian head, looking across the crossing ---- */
  const pedY = 2.72;
  const [qx, qz] = at(along, poleOff - 0.36);
  slab(qx, pedY, qz, 0.24, 0.9, 0.62, 0x14151b, true);
  slab(qx - rx * 0.13, pedY + 0.49, qz - rz * 0.13, 0.5, 0.05, 0.62, 0x0f1016, true);
  const pedYaw = Math.atan2(-rx, -rz);
  for (const [dy, slot] of [
    [0.2, 3],
    [-0.2, 4],
  ] as const) {
    ctx.heads.push({
      x: qx - rx * 0.15,
      y: pedY + dy,
      z: qz - rz * 0.15,
      rot: pedYaw,
      r: 0.105,
      axis,
      offset: sig.offset,
      slot,
    });
  }

  /* ---- a push-button box, because the crossing has one ---- */
  slab(px - rx * 0.2, 1.05, pz - rz * 0.2, 0.16, 0.3, 0.2, 0x2d5a3a, true);
}

/**
 * Kerbside advertising hoardings down the avenues.
 *
 * Only the sites are chosen here — the frame and the screen are built by
 * `ads.ts`, which owns every board in the city so they can share one atlas and
 * one draw call. They are spaced off the street-lamp rhythm on purpose: a lamp
 * every 30m and a board every 56m never land on the same spot.
 */
function billboardSites(ctx: RoadCtx, net: RoadNet) {
  for (let ki = 0; ki < LINES; ki++) {
    const k = ki - HALF;
    if (!isAvenue(k)) continue;
    const w = roadWidth(k);
    for (let j = 0; j < GRID; j++) {
      if (!net.ns[ki][j]) continue;
      const z0 = lineZ(j - HALF) + roadWidth(j - HALF) / 2;
      const z1 = lineZ(j - HALF + 1) - roadWidth(j - HALF + 1) / 2;
      for (let z = z0 + 31; z < z1 - 14; z += 56) {
        const side = (((z + k * 7) / 56) | 0) % 2 === 0 ? 1 : -1;
        ctx.ads.push({
          x: lineX(k) + side * (w / 2 + 3.4),
          y: 4.5,
          z,
          // `panel`'s quad faces (sin rot, 0, cos rot): a board east of the
          // road has to look back west at the traffic on it
          rot: side > 0 ? -Math.PI / 2 : Math.PI / 2,
          w: 7.4,
          h: 3.7,
          kind: "kerb",
        });
      }
    }
  }
  for (let mi = 0; mi < LINES; mi++) {
    const m = mi - HALF;
    if (!isAvenue(m)) continue;
    const w = roadWidth(m);
    for (let i = 0; i < GRID; i++) {
      if (!net.ew[mi][i]) continue;
      const x0 = lineX(i - HALF) + roadWidth(i - HALF) / 2;
      const x1 = lineX(i - HALF + 1) - roadWidth(i - HALF + 1) / 2;
      for (let x = x0 + 31; x < x1 - 14; x += 56) {
        const side = (((x + m * 7) / 56) | 0) % 2 === 0 ? 1 : -1;
        ctx.ads.push({
          x,
          y: 4.5,
          z: lineZ(m) + side * (w / 2 + 3.4),
          rot: side > 0 ? Math.PI : 0,
          w: 7.4,
          h: 3.7,
          kind: "kerb",
        });
      }
    }
  }
}

/**
 * Street lamp: column, arm, a lit head and a faint additive disc on the tarmac
 * underneath. The pool used to be the thing that sold a lit street; in a city
 * that is always mid-morning it is barely there, and the lamp is street
 * furniture you walk past rather than a light source.
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
