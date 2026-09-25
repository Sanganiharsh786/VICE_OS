/**
 * Every surface in Leonida, painted into a canvas at boot.
 *
 * The house rule for this project is that nothing is downloaded, so all of it
 * — asphalt, pavement, sand, seven families of building facade, storefronts,
 * signage, number plates — is drawn with 2D canvas calls and uploaded as a
 * tiling texture.
 *
 * Facade tiles are authored as exactly 4 windows x 4 floors. The world
 * generator then sets the UV repeat from the building's real dimensions, so a
 * 12-metre shopfront and a 130-metre tower get the same floor height and the
 * same window pitch instead of a stretched version of one bitmap.
 */

import * as THREE from "three";
import { mulberry, type Rnd } from "./rng";

/**
 * Real-world size of one facade tile: 6 windows across by 6 storeys up, at a
 * 3.3m window pitch and a 3.5m floor height.
 *
 * The tile has to be big enough that its repeat isn't legible on a hundred-
 * metre tower — at four windows the period landed around thirteen metres and
 * read as a quilt from across the street.
 */
export const TILE_W = 19.8;
export const TILE_H = 21.0;

export type FacadeKind =
  | "tower"
  | "office"
  | "apartment"
  | "shop"
  | "warehouse"
  | "colonial"
  | "resort";

function canvas(w: number, h: number) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return { cv, c: cv.getContext("2d")! };
}

function finish(cv: HTMLCanvasElement, repeatWrap = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeatWrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function grain(c: CanvasRenderingContext2D, w: number, h: number, amt: number) {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
}

/** Speckle that wraps at the tile edge, so it tiles without a seam. */
function speckle(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  n: number,
  rnd: Rnd,
  colour: (r: Rnd) => string,
  maxR = 3,
) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 0.4 + rnd() * maxR;
    c.fillStyle = colour(rnd);
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        if (Math.abs(x + ox - w / 2) > w || Math.abs(y + oy - h / 2) > h) continue;
        c.beginPath();
        c.arc(x + ox, y + oy, r, 0, 7);
        c.fill();
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* ground                                                              */
/* ------------------------------------------------------------------ */

function asphalt() {
  const { cv, c } = canvas(512, 512);
  const rnd = mulberry(7);
  c.fillStyle = "#37343f";
  c.fillRect(0, 0, 512, 512);
  // patch repairs — long darker strips, like resurfaced lanes
  for (let i = 0; i < 9; i++) {
    c.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.12})`;
    c.fillRect(rnd() * 512, 0, 20 + rnd() * 90, 512);
  }
  speckle(c, 512, 512, 1600, rnd, (r) => `rgba(220,215,235,${r() * 0.055})`, 2.2);
  speckle(c, 512, 512, 400, rnd, (r) => `rgba(0,0,0,${r() * 0.28})`, 4);
  // cracks
  c.strokeStyle = "rgba(0,0,0,0.3)";
  c.lineWidth = 1.3;
  for (let i = 0; i < 26; i++) {
    c.beginPath();
    let x = rnd() * 512;
    let y = rnd() * 512;
    c.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rnd() - 0.5) * 60;
      y += (rnd() - 0.5) * 60;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  grain(c, 512, 512, 14);
  return finish(cv);
}

function concrete() {
  const { cv, c } = canvas(512, 512);
  const rnd = mulberry(23);
  c.fillStyle = "#5e5a70";
  c.fillRect(0, 0, 512, 512);
  // 8 slabs across, so a 4m pavement reads at a believable 0.5m pitch
  const p = 128;
  for (let y = 0; y < 512; y += p) {
    for (let x = 0; x < 512; x += p) {
      c.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`;
      c.fillRect(x, y, p, p);
    }
  }
  c.strokeStyle = "rgba(0,0,0,0.42)";
  c.lineWidth = 3;
  for (let i = 0; i <= 512; i += p) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i, 512);
    c.moveTo(0, i);
    c.lineTo(512, i);
    c.stroke();
  }
  speckle(c, 512, 512, 900, rnd, (r) => `rgba(0,0,0,${r() * 0.18})`, 2.4);
  grain(c, 512, 512, 16);
  return finish(cv);
}

function sand() {
  const { cv, c } = canvas(512, 512);
  const rnd = mulberry(41);
  c.fillStyle = "#c8a173";
  c.fillRect(0, 0, 512, 512);
  // wind ripples
  c.strokeStyle = "rgba(255,255,255,0.09)";
  c.lineWidth = 6;
  for (let y = -40; y < 560; y += 17) {
    c.beginPath();
    for (let x = 0; x <= 512; x += 32) {
      c.lineTo(x, y + Math.sin((x / 512) * Math.PI * 4 + y * 0.2) * 5);
    }
    c.stroke();
  }
  speckle(c, 512, 512, 2600, rnd, (r) => `rgba(255,240,210,${r() * 0.3})`, 1.6);
  speckle(c, 512, 512, 900, rnd, (r) => `rgba(120,86,54,${r() * 0.3})`, 2);
  grain(c, 512, 512, 18);
  return finish(cv);
}

function grass() {
  const { cv, c } = canvas(512, 512);
  const rnd = mulberry(59);
  c.fillStyle = "#2f5c3a";
  c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4200; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    c.strokeStyle = `rgba(${90 + rnd() * 70 | 0},${150 + rnd() * 80 | 0},${70 + rnd() * 50 | 0},${0.25 + rnd() * 0.5})`;
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (rnd() - 0.5) * 6, y - 4 - rnd() * 6);
    c.stroke();
  }
  grain(c, 512, 512, 14);
  return finish(cv);
}

/** Dirt, gravel and tyre tracks — industrial yards and unbuilt lots. */
function dirt() {
  const { cv, c } = canvas(512, 512);
  const rnd = mulberry(83);
  c.fillStyle = "#4c4553";
  c.fillRect(0, 0, 512, 512);
  speckle(c, 512, 512, 2200, rnd, (r) => `rgba(150,138,120,${r() * 0.18})`, 3);
  speckle(c, 512, 512, 700, rnd, (r) => `rgba(0,0,0,${r() * 0.3})`, 5);
  grain(c, 512, 512, 20);
  return finish(cv);
}

/** Roof felt with gravel, vents and plant already painted in. */
function roof() {
  const { cv, c } = canvas(256, 256);
  const rnd = mulberry(97);
  c.fillStyle = "#23212c";
  c.fillRect(0, 0, 256, 256);
  speckle(c, 256, 256, 1400, rnd, (r) => `rgba(200,195,210,${r() * 0.1})`, 2);
  // seams between felt rolls
  c.strokeStyle = "rgba(0,0,0,0.45)";
  c.lineWidth = 2;
  for (let y = 0; y < 256; y += 64) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(256, y);
    c.stroke();
  }
  // rooftop plant, seen from the air
  for (let i = 0; i < 5; i++) {
    const w = 18 + rnd() * 36;
    const h = 14 + rnd() * 26;
    const x = rnd() * (256 - w);
    const y = rnd() * (256 - h);
    c.fillStyle = "#39364a";
    c.fillRect(x, y, w, h);
    c.fillStyle = "rgba(0,0,0,0.4)";
    c.fillRect(x + 3, y + h, w, 4);
    c.strokeStyle = "rgba(255,255,255,0.08)";
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  grain(c, 256, 256, 14);
  return finish(cv);
}

/* ------------------------------------------------------------------ */
/* facades                                                             */
/* ------------------------------------------------------------------ */

const COLS = 6;
const ROWS = 6;
const SIZE = 768;
const CW = SIZE / COLS;
const CH = SIZE / ROWS;

/** Warm interior lights, with a few cold offices and a rare neon room. */
function litColour(rnd: Rnd, neon: number) {
  const r = rnd();
  if (r < neon * 0.18)
    return ["#ff2e97", "#22e6ff", "#9dff3d", "#ff5ad9"][Math.floor(rnd() * 4)];
  if (r < 0.45) return "#ffd9a0";
  if (r < 0.7) return "#ffc477";
  if (r < 0.88) return "#e8f0ff";
  return "#fff3d6";
}

type FacadeOpts = {
  base: string[];
  glass: string;
  /** Fraction of windows with the lights on. */
  lit: number;
  neon: number;
  /** Mullion / frame colour. */
  frame: string;
  seed: number;
};

/**
 * The shared facade skeleton: a 4x4 grid of window bays over a base colour,
 * with a per-kind decorator that adds the details that actually distinguish
 * an apartment block from a glass tower.
 */
function facadeTile(
  o: FacadeOpts,
  decorate: (c: CanvasRenderingContext2D, rnd: Rnd, base: string) => void,
  window: (
    c: CanvasRenderingContext2D,
    rnd: Rnd,
    x: number,
    y: number,
    w: number,
    h: number,
    on: boolean,
  ) => void,
) {
  const { cv, c } = canvas(SIZE, SIZE);
  const rnd = mulberry(o.seed);
  const base = o.base[Math.floor(rnd() * o.base.length)];
  c.fillStyle = base;
  c.fillRect(0, 0, SIZE, SIZE);

  decorate(c, rnd, base);

  for (let r = 0; r < ROWS; r++) {
    for (let k = 0; k < COLS; k++) {
      window(c, rnd, k * CW, r * CH, CW, CH, rnd() < o.lit);
    }
  }

  // floor slab shadow under every storey — the single strongest cue that a
  // facade has floors rather than a pattern printed on it
  c.fillStyle = "rgba(0,0,0,0.38)";
  for (let r = 0; r < ROWS; r++) c.fillRect(0, r * CH, SIZE, 4);
  c.fillStyle = "rgba(255,255,255,0.05)";
  for (let r = 0; r < ROWS; r++) c.fillRect(0, r * CH + 4, SIZE, 2);

  grain(c, SIZE, SIZE, 10);
  return finish(cv);
}

const facadeBuilders: Record<FacadeKind, (seed: number) => THREE.Texture> = {
  /* Glass curtain wall. Big panes, thin mullions, cold sky reflection. */
  tower: (seed) =>
    facadeTile(
      {
        base: ["#22354f", "#1d2d45", "#273050"],
        glass: "#3f6b93",
        lit: 0.42,
        neon: 0.2,
        frame: "#2b3350",
        seed,
      },
      (c, rnd) => {
        // vertical mullion ribs run the full height
        c.fillStyle = "rgba(90,110,150,0.35)";
        for (let k = 0; k <= COLS; k++) c.fillRect(k * CW - 2, 0, 4, SIZE);
        void rnd;
      },
      (c, rnd, x, y, w, h, on) => {
        const g = c.createLinearGradient(x, y, x + w, y + h);
        if (on) {
          const col = litColour(rnd, 0.2);
          g.addColorStop(0, col);
          g.addColorStop(1, "#39557a");
          c.globalAlpha = 0.3 + rnd() * 0.3;
        } else {
          g.addColorStop(0, "#38587f");
          g.addColorStop(0.5, "#456a93");
          g.addColorStop(1, "#2a4362");
          c.globalAlpha = 1;
        }
        c.fillStyle = g;
        c.fillRect(x + 4, y + 6, w - 8, h - 12);
        c.globalAlpha = 1;
        // sky glance across the pane
        c.fillStyle = "rgba(200,232,255,0.16)";
        c.fillRect(x + 4, y + 6, w - 8, (h - 12) * 0.35);
      },
    ),

  /* Spandrel-and-band office block. Regular, corporate, mostly cold. */
  office: (seed) =>
    facadeTile(
      {
        base: ["#474a60", "#3f4256", "#52506a"],
        glass: "#33456b",
        lit: 0.5,
        neon: 0.1,
        frame: "#3c3c52",
        seed,
      },
      (c) => {
        c.fillStyle = "rgba(255,255,255,0.045)";
        for (let r = 0; r < ROWS; r++) c.fillRect(0, r * CH + CH * 0.72, SIZE, CH * 0.28);
      },
      (c, rnd, x, y, w, h, on) => {
        c.fillStyle = on ? litColour(rnd, 0.08) : "#2b3c5c";
        c.globalAlpha = on ? 0.3 + rnd() * 0.32 : 1;
        c.fillRect(x + 9, y + 12, w - 18, h * 0.6);
        c.globalAlpha = 1;
        c.strokeStyle = "rgba(0,0,0,0.5)";
        c.lineWidth = 3;
        c.strokeRect(x + 9, y + 12, w - 18, h * 0.6);
      },
    ),

  /* Stucco apartments: smaller openings, balconies, warm domestic light. */
  apartment: (seed) =>
    facadeTile(
      {
        base: ["#7a626c", "#6a6274", "#846d76", "#5f5a6c"],
        glass: "#191320",
        lit: 0.46,
        neon: 0.12,
        frame: "#c9c2b4",
        seed,
      },
      (c, rnd) => {
        // rendered-stucco blotching
        speckle(c, SIZE, SIZE, 700, rnd, (r) => `rgba(255,255,255,${r() * 0.05})`, 8);
        speckle(c, SIZE, SIZE, 400, rnd, (r) => `rgba(0,0,0,${r() * 0.1})`, 9);
      },
      (c, rnd, x, y, w, h, on) => {
        const wx = x + w * 0.2;
        const wy = y + h * 0.16;
        const ww = w * 0.6;
        const wh = h * 0.46;
        c.fillStyle = "rgba(0,0,0,0.5)";
        c.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
        c.fillStyle = on ? litColour(rnd, 0.12) : "#17121f";
        c.globalAlpha = on ? 0.5 + rnd() * 0.5 : 1;
        c.fillRect(wx, wy, ww, wh);
        c.globalAlpha = 1;
        // glazing bar
        c.fillStyle = "rgba(230,225,215,0.5)";
        c.fillRect(wx + ww / 2 - 2, wy, 4, wh);
        // balcony rail on alternate storeys
        if (rnd() > 0.45) {
          const by = y + h * 0.7;
          c.fillStyle = "rgba(0,0,0,0.45)";
          c.fillRect(x + 6, by, w - 12, 5);
          c.strokeStyle = "rgba(220,215,205,0.45)";
          c.lineWidth = 2;
          for (let b = x + 12; b < x + w - 12; b += 11) {
            c.beginPath();
            c.moveTo(b, by);
            c.lineTo(b, by + 20);
            c.stroke();
          }
          c.fillStyle = "rgba(220,215,205,0.55)";
          c.fillRect(x + 6, by + 19, w - 12, 4);
        }
      },
    ),

  /* Two-storey commercial: mostly glass, warm, busy. */
  shop: (seed) =>
    facadeTile(
      {
        base: ["#55485c", "#604a63", "#4a4055"],
        glass: "#211a2c",
        lit: 0.72,
        neon: 0.9,
        frame: "#d8cfc0",
        seed,
      },
      (c, rnd) => {
        speckle(c, SIZE, SIZE, 500, rnd, (r) => `rgba(0,0,0,${r() * 0.14})`, 7);
      },
      (c, rnd, x, y, w, h, on) => {
        c.fillStyle = "rgba(0,0,0,0.45)";
        c.fillRect(x + 5, y + 10, w - 10, h - 22);
        c.fillStyle = on ? litColour(rnd, 0.8) : "#1b1526";
        c.globalAlpha = on ? 0.55 + rnd() * 0.45 : 1;
        c.fillRect(x + 9, y + 14, w - 18, h - 30);
        c.globalAlpha = 1;
        // an air-con box on some bays
        if (rnd() > 0.72) {
          c.fillStyle = "#2c2938";
          c.fillRect(x + w * 0.62, y + h * 0.58, w * 0.26, h * 0.2);
        }
      },
    ),

  /* Corrugated metal shed with a high clerestory. */
  warehouse: (seed) =>
    facadeTile(
      {
        base: ["#5b5e69", "#51545e", "#66646e"],
        glass: "#20242c",
        lit: 0.22,
        neon: 0.05,
        frame: "#585c68",
        seed,
      },
      (c) => {
        // corrugation
        for (let x = 0; x < SIZE; x += 12) {
          c.fillStyle = "rgba(255,255,255,0.05)";
          c.fillRect(x, 0, 5, SIZE);
          c.fillStyle = "rgba(0,0,0,0.16)";
          c.fillRect(x + 6, 0, 5, SIZE);
        }
        c.fillStyle = "rgba(0,0,0,0.25)";
        c.fillRect(0, SIZE * 0.5 - 3, SIZE, 6);
      },
      (c, rnd, x, y, w, h, on) => {
        // only the top band of each storey is glazed
        c.fillStyle = "rgba(0,0,0,0.5)";
        c.fillRect(x + 12, y + 10, w - 24, h * 0.2);
        c.fillStyle = on ? "#cfe0f0" : "#1c222c";
        c.globalAlpha = on ? 0.3 + rnd() * 0.3 : 1;
        c.fillRect(x + 14, y + 12, w - 28, h * 0.2 - 4);
        c.globalAlpha = 1;
        // rust bleed
        if (rnd() > 0.7) {
          c.fillStyle = `rgba(120,60,30,${0.1 + rnd() * 0.18})`;
          c.fillRect(x + rnd() * w * 0.7, y + h * 0.3, 6 + rnd() * 14, h * 0.7);
        }
      },
    ),

  /* Old Town: painted render, shutters, arched heads. */
  colonial: (seed) =>
    facadeTile(
      {
        base: ["#7a5548", "#8a6a4a", "#6d5a68", "#8d7355", "#6a4f57"],
        glass: "#20161c",
        lit: 0.5,
        neon: 0.3,
        frame: "#e8dcc4",
        seed,
      },
      (c, rnd) => {
        speckle(c, SIZE, SIZE, 900, rnd, (r) => `rgba(255,255,255,${r() * 0.07})`, 9);
        speckle(c, SIZE, SIZE, 500, rnd, (r) => `rgba(0,0,0,${r() * 0.14})`, 10);
        // cornice at every floor line
        c.fillStyle = "rgba(240,232,214,0.35)";
        for (let r = 0; r < ROWS; r++) c.fillRect(0, r * CH + 2, SIZE, 7);
      },
      (c, rnd, x, y, w, h, on) => {
        const wx = x + w * 0.26;
        const wy = y + h * 0.22;
        const ww = w * 0.48;
        const wh = h * 0.46;
        // arched head
        c.fillStyle = "#e6dac2";
        c.beginPath();
        c.moveTo(wx - 6, wy + wh + 6);
        c.lineTo(wx - 6, wy + ww * 0.5);
        c.arc(wx + ww / 2, wy + ww * 0.5, ww / 2 + 6, Math.PI, 0);
        c.lineTo(wx + ww + 6, wy + wh + 6);
        c.closePath();
        c.fill();
        c.fillStyle = on ? litColour(rnd, 0.25) : "#1b1219";
        c.globalAlpha = on ? 0.55 + rnd() * 0.45 : 1;
        c.fillRect(wx, wy, ww, wh);
        c.globalAlpha = 1;
        // shutters
        if (rnd() > 0.4) {
          c.fillStyle = ["#2f5d4a", "#3a3f6b", "#6b2f3a"][Math.floor(rnd() * 3)];
          c.fillRect(wx - 16, wy, 14, wh);
          c.fillRect(wx + ww + 2, wy, 14, wh);
        }
      },
    ),

  /* Art-deco beach hotels: pastel bands, deep balconies, neon trim. */
  resort: (seed) =>
    facadeTile(
      {
        base: ["#c9b6d8", "#d8c2a8", "#a8c7d8", "#e0c8b4", "#b8d0c0"],
        glass: "#1d1826",
        lit: 0.58,
        neon: 1,
        frame: "#ffffff",
        seed,
      },
      (c, rnd, base) => {
        void base;
        // horizontal eyebrow bands, the deco signature
        for (let r = 0; r < ROWS; r++) {
          c.fillStyle = "rgba(255,255,255,0.3)";
          c.fillRect(0, r * CH + CH * 0.08, SIZE, 8);
          c.fillStyle = "rgba(0,0,0,0.2)";
          c.fillRect(0, r * CH + CH * 0.08 + 8, SIZE, 5);
        }
        speckle(c, SIZE, SIZE, 400, rnd, (r) => `rgba(0,0,0,${r() * 0.07})`, 10);
      },
      (c, rnd, x, y, w, h, on) => {
        // recessed loggia
        c.fillStyle = "rgba(0,0,0,0.42)";
        c.fillRect(x + 8, y + h * 0.24, w - 16, h * 0.52);
        c.fillStyle = on ? litColour(rnd, 0.6) : "#1a1524";
        c.globalAlpha = on ? 0.5 + rnd() * 0.5 : 1;
        c.fillRect(x + 14, y + h * 0.28, w - 28, h * 0.4);
        c.globalAlpha = 1;
        // balcony slab + rail
        c.fillStyle = "rgba(255,255,255,0.7)";
        c.fillRect(x + 4, y + h * 0.76, w - 8, 6);
        c.strokeStyle = "rgba(255,255,255,0.5)";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x + 6, y + h * 0.76);
        c.lineTo(x + w - 6, y + h * 0.76);
        c.stroke();
      },
    ),
};

/* ------------------------------------------------------------------ */
/* storefronts                                                         */
/* ------------------------------------------------------------------ */

const SHOP_NAMES = [
  "MALIBU",
  "PAWN 24H",
  "EL SOL",
  "VACANCY",
  "CAFE CUBANO",
  "NO CREDIT",
  "LIQUOR",
  "MOTEL",
  "LAUNDRY",
  "TACOS",
  "VINYL",
  "TATTOO",
  "NAILS",
  "BODEGA",
  "ARCADE",
  "BAIL BONDS",
  "DONUTS",
  "CHECKS CASHED",
];

const NEON = ["#ff2e97", "#22e6ff", "#ffb347", "#9dff3d", "#ff5ad9", "#ffe9a8"];

/**
 * The ground floor. Every building gets a 4-metre band of this wrapped round
 * its base, which is the layer the player actually walks past — shutters,
 * awnings, lit glass and a name over the door.
 */
function storefront(seed: number) {
  const { cv, c } = canvas(512, 256);
  const rnd = mulberry(seed);
  const units = 2;
  const uw = 512 / units;

  c.fillStyle = "#2a2332";
  c.fillRect(0, 0, 512, 256);

  for (let u = 0; u < units; u++) {
    const x = u * uw;
    const shutter = rnd() > 0.72;
    const accent = NEON[Math.floor(rnd() * NEON.length)];

    if (shutter) {
      // closed roller shutter — a tagged one, this being Leonida
      c.fillStyle = "#4b4756";
      c.fillRect(x + 8, 40, uw - 16, 200);
      for (let y = 44; y < 240; y += 8) {
        c.fillStyle = "rgba(0,0,0,0.3)";
        c.fillRect(x + 8, y, uw - 16, 3);
      }
      c.globalAlpha = 0.55;
      c.font = "italic bold 62px 'Arial Black', Impact, sans-serif";
      c.textAlign = "center";
      c.fillStyle = accent;
      c.fillText("VC", x + uw / 2, 160);
      c.globalAlpha = 1;
    } else {
      // lit shopfront glazing
      const g = c.createLinearGradient(0, 40, 0, 240);
      g.addColorStop(0, accent);
      g.addColorStop(0.35, "#ffd9a0");
      g.addColorStop(1, "#2a1f33");
      c.fillStyle = g;
      c.globalAlpha = 0.85;
      c.fillRect(x + 10, 60, uw - 20, 180);
      c.globalAlpha = 1;
      // mullions + a door
      c.fillStyle = "#16121d";
      c.fillRect(x + uw * 0.46, 60, 8, 180);
      c.fillRect(x + 10, 150, uw - 20, 5);
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(x + uw * 0.62, 90, uw * 0.26, 150);
    }

    // awning
    if (rnd() > 0.5) {
      c.fillStyle = accent;
      c.globalAlpha = 0.75;
      c.fillRect(x + 4, 34, uw - 8, 26);
      c.globalAlpha = 1;
      c.fillStyle = "rgba(0,0,0,0.3)";
      for (let s = 0; s < 6; s++) c.fillRect(x + 4 + s * ((uw - 8) / 6), 34, 6, 26);
    }

    // fascia sign
    c.fillStyle = "#0a0610";
    c.fillRect(x, 0, uw, 36);
    c.font = "bold 26px 'Arial Black', Impact, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = accent;
    c.shadowBlur = 18;
    c.fillStyle = accent;
    const name = SHOP_NAMES[Math.floor(rnd() * SHOP_NAMES.length)];
    c.fillText(name, x + uw / 2, 18);
    c.shadowBlur = 0;

    c.strokeStyle = "rgba(0,0,0,0.6)";
    c.lineWidth = 4;
    c.strokeRect(x, 0, uw, 256);
  }

  grain(c, 512, 256, 12);
  return finish(cv);
}

/** Warehouse and garage bases: roller doors and loading bays, no glazing. */
function serviceBase(seed: number) {
  const { cv, c } = canvas(512, 256);
  const rnd = mulberry(seed);
  c.fillStyle = "#3c3f49";
  c.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 14) {
    c.fillStyle = "rgba(255,255,255,0.04)";
    c.fillRect(x, 0, 6, 256);
  }
  for (let u = 0; u < 2; u++) {
    const x = u * 256;
    c.fillStyle = "#565a66";
    c.fillRect(x + 30, 46, 196, 210);
    for (let y = 50; y < 256; y += 10) {
      c.fillStyle = "rgba(0,0,0,0.28)";
      c.fillRect(x + 30, y, 196, 4);
    }
    c.fillStyle = "rgba(0,0,0,0.5)";
    c.fillRect(x + 30, 40, 196, 8);
    // bay number
    c.font = "bold 40px 'Arial Black', sans-serif";
    c.textAlign = "center";
    c.fillStyle = "rgba(255,255,255,0.28)";
    c.fillText(String(1 + Math.floor(rnd() * 9)), x + 128, 110);
  }
  grain(c, 512, 256, 14);
  return finish(cv);
}

/* ------------------------------------------------------------------ */
/* one-off graphics                                                    */
/* ------------------------------------------------------------------ */

export function signTexture(text: string, colour: string) {
  const { cv, c } = canvas(512, 128);
  c.fillStyle = "#060109";
  c.fillRect(0, 0, 512, 128);
  c.font = "bold 72px 'Arial Black', Impact, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.shadowColor = colour;
  c.shadowBlur = 34;
  c.fillStyle = colour;
  c.fillText(text, 256, 66);
  c.fillText(text, 256, 66);
  c.shadowBlur = 0;
  c.fillStyle = "#fff";
  c.globalAlpha = 0.55;
  c.fillText(text, 256, 66);
  return finish(cv, false);
}

export function plateTexture(code: string) {
  const { cv, c } = canvas(256, 128);
  c.fillStyle = "#f2efe4";
  c.fillRect(0, 0, 256, 128);
  c.strokeStyle = "#1a2a6b";
  c.lineWidth = 7;
  c.strokeRect(6, 6, 244, 116);
  c.fillStyle = "#ff8a3c";
  c.font = "bold 20px sans-serif";
  c.textAlign = "center";
  c.fillText("LEONIDA", 128, 30);
  c.fillStyle = "#16224f";
  c.font = "bold 58px 'Arial Black', sans-serif";
  c.fillText(code, 128, 90);
  return finish(cv, false);
}

/**
 * A soft radial falloff. Mapped onto additive ground quads it becomes the pool
 * of light under a street lamp — which is how the city is lit at night
 * without a single dynamic light in the scene.
 */
function glowDisc() {
  const { cv, c } = canvas(128, 128);
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.28, "rgba(255,255,255,0.55)");
  g.addColorStop(0.62, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** A tagged wall. These are the surfaces the Image Lab's work lands on. */
export function graffitiWall(seed: number) {
  const { cv, c } = canvas(512, 256);
  const rnd = mulberry(seed);
  c.fillStyle = "#3a3444";
  c.fillRect(0, 0, 512, 256);
  speckle(c, 512, 256, 900, rnd, (r) => `rgba(0,0,0,${r() * 0.2})`, 6);
  const words = ["VICE", "LEONIDA", "NO GODS", "8QX", "RUN", "VC4L"];
  for (let i = 0; i < 4; i++) {
    const col = NEON[Math.floor(rnd() * NEON.length)];
    c.save();
    c.translate(rnd() * 420 + 40, rnd() * 180 + 60);
    c.rotate((rnd() - 0.5) * 0.5);
    c.font = `italic bold ${40 + rnd() * 50}px 'Arial Black', Impact, sans-serif`;
    c.textAlign = "center";
    c.globalAlpha = 0.5 + rnd() * 0.45;
    c.strokeStyle = "rgba(0,0,0,0.8)";
    c.lineWidth = 7;
    const w = words[Math.floor(rnd() * words.length)];
    c.strokeText(w, 0, 0);
    c.fillStyle = col;
    c.fillText(w, 0, 0);
    c.restore();
  }
  c.globalAlpha = 1;
  grain(c, 512, 256, 16);
  return finish(cv);
}

/* ------------------------------------------------------------------ */
/* signage atlas                                                       */
/* ------------------------------------------------------------------ */

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 8;
export const ATLAS_SLOTS = ATLAS_COLS * ATLAS_ROWS;

/**
 * Every shop sign in Leonida on one 1024px sheet.
 *
 * There are several hundred lit signs out there. As separate textures that is
 * several hundred materials and therefore several hundred draw calls; as one
 * atlas addressed by UV sub-rectangle it is one.
 */
function signAtlas() {
  const cw = 1024 / ATLAS_COLS;
  const ch = 1024 / ATLAS_ROWS;
  const { cv, c } = canvas(1024, 1024);
  const rnd = mulberry(521);
  c.fillStyle = "#05010a";
  c.fillRect(0, 0, 1024, 1024);

  for (let s = 0; s < ATLAS_SLOTS; s++) {
    const x = (s % ATLAS_COLS) * cw;
    const y = Math.floor(s / ATLAS_COLS) * ch;
    const text = SHOP_NAMES[s % SHOP_NAMES.length];
    const colour = NEON[s % NEON.length];

    c.save();
    c.beginPath();
    c.rect(x + 2, y + 2, cw - 4, ch - 4);
    c.clip();

    c.fillStyle = "#0a0410";
    c.fillRect(x, y, cw, ch);
    // tube outline round the plate
    c.strokeStyle = colour;
    c.globalAlpha = 0.5;
    c.lineWidth = 4;
    c.strokeRect(x + 10, y + 10, cw - 20, ch - 20);
    c.globalAlpha = 1;

    let size = 44;
    c.textAlign = "center";
    c.textBaseline = "middle";
    do {
      c.font = `bold ${size}px 'Arial Black', Impact, sans-serif`;
      if (c.measureText(text).width < cw - 42) break;
      size -= 3;
    } while (size > 14);

    c.shadowColor = colour;
    c.shadowBlur = 26;
    c.fillStyle = colour;
    c.fillText(text, x + cw / 2, y + ch / 2);
    c.fillText(text, x + cw / 2, y + ch / 2);
    c.shadowBlur = 0;
    c.globalAlpha = 0.6;
    c.fillStyle = "#ffffff";
    c.fillText(text, x + cw / 2, y + ch / 2);
    c.globalAlpha = 1;
    void rnd;
    c.restore();
  }
  return finish(cv, false);
}

/** UV sub-rectangle for atlas slot `n`, inset slightly to avoid bleed. */
export function atlasUv(n: number): [number, number, number, number] {
  const s = ((n % ATLAS_SLOTS) + ATLAS_SLOTS) % ATLAS_SLOTS;
  const cx = s % ATLAS_COLS;
  const cy = Math.floor(s / ATLAS_COLS);
  const w = 1 / ATLAS_COLS;
  const h = 1 / ATLAS_ROWS;
  const p = 0.002;
  // v is flipped: canvas row 0 is the top, texture v 0 is the bottom
  const v1 = 1 - cy * h - p;
  const v0 = 1 - (cy + 1) * h + p;
  return [cx * w + p, v0, (cx + 1) * w - p, v1];
}

/* ------------------------------------------------------------------ */
/* library                                                             */
/* ------------------------------------------------------------------ */

export type TextureLib = ReturnType<typeof buildTextures>;

/**
 * Builds every texture once and hands back a disposer. Facades come in three
 * variants per family so a street has variation without a per-building bitmap.
 */
export function buildTextures() {
  const all: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T) => {
    all.push(t);
    return t;
  };

  const facades = {} as Record<FacadeKind, THREE.Texture[]>;
  (Object.keys(facadeBuilders) as FacadeKind[]).forEach((k, ki) => {
    facades[k] = [0, 1, 2].map((v) => keep(facadeBuilders[k](101 + ki * 37 + v * 13)));
  });

  return {
    asphalt: keep(asphalt()),
    concrete: keep(concrete()),
    sand: keep(sand()),
    grass: keep(grass()),
    dirt: keep(dirt()),
    roof: keep(roof()),
    facades,
    storefronts: [0, 1, 2, 3].map((v) => keep(storefront(211 + v * 29))),
    serviceBases: [0, 1].map((v) => keep(serviceBase(307 + v * 31))),
    graffiti: [0, 1, 2].map((v) => keep(graffitiWall(401 + v * 17))),
    signAtlas: keep(signAtlas()),
    glow: keep(glowDisc()),
    keep,
    dispose() {
      for (const t of all) t.dispose();
    },
  };
}

export { SHOP_NAMES, NEON };
