/**
 * Locomotion + full-body procedural animation.
 *
 * There are no baked animation clips anywhere in this project. Every pose is
 * solved each frame from the character's actual velocity, which is what makes
 * the movement read as a person instead of a looping puppet:
 *
 *  - stride length scales with speed, so the feet are *planted* in world space
 *    through the whole stance phase — no sliding, at any speed
 *  - both legs and both arms run through an analytic two-bone IK solve, so the
 *    knees and elbows bend because of where the limb has to reach, not because
 *    a curve said so
 *  - the pelvis bobs twice per stride, sways toward the stance foot and drops
 *    on the swing side (Trendelenburg), and the shoulders counter-rotate
 *    against it
 *  - heel strike, foot flat and toe-off are three separate ankle angles driven
 *    off the same gait phase
 *  - arms lag the shoulders through a spring, so they have mass
 *  - turning banks the body, acceleration pitches it, landing compresses it
 *
 * The same solver drives the player and every pedestrian on the street.
 */

import * as THREE from "three";
import type { BoneName, Character } from "./rig";

const WALK = 1.55;
const RUN = 5.1;
const GRAVITY = 18.5;
const JUMP_V = 5.6;

export type ActorInput = {
  /** World-space intent on the ground plane. Length 0..1. */
  moveX: number;
  moveZ: number;
  run: boolean;
  jump: boolean;
  /** 0..1 — how far the phone is raised into the shooting pose. */
  aim: number;
  /** World point the head should track, if any. */
  look?: THREE.Vector3 | null;
  /**
   * Yaw to settle onto while standing still — used when the phone is up so
   * the body squares to whatever the lens is pointed at.
   */
  faceYaw?: number | null;
};

export const NO_INPUT: ActorInput = {
  moveX: 0,
  moveZ: 0,
  run: false,
  jump: false,
  aim: 0,
};

/* ------------------------------------------------------------------ */
/* bone maths                                                          */
/* ------------------------------------------------------------------ */

const _pq = new THREE.Quaternion();
const _iq = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _rootPos = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Rotate `bone` so its child axis points along a world direction. */
function aim(bone: THREE.Bone, axisLocal: THREE.Vector3, worldDir: THREE.Vector3) {
  const parent = bone.parent;
  if (!parent) return;
  parent.getWorldQuaternion(_pq);
  _iq.copy(_pq).invert();
  _d.copy(worldDir);
  if (_d.lengthSq() < 1e-10) return;
  _d.normalize().applyQuaternion(_iq);
  bone.quaternion.setFromUnitVectors(axisLocal, _d);
}

/** Force a bone to a world-space orientation regardless of its parents. */
function setWorldQuat(bone: THREE.Bone, q: THREE.Quaternion) {
  const parent = bone.parent;
  if (!parent) return;
  parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert()).multiply(q);
}

/**
 * Analytic two-bone IK. The mid joint is placed explicitly from the pole
 * vector instead of being derived from a twist angle, which keeps knees and
 * elbows pointing where they should even when the chain is nearly straight.
 */
function solveLimb(
  root: THREE.Bone,
  mid: THREE.Bone,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  L1: number,
  L2: number,
  rootAxis: THREE.Vector3,
  midAxis: THREE.Vector3,
) {
  root.getWorldPosition(_rootPos);
  _a.subVectors(target, _rootPos);
  const dist = Math.min(
    Math.max(_a.length(), Math.abs(L1 - L2) + 1e-3),
    (L1 + L2) * 0.998,
  );
  if (dist < 1e-5) return;
  _a.normalize();

  const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const angle = Math.acos(Math.min(1, Math.max(-1, cosA)));

  _perp.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_perp.lengthSq() < 1e-8) {
    _perp.set(_a.z, 0, -_a.x);
    if (_perp.lengthSq() < 1e-8) _perp.set(1, 0, 0);
  }
  _perp.normalize();

  _knee
    .copy(_rootPos)
    .addScaledVector(_a, L1 * Math.cos(angle))
    .addScaledVector(_perp, L1 * Math.sin(angle));

  aim(root, rootAxis, _b.subVectors(_knee, _rootPos));
  root.updateMatrixWorld(true);
  aim(mid, midAxis, _b.subVectors(target, _knee));
  mid.updateMatrixWorld(true);
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Frame-rate independent exponential approach. */
const damp = (a: number, b: number, rate: number, dt: number) =>
  b + (a - b) * Math.exp(-rate * dt);

/* ------------------------------------------------------------------ */
/* the actor                                                           */
/* ------------------------------------------------------------------ */

export class Actor {
  readonly char: Character;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;

  /** Normalised gait cycle position. Right foot strikes at 0. */
  private phase = 0;
  private speed = 0;
  private gaitWeight = 0;
  private yawRate = 0;
  private bank = 0;
  private leanPitch = 0;
  private vy = 0;
  private grounded = true;
  private airTime = 0;
  private landing = 0;
  private aimBlend = 0;
  private breathe = Math.random() * 10;
  private idleSeed = Math.random() * 100;
  /** Spring state for the arm swing, so the arms trail the shoulders. */
  private armSwing = [0, 0];
  private headYaw = 0;
  private headPitch = 0;

  private axes: Record<string, THREE.Vector3> = {};
  private stepCb: ((foot: 0 | 1, pos: THREE.Vector3, speed: number) => void) | null =
    null;
  private lastStance = [true, true];

  /** Scratch, reused every frame — this runs for ~10 actors at 60fps. */
  private s = {
    hip: new THREE.Vector3(),
    foot: new THREE.Vector3(),
    pole: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    right: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    shoulder: new THREE.Vector3(),
    hand: new THREE.Vector3(),
  };

  constructor(char: Character) {
    this.char = char;
    const b = char.bones;
    // A bone's "aim axis" is the direction of its child in its own local
    // space — constant for the life of the rig.
    const axis = (to: BoneName) => b[to].position.clone().normalize();
    this.axes = {
      thighL: axis("shinL"),
      shinL: axis("footL"),
      thighR: axis("shinR"),
      shinR: axis("footR"),
      armL: axis("foreArmL"),
      foreArmL: axis("handL"),
      armR: axis("foreArmR"),
      foreArmR: axis("handR"),
    };
  }

  onFootstep(cb: (foot: 0 | 1, pos: THREE.Vector3, speed: number) => void) {
    this.stepCb = cb;
  }

  get currentSpeed() {
    return this.speed;
  }

  get isGrounded() {
    return this.grounded;
  }

  teleport(x: number, z: number, yaw = 0) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
  }

  /* ---------------- physics + intent ---------------- */

  update(dt: number, input: ActorInput) {
    const mag = Math.hypot(input.moveX, input.moveZ);
    const top = input.run ? RUN : WALK;

    // Desired velocity. Accelerating out of a standstill is deliberately
    // slower than shedding speed — that asymmetry is most of what makes a
    // character feel like it has weight.
    const dx = mag > 1e-3 ? (input.moveX / mag) * top * Math.min(mag, 1) : 0;
    const dz = mag > 1e-3 ? (input.moveZ / mag) * top * Math.min(mag, 1) : 0;
    const wanted = Math.hypot(dx, dz);
    const rate = this.grounded ? (wanted > this.speed ? 7.5 : 11) : 1.4;
    const prev = this.speed;
    this.vel.x = damp(this.vel.x, dx, rate, dt);
    this.vel.z = damp(this.vel.z, dz, rate, dt);
    if (Math.abs(this.vel.x) < 0.02) this.vel.x = 0;
    if (Math.abs(this.vel.z) < 0.02) this.vel.z = 0;
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // Face the way we're going. Turn rate drops at speed — you can pivot on
    // the spot but you have to arc a sprint.
    if (mag > 0.05) {
      const want = Math.atan2(dx, dz);
      let delta = want - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const maxTurn = lerp(11, 3.4, clamp01(this.speed / RUN)) * dt;
      const step = Math.max(-maxTurn, Math.min(maxTurn, delta));
      this.yaw += step;
      this.yawRate = damp(this.yawRate, step / Math.max(dt, 1e-4), 9, dt);
    } else if (input.faceYaw != null) {
      let delta = input.faceYaw - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const maxTurn = 4.5 * dt;
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, delta));
      this.yawRate = damp(this.yawRate, 0, 9, dt);
    } else {
      this.yawRate = damp(this.yawRate, 0, 9, dt);
    }

    if (input.jump && this.grounded) {
      this.vy = JUMP_V;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.airTime += dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.grounded = true;
        this.landing = Math.min(1, this.airTime * 2.4);
        this.airTime = 0;
        this.vy = 0;
      }
    }
    this.landing = damp(this.landing, 0, 6.5, dt);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Gait clock. Frequency comes from speed / stride, so the foot planted on
    // the ground stays exactly where it was put.
    const t = clamp01(this.speed / RUN);
    // Stride = ground covered per full cycle (two steps). 1.6m at a walk is
    // ~115 steps/min; 3.2m at a sprint is ~180. Both are human cadences, and
    // driving frequency from speed/stride is what keeps them honest.
    const stride = lerp(1.6, 3.2, smooth(t));
    const freq = this.speed > 0.06 ? this.speed / stride : 0;
    this.phase = (this.phase + freq * dt) % 1;
    this.gaitWeight = damp(this.gaitWeight, clamp01(this.speed / 0.45), 10, dt);

    // Body attitude: bank into turns, pitch under acceleration.
    const accel = (this.speed - prev) / Math.max(dt, 1e-4);
    this.bank = damp(
      this.bank,
      clamp01(this.speed / RUN) * -this.yawRate * 0.13,
      7,
      dt,
    );
    this.leanPitch = damp(
      this.leanPitch,
      lerp(0.015, 0.16, smooth(t)) + clamp01(accel / 12) * 0.08,
      5,
      dt,
    );
    this.aimBlend = damp(this.aimBlend, clamp01(input.aim), 9, dt);
    this.breathe += dt;

    this.pose(dt, input, stride, t);
  }

  /* ---------------- the pose solve ---------------- */

  private pose(dt: number, input: ActorInput, stride: number, t: number) {
    const { char, s } = this;
    const b = char.bones;
    const rest = char.rest;
    const k = char.dims.scale;
    const g = this.gaitWeight;
    const air = this.grounded ? 0 : 1;

    s.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    s.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    /* -------- root transform -------- */
    char.group.position.copy(this.pos);
    char.group.rotation.set(0, this.yaw, 0);

    /* -------- pelvis -------- */
    const cyc = this.phase * Math.PI * 2;
    // two dips per stride, deepest at each mid-stance
    const bobAmp = lerp(0.008, 0.052, smooth(t)) * k * g;
    const bob = -bobAmp * (0.5 - 0.5 * Math.cos(cyc * 2));
    const swayAmp = lerp(0.012, 0.045, smooth(t)) * k * g;
    const sway = Math.sin(cyc) * swayAmp;

    // idle weight shift keeps a standing character from looking frozen
    const idle = 1 - g;
    const shift = Math.sin(this.breathe * 0.55 + this.idleSeed) * 0.012 * k * idle;
    const breath = Math.sin(this.breathe * 1.35) * 0.5 + 0.5;

    const crouch = this.landing * 0.16 * k + air * 0.02 * k;

    b.hips.position.set(
      sway + shift,
      char.dims.hipY + bob - crouch,
      Math.sin(cyc * 2) * 0.006 * k * g,
    );

    // pelvis drops on the swing side, counter-rotates against the shoulders
    const pelvisRoll = -Math.sin(cyc) * lerp(0.03, 0.1, smooth(t)) * g + this.bank * 0.5;
    const pelvisYaw = Math.sin(cyc) * lerp(0.03, 0.14, smooth(t)) * g;
    _e.set(this.leanPitch * 0.35 + this.landing * 0.18, pelvisYaw, pelvisRoll, "YXZ");
    b.hips.quaternion.copy(_tmpQ.setFromEuler(_e)).multiply(rest.hips);

    /* -------- spine chain -------- */
    const chestYaw = -Math.sin(cyc) * lerp(0.05, 0.2, smooth(t)) * g;
    const spinePitch = this.leanPitch * 0.5 + breath * 0.012 * idle;
    _e.set(spinePitch, chestYaw * 0.4, -this.bank * 0.25, "YXZ");
    b.spine.quaternion.copy(_tmpQ.setFromEuler(_e)).multiply(rest.spine);

    _e.set(
      this.leanPitch * 0.35 - this.aimBlend * 0.06 + breath * 0.018 * idle,
      chestYaw * 0.6,
      -this.bank * 0.3 - Math.sin(cyc) * 0.035 * g,
      "YXZ",
    );
    b.chest.quaternion.copy(_tmpQ.setFromEuler(_e)).multiply(rest.chest);

    /* -------- head: counter-rotate, then look -------- */
    let wantYaw = -chestYaw * 0.8;
    let wantPitch = -this.leanPitch * 0.75;
    if (input.look) {
      _a.copy(input.look).sub(b.head.getWorldPosition(_b));
      const rel = Math.atan2(_a.x, _a.z) - this.yaw;
      let n = rel;
      while (n > Math.PI) n -= Math.PI * 2;
      while (n < -Math.PI) n += Math.PI * 2;
      wantYaw += Math.max(-1.1, Math.min(1.1, n)) * 0.75;
      wantPitch += Math.max(-0.5, Math.min(0.5, -Math.atan2(_a.y, Math.hypot(_a.x, _a.z)))) * 0.6;
    } else {
      wantYaw += Math.sin(this.breathe * 0.31 + this.idleSeed) * 0.22 * idle;
    }
    this.headYaw = damp(this.headYaw, wantYaw, 7, dt);
    this.headPitch = damp(this.headPitch, wantPitch, 7, dt);
    _e.set(this.headPitch * 0.45, this.headYaw * 0.45, 0, "YXZ");
    b.neck.quaternion.copy(_tmpQ.setFromEuler(_e)).multiply(rest.neck);
    _e.set(this.headPitch * 0.55, this.headYaw * 0.55, 0, "YXZ");
    b.head.quaternion.copy(_tmpQ.setFromEuler(_e)).multiply(rest.head);

    // Everything below solves in world space, so the spine chain has to be
    // committed to the matrices before the limbs are touched.
    char.group.updateMatrixWorld(true);

    /* -------- legs -------- */
    const stanceFrac = lerp(0.62, 0.36, smooth(t));
    // Half the ground the foot covers while it is planted.
    const stepLen = stride * stanceFrac * 0.5;
    const lift = lerp(0.05, 0.26, smooth(t)) * k;

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? "R" : "L";
      const sign = i === 0 ? -1 : 1; // R is -x in this rig
      const thigh = b[`thigh${side}` as BoneName];
      const shin = b[`shin${side}` as BoneName];
      const foot = b[`foot${side}` as BoneName];

      thigh.getWorldPosition(s.hip);

      const pf = (this.phase + (i === 0 ? 0 : 0.5)) % 1;
      const stance = pf < stanceFrac;
      // Feet converge toward the midline as speed rises — a sprinter runs
      // almost on a single line. Standing, they stay apart so the legs read
      // as two legs rather than one trouser.
      const hipHalf = lerp(0.125, 0.095, g) * k * lerp(1, 0.45, smooth(t));

      let along: number;
      let height = 0;
      let pitch: number;

      if (stance) {
        const u = pf / stanceFrac;
        // Planted. The foot travels backward relative to the body at exactly
        // the body's speed over the stance, so in world space it does not
        // move at all — this is the line that kills foot sliding.
        along = stepLen * (1 - 2 * u);
        height = 0;
        // heel strike -> flat -> toe off
        pitch =
          u < 0.18
            ? lerp(-0.34, 0, u / 0.18)
            : u > 0.72
              ? lerp(0, 0.62, (u - 0.72) / 0.28)
              : 0;
      } else {
        const u = (pf - stanceFrac) / (1 - stanceFrac);
        const e = smooth(u);
        along = lerp(-stepLen, stepLen, e);
        height = Math.sin(Math.PI * u) * lift * (1 - 0.35 * Math.max(0, u - 0.7));
        pitch = u < 0.45 ? lerp(0.5, -0.2, u / 0.45) : lerp(-0.2, -0.3, (u - 0.45) / 0.55);
      }

      // blend the whole gait out toward a relaxed stand
      along = lerp(0, along, g);
      height = lerp(0, height, g);
      pitch = lerp(0, pitch, g);

      if (air) {
        // tuck in flight, reach for the ground on the way down
        const tuck = clamp01(this.vy / JUMP_V);
        along = lerp(along, i === 0 ? 0.12 * k : -0.1 * k, air);
        height = lerp(height, lerp(0.12, 0.3, tuck) * k, air);
        pitch = lerp(pitch, 0.25, air);
      }

      s.foot
        .copy(this.pos)
        .addScaledVector(s.right, sign * hipHalf)
        .addScaledVector(s.fwd, along);
      s.foot.y = this.pos.y + height + 0.075 * k;

      // knee points forward and a touch outward
      s.pole
        .copy(s.fwd)
        .multiplyScalar(1)
        .addScaledVector(s.right, sign * 0.22)
        .normalize();

      solveLimb(
        thigh,
        shin,
        s.foot,
        s.pole,
        char.dims.thigh,
        char.dims.shin,
        this.axes[`thigh${side}`],
        this.axes[`shin${side}`],
      );

      // ankle orientation is set in world space so the sole stays parallel to
      // the road regardless of how the leg ended up bent
      _e.set(pitch, this.yaw, 0, "YXZ");
      setWorldQuat(foot, s.q.setFromEuler(_e));

      if (stance && !this.lastStance[i] && this.stepCb) {
        this.stepCb(i as 0 | 1, s.foot.clone().setY(0), this.speed);
      }
      this.lastStance[i] = stance;
    }

    /* -------- arms -------- */
    const swingAmp = lerp(0.12, 0.72, smooth(t)) * g;
    const armLen = (char.dims.upperArm + char.dims.foreArm) * 0.97;

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? "R" : "L";
      const sign = i === 0 ? -1 : 1;
      const upper = b[`arm${side}` as BoneName];
      const mid = b[`foreArm${side}` as BoneName];

      // arms oppose the legs; the spring gives them lag and overshoot
      const targetSwing =
        Math.sin(cyc + (i === 0 ? Math.PI : 0)) * swingAmp - this.leanPitch * 0.2;
      this.armSwing[i] = damp(this.armSwing[i], targetSwing, 13, dt);
      const sw = this.armSwing[i];

      upper.getWorldPosition(s.shoulder);

      // reach shrinks as the elbow flexes at speed, which is what produces the
      // tight boxer-ish arm carriage in a sprint
      // A relaxed arm is never straight — 0.88 of full reach leaves a few
      // degrees in the elbow, and it tightens up as the pace builds.
      const reach = armLen * lerp(0.88, 0.64, smooth(t) * g);
      const out = lerp(0.1, 0.3, smooth(t)) + this.aimBlend * 0.1;

      s.hand
        .copy(s.shoulder)
        .addScaledVector(s.fwd, Math.sin(sw) * reach)
        .addScaledVector(s.right, sign * out * reach * 0.55)
        .setY(s.shoulder.y - Math.cos(sw) * reach * lerp(1, 0.78, smooth(t) * g));

      if (this.aimBlend > 0.001) {
        // phone up: both hands converge in front of the face
        _a
          .copy(this.pos)
          .addScaledVector(s.fwd, 0.34 * k)
          .addScaledVector(s.right, sign * 0.085 * k);
        _a.y = this.pos.y + char.dims.hipY + 0.44 * k;
        s.hand.lerp(_a, this.aimBlend);
      }

      // elbows sit behind and outside the hand — raised and flared when the
      // phone comes up, tucked when running
      s.pole
        .copy(s.fwd)
        .multiplyScalar(-1)
        .addScaledVector(s.right, sign * (0.55 + this.aimBlend * 0.5))
        .addScaledVector(DOWN, 0.35 - this.aimBlend * 0.15)
        .normalize();

      solveLimb(
        upper,
        mid,
        s.hand,
        s.pole,
        char.dims.upperArm,
        char.dims.foreArm,
        this.axes[`arm${side}`],
        this.axes[`foreArm${side}`],
      );
    }
  }
}
