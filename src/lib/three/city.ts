/**
 * Leonida.
 *
 * This file used to be the block — one straight street, forty buildings, a
 * point light behind every neon sign. It is now the assembler for a city about
 * a kilometre square: twelve districts on a road grid, a working signalised
 * traffic network, a coastline with a harbour and a marina, six landmarks you
 * can navigate by, and a skyline ring that removes the map edge.
 *
 * Everything is still generated at runtime from numbers and canvas paint —
 * that house rule has not changed — but the scale forced three architectural
 * changes, and they are the reason it runs at all:
 *
 *  - static geometry is welded into merged buffers by material, so ~1500
 *    buildings and a few thousand props are a couple of dozen draw calls
 *  - there are no per-object lights. Lit windows, signage and lamp spill are
 *    emissive geometry and additive ground pools, lit by bloom
 *  - collision and line-of-sight go through a uniform grid instead of a linear
 *    scan and a full-scene raycast
 *
 * The evidence register is unchanged in spirit and much longer in practice:
 * faces, plates and landmarks that will incriminate you if the shutter catches
 * them, handed straight to the Image Lab.
 */

import * as THREE from "three";
import { MeshBank } from "./world/builder";
import { CollisionGrid, type Collider } from "./world/collision";
import { buildTextures } from "./world/textures";
import { buildMaterials } from "./world/materials";
import { buildRoadNet, buildRoads, type RoadNet } from "./world/roads";
import { buildCell, type WorldCtx } from "./world/blocks";
import {
  boatRoutes,
  buildCoast,
  buildHarbour,
  buildMarina,
  buildOcean,
} from "./world/water";
import { buildLandmarks } from "./world/landmarks";
import { buildSkyline } from "./world/skyline";
import { Traffic, VEHICLES } from "./world/traffic";
import type { SignalLamp } from "./world/signals";
import { buildAds } from "./world/ads";
import { Boats, Crowd } from "./world/crowd";
import { EXTENT, GRID, LANDMARK_SPOTS } from "./world/layout";
import { mulberry } from "./world/rng";
import type { AdSite, EvidenceTag } from "./world/types";

export type { EvidenceTag, EvidenceKind } from "./world/types";
export type { Collider } from "./world/collision";
export { LANDMARK_SPOTS, placeName, districtAt } from "./world/layout";

export type CityQuality = "high" | "low";

export type City = {
  group: THREE.Group;
  grid: CollisionGrid;
  evidence: EvidenceTag[];
  /** Pavement nodes the rigged pedestrians navigate by. */
  waypoints: THREE.Vector3[];
  sun: THREE.DirectionalLight;
  /** Where the player starts: the seafront, looking into the city. */
  spawn: { x: number; z: number; yaw: number };
  update: (
    dt: number,
    t: number,
    opts: { x: number; z: number; heat: number },
  ) => void;
  /** True if a building stands between these two points. */
  blocked: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
  /** Distance to the first wall or vehicle along a segment, or -1. */
  rayHit: (
    from: THREE.Vector3,
    to: THREE.Vector3,
    minTop?: number,
  ) => number;
  /**
   * Distance to the first moving vehicle on a segment, or -1, with the roof
   * height of whatever was hit written into `out`. Traffic only: the camera
   * answers a bus differently from the way it answers a wall.
   */
  vehicleHit: (
    from: THREE.Vector3,
    to: THREE.Vector3,
    minTop: number,
    out: { top: number },
  ) => number;
  /**
   * Roof height of the moving vehicle this point is inside, or -1. The camera
   * uses it to climb out of a bus that has driven into the lens.
   */
  vehicleRoofAt: (p: THREE.Vector3, pad?: number) => number;
  /** Pushes an actor out of any moving vehicle it is standing inside. */
  resolveVehicles: (
    pos: THREE.Vector3,
    radius: number,
    clearTop?: number,
  ) => void;
  /**
   * Height of the surface under (x, z) — pavement, kerb, prop or car roof —
   * counting only what is no higher than `clearTop`.
   */
  groundAt: (x: number, z: number, clearTop: number) => number;
  /** The same, but ignoring traffic: what a pedestrian will stand on. */
  walkableAt: (x: number, z: number, clearTop: number) => number;
  stats: { buildings: number; colliders: number; draws: number; ads: number };
  dispose: () => void;
};

export const CITY_BOUNDS = { extent: EXTENT };

/* ------------------------------------------------------------------ */
/* light                                                               */
/* ------------------------------------------------------------------ */

/**
 * Leonida's one and only light.
 *
 * This used to be an eight-stop palette, a running clock and three pinnable
 * modes, and every frame re-sampled the lot and rewrote the sky uniforms, the
 * fog, the ocean and the emissive intensity of every material in the city. The
 * city is late morning now and it stays there, so all of that is a single
 * constant applied once at build time — no interpolation, no per-frame work,
 * and no way for the world to end up somewhere dark.
 *
 * `signage` is the part worth explaining. Shop signs and neon are additive
 * geometry, so in daylight they read as faint washes rather than as light. They
 * are held a little higher than physics would ask for, because Leonida's
 * frontages *are* its character, and the advertising boards — which are opaque
 * and self-lit — now carry the job of being the brightest thing in frame.
 */
const DAY = {
  zen: "#215cb4",
  hor: "#8ec6e8",
  gnd: "#e4eef6",
  sun: "#fff2dc",
  /** Directional intensity, and the hemisphere bounce under it. */
  si: 2.42,
  hemi: 2.85,
  fog: "#aacbe0",
  /** Exponential fog density — daytime haze over a coastal city. */
  fd: 0.00135,
  /** High and a little to the east, so the grid casts usable shadows. */
  sunDir: new THREE.Vector3(0.34, 0.9, -0.42).normalize(),
  /** Emissive floor for lit windows, and the opacity of the additive signage. */
  glow: 0.24,
  signage: { neon: 0.4, sign: 0.42, pool: 0.05 },
};

/* ------------------------------------------------------------------ */
/* sky                                                                 */
/* ------------------------------------------------------------------ */

function buildSky() {
  const geo = new THREE.SphereGeometry(4200, 40, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: DAY.sunDir.clone() },
      zenith: { value: new THREE.Color(DAY.zen) },
      horizon: { value: new THREE.Color(DAY.hor) },
      ground: { value: new THREE.Color(DAY.gnd) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground;
      varying vec3 vDir;

      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

        vec3 col = mix(ground, horizon, smoothstep(0.40, 0.56, h));
        col = mix(col, zenith, smoothstep(0.52, 0.95, h));

        // the sun, and the glow it throws along the horizon behind it
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += horizon * pow(sd, 6.0) * 0.30;
        col += vec3(1.0, 0.94, 0.82) * pow(sd, 340.0) * 2.2;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -3;
  return { mesh, mat, geo };
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

export function buildCity(
  scene: THREE.Scene,
  quality: CityQuality = "high",
): City {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(d: T) => {
    disposables.push(d);
    return d;
  };

  const tex = keep(buildTextures());
  const mat = keep(buildMaterials(tex));
  const bank = new MeshBank();
  const grid = new CollisionGrid();
  const evidence: EvidenceTag[] = [];
  const walk: THREE.Vector3[] = [];
  /*
   * Every luminaire the world puts up, published by the modules that build
   * them. Nothing lights from it: a permanently daylit Leonida has no dynamic
   * lighting to re-home, and the lamps themselves are emissive geometry.
   */
  const lamps: { x: number; z: number; h: number }[] = [];
  const parked: { x: number; z: number; rot: number; kind: number }[] = [];
  const tags: { x: number; y: number; z: number; rot: number; label: string }[] = [];
  /** Signal lenses, and advertising pitches — both filled in while building. */
  const heads: SignalLamp[] = [];
  const adSites: AdSite[] = [];

  const ctx: WorldCtx = {
    bank,
    mat,
    tex,
    grid,
    walk,
    lamps,
    parked,
    evidence,
    tags,
    ads: adSites,
    group,
    keep,
  };

  /* ---- the ground everything else sits on ---- */
  const base = bank.bucket("base", mat.dirt);
  base.ground(0, 0, EXTENT * 2 + 900, EXTENT * 2 + 900, -0.08, { uvScale: 26 });

  /* ---- roads, then blocks ---- */
  const net: RoadNet = buildRoadNet();
  buildRoads({ bank, mat, grid, walk, lamps, heads, ads: adSites }, net);

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) buildCell(ctx, i, j);
  }

  /* ---- coast ---- */
  buildCoast(ctx);
  buildHarbour(ctx);
  const moorings = buildMarina(ctx);

  /* ---- the things you navigate by ---- */
  buildLandmarks(ctx);

  /*
   * ---- and the things the city sells you ----
   *
   * Last, because every board's frame welds into the same buckets as everything
   * above and this has to happen before the flush.
   */
  const ads = buildAds(ctx, adSites);

  /* ---- weld it all down ---- */
  bank.flush(group, keep, {
    // only the geometry that can throw a shadow anyone will notice
    castShadow: (k) =>
      quality === "high" &&
      (k.startsWith("facade") || k === "prop" || k === "metal" || k.startsWith("shop")),
    receiveShadow: (k) => k !== "neon" && k !== "pool" && k !== "sign",
    renderOrder: (k) => (k === "pool" ? 1 : k === "mark" ? 1 : k === "neon" || k === "sign" ? 2 : 0),
  });
  const buildings = group.children.filter((c) => c.name.startsWith("facade")).length;

  /* ---- sky, sea, skyline ---- */
  const sky = buildSky();
  keep(sky.geo);
  keep(sky.mat);
  group.add(sky.mesh);

  const ocean = keep(buildOcean());
  group.add(ocean.mesh);

  const far = buildSkyline(tex);
  if (far) {
    keep(far.geo);
    keep(far.mat);
    group.add(far.mesh);
  }

  scene.fog = new THREE.FogExp2(new THREE.Color(DAY.fog).getHex(), DAY.fd);

  /*
   * Parked vehicles are solid too, at the roof height of the model that is
   * actually sitting there.
   *
   * These used to be pinned at 1.15 — under the camera ray's threshold — so a
   * parked car would stop the player without hauling the third-person camera
   * in every time you passed one. That worked for the camera and lied to
   * everything else: 1.15 is 40cm below a sedan's roof, so landing on one put
   * you shin-deep in it. The camera now gets told what to ignore directly
   * (CAMERA_CLEAR in engine.ts) and these can be honest.
   */
  for (const p of parked) {
    const wide = Math.abs(Math.cos(p.rot)) > 0.5;
    const spec = VEHICLES[Math.min(p.kind, 5)];
    /*
     * The footprint is the model's own, not a one-size box. It used to be a
     * flat 2.1 x 4.9 for everything, which overhangs a hatchback's nose by
     * half a metre — and the readable number plate is mounted 3cm off that
     * nose. Harmless while these colliders were too short for the sightline
     * test to see; at full height it meant a car occluded its own plate and
     * the shutter stopped recording them as evidence.
     */
    grid.box(
      p.x,
      p.z,
      wide ? spec.w : spec.l,
      wide ? spec.l : spec.w,
      spec.top,
      true,
    );
  }

  /* ---- moving parts ---- */
  /*
   * Density.
   *
   * The whole fleet is held inside a 300-metre bubble around the player (see
   * Traffic.update), so these counts are not spread over the square kilometre —
   * they are all on the four or five streets you can actually see. At 140 cars
   * that read as gridlock rather than a city: junctions stayed blocked and you
   * couldn't cross a road. Roughly half of it is still a busy Leonida evening,
   * and the same applies to the pavement.
   */
  const traffic = keep(
    new Traffic({
      net,
      rnd: mulberry(90210),
      moving: quality === "high" ? 72 : 32,
      parked,
      heads,
      evidence,
    }),
  );
  group.add(traffic.group);

  const crowd = keep(new Crowd(walk, quality === "high" ? 85 : 40));
  group.add(crowd.group);

  const boats = keep(new Boats(boatRoutes(), moorings, quality === "high" ? 3 : 2));
  group.add(boats.group);

  /* ---- lighting: a sun, a sky bounce, and a cool fill off the sea ---- */
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(DAY.hor).lerp(new THREE.Color(0xffffff), 0.25).getHex(),
    0x8a7f74,
    DAY.hemi,
  );
  group.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(DAY.sun).getHex(), DAY.si);
  sun.castShadow = quality === "high";
  sun.shadow.mapSize.set(quality === "high" ? 2048 : 1024, quality === "high" ? 2048 : 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 340;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.05;
  group.add(sun);
  group.add(sun.target);

  const fill = new THREE.DirectionalLight(0x8fd8f0, 0.5);
  fill.position.set(-120, 90, 160);
  group.add(fill);

  /*
   * Windows, signage and lamp spill.
   *
   * There is still no dynamic light anywhere in the city — this is the whole
   * lighting model for everything that glows, and by day it is a fixed set of
   * numbers rather than a curve being resampled every frame.
   */
  for (const m of mat.emissives) m.emissiveIntensity = DAY.glow;
  mat.neon.opacity = DAY.signage.neon;
  mat.sign.opacity = DAY.signage.sign;
  mat.pool.opacity = DAY.signage.pool;
  ads.setFog(new THREE.Color(DAY.fog), DAY.fd);
  ocean.material.uniforms.fogColor.value.set(DAY.fog);
  ocean.material.uniforms.fogDensity.value = DAY.fd;
  ocean.material.uniforms.sky.value.set(DAY.hor);
  ocean.material.uniforms.deep.value.set("#0b3556");

  scene.add(group);

  /* ---- state ---- */
  /*
   * On the seafront, facing west into the city, so the first thing the player
   * sees is the skyline rather than the sea. Every fast-travel target sits on
   * a road intersection — open ground by construction — and the spawn is then
   * pushed out of anything it happens to land in.
   */
  const spawnPlace = LANDMARK_SPOTS[0];
  const _spawn = new THREE.Vector3(spawnPlace.x, 0, spawnPlace.z);
  resolveCollisions(_spawn, 0.45, grid);
  const spawn = { x: _spawn.x, z: _spawn.z, yaw: -Math.PI / 2 };

  const scratch: Collider[] = [];
  const _from = new THREE.Vector3();
  const sunDir = DAY.sunDir;

  return {
    group,
    grid,
    evidence,
    waypoints: walk,
    sun,
    spawn,
    stats: {
      buildings,
      colliders: grid.count,
      draws: group.children.length,
      ads: ads.boards,
    },

    update(dt, t, opts) {
      // keep the shadow volume on the player, not on the world origin
      sun.target.position.set(opts.x, 0, opts.z);
      sun.target.updateMatrixWorld();
      sun.position.set(
        opts.x + sunDir.x * 150,
        30 + sunDir.y * 150,
        opts.z + sunDir.z * 150,
      );

      ocean.update(t);
      ads.update(t);
      traffic.update(dt, t, opts.x, opts.z);
      crowd.update(dt, opts.x, opts.z, opts.heat);
      boats.update(dt, t);
    },

    resolveVehicles(pos, radius, clearTop) {
      traffic.resolveAgainst(pos, radius, clearTop);
    },
    groundAt(x, z, clearTop) {
      return Math.max(
        grid.groundAt(x, z, clearTop, scratch),
        traffic.roofAt(x, z, clearTop),
      );
    },
    walkableAt(x, z, clearTop) {
      return grid.groundAt(x, z, clearTop, scratch);
    },
    blocked(from, to) {
      return grid.blocked(from, to);
    },
    rayHit(from, to, minTop) {
      /*
       * Walls and traffic, because the camera needs both. `blocked` above
       * deliberately stays walls-only: a bus drifting through a sightline
       * should not retroactively invalidate a photo you already framed.
       */
      const wall = grid.rayHit(_from.copy(from), to, minTop);
      const car = traffic.rayHit(_from, to, minTop);
      if (wall < 0) return car;
      if (car < 0) return wall;
      return Math.min(wall, car);
    },
    vehicleHit(from, to, minTop, out) {
      return traffic.rayHit(from, to, minTop, out);
    },
    vehicleRoofAt(p, pad) {
      return traffic.roofOver(p, pad);
    },

    dispose() {
      for (const d of disposables) d.dispose();
      ads.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
      scene.remove(group);
      scene.fog = null;
      void scratch;
    },
  };
}

/* ------------------------------------------------------------------ */
/* collision (public API, unchanged in shape)                          */
/* ------------------------------------------------------------------ */

const _scratch: Collider[] = [];

/**
 * Push a capsule out of every wall it overlaps, and keep it on the map.
 *
 * `clearTop` is the height the capsule's feet are carrying: anything shorter is
 * something it is standing on or jumping over, not something it walks into.
 */
export function resolveCollisions(
  pos: THREE.Vector3,
  radius: number,
  grid: CollisionGrid,
  clearTop?: number,
) {
  grid.resolve(pos, radius, _scratch, clearTop);
  const lim = EXTENT - 2;
  pos.x = Math.max(-lim, Math.min(EXTENT + 44, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}

export { CollisionGrid };
