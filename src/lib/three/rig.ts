/**
 * Procedural humanoid rig.
 *
 * Nothing here is downloaded, imported or authored in a DCC tool — the whole
 * character (skeleton, skinned surface, clothing colours) is generated from
 * numbers at runtime, same as every 2D asset in this project.
 *
 * The pipeline is the standard one a game rig goes through, just executed in
 * the browser:
 *
 *   1. build a bone hierarchy in a relaxed A-pose
 *   2. read the posed bone world transforms
 *   3. sweep tapered tubes along those bones to make the surface
 *   4. weight every vertex against the bone *segments* it belongs to
 *   5. bind that pose as the rest pose
 *
 * Authoring the mesh directly on top of the A-pose (rather than a T-pose)
 * keeps every animated rotation a small delta from bind, which is what stops
 * the shoulders from collapsing when the arms swing.
 */

import * as THREE from "three";

/* ------------------------------------------------------------------ */
/* proportions                                                         */
/* ------------------------------------------------------------------ */

export type Proportions = {
  /** Eye-to-floor-ish total height in metres. Everything scales off this. */
  height: number;
  /** Shoulder width multiplier. 1 = average, 1.15 = heavyset. */
  shoulder: number;
  /** Limb + torso thickness multiplier. */
  bulk: number;
};

export const DEFAULT_PROPORTIONS: Proportions = {
  height: 1.82,
  shoulder: 1,
  bulk: 1,
};

export type BodyPalette = {
  skin: string;
  hair: string;
  shirt: string;
  jacket: string;
  pants: string;
  shoes: string;
  /** Neon trim on the jacket — this is Leonida, everyone glows a little. */
  trim: string;
};

/**
 * Deliberately mid-tone rather than "realistic" dark denim — the street is
 * lit by a horizon sun and neon, so anything below about 20% luminance reads
 * as a silhouette with no legs in it.
 */
export const PALETTES: BodyPalette[] = [
  {
    skin: "#c98d63",
    hair: "#221c1a",
    shirt: "#ff2e97",
    jacket: "#4a2a7d",
    pants: "#3b3556",
    shoes: "#f2f0ea",
    trim: "#22e6ff",
  },
  {
    skin: "#8c5a3a",
    hair: "#2a211c",
    shirt: "#f4efe2",
    jacket: "#1d6b82",
    pants: "#4a4668",
    shoes: "#6f6a80",
    trim: "#9dff3d",
  },
  {
    skin: "#e2b08a",
    hair: "#6b4620",
    shirt: "#ffb347",
    jacket: "#6e2358",
    pants: "#524a6a",
    shoes: "#ff2e97",
    trim: "#ff5ad9",
  },
  {
    skin: "#6f4227",
    hair: "#191412",
    shirt: "#22e6ff",
    jacket: "#27364f",
    pants: "#3a4260",
    shoes: "#e8e4dc",
    trim: "#ffb347",
  },
  {
    skin: "#d79b70",
    hair: "#4a2f1c",
    shirt: "#9dff3d",
    jacket: "#432477",
    pants: "#454066",
    shoes: "#7a7490",
    trim: "#ff2e97",
  },
];

/* ------------------------------------------------------------------ */
/* skeleton                                                            */
/* ------------------------------------------------------------------ */

export type BoneName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "shoulderL"
  | "armL"
  | "foreArmL"
  | "handL"
  | "shoulderR"
  | "armR"
  | "foreArmR"
  | "handR"
  | "thighL"
  | "shinL"
  | "footL"
  | "toeL"
  | "thighR"
  | "shinR"
  | "footR"
  | "toeR";

type BoneSpec = {
  name: BoneName;
  parent: BoneName | null;
  /** Offset from the parent joint, in metres at a 1.8m height. */
  pos: [number, number, number];
  /** Rest rotation (XYZ euler, radians) that puts the rig in its A-pose. */
  rot?: [number, number, number];
};

const D = Math.PI / 180;

/**
 * Offsets are authored for a 1.8m figure and scaled at build time. Arms rest
 * along the body with a few degrees of elbow flexion and the hands turned in
 * slightly — a relaxed human stance, not a mannequin's.
 */
const SKELETON: BoneSpec[] = [
  { name: "hips", parent: null, pos: [0, 1.0, 0] },
  { name: "spine", parent: "hips", pos: [0, 0.115, 0] },
  { name: "chest", parent: "spine", pos: [0, 0.155, 0] },
  { name: "neck", parent: "chest", pos: [0, 0.19, -0.01] },
  { name: "head", parent: "neck", pos: [0, 0.105, 0.012] },

  // left arm: out to the shoulder, then rotated down the side of the body
  { name: "shoulderL", parent: "chest", pos: [0.045, 0.135, 0], rot: [0, 0, -8 * D] },
  { name: "armL", parent: "shoulderL", pos: [0.125, 0, 0], rot: [8 * D, 0, -72 * D] },
  { name: "foreArmL", parent: "armL", pos: [0.29, 0, 0], rot: [0, 0, -11 * D] },
  { name: "handL", parent: "foreArmL", pos: [0.26, 0, 0] },

  { name: "shoulderR", parent: "chest", pos: [-0.045, 0.135, 0], rot: [0, 0, 8 * D] },
  { name: "armR", parent: "shoulderR", pos: [-0.125, 0, 0], rot: [8 * D, 0, 72 * D] },
  { name: "foreArmR", parent: "armR", pos: [-0.29, 0, 0], rot: [0, 0, 11 * D] },
  { name: "handR", parent: "foreArmR", pos: [-0.26, 0, 0] },

  { name: "thighL", parent: "hips", pos: [0.095, -0.06, 0], rot: [0, 0, 1.5 * D] },
  { name: "shinL", parent: "thighL", pos: [0, -0.45, 0], rot: [2 * D, 0, 0] },
  { name: "footL", parent: "shinL", pos: [0, -0.44, 0] },
  { name: "toeL", parent: "footL", pos: [0, -0.045, 0.145] },

  { name: "thighR", parent: "hips", pos: [-0.095, -0.06, 0], rot: [0, 0, -1.5 * D] },
  { name: "shinR", parent: "thighR", pos: [0, -0.45, 0], rot: [2 * D, 0, 0] },
  { name: "footR", parent: "shinR", pos: [0, -0.44, 0] },
  { name: "toeR", parent: "footR", pos: [0, -0.045, 0.145] },
];

export type Bones = Record<BoneName, THREE.Bone>;

function buildSkeleton(p: Proportions) {
  const s = p.height / 1.8;
  const bones = {} as Bones;
  const order: THREE.Bone[] = [];

  for (const spec of SKELETON) {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    const wide = spec.name.startsWith("shoulder") ? p.shoulder : 1;
    bone.position.set(
      spec.pos[0] * s * wide,
      spec.pos[1] * s,
      spec.pos[2] * s,
    );
    if (spec.rot) bone.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    if (spec.parent) bones[spec.parent].add(bone);
    bones[spec.name] = bone;
    order.push(bone);
  }
  return { bones, order, root: bones.hips, scale: s };
}

/* ------------------------------------------------------------------ */
/* surface builder                                                     */
/* ------------------------------------------------------------------ */

type Ring = {
  /** Centre of the ring, in character space. */
  p: THREE.Vector3;
  /** Radius across the body (x-ish) and front-to-back (z-ish). */
  rx: number;
  rz: number;
  color: THREE.Color;
};

type Segment = { a: THREE.Vector3; b: THREE.Vector3; bone: number };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/** Squared distance from a point to a line segment. */
function distToSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  _v1.subVectors(b, a);
  const len2 = _v1.lengthSq();
  if (len2 < 1e-9) return p.distanceTo(a);
  let t = _v2.subVectors(p, a).dot(_v1) / len2;
  t = Math.max(0, Math.min(1, t));
  return p.distanceTo(_v3.copy(a).addScaledVector(_v1, t));
}

class BodyBuilder {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  /** Bone segments in character space, indexed into the skeleton array. */
  segs: Segment[] = [];

  constructor(bones: Bones, order: THREE.Bone[]) {
    const index = new Map<THREE.Bone, number>();
    order.forEach((b, i) => index.set(b, i));
    for (const bone of order) {
      const a = bone.getWorldPosition(new THREE.Vector3());
      const kid = bone.children.find((c) => c instanceof THREE.Bone) as
        | THREE.Bone
        | undefined;
      const b = kid
        ? kid.getWorldPosition(new THREE.Vector3())
        : a.clone().add(
            new THREE.Vector3(0, 0.05, 0).applyQuaternion(
              bone.getWorldQuaternion(new THREE.Quaternion()),
            ),
          );
      this.segs.push({ a, b, bone: index.get(bone)! });
    }
    void bones;
  }

  /**
   * Skin weight solve. Candidate bones are whitelisted per body part rather
   * than searched globally — a hand should never be pulled by the hip just
   * because the arm happens to hang beside it.
   */
  private weight(p: THREE.Vector3, allow: number[]) {
    const scored = allow
      .map((i) => {
        const s = this.segs[i];
        const d = distToSeg(p, s.a, s.b);
        return { bone: s.bone, w: 1 / (Math.pow(d, 3.2) + 1e-5) };
      })
      .sort((a, b) => b.w - a.w)
      .slice(0, 4);

    const total = scored.reduce((a, b) => a + b.w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(scored[k]?.bone ?? 0);
      this.sw.push(scored[k] ? scored[k].w / total : 0);
    }
  }

  vertex(p: THREE.Vector3, color: THREE.Color, allow: number[]) {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(color.r, color.g, color.b);
    this.weight(p, allow);
    return this.pos.length / 3 - 1;
  }

  /**
   * Sweeps an elliptical cross-section along a polyline. Each ring gets its
   * own frame so a limb can bend without the surface shearing.
   */
  tube(rings: Ring[], seg: number, allow: number[], cap: [boolean, boolean]) {
    const base = this.pos.length / 3;
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const refA = new THREE.Vector3(0, 0, 1);
    const refB = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      const prev = rings[Math.max(0, i - 1)];
      const next = rings[Math.min(rings.length - 1, i + 1)];
      dir.subVectors(next.p, prev.p);
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      dir.normalize();

      side.crossVectors(dir, refA);
      if (side.lengthSq() < 1e-4) side.crossVectors(dir, refB);
      side.normalize();
      fwd.crossVectors(side, dir).normalize();

      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        const v = new THREE.Vector3()
          .copy(r.p)
          .addScaledVector(side, Math.cos(t) * r.rx)
          .addScaledVector(fwd, Math.sin(t) * r.rz);
        this.vertex(v, r.color, allow);
      }
    }

    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        const a = base + i * seg + j;
        const b = base + i * seg + j2;
        const c = base + (i + 1) * seg + j;
        const d = base + (i + 1) * seg + j2;
        this.idx.push(a, c, b, b, c, d);
      }
    }

    // flat caps so limbs aren't open cylinders
    if (cap[0]) this.cap(rings[0], base, seg, allow, true);
    if (cap[1])
      this.cap(
        rings[rings.length - 1],
        base + (rings.length - 1) * seg,
        seg,
        allow,
        false,
      );
  }

  private cap(
    r: Ring,
    ringBase: number,
    seg: number,
    allow: number[],
    start: boolean,
  ) {
    const c = this.vertex(r.p.clone(), r.color, allow);
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      if (start) this.idx.push(c, ringBase + j, ringBase + j2);
      else this.idx.push(c, ringBase + j2, ringBase + j);
    }
  }

  /** An ellipsoid welded to one bone — heads, hands, knuckles. */
  blob(
    center: THREE.Vector3,
    radius: THREE.Vector3,
    color: THREE.Color,
    allow: number[],
    lat = 10,
    lon = 14,
    squash = 1,
  ) {
    const base = this.pos.length / 3;
    for (let i = 0; i <= lat; i++) {
      const phi = (i / lat) * Math.PI;
      for (let j = 0; j < lon; j++) {
        const th = (j / lon) * Math.PI * 2;
        const x = Math.sin(phi) * Math.cos(th);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(th);
        const v = new THREE.Vector3(
          center.x + x * radius.x,
          center.y + y * radius.y * (y < 0 ? squash : 1),
          center.z + z * radius.z,
        );
        this.vertex(v, color, allow);
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const j2 = (j + 1) % lon;
        const a = base + i * lon + j;
        const b = base + i * lon + j2;
        const c = base + (i + 1) * lon + j;
        const d = base + (i + 1) * lon + j2;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/* ------------------------------------------------------------------ */
/* the character                                                       */
/* ------------------------------------------------------------------ */

export type Character = {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: Bones;
  /** Bind-pose rotation of every bone — all animation is a delta from here. */
  rest: Record<BoneName, THREE.Quaternion>;
  /** Measured limb lengths, so the IK doesn't have to guess. */
  dims: {
    thigh: number;
    shin: number;
    upperArm: number;
    foreArm: number;
    hipY: number;
    scale: number;
  };
  palette: BodyPalette;
};

export function createCharacter(
  opts: Partial<Proportions> & { palette?: BodyPalette } = {},
): Character {
  const p = { ...DEFAULT_PROPORTIONS, ...opts };
  const palette = opts.palette ?? PALETTES[0];
  const { bones, order, root, scale } = buildSkeleton(p);

  root.updateMatrixWorld(true);

  const C = {
    skin: new THREE.Color(palette.skin),
    hair: new THREE.Color(palette.hair),
    shirt: new THREE.Color(palette.shirt),
    jacket: new THREE.Color(palette.jacket),
    pants: new THREE.Color(palette.pants),
    shoes: new THREE.Color(palette.shoes),
  };

  const bb = new BodyBuilder(bones, order);
  const idx = new Map<BoneName, number>();
  order.forEach((b, i) => idx.set(b.name as BoneName, i));
  const allow = (...names: BoneName[]) => names.map((n) => idx.get(n)!);

  const wp = (n: BoneName) => bones[n].getWorldPosition(new THREE.Vector3());
  const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number) =>
    a.clone().lerp(b, t);

  const k = scale;
  const bulk = p.bulk;

  /* ---- torso ---- */
  const hips = wp("hips");
  const spine = wp("spine");
  const chest = wp("chest");
  const neck = wp("neck");
  const torsoBones = allow("hips", "spine", "chest", "neck");

  bb.tube(
    [
      { p: lerp(hips, spine, -0.55), rx: 0.15 * k * bulk, rz: 0.1 * k * bulk, color: C.pants },
      { p: lerp(hips, spine, -0.1), rx: 0.155 * k * bulk, rz: 0.105 * k * bulk, color: C.pants },
      { p: hips.clone(), rx: 0.15 * k * bulk, rz: 0.1 * k * bulk, color: C.jacket },
      { p: spine.clone(), rx: 0.142 * k * bulk, rz: 0.098 * k * bulk, color: C.shirt },
      { p: lerp(spine, chest, 0.55), rx: 0.165 * k * bulk, rz: 0.108 * k * bulk, color: C.shirt },
      { p: chest.clone(), rx: 0.178 * k * bulk * p.shoulder, rz: 0.115 * k * bulk, color: C.jacket },
      // Two closely spaced rings across the top of the chest round the
      // trapezius off. A single jump from chest width to neck width builds a
      // cone, which reads as a pair of shoulder pads.
      { p: lerp(chest, neck, 0.5), rx: 0.174 * k * bulk * p.shoulder, rz: 0.112 * k * bulk, color: C.jacket },
      { p: lerp(chest, neck, 0.74), rx: 0.152 * k * bulk * p.shoulder, rz: 0.104 * k * bulk, color: C.jacket },
      { p: lerp(chest, neck, 0.9), rx: 0.114 * k, rz: 0.09 * k, color: C.jacket },
      { p: lerp(chest, neck, 1.0), rx: 0.082 * k, rz: 0.075 * k, color: C.jacket },
    ],
    16,
    torsoBones,
    [true, true],
  );

  /* ---- neck + head ---- */
  const head = wp("head");
  const headBones = allow("head", "neck");
  bb.tube(
    [
      { p: lerp(neck, head, -0.35), rx: 0.056 * k, rz: 0.05 * k, color: C.skin },
      { p: lerp(neck, head, 0.35), rx: 0.052 * k, rz: 0.048 * k, color: C.skin },
    ],
    12,
    headBones,
    [false, false],
  );
  bb.blob(
    head.clone().add(new THREE.Vector3(0, 0.035 * k, 0)),
    new THREE.Vector3(0.093 * k, 0.115 * k, 0.1 * k),
    C.skin,
    allow("head"),
    12,
    16,
    1.06,
  );
  // brow + nose, just enough silhouette to read as a face at photo distance
  bb.blob(
    head.clone().add(new THREE.Vector3(0, 0.03 * k, 0.088 * k)),
    new THREE.Vector3(0.028 * k, 0.02 * k, 0.03 * k),
    C.skin,
    allow("head"),
    6,
    8,
  );

  /* ---- arms ---- */
  for (const side of ["L", "R"] as const) {
    const arm = wp(`arm${side}` as BoneName);
    const fore = wp(`foreArm${side}` as BoneName);
    const hand = wp(`hand${side}` as BoneName);
    const armBones = allow(
      `shoulder${side}` as BoneName,
      `arm${side}` as BoneName,
      `foreArm${side}` as BoneName,
      `hand${side}` as BoneName,
      "chest",
    );
    const handBones = allow(`hand${side}` as BoneName, `foreArm${side}` as BoneName);

    bb.tube(
      [
        // start above the shoulder joint so the deltoid fills the gap between
        // the arm and the chest instead of leaving a notch
        { p: lerp(arm, fore, -0.24), rx: 0.062 * k * bulk, rz: 0.064 * k * bulk, color: C.jacket },
        { p: lerp(arm, fore, -0.1), rx: 0.077 * k * bulk, rz: 0.078 * k * bulk, color: C.jacket },
        { p: lerp(arm, fore, 0.12), rx: 0.062 * k * bulk, rz: 0.062 * k * bulk, color: C.jacket },
        { p: lerp(arm, fore, 0.62), rx: 0.054 * k * bulk, rz: 0.054 * k * bulk, color: C.jacket },
        { p: fore.clone(), rx: 0.047 * k * bulk, rz: 0.047 * k * bulk, color: C.jacket },
        { p: lerp(fore, hand, 0.35), rx: 0.044 * k * bulk, rz: 0.044 * k * bulk, color: C.skin },
        { p: lerp(fore, hand, 0.88), rx: 0.034 * k, rz: 0.034 * k, color: C.skin },
      ],
      12,
      armBones,
      [true, false],
    );
    bb.blob(
      hand.clone(),
      new THREE.Vector3(0.042 * k, 0.05 * k, 0.03 * k),
      C.skin,
      handBones,
      6,
      8,
    );
  }

  /* ---- legs ---- */
  for (const side of ["L", "R"] as const) {
    const thigh = wp(`thigh${side}` as BoneName);
    const shin = wp(`shin${side}` as BoneName);
    const foot = wp(`foot${side}` as BoneName);
    const toe = wp(`toe${side}` as BoneName);
    const legBones = allow(
      "hips",
      `thigh${side}` as BoneName,
      `shin${side}` as BoneName,
      `foot${side}` as BoneName,
    );
    const footBones = allow(`foot${side}` as BoneName, `toe${side}` as BoneName);

    // The trouser has to run all the way onto the ankle — stopping short
    // leaves a visible gap between the cuff and the shoe once the leg starts
    // bending under IK.
    bb.tube(
      [
        { p: lerp(thigh, shin, -0.12), rx: 0.105 * k * bulk, rz: 0.108 * k * bulk, color: C.pants },
        { p: lerp(thigh, shin, 0.45), rx: 0.09 * k * bulk, rz: 0.093 * k * bulk, color: C.pants },
        { p: shin.clone(), rx: 0.072 * k * bulk, rz: 0.075 * k * bulk, color: C.pants },
        { p: lerp(shin, foot, 0.35), rx: 0.072 * k * bulk, rz: 0.075 * k * bulk, color: C.pants },
        { p: lerp(shin, foot, 0.88), rx: 0.055 * k, rz: 0.058 * k, color: C.pants },
        { p: lerp(shin, foot, 1.0), rx: 0.05 * k, rz: 0.052 * k, color: C.pants },
      ],
      12,
      legBones,
      [true, true],
    );

    // shoe: heel block swept forward to the toe, overlapping the cuff
    const sole = foot.clone().setY(foot.y - 0.03 * k);
    const tip = toe.clone().setY(foot.y - 0.024 * k);
    bb.tube(
      [
        { p: foot.clone().add(new THREE.Vector3(0, 0.035 * k, -0.045 * k)), rx: 0.048 * k, rz: 0.04 * k, color: C.shoes },
        { p: sole.clone().add(new THREE.Vector3(0, 0.012 * k, -0.055 * k)), rx: 0.052 * k, rz: 0.045 * k, color: C.shoes },
        { p: lerp(sole, tip, 0.25), rx: 0.056 * k, rz: 0.05 * k, color: C.shoes },
        { p: lerp(sole, tip, 0.7), rx: 0.052 * k, rz: 0.042 * k, color: C.shoes },
        { p: lerp(sole, tip, 1.02), rx: 0.038 * k, rz: 0.03 * k, color: C.shoes },
      ],
      10,
      footBones,
      [true, true],
    );
  }

  const geometry = bb.build();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.06,
  });

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.add(root);
  mesh.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(order);
  mesh.bind(skeleton);

  // hair sits on the head bone rather than in the skin, so it keeps a hard
  // silhouette instead of smearing with the scalp weights
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.098 * k, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.85 }),
  );
  hair.position.set(0, 0.042 * k, -0.004 * k);
  hair.scale.set(1, 1.12, 1.04);
  hair.castShadow = true;
  bones.head.add(hair);

  const group = new THREE.Group();
  group.add(mesh);

  const rest = {} as Record<BoneName, THREE.Quaternion>;
  for (const b of order) rest[b.name as BoneName] = b.quaternion.clone();

  return {
    group,
    mesh,
    bones,
    rest,
    palette,
    dims: {
      thigh: bones.shinL.position.length(),
      shin: bones.footL.position.length(),
      upperArm: bones.foreArmL.position.length(),
      foreArm: bones.handL.position.length(),
      hipY: bones.hips.position.y,
      scale,
    },
  };
}

/** Deterministic pick so a pedestrian looks the same every frame. */
export function paletteFor(seed: number) {
  return PALETTES[Math.abs(Math.floor(seed)) % PALETTES.length];
}
