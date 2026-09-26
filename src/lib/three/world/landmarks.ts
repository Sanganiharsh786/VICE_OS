/**
 * The things you navigate by.
 *
 * A grid city with no landmarks is a maze: every junction looks like the last
 * one and the player has no way to build a mental map. These are deliberately
 * over-scaled and placed so that at least one of them is visible from almost
 * anywhere — the tower from downtown, the stadium from the west, the wheel and
 * the lighthouse from the whole length of the beach.
 *
 * They are also the city's LANDMARK evidence: put one in a photograph and you
 * have geotagged yourself more precisely than the EXIF would.
 */

import * as THREE from "three";
import { SHORE_X, type WorldCtx } from "./blocks";
import { TILE_H, TILE_W, atlasUv, signTexture } from "./textures";
import { cellRng, pick } from "./rng";

/** Registers a landmark as a photographable subject. */
function markEvidence(
  ctx: WorldCtx,
  label: string,
  x: number,
  y: number,
  z: number,
  radius: number,
) {
  const anchor = new THREE.Object3D();
  anchor.position.set(x, y, z);
  anchor.updateMatrixWorld();
  ctx.group.add(anchor);
  ctx.evidence.push({
    kind: "LANDMARK",
    label,
    object: anchor,
    offset: new THREE.Vector3(),
    radius,
  });
}

export function buildLandmarks(ctx: WorldCtx) {
  leonidaTower(ctx);
  stadium(ctx);
  observationWheel(ctx);
  lighthouse(ctx);
  convention(ctx);
  station(ctx);
}

/* ------------------------------------------------------------------ */

/** The one building you can see from every district. */
function leonidaTower(ctx: WorldCtx) {
  const x = 62;
  const z = -58;
  const h = 210;
  const shaft = ctx.bank.bucket("facade:tower:0", ctx.mat.facade.tower[0]);
  const metal = ctx.bank.bucket("metal", ctx.mat.metal);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);

  // four stepped stages, each narrower than the last
  let y = 0;
  let w = 40;
  for (let s = 0; s < 4; s++) {
    const seg = h * [0.42, 0.26, 0.18, 0.1][s];
    shaft.box(x, y + seg / 2, z, w, seg, w, {
      tint: 0xe8ecf5,
      uvScale: [TILE_W, TILE_H],
      snapUv: true,
      ao: s === 0 ? 0.4 : 0.1,
    });
    // setback terrace
    metal.box(x, y + seg + 0.6, z, w + 2.2, 1.2, w + 2.2, { tint: 0x6f6a80 });
    // vertical light ribs up each corner
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      neon.box(x + (ox * w) / 2, y + seg / 2, z + (oz * w) / 2, 0.5, seg, 0.5, {
        tint: 0x22e6ff,
        shade: false,
      });
    }
    y += seg + 1.2;
    w *= 0.72;
  }

  // crown + mast
  metal.cylinder(x, y + 12, z, 5, 1.2, 24, 8, 0x8a84a0, 0.2);
  metal.cylinder(x, y + 34, z, 0.6, 0.2, 22, 5, 0x6f6a80, 0.2);
  neon.blob(x, y + 45, z, 1.4, 1.6, 1.4, 6, 3, 0xff2b2b);

  // the name, big enough to read from the beach
  const nameTex = signTexture("LEONIDA", "#22e6ff");
  ctx.keep(nameTex);
  const nameMat = new THREE.MeshBasicMaterial({
    map: nameTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  ctx.keep(nameMat);
  const nameB = ctx.bank.bucket("towerName", nameMat);
  for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    nameB.panel(
      x + Math.sin(rot) * 21,
      h * 0.44,
      z + Math.cos(rot) * 21,
      26,
      7.4,
      rot,
      0xffffff,
    );
  }

  ctx.grid.box(x, z, 42, 42, h);
  markEvidence(ctx, "LEONIDA TOWER", x, h * 0.44, z, 16);
  ctx.lamps.push({ x, z, h: 40 });
}

/** Stadium out west — a ring of stands under a ribbed roof. */
function stadium(ctx: WorldCtx) {
  const x = -300;
  const z = 180;
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const metal = ctx.bank.bucket("metal", ctx.mat.metal);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);
  const grass = ctx.bank.bucket("grass", ctx.mat.grass);
  const rnd = cellRng(2, 9, 13);

  grass.ground(x, z, 70, 46, 0.3, { uvScale: 8 });

  const R = 52;
  const sides = 24;
  for (let s = 0; s < sides; s++) {
    const a0 = (s / sides) * Math.PI * 2;
    const a1 = ((s + 1) / sides) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const cx = x + Math.cos(am) * R * 1.12;
    const cz = z + Math.sin(am) * R * 0.86;
    const seg = (Math.PI * 2 * R) / sides;
    // stand
    prop.box(cx, 11, cz, seg * 1.5, 22, 22, { tint: 0x4a4658 });
    // roof panel, cantilevered inward
    metal.box(
      x + Math.cos(am) * R * 0.96,
      24,
      z + Math.sin(am) * R * 0.74,
      seg * 1.6,
      1.2,
      26,
      { tint: 0x8a84a0 },
    );
    if (s % 3 === 0) {
      neon.box(
        x + Math.cos(am) * R * 0.86,
        23,
        z + Math.sin(am) * R * 0.66,
        seg,
        0.5,
        1.2,
        { tint: pick(rnd, [0x22e6ff, 0xff2e97, 0x9dff3d]), shade: false },
      );
    }
  }
  // floodlight pylons
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const px = x + ox * R * 1.15;
    const pz = z + oz * R * 0.95;
    metal.cylinder(px, 22, pz, 1.2, 0.8, 44, 6, 0x6f6a80, 0.3);
    metal.box(px, 45, pz, 7, 4.5, 1.6, { tint: 0x4a4658 });
    neon.box(px, 45, pz + (oz > 0 ? -0.9 : 0.9), 6.6, 4.1, 0.2, {
      tint: 0xfff0d0,
      shade: false,
    });
    ctx.lamps.push({ x: px, z: pz, h: 45 });
  }

  ctx.grid.box(x, z, 130, 110, 24);
  markEvidence(ctx, "VICE ARENA", x, 30, z, 34);
}

/**
 * Observation wheel over the beach. Turns.
 *
 * The gondolas and the rim used to be built out of the `neon` bucket, which is
 * an additive, depth-write-free material whose opacity the day/night cycle
 * pulls down to 0.32 in daylight. After dark that is exactly right — the wheel
 * is a ring of light over the water. In daylight it meant the whole ride went
 * translucent: you could see the sea straight through the cars, and the rim
 * was a faint smear rather than a structure.
 *
 * So the ride is now solid — painted cars on a steel rim, lit by the sun like
 * everything else — and the neon is reduced to what it should always have
 * been: a light strip on each car and a tube running round the rim beside it.
 * Those still fade out at noon, and the fairground underneath them does not.
 */
function observationWheel(ctx: WorldCtx) {
  const x = SHORE_X - 46;
  const z = 300;
  const metal = ctx.bank.bucket("metal", ctx.mat.metal);
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);
  const R = 34;
  const hubY = R + 8;

  // A-frame legs, leaning in to meet the hub
  for (const oz of [-6, 6]) {
    metal.bar(x - 20, 0, z + oz, x, hubY, z + oz, 1.9, 0x8a84a0);
    metal.bar(x + 20, 0, z + oz, x, hubY, z + oz, 1.9, 0x8a84a0);
  }
  metal.cylinder(x, hubY, z, 2.4, 2.4, 14, 10, 0x9a94b0, 0.2);

  /** Fairground paint: what the cars are, before anything is lit. */
  const LIVERY = [0xe24a86, 0x2fb6d8, 0xf0a63a, 0x7ec845];

  const spokes = 20;
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    const ex = x + Math.cos(a) * R;
    const ey = hubY + Math.sin(a) * R;
    // a spoke is a diagonal member, so it has to be a beam rather than a box
    for (const oz of [-3.5, 3.5]) {
      metal.bar(x, hubY, z + oz, ex, ey, z + oz, 0.35, 0x8f89a8);
    }

    const tint = LIVERY[s % 4];
    // the hanger the car swings from
    metal.box(ex, ey - 0.5, z, 0.3, 1.2, 0.3, { tint: 0x9a94b0 });
    // the car: a painted shell with a glazed band round it
    prop.box(ex, ey - 1.85, z, 2.4, 1.9, 3.2, { tint, ao: 0.3 });
    prop.box(ex, ey - 1.6, z, 2.46, 0.9, 3.26, { tint: 0x16202f, shade: false });
    prop.box(ex, ey - 2.82, z, 2.5, 0.16, 3.3, { tint: 0x6f6a80, shade: false });
    // and the strip of light along its flank, which is all the neon it needs
    neon.box(ex, ey - 2.66, z, 2.54, 0.18, 3.34, { tint, shade: false });
  }

  /*
   * Rim: a steel band, with the light tube running either side of it.
   *
   * Every face goes in twice, wound both ways. A bucket quad is single-sided
   * and these are rings — one winding leaves half the ride invisible depending
   * on which side of the wheel you happen to be standing on, and there is no
   * angle from which that is not obvious.
   */
  const UV: [number, number, number, number, number, number, number, number] =
    [0, 0, 1, 0, 1, 1, 0, 1];
  const bothWays = (
    b: ReturnType<WorldCtx["bank"]["bucket"]>,
    a: THREE.Vector3Like,
    c: THREE.Vector3Like,
    d: THREE.Vector3Like,
    e: THREE.Vector3Like,
    cols: [number, number, number, number],
  ) => {
    b.quad(a, c, d, e, UV, cols);
    b.quad(e, d, c, a, UV, [cols[3], cols[2], cols[1], cols[0]]);
  };

  for (let s = 0; s < spokes * 2; s++) {
    const a0 = (s / (spokes * 2)) * Math.PI * 2;
    const a1 = ((s + 1) / (spokes * 2)) * Math.PI * 2;
    const p = (e: number, dz: number, dr: number) => ({
      x: x + Math.cos(e) * (R + dr),
      y: hubY + Math.sin(e) * (R + dr),
      z: z + dz,
    });
    bothWays(
      metal,
      p(a0, -3.6, 0),
      p(a1, -3.6, 0),
      p(a1, 3.6, 0),
      p(a0, 3.6, 0),
      [0x8f89a8, 0x8f89a8, 0x7d7896, 0x7d7896],
    );
    const lit = s % 2 ? 0x22e6ff : 0xff2e97;
    for (const dz of [-3.7, 3.7]) {
      bothWays(
        neon,
        p(a0, dz, -0.5),
        p(a1, dz, -0.5),
        p(a1, dz, 0.9),
        p(a0, dz, 0.9),
        [lit, lit, lit, lit],
      );
    }
  }

  ctx.grid.box(x, z, 38, 16, hubY);
  markEvidence(ctx, "LEONIDA WHEEL", x, hubY, z, 30);
  ctx.lamps.push({ x, z, h: hubY });
}

/** Lighthouse at the harbour mouth. */
function lighthouse(ctx: WorldCtx) {
  const x = SHORE_X + 78;
  const z = -420;
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);

  // the rock it stands on
  prop.cylinder(x, -1, z, 22, 14, 6, 9, 0x4a4450, 0.3);
  const h = 44;
  // banded tower
  for (let b = 0; b < 7; b++) {
    prop.cylinder(
      x,
      2 + (b + 0.5) * (h / 7),
      z,
      6 - b * 0.55,
      6 - (b + 1) * 0.55,
      h / 7,
      12,
      b % 2 === 0 ? 0xf0e8dc : 0xc4453a,
      0.15,
    );
  }
  prop.cylinder(x, h + 4, z, 4.6, 4.6, 1.2, 12, 0x3a3644, 0.1);
  neon.cylinder(x, h + 6.4, z, 3.4, 3.4, 4, 12, 0xfff3c8);
  prop.cylinder(x, h + 9.4, z, 4.4, 1.2, 3, 12, 0x3a3644, 0.1);

  ctx.grid.box(x, z, 24, 24, h);
  markEvidence(ctx, "POINT LEONIDA LIGHT", x, h + 6, z, 8);
  ctx.lamps.push({ x, z, h: h + 6 });
}

/** Convention centre / shopping mall: a long low shed with a glass drum. */
function convention(ctx: WorldCtx) {
  const x = -150;
  const z = -300;
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const metal = ctx.bank.bucket("metal", ctx.mat.metal);
  const glass = ctx.bank.bucket("glass", ctx.mat.glass);
  const sign = ctx.bank.bucket("sign", ctx.mat.sign);
  const rnd = cellRng(4, 1, 5);

  prop.box(x, 9, z, 120, 18, 74, { tint: 0x3f3b4e, uvScale: [10, 10] });
  metal.box(x, 18.8, z, 124, 1.6, 78, { tint: 0x7a7490 });
  glass.cylinder(x, 14, z - 30, 18, 16, 28, 16, 0x6fd8f0, 0.1);
  metal.cylinder(x, 28.6, z - 30, 17.5, 4, 3, 16, 0x8a84a0, 0.1);
  for (let s = 0; s < 4; s++) {
    sign.panel(
      x - 40 + s * 26,
      14,
      z + 37.4,
      16,
      5,
      0,
      0xffffff,
      atlasUv(Math.floor(rnd() * 32)),
    );
  }
  ctx.grid.box(x, z, 122, 76, 19);
  markEvidence(ctx, "LEONIDA CONVENTION CENTRE", x, 22, z, 26);
}

/** Central station: a barrel-vaulted trainshed with a clock tower. */
function station(ctx: WorldCtx) {
  const x = -60;
  const z = 220;
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const metal = ctx.bank.bucket("metal", ctx.mat.metal);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);

  prop.box(x, 11, z, 96, 22, 44, { tint: 0x7a6250, uvScale: [10, 10] });
  // vault
  const segs = 16;
  for (let s = 0; s < segs; s++) {
    const a0 = Math.PI * (s / segs);
    const a1 = Math.PI * ((s + 1) / segs);
    const R = 24;
    metal.quad(
      { x: x - 48, y: 22 + Math.sin(a0) * R * 0.7, z: z + Math.cos(a0) * R },
      { x: x + 48, y: 22 + Math.sin(a0) * R * 0.7, z: z + Math.cos(a0) * R },
      { x: x + 48, y: 22 + Math.sin(a1) * R * 0.7, z: z + Math.cos(a1) * R },
      { x: x - 48, y: 22 + Math.sin(a1) * R * 0.7, z: z + Math.cos(a1) * R },
      [0, 0, 6, 0, 6, 1, 0, 1],
      [0x8a84a0, 0x8a84a0, 0xa8a2bc, 0xa8a2bc],
    );
  }
  // clock tower
  const tx = x + 52;
  prop.box(tx, 26, z, 14, 52, 14, { tint: 0x7a6250, uvScale: [8, 8] });
  prop.box(tx, 53, z, 16, 2, 16, { tint: 0x5f4d3e });
  neon.box(tx, 47, z + 7.2, 7, 7, 0.3, { tint: 0xffe9a8, shade: false });
  neon.box(tx + 7.2, 47, z, 0.3, 7, 7, { tint: 0xffe9a8, shade: false });
  prop.cylinder(tx, 58, z, 6, 0.5, 9, 8, 0x4a3f38, 0.2);

  ctx.grid.box(x, z, 98, 46, 22);
  ctx.grid.box(tx, z, 14, 14, 52);
  markEvidence(ctx, "LEONIDA CENTRAL STATION", tx, 47, z, 12);
  ctx.lamps.push({ x: tx, z, h: 50 });
}
