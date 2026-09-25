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
 * The whole fleet is four InstancedMeshes (bodies, cabins, wheels, lamps), so
 * a hundred cars cost four draw calls and the parked ones are free: they live
 * in the same buffers and simply never get their matrices rewritten.
 */

import * as THREE from "three";
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

type VehicleSpec = {
  name: string;
  /** width, height, length of the main body. */
  w: number;
  h: number;
  l: number;
  /** cabin size and its offset back from the body centre. */
  cw: number;
  ch: number;
  cl: number;
  cz: number;
  /** ride height and wheel radius. */
  ride: number;
  wheel: number;
  /** wheelbase half-length. */
  base: number;
  top: number;
  colours: number[];
  speed: number;
};

const CIVIC = [0xd8d4cc, 0x2b2f3a, 0x8a1f3a, 0x1f4a8a, 0x3a6b4a, 0x6b6b74, 0xb03a6b];
const BRIGHT = [0xff2e97, 0x22e6ff, 0xffb347, 0x9dff3d, 0xff5ad9];

export const VEHICLES: VehicleSpec[] = [
  { name: "sedan", w: 1.86, h: 0.66, l: 4.5, cw: 1.68, ch: 0.58, cl: 2.1, cz: -0.15, ride: 0.7, wheel: 0.33, base: 1.5, top: 1.55, colours: CIVIC, speed: 13 },
  { name: "suv", w: 2.0, h: 0.92, l: 4.9, cw: 1.86, ch: 0.72, cl: 2.7, cz: -0.1, ride: 0.86, wheel: 0.4, base: 1.6, top: 2.0, colours: CIVIC, speed: 12 },
  { name: "hatch", w: 1.76, h: 0.66, l: 3.9, cw: 1.62, ch: 0.62, cl: 2.0, cz: -0.3, ride: 0.66, wheel: 0.31, base: 1.3, top: 1.5, colours: [...CIVIC, ...BRIGHT], speed: 12.5 },
  { name: "van", w: 2.06, h: 1.5, l: 5.6, cw: 1.94, ch: 0.5, cl: 1.5, cz: 1.9, ride: 1.05, wheel: 0.38, base: 1.9, top: 2.5, colours: [0xe8e4dc, 0xd8d4cc, 0x2f6bb0], speed: 11 },
  { name: "pickup", w: 2.0, h: 0.8, l: 5.3, cw: 1.84, ch: 0.68, cl: 1.9, cz: 0.7, ride: 0.92, wheel: 0.4, base: 1.8, top: 1.9, colours: CIVIC, speed: 12 },
  { name: "taxi", w: 1.9, h: 0.68, l: 4.7, cw: 1.72, ch: 0.6, cl: 2.2, cz: -0.15, ride: 0.72, wheel: 0.34, base: 1.55, top: 1.6, colours: [0xf2c22a], speed: 13.5 },
  { name: "bus", w: 2.5, h: 2.5, l: 11.5, cw: 2.4, ch: 0.5, cl: 9.5, cz: -0.4, ride: 1.6, wheel: 0.52, base: 3.6, top: 3.4, colours: [0xd8562f, 0x2f7ad8, 0xe8e4dc], speed: 9 },
  { name: "truck", w: 2.5, h: 2.9, l: 9.5, cw: 2.3, ch: 1.0, cl: 2.4, cz: 3.2, ride: 1.9, wheel: 0.55, base: 3.0, top: 3.8, colours: [0x9a9490, 0x3a5f8a, 0x8a3a3a], speed: 9.5 },
];

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

export class Traffic {
  readonly group = new THREE.Group();
  private cars: Car[] = [];
  private net: RoadNet;
  private rnd: Rnd;

  private body: THREE.InstancedMesh;
  private cabin: THREE.InstancedMesh;
  private wheel: THREE.InstancedMesh;
  private lamp: THREE.InstancedMesh;
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

    const bodyGeo = keep(new THREE.BoxGeometry(1, 1, 1));
    const cabinGeo = keep(new THREE.BoxGeometry(1, 1, 1));
    const wheelGeo = keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
    wheelGeo.rotateZ(Math.PI / 2);
    const lampGeo = keep(new THREE.BoxGeometry(1, 1, 1));

    /*
     * Car paint is a dielectric with a clearcoat, not a metal. There is no
     * environment map in this scene, so a high metalness has nothing to
     * reflect and no diffuse left to fall back on — every vehicle came out
     * black. Low metalness, low roughness reads as paint and keeps its colour.
     */
    const bodyMat = keep(
      new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.16 }),
    );
    const cabinMat = keep(
      new THREE.MeshStandardMaterial({ color: 0x1b2236, roughness: 0.12, metalness: 0.25 }),
    );
    const wheelMat = keep(
      new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.95 }),
    );
    const lampMat = keep(
      new THREE.MeshBasicMaterial({ toneMapped: false }),
    );

    this.body = new THREE.InstancedMesh(bodyGeo, bodyMat, this.capacity);
    this.cabin = new THREE.InstancedMesh(cabinGeo, cabinMat, this.capacity);
    this.wheel = new THREE.InstancedMesh(wheelGeo, wheelMat, this.capacity * 4);
    this.lamp = new THREE.InstancedMesh(lampGeo, lampMat, this.capacity * 4);
    for (const m of [this.body, this.cabin, this.wheel, this.lamp]) {
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
    this.wheel.count = this.capacity * 4;
    this.lamp.count = this.capacity * 4;

    /* ---- a few readable plates, as photographable evidence ---- */
    const plateGeo = keep(new THREE.PlaneGeometry(0.56, 0.28));
    for (let n = 0; n < Math.min(8, parked.length); n++) {
      const p = parked[Math.floor((n / 8) * parked.length)];
      const code = PLATES[n % PLATES.length];
      const tex = keep(plateTexture(code));
      const mat = keep(new THREE.MeshBasicMaterial({ map: tex }));
      const mesh = new THREE.Mesh(plateGeo, mat);
      const spec = VEHICLES[Math.min(p.kind, 5)];
      mesh.position.set(
        p.x - Math.sin(p.rot) * (spec.l / 2 + 0.03),
        spec.ride - 0.08,
        p.z - Math.cos(p.rot) * (spec.l / 2 + 0.03),
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

  /** Writes one vehicle's five instance matrices. */
  private write(
    idx: number,
    spec: VehicleSpec,
    x: number,
    z: number,
    yaw: number,
    colour: THREE.Color | number,
    lit: boolean,
  ) {
    const q = this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // local (right, up, forward) -> world
    const fx = sin;
    const fz = cos;
    const rx = cos;
    const rz = -sin;

    const at = (r: number, up: number, f: number) =>
      this._p.set(x + rx * r + fx * f, up, z + rz * r + fz * f);

    this._m.compose(at(0, spec.ride, 0), q, this._sc.set(spec.w, spec.h, spec.l));
    this.body.setMatrixAt(idx, this._m);
    this.body.setColorAt(idx, this._col.set(colour));

    this._m.compose(
      at(0, spec.ride + spec.h / 2 + spec.ch / 2, spec.cz),
      q,
      this._sc.set(spec.cw, spec.ch, spec.cl),
    );
    this.cabin.setMatrixAt(idx, this._m);

    const wr = spec.w / 2 - 0.08;
    const wheels: [number, number][] = [
      [-wr, spec.base],
      [wr, spec.base],
      [-wr, -spec.base],
      [wr, -spec.base],
    ];
    wheels.forEach(([r, f], n) => {
      this._m.compose(
        at(r, spec.wheel, f),
        q,
        this._sc.set(0.26, spec.wheel * 2, spec.wheel * 2),
      );
      this.wheel.setMatrixAt(idx * 4 + n, this._m);
    });

    const lr = spec.w / 2 - 0.34;
    const lamps: [number, number, number][] = [
      [-lr, spec.l / 2, 0],
      [lr, spec.l / 2, 0],
      [-lr, -spec.l / 2, 1],
      [lr, -spec.l / 2, 1],
    ];
    lamps.forEach(([r, f, rear], n) => {
      this._m.compose(
        at(r, spec.ride + (rear ? 0.06 : 0), f),
        q,
        this._sc.set(0.34, 0.16, 0.1),
      );
      this.lamp.setMatrixAt(idx * 4 + n, this._m);
      this.lamp.setColorAt(
        idx * 4 + n,
        this._col.setHex(rear ? (lit ? 0xff2020 : 0x5a0c0c) : lit ? 0xfff2d0 : 0x3a3830),
      );
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

    this.body.instanceMatrix.needsUpdate = true;
    this.cabin.instanceMatrix.needsUpdate = true;
    this.wheel.instanceMatrix.needsUpdate = true;
    this.lamp.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.lamp.instanceColor) this.lamp.instanceColor.needsUpdate = true;

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
  resolveAgainst(pos: THREE.Vector3, radius: number) {
    for (const c of this.cars) {
      const [cx, cz] = this.place(c.axis, c.line, c.lane, c.dir, c.s);
      if (Math.abs(cx - pos.x) > 12 || Math.abs(cz - pos.z) > 12) continue;

      const spec = VEHICLES[c.spec];
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

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
