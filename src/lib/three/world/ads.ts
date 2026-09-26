/**
 * Leonida Outdoor — the city's advertising.
 *
 * A city sells its wall space, and in a game about photographing that city the
 * boards are not scenery: they are the brightest, most legible thing in a
 * daylit frame, they date and place a photograph, and they are the only surface
 * in Leonida whose content changes while you are standing in front of it.
 *
 * Three kinds of pitch, collected while the world generates (see `AdSite`):
 * kerbside boards on two posts down the avenues, rooftop hoardings on the
 * low-rise stock, and portrait supersides painted up a gable wall.
 *
 * How they animate, and why it is done this way:
 *
 *  - all twelve creatives are painted once into a single atlas at build time,
 *    exactly like the shop-sign atlas. No runtime canvas work, no texture
 *    uploads per frame
 *  - every board in the city is one merged buffer and one draw call. Each
 *    board's four vertices carry its own index in an `adSeed` attribute
 *  - which creative a board is showing is therefore decided *in the shader*,
 *    from `time` and `adSeed`. Boards change on their own staggered schedules
 *    with a wipe between creatives, and the CPU cost of the whole system is one
 *    uniform write per frame
 *
 * The screen face is deliberately unlit. A board is an emitter — a printed one
 * under floodlights, an LED one by itself — so shading it with the sun would
 * make the ones facing away from it read as grey panels. The frame, the posts
 * and the floodlight cans around it are ordinary lit geometry in the city's
 * merged buffers.
 */

import * as THREE from "three";
import type { WorldCtx } from "./blocks";
import { districtAt } from "./layout";
import type { AdSite } from "./types";

/* ------------------------------------------------------------------ */
/* the creatives                                                       */
/* ------------------------------------------------------------------ */

export const AD_COLS = 4;
export const AD_ROWS = 3;
export const AD_COUNT = AD_COLS * AD_ROWS;
/** Seconds a board holds one creative before wiping to the next. */
export const AD_DWELL = 9;

const CELL = 512;

type Motif = "sun" | "band" | "orb" | "grid" | "wave";

type Brand = {
  name: string;
  line: string;
  /** Background gradient, top to bottom. */
  a: string;
  b: string;
  /** Headline and rule colour. */
  ink: string;
  motif: Motif;
  legal: string;
};

/**
 * Twelve campaigns running in Leonida this season.
 *
 * They are written as a media buy rather than as jokes: a spirit, a soda, two
 * motors, a radio station, an airline, a realtor and a lottery is roughly what
 * actually papers a coastal city, and the mix is what makes the boards read as
 * advertising instead of as set dressing.
 */
const BRANDS: Brand[] = [
  { name: "VICEGRAM", line: "POST IT BEFORE THEY DO", a: "#2a0a3c", b: "#ff2e97", ink: "#ffffff", motif: "orb", legal: "LEONIDA OUTDOOR · VCG-0114" },
  { name: "LEONIDA GOLD", line: "RUM SINCE '79", a: "#3a1c06", b: "#f2a63c", ink: "#2a1402", motif: "sun", legal: "DRINK LIKE YOU LIVE HERE" },
  { name: "TRUNK FL", line: "WE MOVE ANYTHING", a: "#06213a", b: "#22e6ff", ink: "#04121f", motif: "band", legal: "BONDED · INSURED · DISCREET" },
  { name: "SUNDOWNER", line: "SEE THE WHOLE COAST", a: "#4a1140", b: "#ffb347", ink: "#ffffff", motif: "wave", legal: "SUNDOWNER MOTORS · 12 LOTS" },
  { name: "CANDY WAVE", line: "ALL NIGHT · 101.7 FM", a: "#1a0630", b: "#ff5ad9", ink: "#ffffff", motif: "wave", legal: "BROADCASTING FROM THE PIER" },
  { name: "MOSQUITO LIME", line: "SODA WITH A BITE", a: "#0c2a12", b: "#9dff3d", ink: "#08210d", motif: "orb", legal: "CONTAINS REAL LIME. ALLEGEDLY." },
  { name: "PANTHER CLUB", line: "MEMBERS & FRIENDS", a: "#120616", b: "#c8a24a", ink: "#f4ead2", motif: "band", legal: "OCEAN MILE · NO CAMERAS" },
  { name: "ORCHID AIR", line: "LEONIDA TO ANYWHERE", a: "#07284a", b: "#7fd8f0", ink: "#04182c", motif: "sun", legal: "34 GATES · ONE TERMINAL" },
  { name: "8QX DENIM", line: "CUT FOR THE HEAT", a: "#1b1f2e", b: "#6f8fd8", ink: "#f0f2f8", motif: "grid", legal: "MADE IN THE WAREHOUSE DISTRICT" },
  { name: "FANG", line: "STAY UP", a: "#2a0606", b: "#ff3b30", ink: "#ffffff", motif: "grid", legal: "ENERGY · NOT FOR CHILDREN" },
  { name: "LEONIDA LOTTO", line: "SOMEBODY HAS TO", a: "#0a1a3a", b: "#ffe9a8", ink: "#08142c", motif: "sun", legal: "ODDS PRINTED SMALLER THAN THIS" },
  { name: "HAVEN REALTY", line: "OWN THE SKYLINE", a: "#101828", b: "#e8e2d2", ink: "#0c1220", motif: "grid", legal: "HAVEN REALTY · SINCE 1962" },
];

/** Largest font size at which `text` fits `max` pixels wide. */
function fit(
  c: CanvasRenderingContext2D,
  text: string,
  max: number,
  start: number,
  font: (n: number) => string,
) {
  let n = start;
  while (n > 10) {
    c.font = font(n);
    if (c.measureText(text).width <= max) break;
    n -= 2;
  }
  return n;
}

/** The graphic behind the type. Cheap shapes, because the type is the poster. */
function motif(c: CanvasRenderingContext2D, m: Motif, ink: string) {
  c.save();
  c.globalAlpha = 0.17;
  c.fillStyle = ink;
  c.strokeStyle = ink;
  if (m === "sun") {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      c.beginPath();
      c.moveTo(CELL / 2, CELL * 0.62);
      c.arc(CELL / 2, CELL * 0.62, CELL, a, a + 0.09);
      c.closePath();
      c.fill();
    }
  } else if (m === "band") {
    c.lineWidth = 34;
    for (let i = -2; i < 7; i++) {
      c.beginPath();
      c.moveTo(i * 96 - 120, CELL + 40);
      c.lineTo(i * 96 + 180, -40);
      c.stroke();
    }
  } else if (m === "orb") {
    for (const [r, al] of [[CELL * 0.46, 0.2], [CELL * 0.3, 0.26], [CELL * 0.15, 0.34]] as const) {
      c.globalAlpha = al;
      c.beginPath();
      c.arc(CELL * 0.72, CELL * 0.36, r, 0, 7);
      c.fill();
    }
  } else if (m === "grid") {
    c.lineWidth = 3;
    for (let i = 0; i <= 12; i++) {
      c.beginPath();
      c.moveTo((i / 12) * CELL, 0);
      c.lineTo((i / 12) * CELL, CELL);
      c.moveTo(0, (i / 12) * CELL);
      c.lineTo(CELL, (i / 12) * CELL);
      c.stroke();
    }
  } else {
    c.lineWidth = 16;
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      for (let x = 0; x <= CELL; x += 16) {
        const y = CELL * 0.3 + i * 58 + Math.sin(x / 74 + i) * 26;
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  c.restore();
}

/** One poster, drawn into the top-left CELL x CELL of the context's origin. */
function poster(c: CanvasRenderingContext2D, brand: Brand) {
  const g = c.createLinearGradient(0, 0, CELL * 0.35, CELL);
  g.addColorStop(0, brand.a);
  g.addColorStop(1, brand.b);
  c.fillStyle = g;
  c.fillRect(0, 0, CELL, CELL);

  motif(c, brand.motif, brand.ink);

  c.textAlign = "center";
  c.textBaseline = "middle";

  // headline, broken over two lines if it is a two-word name
  const words = brand.name.split(" ");
  const lines = words.length > 1 && brand.name.length > 9 ? words : [brand.name];
  const size = Math.min(
    ...lines.map((l) => fit(c, l, CELL - 56, 140, (n) => `bold ${n}px 'Arial Black', Impact, sans-serif`)),
  );
  c.font = `bold ${size}px 'Arial Black', Impact, sans-serif`;
  const top = CELL * 0.4 - ((lines.length - 1) * size * 0.52) / 2;
  lines.forEach((l, i) => {
    const y = top + i * size * 1.04;
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.fillText(l, CELL / 2 + 5, y + 6);
    c.fillStyle = brand.ink;
    c.fillText(l, CELL / 2, y);
  });

  // rule, tagline
  const ruleY = top + lines.length * size * 0.66 + 26;
  c.fillStyle = brand.ink;
  c.globalAlpha = 0.8;
  c.fillRect(CELL * 0.18, ruleY, CELL * 0.64, 5);
  c.globalAlpha = 1;

  const ts = fit(c, brand.line, CELL - 84, 52, (n) => `bold ${n}px 'Arial Narrow', Arial, sans-serif`);
  c.font = `bold ${ts}px 'Arial Narrow', Arial, sans-serif`;
  c.fillStyle = brand.ink;
  c.fillText(brand.line, CELL / 2, ruleY + 30 + ts / 2);

  // the strip along the bottom every hoarding in the world has
  c.fillStyle = "rgba(0,0,0,0.42)";
  c.fillRect(0, CELL - 46, CELL, 46);
  c.font = "bold 19px 'Arial Narrow', Arial, sans-serif";
  c.fillStyle = "rgba(255,255,255,0.62)";
  c.fillText(brand.legal, CELL / 2, CELL - 22);

  // a printed border, and a corner darkening so it isn't a flat rectangle
  c.strokeStyle = "rgba(0,0,0,0.35)";
  c.lineWidth = 8;
  c.strokeRect(4, 4, CELL - 8, CELL - 8);
  const v = c.createRadialGradient(CELL / 2, CELL / 2, CELL * 0.3, CELL / 2, CELL / 2, CELL * 0.76);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.3)");
  c.fillStyle = v;
  c.fillRect(0, 0, CELL, CELL);
}

/** Every campaign on one sheet, addressed by slot from the shader. */
function adAtlas() {
  const cv = document.createElement("canvas");
  cv.width = AD_COLS * CELL;
  cv.height = AD_ROWS * CELL;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#07050c";
  c.fillRect(0, 0, cv.width, cv.height);
  BRANDS.forEach((brand, i) => {
    c.save();
    c.translate((i % AD_COLS) * CELL, Math.floor(i / AD_COLS) * CELL);
    c.beginPath();
    c.rect(0, 0, CELL, CELL);
    c.clip();
    poster(c, brand);
    c.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* the screens                                                         */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */ `
  attribute float adSeed;
  varying vec2 vUv;
  varying float vSeed;
  varying float vDepth;
  void main(){
    vUv = uv;
    vSeed = adSeed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D atlas;
  uniform float time;
  uniform vec2 cells;
  uniform float count;
  uniform float dwell;
  uniform float gain;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec2 vUv;
  varying float vSeed;
  varying float vDepth;

  vec3 creative(float slot, vec2 uv){
    float col = mod(slot, cells.x);
    float row = floor(slot / cells.x);
    // v is flipped: atlas row 0 is the top of the canvas
    vec2 o = (vec2(col, cells.y - 1.0 - row) + clamp(uv, 0.006, 0.994)) / cells;
    return texture2D(atlas, o).rgb;
  }

  void main(){
    /*
     * Each board runs the same 1-in-5 walk through the atlas (5 and 12 are
     * coprime, so every campaign gets shown) from its own starting slot, and
     * starts at its own point in the dwell — so a street of boards never flips
     * in unison.
     */
    float phase = time / dwell + fract(vSeed * 0.6180339);
    float n = floor(phase);
    float f = fract(phase);
    float a = mod(n * 5.0 + vSeed, count);
    float b = mod(a + 5.0, count);

    float wipe = smoothstep(0.86, 1.0, f);
    float edge = mix(1.0, smoothstep(wipe - 0.035, wipe + 0.035, vUv.x), step(0.0005, wipe));
    vec3 col = mix(creative(b, vUv), creative(a, vUv), edge);
    // the bar of light that runs across a board as it changes
    col += vec3(0.5, 0.48, 0.42) * exp(-pow((vUv.x - wipe) * 26.0, 2.0)) * step(0.0005, wipe);

    // scanlines and a slow flicker: these are lit boards, not printed card
    col *= 0.955 + 0.045 * sin(vUv.y * 380.0);
    col *= gain * (0.99 + 0.012 * sin(time * 31.0 + vSeed * 7.0));

    float fg = 1.0 - exp(-pow(max(vDepth, 0.0) * fogDensity, 2.0));
    col = mix(col, fogColor, clamp(fg, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export type AdBoards = {
  mesh: THREE.Mesh | null;
  /** Count of boards actually standing, for the world stats. */
  boards: number;
  update: (t: number) => void;
  /** Keeps the screens in the same air as everything else. */
  setFog: (colour: THREE.Color, density: number) => void;
  dispose: () => void;
};

/**
 * Builds every collected site: frame into the city's merged buffers, screen
 * face into one animated mesh, and the big ones into the evidence register.
 */
export function buildAds(ctx: WorldCtx, sites: AdSite[]): AdBoards {
  const prop = ctx.bank.bucket("prop", ctx.mat.prop);
  const metal = ctx.bank.bucket("metal", ctx.mat.metal);
  const neon = ctx.bank.bucket("neon", ctx.mat.neon);

  const pos: number[] = [];
  /*
   * Unused by the shader below, but three declares `attribute vec3 normal` in
   * every non-raw ShaderMaterial's vertex prefix, and leaving a declared
   * attribute unbound is the kind of thing that works on one driver and drops
   * the whole draw call on the next.
   */
  const nrm: number[] = [];
  const uv: number[] = [];
  const seed: number[] = [];
  const idx: number[] = [];

  /** How many boards carry an evidence tag — enough to matter, not to spam. */
  const TAGGED = 16;
  const tagEvery = Math.max(1, Math.ceil(sites.length / TAGGED));

  sites.forEach((site, n) => {
    const { x, y, z, rot, w, h } = site;
    const sin = Math.sin(rot);
    const cos = Math.cos(rot);
    // face normal, and the direction the face runs in
    const nx = sin;
    const nz = cos;
    const rxv = cos;
    const rzv = -sin;
    /** True when the board spans the X axis, i.e. its depth is along Z. */
    const spansX = Math.abs(cos) > 0.5;

    /** A box measured in (across the face, up, through the face). */
    const slab = (
      cx: number,
      cy: number,
      cz: number,
      across: number,
      up: number,
      deep: number,
      tint: number,
      bucket = prop,
    ) => {
      if (spansX) bucket.box(cx, cy, cz, across, up, deep, { tint });
      else bucket.box(cx, cy, cz, deep, up, across, { tint });
    };

    /*
     * ---- backing board, screen face, trim ----
     *
     * The stack through the board matters, and getting it wrong is invisible in
     * the code and total on screen. `site.y`/`site.x`/`site.z` is the *face*
     * plane, so everything structural has to sit behind it: the backing box is
     * 0.2 deep hung entirely on the back (front face landing exactly on 0), the
     * screen quad goes 2cm in front of that, and only the trim is allowed to
     * stand proud of the screen — which is what a frame does anyway.
     *
     * Centring the backing on the site instead buries the screen 5cm inside it,
     * and every board in the city renders as a black rectangle.
     */
    const BACK = 0.2;
    slab(x - nx * (BACK / 2), y, z - nz * (BACK / 2), w + 0.5, h + 0.5, BACK, 0x23242c);

    const base = pos.length / 3;
    const hx = w / 2;
    const hy = h / 2;
    const px = x + nx * 0.02;
    const pz = z + nz * 0.02;
    for (const [lx, ly, u, v] of [
      [-hx, -hy, 0, 0],
      [hx, -hy, 1, 0],
      [hx, hy, 1, 1],
      [-hx, hy, 0, 1],
    ] as const) {
      pos.push(px + rxv * lx, y + ly, pz + rzv * lx);
      nrm.push(nx, 0, nz);
      uv.push(u, v);
      // the board's own index: the shader takes its starting slot and its
      // position in the dwell from it, so no two neighbours are in step
      seed.push(n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);

    for (const s of [-1, 1] as const) {
      slab(
        x + rxv * s * (w / 2 + 0.14) - nx * 0.06,
        y,
        z + rzv * s * (w / 2 + 0.14) - nz * 0.06,
        0.3,
        h + 0.62,
        0.28,
        0x35374a,
      );
      slab(x - nx * 0.06, y + s * (h / 2 + 0.14), z - nz * 0.06, w + 0.62, 0.3, 0.28, 0x35374a);
    }

    /* ---- floodlights: a bracket under the board with three cans on it ---- */
    if (site.kind !== "wall") {
      const fy = y - h / 2 - 0.5;
      metal.bar(
        x + rxv * (w / 2 - 0.4) + nx * 0.7,
        fy,
        z + rzv * (w / 2 - 0.4) + nz * 0.7,
        x - rxv * (w / 2 - 0.4) + nx * 0.7,
        fy,
        z - rzv * (w / 2 - 0.4) + nz * 0.7,
        0.09,
        0x4e5262,
      );
      for (const s of [-0.62, 0, 0.62]) {
        const cx = x + rxv * s * (w / 2) + nx * 0.72;
        const cz = z + rzv * s * (w / 2) + nz * 0.72;
        slab(cx, fy + 0.2, cz, 0.46, 0.24, 0.3, 0x2a2c36, metal);
        slab(cx - nx * 0.1, fy + 0.3, cz - nz * 0.1, 0.34, 0.06, 0.05, 0xfff0cc, neon);
      }
    }

    /* ---- what holds it up ---- */
    if (site.kind === "kerb") {
      const foot = 0.19;
      for (const s of [-1, 1] as const) {
        const lx = x + rxv * s * (w * 0.31);
        const lz = z + rzv * s * (w * 0.31);
        prop.cylinder(lx, (y - h / 2 + foot) / 2, lz, 0.19, 0.16, y - h / 2 - foot, 8, 0x3a3d4a, 0.4);
        // the posts are what you walk into; the board itself is overhead
        ctx.grid.box(lx, lz, 0.5, 0.5, y - h / 2);
      }
    } else if (site.kind === "roof") {
      // a braced frame standing on the parapet, raked back onto the roof
      const foot = y - h / 2 - 1.35;
      for (const s of [-1, 0, 1] as const) {
        const lx = x + rxv * s * (w * 0.4);
        const lz = z + rzv * s * (w * 0.4);
        metal.bar(lx, foot, lz, lx, y + h / 2, lz, 0.13, 0x4a4d5c);
        metal.bar(lx, y, lz, lx - nx * 2.2, foot, lz - nz * 2.2, 0.1, 0x4a4d5c);
      }
      // service catwalk along the bottom edge
      slab(x, y - h / 2 - 0.3, z, w + 0.4, 0.09, 1.1, 0x50546a, metal);
    }

    /* ---- the register ---- */
    if (site.kind !== "wall" && n % tagEvery === 0) {
      const anchor = new THREE.Object3D();
      anchor.position.set(x + nx * 0.4, y, z + nz * 0.4);
      anchor.updateMatrixWorld();
      ctx.group.add(anchor);
      ctx.evidence.push({
        kind: "BILLBOARD",
        label: `AD BOARD · ${districtAt(x, z).name}`,
        object: anchor,
        offset: new THREE.Vector3(),
        radius: Math.min(w, h) * 0.42,
      });
    }
  });

  if (!idx.length) {
    return {
      mesh: null,
      boards: 0,
      update: () => {},
      setFog: () => {},
      dispose: () => {},
    };
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("adSeed", new THREE.Float32BufferAttribute(seed, 1));
  geo.setIndex(
    pos.length / 3 > 65535
      ? new THREE.Uint32BufferAttribute(idx, 1)
      : new THREE.Uint16BufferAttribute(idx, 1),
  );
  geo.computeBoundingSphere();

  const atlas = adAtlas();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      atlas: { value: atlas },
      time: { value: 0 },
      cells: { value: new THREE.Vector2(AD_COLS, AD_ROWS) },
      count: { value: AD_COUNT },
      dwell: { value: AD_DWELL },
      gain: { value: 1 },
      fogColor: { value: new THREE.Color(0xaacbe0) },
      fogDensity: { value: 0.00135 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "ads";
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.group.add(mesh);

  return {
    mesh,
    boards: sites.length,
    update(t) {
      mat.uniforms.time.value = t;
    },
    setFog(colour, density) {
      (mat.uniforms.fogColor.value as THREE.Color).copy(colour);
      mat.uniforms.fogDensity.value = density;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      atlas.dispose();
    },
  };
}
