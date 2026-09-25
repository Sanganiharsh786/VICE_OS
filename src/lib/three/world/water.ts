/**
 * The coast: ocean, sand, boardwalk, piers, the harbour and the marina.
 *
 * The sea is a single large plane displaced in the vertex shader by a stack of
 * crossing swells, shaded by a Fresnel mix between a deep colour and the sky,
 * with surf breaking where it shoals into the beach. It runs three kilometres
 * out so the horizon is water rather than a visible edge — which is most of
 * what makes the city read as being on a coast rather than on a tabletop.
 */

import * as THREE from "three";
import { PAVE_Y, SAND_X, SHORE_X, tree, type WorldCtx } from "./blocks";
import { CELL, DISTRICTS, HALF } from "./layout";
import { cellRng, irange, pick, range, type Rnd } from "./rng";

export const SEA_Y = -0.6;

/* ------------------------------------------------------------------ */
/* the sea                                                             */
/* ------------------------------------------------------------------ */

export type Ocean = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update: (t: number) => void;
  dispose: () => void;
};

export function buildOcean(): Ocean {
  const geo = new THREE.PlaneGeometry(6000, 6000, 200, 200);
  geo.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      deep: { value: new THREE.Color("#07203a") },
      shallow: { value: new THREE.Color("#1d6b8a") },
      sky: { value: new THREE.Color("#ff9a5c") },
      foam: { value: new THREE.Color("#cfe8ff") },
      shoreX: { value: SHORE_X },
      fogColor: { value: new THREE.Color("#3a1140") },
      fogDensity: { value: 0.0016 },
    },
    fog: false,
    vertexShader: /* glsl */ `
      uniform float time;
      varying vec3 vWorld;
      varying float vWave;
      varying float vDepth;

      float swell(vec2 p, vec2 dir, float len, float speed, float amp, float t){
        return sin(dot(p, dir) / len + t * speed) * amp;
      }

      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec2 p = wp.xz;
        float h = 0.0;
        h += swell(p, normalize(vec2( 1.0, 0.35)), 11.0, 0.9, 0.42, time);
        h += swell(p, normalize(vec2(-0.6, 1.0 )),  7.0, 1.3, 0.24, time);
        h += swell(p, normalize(vec2( 0.9,-0.5 )),  3.4, 2.1, 0.11, time);
        h += swell(p, normalize(vec2( 0.2, 1.0 )),  1.7, 3.3, 0.05, time);
        wp.y += h;
        vWave = h;
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 deep; uniform vec3 shallow; uniform vec3 sky; uniform vec3 foam;
      uniform vec3 fogColor; uniform float fogDensity;
      uniform float shoreX; uniform float time;
      varying vec3 vWorld;
      varying float vWave;
      varying float vDepth;

      void main(){
        // normal from the analytic slope of the dominant swell — enough for a
        // convincing Fresnel without a normal map
        float slope = cos(dot(vWorld.xz, normalize(vec2(1.0, 0.35))) / 11.0 + time * 0.9);
        vec3 n = normalize(vec3(-slope * 0.09, 1.0, -slope * 0.05));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);

        float shoal = clamp((vWorld.x - shoreX) / 140.0, 0.0, 1.0);
        vec3 body = mix(shallow, deep, shoal);
        vec3 col = mix(body, sky, fres * 0.85);

        // surf breaking in the shallows, white caps on the peaks offshore
        float surf = smoothstep(0.55, 1.0, 1.0 - shoal)
                   * smoothstep(0.15, 0.6, 0.5 + 0.5 * sin((vWorld.x - shoreX) * 0.3 + time * 2.2));
        col = mix(col, foam, surf * 0.75);
        col = mix(col, foam, smoothstep(0.4, 0.72, vWave) * 0.2);

        float f = 1.0 - exp(-pow(max(vDepth, 0.0) * fogDensity, 2.0));
        col = mix(col, fogColor, clamp(f, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  // pushed out so the plane's centre — where the tessellation is densest — sits
  // offshore rather than under the beach
  mesh.position.set(SHORE_X + 1200, SEA_Y, 0);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  return {
    mesh,
    material,
    update(t) {
      material.uniforms.time.value = t;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* beach + boardwalk                                                   */
/* ------------------------------------------------------------------ */

const Z_TOP = -HALF * CELL;
const Z_BOT = HALF * CELL;

export function buildCoast(ctx: WorldCtx) {
  const rnd = cellRng(9, 9, 71);
  const sandB = ctx.bank.bucket("sand", ctx.mat.sand);
  const paveB = ctx.bank.bucket("pave", ctx.mat.pavement);
  const propB = ctx.bank.bucket("prop", ctx.mat.prop);
  const neonB = ctx.bank.bucket("neon", ctx.mat.neon);
  const foliage = ctx.bank.bucket("foliage", ctx.mat.foliage);
  const poolB = ctx.bank.bucket("pool", ctx.mat.pool);

  const depth = Z_BOT - Z_TOP;

  /* -------- sand, and the wedge that runs it under the water -------- */
  // stops short of the harbour, which has a concrete quay instead of a beach
  const sandZ0 = Z_TOP + CELL * 2;
  sandB.ground(
    (SAND_X + SHORE_X) / 2,
    (sandZ0 + Z_BOT) / 2,
    SHORE_X - SAND_X,
    Z_BOT - sandZ0,
    0.08,
    { uvScale: 14 },
  );
  sandB.quad(
    { x: SHORE_X, y: 0.08, z: sandZ0 },
    { x: SHORE_X + 40, y: SEA_Y - 1.6, z: sandZ0 },
    { x: SHORE_X + 40, y: SEA_Y - 1.6, z: Z_BOT },
    { x: SHORE_X, y: 0.08, z: Z_BOT },
    [0, 0, 3, 0, 3, 68, 0, 68],
    [0xbf9a6b, 0x6b5c48, 0x6b5c48, 0xbf9a6b],
  );

  /* -------- boardwalk down the whole coast -------- */
  const bw = SAND_X - 5.5;
  paveB.box(bw, PAVE_Y / 2, 0, 10, PAVE_Y, depth, { uvScale: [3, 3], shade: false });
  propB.box(bw + 5.2, PAVE_Y + 0.5, 0, 0.2, 1.0, depth, { tint: 0x6b5a44 });
  for (let z = Z_TOP + 12; z < Z_BOT; z += 14) {
    // rail posts
    propB.box(bw + 5.2, PAVE_Y + 0.5, z, 0.3, 1.1, 0.3, { tint: 0x5a4a38 });
    ctx.walk.push(new THREE.Vector3(bw + range(rnd, -3.5, 3.5), PAVE_Y, z));
    ctx.walk.push(new THREE.Vector3(bw + range(rnd, -3.5, 3.5), PAVE_Y, z + 7));
  }

  /* -------- beach furniture -------- */
  for (let z = sandZ0 + 20; z < Z_BOT - 20; z += 34) {
    // Palms along the back of the beach. Scattered in x on purpose: a dead
    // straight row read as a wall of canopy when you walked along it.
    for (let t = 0; t < 2; t++) {
      tree(
        ctx,
        rnd,
        SAND_X + range(rnd, -2, 22),
        z + range(rnd, -16, 16),
        DISTRICTS.beach,
      );
    }

    // lifeguard tower
    if (rnd() > 0.45) {
      const lx = SAND_X + range(rnd, 26, 44);
      const lz = z + range(rnd, -10, 10);
      for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) {
        propB.box(lx + ox, 1.5, lz + oz, 0.22, 3, 0.22, { tint: 0x8a6a48 });
      }
      propB.box(lx, 3.2, lz, 4.2, 0.24, 4.2, { tint: 0x9a7a54 });
      propB.box(lx, 4.4, lz, 3.6, 2.2, 3.6, { tint: 0xd8583c });
      propB.box(lx, 5.8, lz, 4.6, 0.3, 4.6, { tint: 0xf0e4d0 });
      ctx.grid.box(lx, lz, 4.2, 4.2, 3.2);
    }

    // parasols and loungers, thinning out toward the water
    for (let u = 0; u < irange(rnd, 3, 7); u++) {
      const ux = SAND_X + range(rnd, 16, 54);
      const uz = z + range(rnd, -14, 14);
      propB.cylinder(ux, 1.2, uz, 0.05, 0.05, 2.4, 4, 0xbfae94);
      const col = pick(rnd, [0xff5a7a, 0x3ac4d8, 0xffc247, 0x9de05a]);
      // canopy panels, built as real quads: a degenerate one (two corners in
      // the same place) has no normal to compute and poisons the frame
      for (let s = 0; s < 6; s++) {
        const a0 = (s / 6) * Math.PI * 2;
        const a1 = ((s + 1) / 6) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        foliage.quad(
          { x: ux + Math.cos(a0) * 0.12, y: 2.48, z: uz + Math.sin(a0) * 0.12 },
          { x: ux + Math.cos(a0) * 1.7, y: 2.1, z: uz + Math.sin(a0) * 1.7 },
          { x: ux + Math.cos(am) * 1.78, y: 2.06, z: uz + Math.sin(am) * 1.78 },
          { x: ux + Math.cos(a1) * 1.7, y: 2.1, z: uz + Math.sin(a1) * 1.7 },
          [0.5, 0.5, 0, 0, 0.5, 0, 1, 0],
          [col, col, col, col],
        );
      }
      if (rnd() > 0.5) {
        propB.box(ux + 1.6, 0.35, uz, 1.9, 0.14, 0.7, { tint: 0xe8dcc4 });
      }
    }
  }

  /* -------- two piers reaching out over the water -------- */
  for (const pz of [-200, 180]) {
    pier(ctx, rnd, pz);
  }

  /* -------- neon strip lighting the boardwalk -------- */
  for (let z = Z_TOP + 24; z < Z_BOT; z += 24) {
    propB.cylinder(bw - 4.2, 3.2, z, 0.14, 0.1, 6.4, 6, 0x35323f, 0.4);
    neonB.blob(bw - 4.2, 6.6, z, 0.4, 0.5, 0.4, 6, 2, 0xffd9a0);
    poolB.ground(bw - 4.2, z, 18, 18, PAVE_Y + 0.04, { tint: 0x5a3c20, uvScale: 18 });
    ctx.lamps.push({ x: bw - 4.2, z, h: 6.6 });
  }
}

/** A timber pier on piles, with a bar at the end of it. */
function pier(ctx: WorldCtx, rnd: Rnd, cz: number) {
  const propB = ctx.bank.bucket("prop", ctx.mat.prop);
  const paveB = ctx.bank.bucket("pave", ctx.mat.pavement);
  const neonB = ctx.bank.bucket("neon", ctx.mat.neon);
  const len = 150;
  const x0 = SHORE_X - 20;
  const deck = 3.2;

  paveB.box(x0 + len / 2, deck, cz, len, 0.5, 11, { uvScale: [3, 3], shade: false });
  for (let x = x0; x < x0 + len; x += 9) {
    for (const oz of [-4.6, 4.6]) {
      propB.cylinder(x, (deck - 4) / 2, cz + oz, 0.4, 0.34, deck + 4, 6, 0x4a3a2c, 0.45);
      propB.box(x, deck + 0.9, cz + oz, 0.22, 1.2, 0.22, { tint: 0x6b5a44 });
    }
    propB.box(x + 4.5, deck + 1.35, cz - 4.6, 9, 0.16, 0.16, { tint: 0x6b5a44 });
    propB.box(x + 4.5, deck + 1.35, cz + 4.6, 9, 0.16, 0.16, { tint: 0x6b5a44 });
    ctx.walk.push(new THREE.Vector3(x + 4, deck + 0.25, cz + range(rnd, -3, 3)));
  }

  // pavilion on the head of the pier
  const hx = x0 + len + 6;
  paveB.box(hx, deck, cz, 26, 0.5, 26, { uvScale: [3, 3], shade: false });
  for (const [ox, oz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]] as const) {
    propB.cylinder(hx + ox, (deck - 4) / 2, cz + oz, 0.45, 0.4, deck + 4, 6, 0x4a3a2c, 0.45);
  }
  propB.box(hx, deck + 2.4, cz, 16, 4.4, 12, { tint: 0x7a5f8a });
  propB.box(hx, deck + 4.9, cz, 18, 0.5, 14, { tint: 0xe0d2bc });
  neonB.box(hx - 8.2, deck + 4.2, cz, 0.3, 0.9, 11, { tint: 0xff2e97, shade: false });
  neonB.box(hx, deck + 5.3, cz, 17, 0.3, 0.3, { tint: 0x22e6ff, shade: false });
  ctx.grid.box(hx, cz, 16, 12, deck + 4.6);
  ctx.lamps.push({ x: hx, z: cz, h: deck + 5 });
}

/* ------------------------------------------------------------------ */
/* harbour + marina                                                    */
/* ------------------------------------------------------------------ */

export function buildHarbour(ctx: WorldCtx) {
  const rnd = cellRng(9, 1, 91);
  const propB = ctx.bank.bucket("prop", ctx.mat.prop);
  const metalB = ctx.bank.bucket("metal", ctx.mat.metal);
  const roadB = ctx.bank.bucket("road", ctx.mat.road);
  const neonB = ctx.bank.bucket("neon", ctx.mat.neon);

  // the quay: a concrete apron from the last road out to the water
  const qz0 = -HALF * CELL;
  const qz1 = qz0 + CELL * 2;
  const qx0 = 327;
  roadB.ground(
    (qx0 + SHORE_X) / 2,
    (qz0 + qz1) / 2,
    SHORE_X - qx0,
    qz1 - qz0,
    0.12,
    { uvScale: 10 },
  );
  // quay wall down into the water
  propB.quad(
    { x: SHORE_X, y: 0.12, z: qz0 },
    { x: SHORE_X, y: SEA_Y - 3, z: qz0 },
    { x: SHORE_X, y: SEA_Y - 3, z: qz1 },
    { x: SHORE_X, y: 0.12, z: qz1 },
    [0, 0, 0, 1, 20, 1, 20, 0],
    [0x6a6474, 0x3a3644, 0x3a3644, 0x6a6474],
  );

  /* -------- gantry cranes -------- */
  for (let n = 0; n < 3; n++) {
    const cx = SHORE_X - 26;
    const cz = qz0 + 24 + n * 48;
    const h = 34;
    for (const [ox, oz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as const) {
      metalB.box(cx + ox, h / 2, cz + oz, 1.1, h, 1.1, { tint: 0xd8562f });
    }
    metalB.box(cx, h, cz, 20, 2.2, 20, { tint: 0xd8562f });
    // the jib out over the water
    metalB.box(cx + 24, h + 3, cz, 62, 1.8, 3.2, { tint: 0xe8663f });
    metalB.box(cx - 14, h + 3, cz, 22, 1.6, 2.8, { tint: 0xe8663f });
    metalB.box(cx + 2, h + 8, cz, 3, 10, 3, { tint: 0xc44a28 });
    neonB.box(cx + 2, h + 13.4, cz, 0.6, 0.6, 0.6, { tint: 0xff2b2b, shade: false });
    ctx.grid.box(cx, cz, 18, 18, h);
    ctx.lamps.push({ x: cx, z: cz, h: h + 3 });
  }

  /* -------- container stacks -------- */
  const COLOURS = [0xd8562f, 0x2f7ad8, 0x3fa85a, 0xd8b52f, 0x8a3fd8, 0xc9c4b8];
  for (let s = 0; s < 22; s++) {
    const cx = qx0 + range(rnd, 6, 48);
    const cz = qz0 + range(rnd, 12, CELL * 2 - 12);
    const stack = irange(rnd, 1, 4);
    const rot = rnd() > 0.5 ? 0 : Math.PI / 2;
    for (let y = 0; y < stack; y++) {
      const w = rot === 0 ? 12.2 : 2.9;
      const d = rot === 0 ? 2.9 : 12.2;
      metalB.box(cx, 1.4 + y * 2.8, cz, w, 2.7, d, { tint: pick(rnd, COLOURS) });
    }
    ctx.grid.box(cx, cz, rot === 0 ? 12.2 : 2.9, rot === 0 ? 2.9 : 12.2, stack * 2.8);
  }

  /* -------- fuel tanks -------- */
  for (let n = 0; n < 4; n++) {
    const tx = qx0 + 8;
    const tz = qz0 + 30 + n * 42;
    metalB.cylinder(tx, 7, tz, 9, 9, 14, 14, 0xb8b2a4, 0.3);
    metalB.cylinder(tx, 14.6, tz, 9.2, 8, 1.6, 14, 0x9a948a, 0.2);
    ctx.grid.box(tx, tz, 18, 18, 15);
  }
}

export function buildMarina(ctx: WorldCtx): BoatSlot[] {
  const rnd = cellRng(8, 3, 113);
  const propB = ctx.bank.bucket("prop", ctx.mat.prop);
  const slots: BoatSlot[] = [];

  // pontoons stepping out from the shore
  const mz0 = -HALF * CELL + CELL * 2;
  for (let n = 0; n < 5; n++) {
    const pz = mz0 + 22 + n * 34;
    const x0 = SHORE_X - 6;
    const len = 70;
    propB.box(x0 + len / 2, 0.7, pz, len, 0.4, 3.4, { tint: 0xb8b2a4 });
    for (let x = x0; x < x0 + len; x += 12) {
      propB.cylinder(x, -1.2, pz + 1.9, 0.22, 0.22, 4.4, 5, 0x5a5464, 0.3);
      propB.cylinder(x, -1.2, pz - 1.9, 0.22, 0.22, 4.4, 5, 0x5a5464, 0.3);
      ctx.walk.push(new THREE.Vector3(x + 5, 0.9, pz));
    }
    // berths either side
    for (let b = 0; b < 5; b++) {
      for (const side of [-1, 1] as const) {
        if (rnd() > 0.75) continue;
        slots.push({
          x: x0 + 10 + b * 13,
          z: pz + side * 6.2,
          rot: Math.PI / 2,
          kind: irange(rnd, 0, 3),
        });
      }
    }
  }
  return slots;
}

export type BoatSlot = { x: number; z: number; rot: number; kind: number };

/**
 * Where moving boats go. Long runs parallel to the coast plus a couple of
 * approaches into the harbour mouth, so there is always something on the water
 * without any of it looking aimless.
 */
export function boatRoutes(): { a: THREE.Vector3; b: THREE.Vector3; kind: number }[] {
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  return [
    { a: v(SHORE_X + 120, -900), b: v(SHORE_X + 120, 900), kind: 0 },
    { a: v(SHORE_X + 260, 900), b: v(SHORE_X + 260, -900), kind: 1 },
    { a: v(SHORE_X + 420, -1100), b: v(SHORE_X + 420, 1100), kind: 2 },
    { a: v(SHORE_X + 700, 1200), b: v(SHORE_X + 700, -1200), kind: 3 },
    { a: v(SHORE_X + 60, -420), b: v(SHORE_X + 340, -120), kind: 1 },
    { a: v(SHORE_X + 340, 260), b: v(SHORE_X + 70, 420), kind: 0 },
  ];
}
