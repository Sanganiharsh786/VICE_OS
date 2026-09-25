/**
 * Background life: the instanced crowd, and the boats.
 *
 * The seven fully rigged characters in the engine are expensive — skinned
 * meshes running a full IK gait solve — so they are reserved for the people
 * near the player, who are the ones the camera can actually identify. Density
 * everywhere else comes from this: a few hundred four-box pedestrians walking
 * the pavement graph in four draw calls, with a swinging gait that is
 * completely convincing past about fifteen metres.
 *
 * Both crowds and boats recycle around the player, so the city stays populated
 * wherever you go without simulating a kilometre of empty pavement.
 */

import * as THREE from "three";
import { PALETTES } from "../rig";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ */
/* pedestrians                                                         */
/* ------------------------------------------------------------------ */

type Walker = {
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** Gait phase, 0..1. */
  phase: number;
  speed: number;
  height: number;
  target: THREE.Vector3;
  wait: number;
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
};

export class Crowd {
  readonly group = new THREE.Group();
  private walkers: Walker[] = [];
  private nodes: THREE.Vector3[];
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private disposables: { dispose: () => void }[] = [];
  private since = 0;

  constructor(nodes: THREE.Vector3[], count: number) {
    this.nodes = nodes;
    const keep = <T extends { dispose: () => void }>(d: T) => {
      this.disposables.push(d);
      return d;
    };

    const torsoGeo = keep(new THREE.BoxGeometry(1, 1, 1));
    const headGeo = keep(new THREE.SphereGeometry(0.5, 7, 5));
    const limbGeo = keep(new THREE.BoxGeometry(1, 1, 1));
    // pivot the limbs at the top so a rotation reads as a swing from the hip
    limbGeo.translate(0, -0.5, 0);

    const mat = () =>
      keep(new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.02 }));

    this.torso = new THREE.InstancedMesh(torsoGeo, mat(), count);
    this.head = new THREE.InstancedMesh(headGeo, mat(), count);
    this.legs = new THREE.InstancedMesh(limbGeo, mat(), count * 2);
    this.arms = new THREE.InstancedMesh(limbGeo, mat(), count * 2);

    for (const m of [this.torso, this.head, this.legs, this.arms]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      this.group.add(m);
    }

    for (let i = 0; i < count; i++) {
      const pal = PALETTES[i % PALETTES.length];
      const node = nodes.length ? nodes[(Math.random() * nodes.length) | 0] : new THREE.Vector3();
      this.walkers.push({
        x: node.x + (Math.random() - 0.5) * 3,
        z: node.z + (Math.random() - 0.5) * 3,
        y: node.y,
        yaw: Math.random() * 7,
        phase: Math.random(),
        speed: 1.05 + Math.random() * 0.7,
        height: 1.6 + Math.random() * 0.28,
        target: this.pick(),
        wait: Math.random() * 4,
        shirt: new THREE.Color(Math.random() > 0.5 ? pal.shirt : pal.jacket),
        pants: new THREE.Color(pal.pants),
        skin: new THREE.Color(pal.skin),
      });
    }
  }

  private pick() {
    if (!this.nodes.length) return new THREE.Vector3();
    return this.nodes[(Math.random() * this.nodes.length) | 0].clone();
  }

  /** Re-seed a walker onto the pavement graph near the player. */
  private reseed(w: Walker, px: number, pz: number) {
    for (let t = 0; t < 30; t++) {
      const n = this.nodes[(Math.random() * this.nodes.length) | 0];
      if (!n) return;
      const d = Math.hypot(n.x - px, n.z - pz);
      if (d < 18 || d > 110) continue;
      w.x = n.x;
      w.z = n.z;
      w.y = n.y;
      w.target = this.pick();
      return;
    }
  }

  update(dt: number, px: number, pz: number, heat: number) {
    this.since += dt;
    const recycle = this.since > 2.5;
    if (recycle) this.since = 0;

    const n = this.walkers.length;
    for (let i = 0; i < n; i++) {
      const w = this.walkers[i];

      if (recycle && Math.hypot(w.x - px, w.z - pz) > 140) this.reseed(w, px, pz);

      let dx = w.target.x - w.x;
      let dz = w.target.z - w.z;
      let dist = Math.hypot(dx, dz);

      if (dist < 1.2) {
        w.wait -= dt;
        if (w.wait <= 0) {
          w.target = this.pick();
          w.wait = 0.5 + Math.random() * 4;
        }
      }

      // give the player a wide berth once the city is nervous about them
      const toPlayer = Math.hypot(w.x - px, w.z - pz);
      const spooked = heat > 45 && toPlayer < 9;
      if (spooked) {
        dx = w.x - px;
        dz = w.z - pz;
        dist = Math.max(toPlayer, 0.01);
      }

      const moving = dist > 1.2 || spooked;
      const speed = moving ? w.speed * (spooked ? 2.2 : 1) : 0;
      if (moving) {
        w.x += (dx / dist) * speed * dt;
        w.z += (dz / dist) * speed * dt;
        const want = Math.atan2(dx / dist, dz / dist);
        let delta = want - w.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        w.yaw += delta * Math.min(1, dt * 7);
      }

      // stride length scales with speed, so the feet don't skate
      w.phase = (w.phase + (speed / 1.5) * dt) % 1;
      const cyc = w.phase * Math.PI * 2;
      const gait = Math.min(1, speed / 0.5);
      const swing = Math.sin(cyc) * 0.62 * gait;
      const bob = -Math.abs(Math.cos(cyc)) * 0.035 * gait;

      const k = w.height / 1.75;
      const legLen = 0.86 * k;
      const hipY = w.y + legLen + bob * k;
      const torsoH = 0.62 * k;
      const torsoY = hipY + torsoH / 2;

      _q.setFromAxisAngle(UP, w.yaw);

      _m.compose(
        _p.set(w.x, torsoY, w.z),
        _q,
        _s.set(0.44 * k, torsoH, 0.26 * k),
      );
      this.torso.setMatrixAt(i, _m);
      this.torso.setColorAt(i, w.shirt);

      _m.compose(
        _p.set(w.x, torsoY + torsoH / 2 + 0.13 * k, w.z),
        _q,
        _s.set(0.25 * k, 0.3 * k, 0.25 * k),
      );
      this.head.setMatrixAt(i, _m);
      this.head.setColorAt(i, w.skin);

      const sin = Math.sin(w.yaw);
      const cos = Math.cos(w.yaw);
      for (let l = 0; l < 2; l++) {
        const sign = l === 0 ? -1 : 1;
        const a = sign * swing;
        // limbs pivot about the hip / shoulder, so swing them in the walk plane
        _q.setFromEuler(new THREE.Euler(a, w.yaw, 0, "YXZ"));

        const hx = w.x + cos * sign * 0.11 * k;
        const hz = w.z - sin * sign * 0.11 * k;
        _m.compose(_p.set(hx, hipY, hz), _q, _s.set(0.15 * k, legLen, 0.16 * k));
        this.legs.setMatrixAt(i * 2 + l, _m);
        this.legs.setColorAt(i * 2 + l, w.pants);

        _q.setFromEuler(new THREE.Euler(-a * 0.8, w.yaw, 0, "YXZ"));
        const sx = w.x + cos * sign * 0.25 * k;
        const sz = w.z - sin * sign * 0.25 * k;
        _m.compose(
          _p.set(sx, torsoY + torsoH / 2 - 0.05 * k, sz),
          _q,
          _s.set(0.12 * k, 0.6 * k, 0.12 * k),
        );
        this.arms.setMatrixAt(i * 2 + l, _m);
        this.arms.setColorAt(i * 2 + l, w.shirt);
      }
    }

    for (const m of [this.torso, this.head, this.legs, this.arms]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* boats                                                               */
/* ------------------------------------------------------------------ */

type Boat = {
  route: number;
  t: number;
  speed: number;
  scale: number;
  hull: THREE.Color;
};

export class Boats {
  readonly group = new THREE.Group();
  private boats: Boat[] = [];
  private routes: { a: THREE.Vector3; b: THREE.Vector3; kind: number }[];
  private hull: THREE.InstancedMesh;
  private cabin: THREE.InstancedMesh;
  private wake: THREE.InstancedMesh;
  private disposables: { dispose: () => void }[] = [];

  constructor(
    routes: { a: THREE.Vector3; b: THREE.Vector3; kind: number }[],
    moorings: { x: number; z: number; rot: number; kind: number }[],
    perRoute = 3,
  ) {
    this.routes = routes;
    const keep = <T extends { dispose: () => void }>(d: T) => {
      this.disposables.push(d);
      return d;
    };

    const total = routes.length * perRoute + moorings.length;
    // a hull with a pointed bow, cheaply: a box with the front vertices pinched
    const hullGeo = keep(new THREE.CylinderGeometry(0.5, 0.34, 1, 4, 1));
    hullGeo.rotateZ(Math.PI / 2);
    hullGeo.rotateY(Math.PI / 4);
    hullGeo.scale(1, 1, 1);
    const cabinGeo = keep(new THREE.BoxGeometry(1, 1, 1));
    const wakeGeo = keep(new THREE.PlaneGeometry(1, 1));
    wakeGeo.rotateX(-Math.PI / 2);

    this.hull = new THREE.InstancedMesh(
      hullGeo,
      keep(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2 })),
      total,
    );
    this.cabin = new THREE.InstancedMesh(
      cabinGeo,
      keep(new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.5 })),
      total,
    );
    this.wake = new THREE.InstancedMesh(
      wakeGeo,
      keep(
        new THREE.MeshBasicMaterial({
          color: 0xcfe8ff,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      total,
    );
    for (const m of [this.hull, this.cabin, this.wake]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }

    const HULLS = [0xf2efe6, 0xe8e4dc, 0x2a4a7a, 0x1f5a4a, 0x7a2a3a];
    for (let r = 0; r < routes.length; r++) {
      for (let n = 0; n < perRoute; n++) {
        this.boats.push({
          route: r,
          t: n / perRoute + Math.random() * 0.1,
          speed: 0.004 + Math.random() * 0.006,
          scale: 5 + Math.random() * 14,
          hull: new THREE.Color(HULLS[(r + n) % HULLS.length]),
        });
      }
    }

    // moored boats in the marina, written once
    moorings.forEach((p, n) => {
      const idx = routes.length * perRoute + n;
      this.write(idx, p.x, p.z, p.rot, 6 + (n % 4) * 3, new THREE.Color(HULLS[n % HULLS.length]), 0, 0);
    });
    this.hull.count = total;
    this.cabin.count = total;
    this.wake.count = total;
  }

  private write(
    idx: number,
    x: number,
    z: number,
    yaw: number,
    len: number,
    colour: THREE.Color,
    bob: number,
    speed: number,
  ) {
    _q.setFromAxisAngle(UP, yaw);
    const beam = len * 0.3;
    _m.compose(_p.set(x, -0.2 + bob, z), _q, _s.set(beam, beam * 0.8, len));
    this.hull.setMatrixAt(idx, _m);
    this.hull.setColorAt(idx, colour);

    _m.compose(
      _p.set(x, 0.35 + bob, z),
      _q,
      _s.set(beam * 0.7, len * 0.12, len * 0.34),
    );
    this.cabin.setMatrixAt(idx, _m);

    _m.compose(
      _p.set(x - Math.sin(yaw) * len * 0.9, -0.55, z - Math.cos(yaw) * len * 0.9),
      _q,
      _s.set(beam * 1.5 * speed, 1, len * 1.8 * speed),
    );
    this.wake.setMatrixAt(idx, _m);
  }

  update(dt: number, t: number) {
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      const r = this.routes[b.route];
      // ping-pong along the route rather than teleporting back to the start
      b.t += b.speed * dt * 60 * (1 / 60);
      const u = b.t % 2;
      const f = u < 1 ? u : 2 - u;
      const dir = u < 1 ? 1 : -1;
      const x = r.a.x + (r.b.x - r.a.x) * f;
      const z = r.a.z + (r.b.z - r.a.z) * f;
      const yaw = Math.atan2((r.b.x - r.a.x) * dir, (r.b.z - r.a.z) * dir);
      const bob = Math.sin(t * 1.3 + i) * 0.3 + Math.sin(t * 2.7 + i * 2) * 0.12;
      this.write(i, x, z, yaw, b.scale, b.hull, bob, 1);
    }
    this.hull.instanceMatrix.needsUpdate = true;
    this.cabin.instanceMatrix.needsUpdate = true;
    this.wake.instanceMatrix.needsUpdate = true;
    if (this.hull.instanceColor) this.hull.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
