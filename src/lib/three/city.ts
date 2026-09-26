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
import { Traffic, VEHICLES, type SignalHead } from "./world/traffic";
import { Boats, Crowd } from "./world/crowd";
import { EXTENT, GRID, LANDMARK_SPOTS } from "./world/layout";
import { mulberry } from "./world/rng";
import type { EvidenceTag } from "./world/types";

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
  /** 0..1 through the day. Sunset is the look the city is designed around. */
  timeOfDay: number;
  setTimeOfDay: (t: number) => void;
  /** Pinned lighting, or "auto" to let the clock run. */
  timeMode: TimeMode;
  setTimeMode: (mode: TimeMode) => TimeMode;
  cycleTimeMode: () => TimeMode;
  /** 0 = broad daylight, 1 = full night. Drives headlights and neon. */
  nightness: number;
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
  stats: { buildings: number; colliders: number; draws: number };
  dispose: () => void;
};

export const CITY_BOUNDS = { extent: EXTENT };

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
      sunDir: { value: new THREE.Vector3(0.6, 0.2, -0.7) },
      zenith: { value: new THREE.Color("#140a32") },
      horizon: { value: new THREE.Color("#6d1d63") },
      ground: { value: new THREE.Color("#ff8a4c") },
      night: { value: 1 },
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
      uniform float night;
      varying vec3 vDir;

      float hash(vec3 p){
        p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

        vec3 col = mix(ground, horizon, smoothstep(0.40, 0.56, h));
        col = mix(col, zenith, smoothstep(0.52, 0.95, h));

        // the sun, and the glow it throws along the horizon behind it
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += horizon * pow(sd, 6.0) * 0.55;
        col += vec3(1.0, 0.82, 0.55) * pow(sd, 260.0) * 2.6;

        // stars, fading in with the night and cut off below the horizon
        if (night > 0.02 && d.y > -0.02) {
          float s = hash(floor(d * 320.0));
          float star = smoothstep(0.9975, 1.0, s) * smoothstep(0.0, 0.25, d.y);
          col += vec3(0.85, 0.9, 1.0) * star * night * 2.2;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -3;
  return { mesh, mat, geo };
}

/**
 * Keyframes for the sky, sun, fog and how lit the city's windows are.
 *
 * `fd` is the exponential fog density, and it is lowest at night on purpose.
 * Night air is clearer than daytime haze, and dark fog does nothing except
 * flatten the city into grey — the thing you actually want to see after dark is
 * the neon two blocks away, which needs the air to be clear to reach you.
 */
const PALETTE = [
  // [tod, zenith, horizon, ground, sunColour, sunIntensity, hemi, fog, fogDensity, nightness]
  { t: 0.0, zen: "#040611", hor: "#120a2e", gnd: "#241344", sun: "#3a4a8a", si: 0.2, hemi: 0.62, fog: "#0d0a22", fd: 0.00055, night: 1 },
  { t: 0.22, zen: "#0d1636", hor: "#5a2a5e", gnd: "#d86a4a", sun: "#ff9a5c", si: 0.7, hemi: 1.3, fog: "#3a1c40", fd: 0.00085, night: 0.6 },
  { t: 0.30, zen: "#2a4e8c", hor: "#8fb8d8", gnd: "#ffd8a8", sun: "#ffd2a0", si: 1.9, hemi: 2.5, fog: "#9fc0d8", fd: 0.0013, night: 0.12 },
  { t: 0.5, zen: "#1f5fbf", hor: "#8ec8ea", gnd: "#d8eaf5", sun: "#fff4e0", si: 2.5, hemi: 3.0, fog: "#adceE2", fd: 0.0014, night: 0 },
  { t: 0.70, zen: "#2a4e8c", hor: "#c88a6a", gnd: "#ffc07a", sun: "#ffc490", si: 1.7, hemi: 2.3, fog: "#b08fa4", fd: 0.0013, night: 0.1 },
  { t: 0.80, zen: "#140a32", hor: "#6d1d63", gnd: "#ff8a4c", sun: "#ffb178", si: 1.0, hemi: 1.45, fog: "#4a1852", fd: 0.001, night: 0.55 },
  { t: 0.88, zen: "#0a0724", hor: "#3a1550", gnd: "#a8386a", sun: "#8a5a9a", si: 0.34, hemi: 0.82, fog: "#22103a", fd: 0.0007, night: 0.9 },
  { t: 1.0, zen: "#040611", hor: "#120a2e", gnd: "#241344", sun: "#3a4a8a", si: 0.2, hemi: 0.62, fog: "#0d0a22", fd: 0.00055, night: 1 },
];

/**
 * The fixed times the player can pin the world to, plus the running clock.
 *
 * Leonida is a day-and-sunset city: full night was dropped as a mode, and the
 * running clock turns back at dusk rather than carrying on into the small
 * hours. Sunset still sits at `night` 0.5 in the palette, so the neon, the
 * headlights and the lit windows are all still there — it just never goes
 * black.
 */
export const TIME_MODES = ["auto", "day", "sunset"] as const;
export type TimeMode = (typeof TIME_MODES)[number];

const MODE_TIME: Record<Exclude<TimeMode, "auto">, number> = {
  day: 0.46,
  sunset: 0.79,
};

/** The arc the running clock swings through, and back. */
const AUTO_MIN = 0.32;
const AUTO_MAX = 0.82;

function samplePalette(t: number) {
  const tod = ((t % 1) + 1) % 1;
  let a = PALETTE[0];
  let b = PALETTE[PALETTE.length - 1];
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (tod >= PALETTE[i].t && tod <= PALETTE[i + 1].t) {
      a = PALETTE[i];
      b = PALETTE[i + 1];
      break;
    }
  }
  const u = b.t === a.t ? 0 : (tod - a.t) / (b.t - a.t);
  const mix = (x: string, y: string) =>
    new THREE.Color(x).lerp(new THREE.Color(y), u);
  const num = (x: number, y: number) => x + (y - x) * u;
  return {
    zen: mix(a.zen, b.zen),
    hor: mix(a.hor, b.hor),
    gnd: mix(a.gnd, b.gnd),
    sun: mix(a.sun, b.sun),
    si: num(a.si, b.si),
    hemi: num(a.hemi, b.hemi),
    fog: mix(a.fog, b.fog),
    fd: num(a.fd, b.fd),
    night: num(a.night, b.night),
  };
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
  const lamps: { x: number; z: number; h: number }[] = [];
  const parked: { x: number; z: number; rot: number; kind: number }[] = [];
  const tags: { x: number; y: number; z: number; rot: number; label: string }[] = [];
  const heads: SignalHead[] = [];

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
    group,
    keep,
  };

  /* ---- the ground everything else sits on ---- */
  const base = bank.bucket("base", mat.dirt);
  base.ground(0, 0, EXTENT * 2 + 900, EXTENT * 2 + 900, -0.08, { uvScale: 26 });

  /* ---- roads, then blocks ---- */
  const net: RoadNet = buildRoadNet();
  buildRoads({ bank, mat, grid, walk, lamps }, net);
  collectSignalHeads(net, heads);

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) buildCell(ctx, i, j);
  }

  /* ---- coast ---- */
  buildCoast(ctx);
  buildHarbour(ctx);
  const moorings = buildMarina(ctx);

  /* ---- the things you navigate by ---- */
  buildLandmarks(ctx);

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

  scene.fog = new THREE.FogExp2(0x4a1852, 0.001);

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

  /* ---- lighting ---- */
  const hemi = new THREE.HemisphereLight(0xffa8d8, 0x4a3560, 1.05);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xffb178, 0.8);
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

  const fill = new THREE.DirectionalLight(0x6fe6ff, 0.42);
  fill.position.set(-120, 90, 160);
  group.add(fill);

  /*
   * Four roaming point lights, re-homed onto the nearest street lamps every
   * half second. The city's lighting is emissive geometry, but the player
   * character is a real lit mesh, so these are what make them pick up the
   * colour of the lamp they are standing under.
   */
  const spots: THREE.PointLight[] = [];
  for (let n = 0; n < (quality === "high" ? 4 : 2); n++) {
    const p = new THREE.PointLight(0xffc98a, 0, 26, 2);
    p.position.set(0, -50, 0);
    group.add(p);
    spots.push(p);
  }

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

  const state = {
    tod: MODE_TIME.sunset,
    night: 0.55,
    /** "auto" runs the clock; the rest pin the world to one lighting setup. */
    mode: "sunset" as TimeMode,
    /** Which way the running clock is currently travelling. */
    dir: 1,
  };
  const scratch: Collider[] = [];
  const _from = new THREE.Vector3();
  let sinceLights = 9;

  function applyTime() {
    const p = samplePalette(state.tod);
    state.night = p.night;

    // sun tracks a plausible arc: up in the east, down in the west
    const ang = (state.tod - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const dir = new THREE.Vector3(
      Math.cos(ang) * 0.75,
      Math.max(elev, -0.35),
      -0.45,
    ).normalize();

    sky.mat.uniforms.zenith.value.copy(p.zen);
    sky.mat.uniforms.horizon.value.copy(p.hor);
    sky.mat.uniforms.ground.value.copy(p.gnd);
    sky.mat.uniforms.sunDir.value.copy(dir);
    sky.mat.uniforms.night.value = p.night;

    sun.color.copy(p.sun);
    sun.intensity = p.si;
    hemi.intensity = p.hemi;
    hemi.color.copy(p.hor).lerp(new THREE.Color(0xffffff), 0.25);
    fill.intensity = 0.2 + (1 - p.night) * 0.75;

    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.copy(p.fog);
      fog.density = p.fd;
    }
    ocean.material.uniforms.fogColor.value.copy(p.fog);
    ocean.material.uniforms.fogDensity.value = p.fd;
    ocean.material.uniforms.sky.value.copy(p.hor);
    ocean.material.uniforms.deep.value
      .set("#07203a")
      .lerp(new THREE.Color("#02060e"), p.night);

    // Windows, signage and lamp spill all come up as the light goes down. This
    // is the entire night lighting model — there is no dynamic light doing it.
    const glow = 0.18 + p.night * 1.25;
    for (const m of mat.emissives) m.emissiveIntensity = glow;
    mat.neon.opacity = 0.32 + p.night * 0.68;
    mat.sign.opacity = 0.28 + p.night * 0.72;
    mat.pool.opacity = 0.04 + p.night * 1.15;
    for (const s of spots) s.intensity = p.night * 16;
  }
  applyTime();

  return {
    group,
    grid,
    evidence,
    waypoints: walk,
    sun,
    spawn,
    get timeOfDay() {
      return state.tod;
    },
    get nightness() {
      return state.night;
    },
    setTimeOfDay(t) {
      state.tod = ((t % 1) + 1) % 1;
      applyTime();
    },
    get timeMode() {
      return state.mode;
    },
    setTimeMode(mode) {
      state.mode = mode;
      if (mode !== "auto") state.tod = MODE_TIME[mode];
      applyTime();
      return mode;
    },
    cycleTimeMode() {
      const next = TIME_MODES[(TIME_MODES.indexOf(state.mode) + 1) % TIME_MODES.length];
      return this.setTimeMode(next);
    },
    stats: {
      buildings,
      colliders: grid.count,
      draws: group.children.length,
    },

    update(dt, t, opts) {
      /*
       * A full sweep runs about eight minutes, unless the player has pinned
       * the lighting to one time. It reverses at each end of the arc instead
       * of wrapping through midnight — morning up to dusk, then back down.
       */
      if (state.mode === "auto") {
        state.tod += (dt / 480) * state.dir;
        if (state.tod >= AUTO_MAX) {
          state.tod = AUTO_MAX;
          state.dir = -1;
        } else if (state.tod <= AUTO_MIN) {
          state.tod = AUTO_MIN;
          state.dir = 1;
        }
      }
      applyTime();

      // keep the shadow volume on the player, not on the world origin
      sun.target.position.set(opts.x, 0, opts.z);
      sun.target.updateMatrixWorld();
      const d = sky.mat.uniforms.sunDir.value as THREE.Vector3;
      sun.position.set(opts.x + d.x * 150, 30 + d.y * 150, opts.z + d.z * 150);

      ocean.update(t);
      traffic.update(dt, t, opts.x, opts.z, state.night);
      crowd.update(dt, opts.x, opts.z, opts.heat);
      boats.update(dt, t);

      sinceLights += dt;
      if (sinceLights > 0.5) {
        sinceLights = 0;
        nearestLamps(lamps, opts.x, opts.z, spots);
      }
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
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function collectSignalHeads(net: RoadNet, out: SignalHead[]) {
  for (const s of net.signals) {
    // one head per approach, on the near kerb, matching roads.ts
    for (const [ax, az] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const axis: 0 | 1 = ax === 0 ? 0 : 1;
      out.push({
        x: s.x + ax * 12 + (ax === 0 ? 9 : 0),
        y: 5.8,
        z: s.z + az * 12 + (az === 0 ? 9 : 0),
        axis,
        offset: s.offset,
      });
    }
  }
}

/** Re-homes the roaming point lights onto the closest street lamps. */
function nearestLamps(
  lamps: { x: number; z: number; h: number }[],
  x: number,
  z: number,
  out: THREE.PointLight[],
) {
  const best: { d: number; l: { x: number; z: number; h: number } }[] = [];
  for (const l of lamps) {
    const d = (l.x - x) ** 2 + (l.z - z) ** 2;
    if (d > 60 * 60) continue;
    best.push({ d, l });
  }
  best.sort((a, b) => a.d - b.d);
  for (let i = 0; i < out.length; i++) {
    const pick = best[i];
    if (pick) out[i].position.set(pick.l.x, pick.l.h - 0.4, pick.l.z);
    else out[i].position.set(x, -60, z);
  }
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
