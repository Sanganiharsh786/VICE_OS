/**
 * Traffic.
 *
 * Vehicles are not wandering: each one is on a numbered lane of a numbered
 * road, travelling in a known direction, and it re-plans at every junction it
 * reaches. It keeps to its side of the centre line, closes on the car in front
 * and holds a gap, stops at a red light behind the stop line, and turns only
 * onto roads that exist — which is why the grid ends cleanly at the sea
 * instead of driving into it.
 *
 * The whole fleet is six InstancedMeshes (hulls, greenhouses, glazing, wheels,
 * lamps, bumpers), so a hundred cars cost six draw calls and the parked ones
 * are free: they live in the same buffers and simply never get their matrices
 * rewritten.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, GRID, HALF } from "./layout";
import { laneCount, laneOffset, type RoadNet } from "./roads";
import { irange, pick, type Rnd } from "./rng";
import { plateTexture } from "./textures";
import type { EvidenceTag } from "./types";

/* ------------------------------------------------------------------ */
/* signals                                                             */
/* ------------------------------------------------------------------ */

const CYCLE = 20;
const NS_GREEN = 8.8;
const NS_AMBER = 10;
const EW_GREEN = 18.8;

export type Phase = "green" | "amber" | "red";

/** Light shown to traffic on `axis` (0 = north-south) at this intersection. */
export function lightState(axis: 0 | 1, offset: number, t: number): Phase {
  const p = (t + offset) % CYCLE;
  if (axis === 0) {
    if (p < NS_GREEN) return "green";
    if (p < NS_AMBER) return "amber";
    return "red";
  }
  if (p < NS_AMBER) return "red";
  if (p < EW_GREEN) return "green";
  return "amber";
}

export type SignalHead = {
  x: number;
  y: number;
  z: number;
  /** Which approach this head governs. */
  axis: 0 | 1;
  offset: number;
};

/* ------------------------------------------------------------------ */
/* vehicle shapes                                                      */
/* ------------------------------------------------------------------ */

/**
 * A vehicle is six parts, and only two of them are painted.
 *
 * The old model was a body box with a black box on top of it, and the wheels
 * were inset far enough that the body hid them completely — so every car in
 * Leonida read as a coloured brick sliding along the tarmac. What actually
 * makes something look like a car at this polygon count is the silhouette:
 * wheels standing proud of a hull that tucks in above them, a greenhouse
 * narrower and shorter than the body it sits on, and glass that is a band
 * around that greenhouse rather than the whole of it. Paint the roof, and the
 * black slab becomes a car.
 *
 * Everything here is measured in metres against the real thing, which is why
 * the bus's glazing sits at 1.9–3.0m — where a bus's windows are — instead of
 * as a strip laid over its roof.
 */
type VehicleSpec = {
  name: string;
  /** Overall footprint and roof height. Collision, gaps and the camera use these. */
  w: number;
  l: number;
  top: number;

  /** The hull: its own box, which is not the footprint on an artic-nosed truck. */
  bw: number;
  bh: number;
  bl: number;
  /** Hull centre offset along the vehicle's own axis. */
  bz: number;
  /** Hull centre height. */
  ride: number;

  /** Greenhouse — a car's cabin, a van's roof cap, a truck's cab. */
  cw: number;
  ch: number;
  cl: number;
  cz: number;
  cy: number;

  /**
   * Glazing band. Width is derived from whatever it wraps at its own height,
   * so it always sits a consistent 1.5cm proud of the taper instead of being
   * hand-tuned per vehicle and drifting when a body changes.
   */
  gh: number;
  gl: number;
  gz: number;
  gy: number;
  gOn: "cab" | "hull";

  /** Wheel radius, half-wheelbase, and how far out the hubs sit. */
  wheel: number;
  base: number;
  track: number;

  /** Lamp height, and the nose and tail faces they (and the bumpers) mount on. */
  lampY: number;
  nose: number;
  tail: number;

  colours: number[];
  speed: number;
};

const CIVIC = [0xd8d4cc, 0x2b2f3a, 0x8a1f3a, 0x1f4a8a, 0x3a6b4a, 0x6b6b74, 0xb03a6b];
const BRIGHT = [0xff2e97, 0x22e6ff, 0xffb347, 0x9dff3d, 0xff5ad9];

export const VEHICLES: VehicleSpec[] = [
  {
    name: "sedan", w: 1.86, l: 4.6, top: 1.67,
    bw: 1.86, bh: 0.7, bl: 4.6, bz: 0, ride: 0.72,
    cw: 1.7, ch: 0.6, cl: 2.3, cz: -0.2, cy: 1.37,
    gh: 0.4, gl: 2.06, gz: -0.2, gy: 1.33, gOn: "cab",
    wheel: 0.34, base: 1.52, track: 0.86,
    lampY: 0.62, nose: 2.3, tail: -2.3,
    colours: CIVIC, speed: 13,
  },
  {
    name: "suv", w: 2.02, l: 4.92, top: 2.11,
    bw: 2.02, bh: 0.98, bl: 4.92, bz: 0, ride: 0.9,
    cw: 1.88, ch: 0.72, cl: 2.8, cz: -0.1, cy: 1.75,
    gh: 0.46, gl: 2.52, gz: -0.1, gy: 1.7, gOn: "cab",
    wheel: 0.41, base: 1.62, track: 0.94,
    lampY: 0.8, nose: 2.46, tail: -2.46,
    colours: CIVIC, speed: 12,
  },
  {
    name: "hatch", w: 1.78, l: 3.96, top: 1.63,
    bw: 1.78, bh: 0.7, bl: 3.96, bz: 0, ride: 0.7,
    cw: 1.62, ch: 0.58, cl: 2.0, cz: -0.36, cy: 1.34,
    gh: 0.38, gl: 1.78, gz: -0.36, gy: 1.3, gOn: "cab",
    wheel: 0.32, base: 1.34, track: 0.82,
    lampY: 0.62, nose: 1.98, tail: -1.98,
    colours: [...CIVIC, ...BRIGHT], speed: 12.5,
  },
  {
    // a high-roof panel van: one tall hull, a roof cap, and glass only up front
    name: "van", w: 2.06, l: 5.6, top: 2.12,
    bw: 2.06, bh: 1.56, bl: 5.6, bz: 0, ride: 1.06,
    cw: 1.96, ch: 0.28, cl: 4.9, cz: -0.15, cy: 1.98,
    gh: 0.54, gl: 2.02, gz: 1.75, gy: 1.48, gOn: "hull",
    wheel: 0.38, base: 1.86, track: 0.96,
    lampY: 0.7, nose: 2.8, tail: -2.8,
    colours: [0xe8e4dc, 0xd8d4cc, 0x2f6bb0], speed: 11,
  },
  {
    // the hull is the bonnet-and-bed line at 1.2m and the cab stands above it,
    // which is the step that tells a pickup from an estate at fifty metres
    name: "pickup", w: 2.02, l: 5.3, top: 2.05,
    bw: 2.02, bh: 0.7, bl: 5.3, bz: 0, ride: 0.84,
    cw: 1.86, ch: 0.86, cl: 2.1, cz: 0.8, cy: 1.62,
    gh: 0.5, gl: 1.86, gz: 0.8, gy: 1.68, gOn: "cab",
    wheel: 0.4, base: 1.8, track: 0.94,
    lampY: 0.72, nose: 2.65, tail: -2.65,
    colours: CIVIC, speed: 12,
  },
  {
    name: "taxi", w: 1.9, l: 4.72, top: 1.68,
    bw: 1.9, bh: 0.7, bl: 4.72, bz: 0, ride: 0.73,
    cw: 1.74, ch: 0.6, cl: 2.36, cz: -0.18, cy: 1.38,
    gh: 0.4, gl: 2.1, gz: -0.18, gy: 1.34, gOn: "cab",
    wheel: 0.34, base: 1.56, track: 0.88,
    lampY: 0.63, nose: 2.36, tail: -2.36,
    colours: [0xf2c22a], speed: 13.5,
  },
  {
    // the glazing wraps the whole hull, so the band is the windscreen, the
    // side lights and the rear window in one piece — which is how a bus is built
    name: "bus", w: 2.55, l: 11.6, top: 3.39,
    bw: 2.55, bh: 2.78, bl: 11.6, bz: 0, ride: 1.76,
    cw: 2.38, ch: 0.24, cl: 10.6, cz: -0.2, cy: 3.27,
    gh: 1.08, gl: 11.31, gz: -0.1, gy: 2.4, gOn: "hull",
    wheel: 0.52, base: 3.7, track: 1.16,
    lampY: 0.8, nose: 5.8, tail: -5.8,
    colours: [0xd8562f, 0x2f7ad8, 0xe8e4dc], speed: 9,
  },
  {
    // a box truck: the hull is the cargo box, the greenhouse is the cab in
    // front of it, and the front wheels sit under the cab where they belong
    name: "truck", w: 2.52, l: 9.6, top: 3.44,
    bw: 2.52, bh: 2.72, bl: 6.9, bz: -1.32, ride: 1.96,
    cw: 2.44, ch: 2.08, cl: 3.2, cz: 3.2, cy: 1.38,
    gh: 0.72, gl: 2.82, gz: 3.2, gy: 2.0, gOn: "cab",
    wheel: 0.55, base: 3.15, track: 1.14,
    lampY: 0.8, nose: 4.8, tail: -4.77,
    colours: [0x9a9490, 0x3a5f8a, 0x8a3a3a], speed: 9.5,
  },
];

/* ------------------------------------------------------------------ */
/* part geometry                                                       */
/* ------------------------------------------------------------------ */

/**
 * How much the hull and the greenhouse pull in at each end of their height.
 *
 * These are the whole silhouette. The hull tucking in at the floor is what
 * lets the wheels stand proud of it; the greenhouse losing 16% of its length
 * at the roof is the rake of a windscreen and a backlight.
 */
const HULL = { botX: 0.9, topX: 0.99, botZ: 0.98, topZ: 0.97 };
const CAB = { botX: 1, topX: 0.96, botZ: 1, topZ: 0.84 };

/** How far the glazing stands off whatever it wraps. */
const GLASS_PROUD = 0.03;

/** The x scale of a tapered part at height fraction `f` (0 = floor, 1 = roof). */
function taperX(t: { botX: number; topX: number }, f: number) {
  return t.botX + (t.topX - t.botX) * f;
}

/**
 * A unit box whose top and bottom faces are scaled in, shaded from the sill up.
 *
 * Three height segments so the shading is a gradient rather than a hard line,
 * and so the taper reads as a curve down the flank instead of a single bevel.
 * The vertex colours multiply the per-instance paint, so the tuck under the
 * doors sits in its own shadow on a car of any colour.
 */
function taperedBox(t: { botX: number; topX: number; botZ: number; topZ: number }, shade: number) {
  const geo = new THREE.BoxGeometry(1, 1, 1, 1, 3, 1);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const f = pos.getY(i) + 0.5;
    pos.setX(i, pos.getX(i) * taperX(t, f));
    pos.setZ(i, pos.getZ(i) * (t.botZ + (t.topZ - t.botZ) * f));
    const k = shade + (1 - shade) * Math.min(1, f * 3.2);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Fills a geometry's colour attribute with one flat colour. */
function paint(geo: THREE.BufferGeometry, hex: number) {
  const n = geo.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * Tyre and hub welded into one geometry, so a wheel is still one instance.
 *
 * A bare cylinder at this size is a black disc and disappears against the road
 * shadow. The hub is what makes it read as a wheel — it stands 2% proud of the
 * tyre so it never z-fights, and it is the only bright thing under the car.
 * Unit-sized: x is the width, y and z are the diameter.
 */
function wheelGeometry() {
  const tyre = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  tyre.rotateZ(Math.PI / 2);
  paint(tyre, 0x0d0d11);
  const hub = new THREE.CylinderGeometry(0.28, 0.28, 1.04, 12);
  hub.rotateZ(Math.PI / 2);
  paint(hub, 0x6d7482);
  const merged = mergeGeometries([tyre, hub], false);
  tyre.dispose();
  hub.dispose();
  return merged ?? new THREE.CylinderGeometry(0.5, 0.5, 1, 16).rotateZ(Math.PI / 2);
}

const PLATES = [
  "VC 4 LIFE", "8QX 220", "LEO 991", "TRNK FL", "77 VICE",
  "3RP 118", "OCN 42", "HVN 7", "5KL 903", "BLVD 1",
];

/* ------------------------------------------------------------------ */
/* a vehicle on the network                                            */
/* ------------------------------------------------------------------ */

type Car = {
  spec: number;
  /** 0 = runs north-south along Z, 1 = runs east-west along X. */
  axis: 0 | 1;
  /** Road line index (k for axis 0, m for axis 1). */
  line: number;
  dir: 1 | -1;
  lane: number;
  /** Position along the road: world z for axis 0, world x for axis 1. */
  s: number;
  v: number;
  vMax: number;
  colour: THREE.Color;
  /** Node index (the other axis's line) the car is heading toward. */
  node: number;
  plan: -1 | 0 | 1;
  planned: boolean;
};

const LANE_KEY = (c: Car) => c.axis * 1e6 + (c.line + 32) * 1e4 + (c.dir + 1) * 100 + c.lane;

/* Scratch for the ray test below — it runs once per car per frame. */
const _UP = new THREE.Vector3(0, 1, 0);
const _o: [number, number, number] = [0, 0, 0];
const _d: [number, number, number] = [0, 0, 0];
const _lo: [number, number, number] = [0, 0, 0];
const _hi: [number, number, number] = [0, 0, 0];

/**
 * Three-axis slab test. Returns the entry parameter in 0..1 along `d`, or -1.
 * A ray that starts inside the box returns 0.
 */
function slabT(
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  lo: readonly [number, number, number],
  hi: readonly [number, number, number],
) {
  let t0 = 0;
  let t1 = 1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-8) {
      if (o[a] < lo[a] || o[a] > hi[a]) return -1;
      continue;
    }
    let p = (lo[a] - o[a]) / d[a];
    let q = (hi[a] - o[a]) / d[a];
    if (p > q) [p, q] = [q, p];
    t0 = Math.max(t0, p);
    t1 = Math.min(t1, q);
    if (t0 > t1) return -1;
  }
  return t0;
}

export class Traffic {
  readonly group = new THREE.Group();
  private cars: Car[] = [];
  private net: RoadNet;
  private rnd: Rnd;

  private body: THREE.InstancedMesh;
  private cabin: THREE.InstancedMesh;
  private glass: THREE.InstancedMesh;
  private wheel: THREE.InstancedMesh;
  private lamp: THREE.InstancedMesh;
  private bumper: THREE.InstancedMesh;
  private signal: THREE.InstancedMesh | null = null;
  private heads: SignalHead[] = [];

  private capacity: number;
  private moving: number;
  private disposables: { dispose: () => void }[] = [];
  private buckets = new Map<number, Car[]>();
  private since = 0;
  private sigSince = 99;

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _sc = new THREE.Vector3();
  private _col = new THREE.Color();

  constructor(opts: {
    net: RoadNet;
    rnd: Rnd;
    moving: number;
    parked: { x: number; z: number; rot: number; kind: number }[];
    heads: SignalHead[];
    evidence: EvidenceTag[];
  }) {
    this.net = opts.net;
    this.rnd = opts.rnd;
    this.moving = opts.moving;
    const parked = opts.parked;
    this.capacity = opts.moving + parked.length;

    const keep = <T extends { dispose: () => void }>(d: T) => {
      this.disposables.push(d);
      return d;
    };

    const bodyGeo = keep(taperedBox(HULL, 0.76));
    const cabinGeo = keep(taperedBox(CAB, 0.86));
    const glassGeo = keep(new THREE.BoxGeometry(1, 1, 1));
    const wheelGeo = keep(wheelGeometry());
    const lampGeo = keep(new THREE.BoxGeometry(1, 1, 1));
    const bumperGeo = keep(new THREE.BoxGeometry(1, 1, 1));

    /*
     * Car paint is a dielectric with a clearcoat, not a metal. There is no
     * environment map in this scene, so a high metalness has nothing to
     * reflect and no diffuse left to fall back on — every vehicle came out
     * black. Low metalness, low roughness reads as paint and keeps its colour.
     *
     * The hull and the greenhouse share it: the roof of a car is painted the
     * same as its doors, and that one fact is most of what stopped the old
     * model reading as a vehicle.
     */
    const paintMat = keep(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.34,
        metalness: 0.16,
      }),
    );
    /*
     * Glazing is deliberately NOT per-instance coloured. Tinting it with the
     * paint would give a red car red windows; leaving it on its own material
     * keeps every windscreen the same cold grey-blue, which is what sells the
     * band as glass rather than as a stripe.
     *
     * It has to be very dark to survive the day: the city runs a hemisphere
     * light at intensity 3 over a sun at 2.5, and a mid-grey windscreen comes
     * out of that as a pale blue panel that reads as paint. The emissive is
     * what keeps it from going to a flat void after dark.
     */
    const glassMat = keep(
      new THREE.MeshStandardMaterial({
        color: 0x0c111c,
        roughness: 0.22,
        metalness: 0.12,
        emissive: new THREE.Color(0x0b1728),
      }),
    );
    const wheelMat = keep(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }),
    );
    const lampMat = keep(new THREE.MeshBasicMaterial({ toneMapped: false }));
    const bumperMat = keep(
      new THREE.MeshStandardMaterial({ color: 0x23242a, roughness: 0.62 }),
    );

    this.body = new THREE.InstancedMesh(bodyGeo, paintMat, this.capacity);
    this.cabin = new THREE.InstancedMesh(cabinGeo, paintMat, this.capacity);
    this.glass = new THREE.InstancedMesh(glassGeo, glassMat, this.capacity);
    this.wheel = new THREE.InstancedMesh(wheelGeo, wheelMat, this.capacity * 4);
    this.lamp = new THREE.InstancedMesh(lampGeo, lampMat, this.capacity * 4);
    this.bumper = new THREE.InstancedMesh(bumperGeo, bumperMat, this.capacity * 2);
    for (const m of [
      this.body,
      this.cabin,
      this.glass,
      this.wheel,
      this.lamp,
      this.bumper,
    ]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.body.castShadow = true;
    this.cabin.castShadow = true;

    /* ---- moving fleet ---- */
    for (let i = 0; i < opts.moving; i++) {
      const car = this.spawn(i);
      if (car) this.cars.push(car);
    }

    /* ---- parked stock, written once ---- */
    parked.forEach((p, n) => {
      const idx = opts.moving + n;
      const spec = VEHICLES[Math.min(p.kind, 5)];
      this.write(idx, spec, p.x, p.z, p.rot, pick(this.rnd, spec.colours), false);
    });
    this.body.count = this.capacity;
    this.cabin.count = this.capacity;
    this.glass.count = this.capacity;
    this.wheel.count = this.capacity * 4;
    this.lamp.count = this.capacity * 4;
    this.bumper.count = this.capacity * 2;

    /* ---- a few readable plates, as photographable evidence ---- */
    const plateGeo = keep(new THREE.PlaneGeometry(0.56, 0.28));
    for (let n = 0; n < Math.min(8, parked.length); n++) {
      const p = parked[Math.floor((n / 8) * parked.length)];
      const code = PLATES[n % PLATES.length];
      const tex = keep(plateTexture(code));
      const mat = keep(new THREE.MeshBasicMaterial({ map: tex }));
      const mesh = new THREE.Mesh(plateGeo, mat);
      const spec = VEHICLES[Math.min(p.kind, 5)];
      // hung on the tail face, over the bumper, level with the rear lamps
      const off = spec.tail - 0.03;
      mesh.position.set(
        p.x + Math.sin(p.rot) * off,
        spec.lampY - 0.06,
        p.z + Math.cos(p.rot) * off,
      );
      mesh.rotation.y = p.rot + Math.PI;
      this.group.add(mesh);
      opts.evidence.push({
        kind: "PLATE",
        label: `PLATE ${code}`,
        object: mesh,
        offset: new THREE.Vector3(),
        radius: 0.46,
      });
    }

    this.buildSignals(opts.heads, keep);
  }

  /* ---------------- signals ---------------- */

  private buildSignals(
    heads: SignalHead[],
    keep: <T extends { dispose: () => void }>(d: T) => T,
  ) {
    if (!heads.length) return;
    this.heads = heads;
    const geo = keep(new THREE.SphereGeometry(0.17, 6, 5));
    const mat = keep(new THREE.MeshBasicMaterial({ toneMapped: false }));
    const im = new THREE.InstancedMesh(geo, mat, heads.length * 3);
    im.frustumCulled = false;
    const m = new THREE.Matrix4();
    heads.forEach((h, i) => {
      for (let l = 0; l < 3; l++) {
        m.makeTranslation(h.x, h.y + 0.42 - l * 0.42, h.z);
        im.setMatrixAt(i * 3 + l, m);
        im.setColorAt(i * 3 + l, this._col.setHex(0x120c10));
      }
    });
    im.instanceMatrix.needsUpdate = true;
    this.signal = im;
    this.group.add(im);
  }

  private updateSignals(t: number) {
    const im = this.signal;
    if (!im || !im.instanceColor) return;
    const DIM = [0x2a0806, 0x2a1c04, 0x062a10];
    const LIT = [0xff2b1f, 0xffb020, 0x2fe06a];
    this.heads.forEach((h, i) => {
      const state = lightState(h.axis, h.offset, t);
      const on = state === "red" ? 0 : state === "amber" ? 1 : 2;
      for (let l = 0; l < 3; l++) {
        im.setColorAt(i * 3 + l, this._col.setHex(l === on ? LIT[l] : DIM[l]));
      }
    });
    im.instanceColor.needsUpdate = true;
  }

  /* ---------------- spawning ---------------- */

  /** A random legal place on the network, optionally near a point. */
  private randomSlot(nearX?: number, nearZ?: number) {
    for (let tries = 0; tries < 60; tries++) {
      const axis: 0 | 1 = this.rnd() > 0.5 ? 0 : 1;
      const line = irange(this.rnd, -HALF, HALF);
      const cell = irange(this.rnd, 0, GRID - 1);
      const table = axis === 0 ? this.net.ns : this.net.ew;
      if (!table[line + HALF]?.[cell]) continue;
      const dir: 1 | -1 = this.rnd() > 0.5 ? 1 : -1;
      const lane = irange(this.rnd, 0, laneCount(line) - 1);
      const s = (cell - HALF) * CELL + this.rnd() * CELL;
      if (nearX != null && nearZ != null) {
        const [x, z] = this.place(axis, line, lane, dir, s);
        // close enough to be worth simulating, far enough not to pop in
        const d = Math.hypot(x - nearX, z - nearZ);
        if (d < 70 || d > 230) continue;
      }
      return { axis, line, dir, lane, s };
    }
    return null;
  }

  private spawn(idx: number, nearX?: number, nearZ?: number): Car | null {
    const slot = this.randomSlot(nearX, nearZ);
    if (!slot) return null;
    // buses and trucks only on the wider roads
    const heavy = this.rnd() > 0.82;
    const spec = heavy ? irange(this.rnd, 6, 7) : irange(this.rnd, 0, 5);
    const s = VEHICLES[spec];
    const car: Car = {
      spec,
      axis: slot.axis,
      line: slot.line,
      dir: slot.dir,
      lane: slot.lane,
      s: slot.s,
      v: s.speed * 0.6,
      vMax: s.speed * (0.82 + this.rnd() * 0.36),
      colour: new THREE.Color(pick(this.rnd, s.colours)),
      node: 0,
      plan: 0,
      planned: false,
    };
    this.retarget(car);
    void idx;
    return car;
  }

  /* ---------------- geometry ---------------- */

  /** World position of a car on its lane. */
  private place(axis: 0 | 1, line: number, lane: number, dir: 1 | -1, s: number) {
    const off = laneOffset(line, lane);
    if (axis === 0) {
      // driving +z, keep right = -x
      return [line * CELL - dir * off, s] as const;
    }
    // driving +x, keep right = +z
    return [s, line * CELL + dir * off] as const;
  }

  private yawOf(axis: 0 | 1, dir: 1 | -1) {
    if (axis === 0) return dir > 0 ? 0 : Math.PI;
    return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  /** Writes one vehicle's twelve instance matrices. */
  private write(
    idx: number,
    spec: VehicleSpec,
    x: number,
    z: number,
    yaw: number,
    colour: THREE.Color | number,
    lit: boolean,
  ) {
    const q = this._q.setFromAxisAngle(_UP, yaw);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // local (right, up, forward) -> world
    const fx = sin;
    const fz = cos;
    const rx = cos;
    const rz = -sin;

    const at = (r: number, up: number, f: number) =>
      this._p.set(x + rx * r + fx * f, up, z + rz * r + fz * f);

    const coat = this._col.set(colour);

    this._m.compose(
      at(0, spec.ride, spec.bz),
      q,
      this._sc.set(spec.bw, spec.bh, spec.bl),
    );
    this.body.setMatrixAt(idx, this._m);
    this.body.setColorAt(idx, coat);

    this._m.compose(
      at(0, spec.cy, spec.cz),
      q,
      this._sc.set(spec.cw, spec.ch, spec.cl),
    );
    this.cabin.setMatrixAt(idx, this._m);
    this.cabin.setColorAt(idx, coat);

    /*
     * The band's width is read off the taper of whatever it wraps at its own
     * height, so it clears the flank by the same 3cm on a hatchback and on a
     * bus without either of them carrying a hand-tuned number.
     */
    const host =
      spec.gOn === "hull"
        ? { w: spec.bw, y0: spec.ride - spec.bh / 2, h: spec.bh, t: HULL }
        : { w: spec.cw, y0: spec.cy - spec.ch / 2, h: spec.ch, t: CAB };
    const f = Math.min(1, Math.max(0, (spec.gy + spec.gh / 2 - host.y0) / host.h));
    this._m.compose(
      at(0, spec.gy, spec.gz),
      q,
      this._sc.set(host.w * taperX(host.t, f) + GLASS_PROUD, spec.gh, spec.gl),
    );
    this.glass.setMatrixAt(idx, this._m);

    const wheels: [number, number][] = [
      [-spec.track, spec.base],
      [spec.track, spec.base],
      [-spec.track, -spec.base],
      [spec.track, -spec.base],
    ];
    wheels.forEach(([r, fwd], n) => {
      this._m.compose(
        at(r, spec.wheel, fwd),
        q,
        this._sc.set(0.3, spec.wheel * 2, spec.wheel * 2),
      );
      this.wheel.setMatrixAt(idx * 4 + n, this._m);
    });

    const lr = spec.bw / 2 - 0.36;
    const lamps: [number, number, number][] = [
      [-lr, spec.nose, 0],
      [lr, spec.nose, 0],
      [-lr, spec.tail, 1],
      [lr, spec.tail, 1],
    ];
    lamps.forEach(([r, fwd, rear], n) => {
      this._m.compose(
        at(r, spec.lampY + (rear ? 0.06 : 0), fwd),
        q,
        this._sc.set(0.34, 0.16, 0.1),
      );
      this.lamp.setMatrixAt(idx * 4 + n, this._m);
      this.lamp.setColorAt(
        idx * 4 + n,
        this._col.setHex(rear ? (lit ? 0xff2020 : 0x5a0c0c) : lit ? 0xfff2d0 : 0x3a3830),
      );
    });

    // Bumpers sit flush with the nose and tail faces and break the paint up
    // exactly where a real one does — under the lamps, across the full width.
    const bumpY = Math.max(0.3, spec.lampY - 0.2);
    [spec.nose - 0.08, spec.tail + 0.08].forEach((fwd, n) => {
      this._m.compose(at(0, bumpY, fwd), q, this._sc.set(spec.bw * 0.96, 0.22, 0.16));
      this.bumper.setMatrixAt(idx * 2 + n, this._m);
    });
  }

  /* ---------------- planning ---------------- */

  /** Does the segment leaving node `node` in the current direction exist? */
  private segmentAhead(axis: 0 | 1, line: number, node: number, dir: 1 | -1) {
    const table = axis === 0 ? this.net.ns : this.net.ew;
    const cell = dir > 0 ? node + HALF : node + HALF - 1;
    return !!table[line + HALF]?.[cell];
  }

  /** Sets `node` to the next intersection in front of the car. */
  private retarget(car: Car) {
    const t = car.s / CELL;
    car.node = car.dir > 0 ? Math.ceil(t + 1e-6) : Math.floor(t - 1e-6);
    car.node = Math.max(-HALF, Math.min(HALF, car.node));
    car.planned = false;
  }

  /** Chooses straight / left / right, preferring straight where legal. */
  private decide(car: Car) {
    const node = car.node;
    const straight = this.segmentAhead(car.axis, car.line, node, car.dir);
    const otherAxis: 0 | 1 = car.axis === 0 ? 1 : 0;
    const opts: (-1 | 0 | 1)[] = [];
    if (straight) opts.push(0, 0, 0, 0);
    for (const turn of [-1, 1] as const) {
      // for an NS car the new line is the node index; the new direction is
      // whichever way the turn points
      const newLine = node;
      const newDir: 1 | -1 =
        car.axis === 0
          ? ((car.dir * turn) as 1 | -1)
          : ((-car.dir * turn) as 1 | -1);
      const newNode = car.line;
      if (this.segmentAhead(otherAxis, newLine, newNode, newDir)) opts.push(turn);
    }
    car.plan = opts.length ? pick(this.rnd, opts) : 0;
    car.planned = true;
  }

  /** Commits a planned turn once the car reaches the junction centre. */
  private applyPlan(car: Car) {
    const node = car.node;
    if (car.plan === 0 && this.segmentAhead(car.axis, car.line, node, car.dir)) {
      this.retarget(car);
      return true;
    }
    if (car.plan !== 0) {
      const otherAxis: 0 | 1 = car.axis === 0 ? 1 : 0;
      const newDir: 1 | -1 =
        car.axis === 0
          ? ((car.dir * car.plan) as 1 | -1)
          : ((-car.dir * car.plan) as 1 | -1);
      const newLine = node;
      car.axis = otherAxis;
      car.s = car.line * CELL;
      car.line = newLine;
      car.dir = newDir;
      car.lane = Math.min(car.lane, laneCount(newLine) - 1);
      this.retarget(car);
      return true;
    }
    return false;
  }

  /* ---------------- the step ---------------- */

  update(dt: number, t: number, playerX: number, playerZ: number, night: number) {
    /* lane occupancy, rebuilt each tick — a hundred entries, not a concern */
    this.buckets.clear();
    for (const c of this.cars) {
      const k = LANE_KEY(c);
      let arr = this.buckets.get(k);
      if (!arr) this.buckets.set(k, (arr = []));
      arr.push(c);
    }

    this.since += dt;
    const recycle = this.since > 2;
    if (recycle) this.since = 0;

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const spec = VEHICLES[car.spec];
      const [x, z] = this.place(car.axis, car.line, car.lane, car.dir, car.s);

      /*
       * Keep the fleet where the player can see it. A hundred cars spread over
       * a square kilometre is an empty city; the same hundred held inside a
       * 300-metre bubble is rush hour, and the player can't tell the difference
       * because they can't see the rest of the grid anyway.
       */
      if (recycle && Math.hypot(x - playerX, z - playerZ) > 300) {
        const fresh = this.spawn(i, playerX, playerZ);
        if (fresh) {
          this.cars[i] = fresh;
          continue;
        }
      }

      const nodeS = car.node * CELL;
      const toNode = (nodeS - car.s) * car.dir;

      if (!car.planned && toNode < 46) this.decide(car);

      /* ---- how far we may travel before something stops us ---- */
      let allowed = Infinity;

      // the junction, if the light is against us
      const sig =
        car.axis === 0
          ? this.net.signalAt(car.line, car.node)
          : this.net.signalAt(car.node, car.line);
      if (sig) {
        const state = lightState(car.axis, sig.offset, t);
        const stopAt = toNode - (spec.l / 2 + 7.5);
        if (state === "red" || (state === "amber" && stopAt > 4)) {
          allowed = Math.min(allowed, Math.max(0, stopAt));
        }
      }
      // a dead end we have no plan through
      if (car.planned && car.plan === 0 && !this.segmentAhead(car.axis, car.line, car.node, car.dir)) {
        allowed = Math.min(allowed, Math.max(0, toNode - spec.l));
      }

      // the car in front, in our own lane
      const lane = this.buckets.get(LANE_KEY(car));
      if (lane) {
        for (const o of lane) {
          if (o === car) continue;
          const gap = (o.s - car.s) * car.dir;
          if (gap > 0) {
            allowed = Math.min(allowed, gap - (spec.l / 2 + VEHICLES[o.spec].l / 2 + 2.2));
          }
        }
      }

      /*
       * Somebody standing in the road.
       *
       * Traffic used to drive straight through the player, which is the single
       * most immersion-breaking thing a city can do. The test is the same one
       * used for the car in front: project the player onto this car's lane, and
       * if they are ahead of it and within its width, that is how far it is
       * cleared to travel.
       */
      const lateral = car.axis === 0 ? Math.abs(playerX - x) : Math.abs(playerZ - z);
      const ahead =
        car.axis === 0 ? (playerZ - car.s) * car.dir : (playerX - car.s) * car.dir;
      if (lateral < spec.w / 2 + 1.15 && ahead > 0) {
        allowed = Math.min(allowed, ahead - (spec.l / 2 + 1.9));
      }

      /* ---- longitudinal control ---- */
      // target speed from the distance we're cleared for, capped by the limit
      const safe = allowed === Infinity ? car.vMax : Math.sqrt(Math.max(0, allowed) * 2 * 6.5);
      // ease off through a turn
      const turning = car.planned && car.plan !== 0 && toNode < 18 ? 0.45 : 1;
      const want = Math.min(car.vMax * turning, safe);
      const rate = want < car.v ? 9 : 3.4;
      car.v += (want - car.v) * (1 - Math.exp(-rate * dt));
      if (car.v < 0.02) car.v = 0;

      car.s += car.dir * car.v * dt;

      // reached the junction?
      if ((car.node * CELL - car.s) * car.dir <= 0) {
        if (!car.planned) this.decide(car);
        if (!this.applyPlan(car)) {
          // nowhere to go — turn around rather than stop forever
          car.dir = -car.dir as 1 | -1;
          this.retarget(car);
        }
      }

      const [px, pz] = this.place(car.axis, car.line, car.lane, car.dir, car.s);
      this.write(i, spec, px, pz, this.yawOf(car.axis, car.dir), car.colour, night > 0.25);
    }

    for (const m of [
      this.body,
      this.cabin,
      this.glass,
      this.wheel,
      this.lamp,
      this.bumper,
    ]) {
      m.instanceMatrix.needsUpdate = true;
    }
    for (const m of [this.body, this.cabin, this.lamp]) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    this.sigSince += dt;
    if (this.sigSince > 0.2) {
      this.sigSince = 0;
      this.updateSignals(t);
    }
  }

  /**
   * Pushes a capsule out of any moving vehicle it is standing inside.
   *
   * Cars brake for the player, but a bus that has already stopped still
   * occupies eleven metres of road, and walking through it looks worse than
   * being run over. Each vehicle is tested as an oriented box: rotate the
   * point into the vehicle's frame, push it out along the shallowest axis,
   * rotate back.
   */
  resolveAgainst(pos: THREE.Vector3, radius: number, clearTop = 0) {
    for (const c of this.cars) {
      const spec = VEHICLES[c.spec];
      // feet above the roof: this is a jump over the bonnet, not a collision
      if (spec.top <= clearTop) continue;
      const [cx, cz] = this.place(c.axis, c.line, c.lane, c.dir, c.s);
      if (Math.abs(cx - pos.x) > 12 || Math.abs(cz - pos.z) > 12) continue;

      const yaw = this.yawOf(c.axis, c.dir);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // vehicle-local: +f along its nose, +r out of its right flank
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const f = dx * sin + dz * cos;
      const r = dx * cos - dz * sin;

      const hf = spec.l / 2 + radius;
      const hr = spec.w / 2 + radius;
      if (Math.abs(f) >= hf || Math.abs(r) >= hr) continue;

      // out the nearest face
      const outF = hf - Math.abs(f);
      const outR = hr - Math.abs(r);
      let nf = f;
      let nr = r;
      if (outR <= outF) nr = r >= 0 ? hr : -hr;
      else nf = f >= 0 ? hf : -hf;

      pos.x = cx + nf * sin + nr * cos;
      pos.z = cz + nf * cos - nr * sin;
    }
  }

  /**
   * Roof height of the vehicle under (x, z), or 0. The counterpart to the skip
   * in `resolveAgainst`: if a jump is allowed to clear a car, the landing has
   * to be able to end up on it rather than back through it.
   */
  roofAt(x: number, z: number, clearTop: number) {
    let y = 0;
    for (const c of this.cars) {
      const spec = VEHICLES[c.spec];
      if (spec.top > clearTop || spec.top <= y) continue;
      const [cx, cz] = this.place(c.axis, c.line, c.lane, c.dir, c.s);
      if (Math.abs(cx - x) > 12 || Math.abs(cz - z) > 12) continue;

      const yaw = this.yawOf(c.axis, c.dir);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = x - cx;
      const dz = z - cz;
      const f = dx * sin + dz * cos;
      const r = dx * cos - dz * sin;
      if (Math.abs(f) >= spec.l / 2 || Math.abs(r) >= spec.w / 2) continue;
      y = spec.top;
    }
    return y;
  }

  /**
   * Distance along `from`→`to` to the first moving vehicle in the way, or -1.
   *
   * The camera's occlusion test was a slab test against the collision grid,
   * and traffic has never been in that grid — it is simulated separately and
   * only ever consulted for walking into and jumping onto. So an eleven-metre
   * bus could drive straight between the lens and the player with nothing to
   * stop it, and the frame filled with the unlit underside of its own body.
   *
   * Same oriented-box maths as `resolveAgainst`: rotate the segment into the
   * vehicle's frame, where the box is axis-aligned, and run a slab test there.
   * Starting inside a vehicle returns 0, which is the honest answer.
   *
   * `minTop` is the caller's "too short to count as a wall" line, the same one
   * the collision grid takes. The camera passes CAMERA_CLEAR, so a hatchback
   * crossing the shot never tugs the rig; only the vans, buses and trucks that
   * can actually black out the frame do.
   *
   * `out.top` receives the roof height of whatever was hit. The camera needs
   * it to work out how far it has to climb to see over the thing.
   */
  rayHit(
    from: THREE.Vector3,
    to: THREE.Vector3,
    minTop = 0,
    out?: { top: number },
    pad = 0,
  ) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return -1;

    // Cheap reject: nothing further from the segment's midpoint than half its
    // length plus the longest vehicle can possibly be sitting on it.
    const midX = (from.x + to.x) / 2;
    const midZ = (from.z + to.z) / 2;
    const span = Math.hypot(dx, dz) / 2 + 6 + pad;

    let best = -1;
    if (out) out.top = 0;
    for (const c of this.cars) {
      const spec = VEHICLES[c.spec];
      if (spec.top < minTop) continue;
      const [cx, cz] = this.place(c.axis, c.line, c.lane, c.dir, c.s);
      if (Math.abs(cx - midX) > span || Math.abs(cz - midZ) > span) continue;

      const yaw = this.yawOf(c.axis, c.dir);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const ox = from.x - cx;
      const oz = from.z - cz;

      // vehicle-local (forward, up, right), the same frame `resolveAgainst` uses
      _o[0] = ox * sin + oz * cos;
      _o[1] = from.y;
      _o[2] = ox * cos - oz * sin;
      _d[0] = dx * sin + dz * cos;
      _d[1] = dy;
      _d[2] = dx * cos - dz * sin;
      _lo[0] = -spec.l / 2 - pad;
      _lo[1] = -pad;
      _lo[2] = -spec.w / 2 - pad;
      _hi[0] = spec.l / 2 + pad;
      _hi[1] = spec.top + pad;
      _hi[2] = spec.w / 2 + pad;

      const t = slabT(_o, _d, _lo, _hi);
      if (t >= 0 && (best < 0 || t < best)) {
        best = t;
        if (out) out.top = spec.top;
      }
    }
    return best < 0 ? -1 : best * len;
  }

  /**
   * Roof height of the moving vehicle containing `p`, or -1.
   *
   * `roofAt` answers the same question for a pair of feet, in two dimensions,
   * because a jump only ever lands on top. The lens can end up beside a bus as
   * easily as under one, so this one tests height as well.
   */
  roofOver(p: THREE.Vector3, pad = 0) {
    let y = -1;
    for (const c of this.cars) {
      const spec = VEHICLES[c.spec];
      if (spec.top <= y) continue;
      if (p.y > spec.top + pad || p.y < -pad) continue;
      const [cx, cz] = this.place(c.axis, c.line, c.lane, c.dir, c.s);
      if (Math.abs(cx - p.x) > 12 || Math.abs(cz - p.z) > 12) continue;

      const yaw = this.yawOf(c.axis, c.dir);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const f = dx * sin + dz * cos;
      const r = dx * cos - dz * sin;
      if (Math.abs(f) >= spec.l / 2 + pad || Math.abs(r) >= spec.w / 2 + pad)
        continue;
      y = spec.top;
    }
    return y;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
