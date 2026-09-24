/**
 * Procedural Leonida.
 *
 * Every "photo" in VICE OS is painted on a canvas at runtime — no stock art,
 * no copyrighted assets, nothing to load over the wire. Each scene is a small
 * composition of shared primitives (sky, sun, water, palms, skyline, grain)
 * driven by a seeded RNG so a given shot always looks the same.
 */

export type Palette = {
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  sunTop: string;
  sunBottom: string;
  ground: string;
  accent: string;
  haze: string;
};

export type SceneId =
  | "ocean-drive"
  | "gator-keys"
  | "downtown-vice"
  | "neon-motel"
  | "beach-patrol"
  | "causeway";

export type Scene = {
  id: SceneId;
  title: string;
  location: string;
  time: string;
  /** Flavour text shown under the shot in the camera roll. */
  note: string;
};

export const SCENES: Scene[] = [
  {
    id: "ocean-drive",
    title: "Ocean Drive, 7:41 PM",
    location: "VICE BEACH",
    time: "GOLDEN HOUR",
    note: "Shot from the passenger seat. Somebody's convertible.",
  },
  {
    id: "gator-keys",
    title: "Airboat Run",
    location: "LEONIDA KEYS",
    time: "MOONRISE",
    note: "Do not feed them. They remember faces.",
  },
  {
    id: "downtown-vice",
    title: "Downtown Skyline",
    location: "VICE CITY",
    time: "02:13",
    note: "Rooftop. The door was already open, officer.",
  },
  {
    id: "neon-motel",
    title: "Motel Flamingo",
    location: "ROUTE 41",
    time: "LATE",
    note: "Room 7. Cash only. No questions.",
  },
  {
    id: "beach-patrol",
    title: "Patrol Tower 4",
    location: "SOUTH STRAND",
    time: "11:02",
    note: "Nice and legal. For now.",
  },
  {
    id: "causeway",
    title: "The Causeway",
    location: "OUTBOUND",
    time: "03:55",
    note: "Taillights, palm trees, and a very full trunk.",
  },
];

const PALETTES: Record<SceneId, Palette> = {
  "ocean-drive": {
    skyTop: "#2b0b5e",
    skyMid: "#c0247e",
    skyBottom: "#ff9a3c",
    sunTop: "#fff0a8",
    sunBottom: "#ff2e97",
    ground: "#120631",
    accent: "#22e6ff",
    haze: "#ff6bb5",
  },
  "gator-keys": {
    skyTop: "#04121f",
    skyMid: "#0b3b4a",
    skyBottom: "#39a08a",
    sunTop: "#eafff4",
    sunBottom: "#7bf0c1",
    ground: "#03130f",
    accent: "#9dff3d",
    haze: "#4fd3a5",
  },
  "downtown-vice": {
    skyTop: "#05010f",
    skyMid: "#1b0740",
    skyBottom: "#5c1668",
    sunTop: "#ffffff",
    sunBottom: "#8a5bff",
    ground: "#060118",
    accent: "#ff2e97",
    haze: "#7b3bff",
  },
  "neon-motel": {
    skyTop: "#0a0326",
    skyMid: "#2a0a4e",
    skyBottom: "#6b1450",
    sunTop: "#fff5cf",
    sunBottom: "#ff7a2f",
    ground: "#0a0520",
    accent: "#ffb347",
    haze: "#ff4fa0",
  },
  "beach-patrol": {
    skyTop: "#0f7fd6",
    skyMid: "#63c7f2",
    skyBottom: "#cdf3ff",
    sunTop: "#ffffff",
    sunBottom: "#ffe9a8",
    ground: "#f0d9a8",
    accent: "#ff2e97",
    haze: "#ffffff",
  },
  causeway: {
    skyTop: "#08021c",
    skyMid: "#2d0a52",
    skyBottom: "#ff4d6d",
    sunTop: "#fff1b8",
    sunBottom: "#ff2e97",
    ground: "#0a0426",
    accent: "#22e6ff",
    haze: "#ff87c3",
  },
};

/* ------------------------------------------------------------------ */
/* rng                                                                 */
/* ------------------------------------------------------------------ */

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Rng = () => number;

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

function sky(ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette) {
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(0.55, p.skyMid);
  g.addColorStop(1, p.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function stars(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, n = 140) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = rng() * w;
    const y = rng() * h * 0.42;
    const r = rng() * 1.8 + 0.4;
    ctx.globalAlpha = 0.25 + rng() * 0.6;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The synthwave sun: a gradient disc sliced by horizontal bars. */
function sun(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  p: Palette,
  slice = true,
) {
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.6);
  glow.addColorStop(0, `${p.sunBottom}66`);
  glow.addColorStop(1, "#00000000");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  g.addColorStop(0, p.sunTop);
  g.addColorStop(0.5, p.sunBottom);
  g.addColorStop(1, p.sunBottom);
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  if (slice) {
    ctx.globalCompositeOperation = "destination-out";
    let y = cy + r * 0.06;
    let gap = 3;
    while (y < cy + r) {
      ctx.fillRect(cx - r, y, r * 2, gap);
      y += gap + Math.max(6, r * 0.09 - gap * 0.4);
      gap += 1.6;
    }
  }
  ctx.restore();
}

function water(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizon: number,
  p: Palette,
  rng: Rng,
) {
  const g = ctx.createLinearGradient(0, horizon, 0, h);
  g.addColorStop(0, p.haze);
  g.addColorStop(0.28, p.skyMid);
  g.addColorStop(1, p.ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon, w, h - horizon);

  // glitter path under the sun
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 260; i++) {
    const t = rng();
    const y = horizon + t * (h - horizon);
    const spread = 40 + t * w * 0.55;
    const x = w * 0.5 + (rng() - 0.5) * spread;
    ctx.globalAlpha = (1 - t) * 0.5 * rng();
    ctx.fillStyle = p.sunTop;
    ctx.fillRect(x, y, 10 + rng() * 60, 1.6 + rng() * 2.4);
  }
  ctx.restore();
}

/** Perspective grid, the synthwave floor. */
function grid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizon: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.55;
  const vpx = w / 2;
  for (let i = -14; i <= 14; i++) {
    ctx.beginPath();
    ctx.moveTo(vpx + i * (w / 10), h);
    ctx.lineTo(vpx + i * 12, horizon);
    ctx.stroke();
  }
  let y = horizon;
  let step = 2;
  while (y < h) {
    ctx.globalAlpha = 0.14 + (y - horizon) / (h - horizon) * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    y += step;
    step *= 1.32;
  }
  ctx.restore();
}

function palm(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  height: number,
  rng: Rng,
  color = "#000000",
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const lean = (rng() - 0.5) * height * 0.22;

  ctx.lineWidth = Math.max(4, height * 0.028);
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + lean * 0.4, baseY - height * 0.6, x + lean, baseY - height);
  ctx.stroke();

  const topX = x + lean;
  const topY = baseY - height;
  const fronds = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < fronds; i++) {
    const a = (Math.PI / (fronds - 1)) * i + Math.PI;
    const len = height * (0.28 + rng() * 0.2);
    const ex = topX + Math.cos(a) * len;
    const ey = topY + Math.sin(a) * len * 0.62 + len * 0.3;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(
      topX + Math.cos(a) * len * 0.6,
      topY + Math.sin(a) * len * 0.5 - len * 0.22,
      ex,
      ey,
    );
    ctx.lineWidth = Math.max(3, height * 0.022);
    ctx.stroke();
  }
  // coconuts
  ctx.beginPath();
  ctx.arc(topX + 4, topY + 8, height * 0.016, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function skyline(
  ctx: CanvasRenderingContext2D,
  w: number,
  baseY: number,
  maxH: number,
  rng: Rng,
  body: string,
  windowColor: string,
) {
  let x = -20;
  while (x < w + 20) {
    const bw = 40 + rng() * 110;
    const bh = maxH * (0.3 + rng() * 0.7);
    ctx.fillStyle = body;
    ctx.fillRect(x, baseY - bh, bw, bh);

    // antenna
    if (rng() > 0.75) {
      ctx.fillRect(x + bw / 2 - 2, baseY - bh - 26 - rng() * 30, 4, 30);
    }
    // windows
    const cols = Math.max(1, Math.floor(bw / 16));
    const rows = Math.max(1, Math.floor(bh / 20));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rng() > 0.62) {
          ctx.globalAlpha = 0.25 + rng() * 0.75;
          ctx.fillStyle = windowColor;
          ctx.fillRect(x + 6 + c * 16, baseY - bh + 8 + r * 20, 6, 9);
        }
      }
    }
    ctx.globalAlpha = 1;
    x += bw + 6 + rng() * 14;
  }
}

function clouds(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rng: Rng,
  color: string,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 9; i++) {
    const cy = h * (0.08 + rng() * 0.34);
    const cw = w * (0.2 + rng() * 0.45);
    const chh = 10 + rng() * 26;
    const cx = rng() * w;
    ctx.globalAlpha = 0.1 + rng() * 0.22;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw / 2, chh, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Glowing neon tube text. */
function neonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  font = "Arial Black, sans-serif",
) {
  ctx.save();
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.7;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.shadowBlur = size * 0.25;
  ctx.fillStyle = "#fff7fb";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.75) {
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.25,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.78,
  );
  g.addColorStop(0, "#00000000");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount = 16) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function chroma(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.05;
  ctx.drawImage(ctx.canvas, -2, 0, w, h);
  ctx.globalAlpha = 0.04;
  ctx.drawImage(ctx.canvas, 2, 1, w, h);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* scenes                                                              */
/* ------------------------------------------------------------------ */

const W = 1080;
const H = 1350;

function makeCanvas(w = W, h = H) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  return { c, ctx };
}

function drawScene(id: SceneId, ctx: CanvasRenderingContext2D, rng: Rng) {
  const p = PALETTES[id];
  const horizon = H * 0.58;

  switch (id) {
    case "ocean-drive": {
      sky(ctx, W, H, p);
      clouds(ctx, W, H, rng, "#ffd9ec");
      sun(ctx, W * 0.5, horizon - 60, 210, p);
      water(ctx, W, H, horizon, p, rng);
      // boardwalk strip
      ctx.fillStyle = "#0b0320";
      ctx.fillRect(0, H * 0.79, W, H * 0.21);
      ctx.fillStyle = `${p.accent}44`;
      ctx.fillRect(0, H * 0.79, W, 4);
      for (let i = 0; i < 7; i++) {
        palm(ctx, 60 + i * 170 + rng() * 40, H * 0.82, 300 + rng() * 240, rng, "#07021a");
      }
      neonText(ctx, "OCEAN DRIVE", W * 0.5, H * 0.905, 58, p.accent);
      break;
    }
    case "gator-keys": {
      sky(ctx, W, H, p);
      stars(ctx, W, H, rng, 190);
      sun(ctx, W * 0.72, H * 0.18, 78, p, false);
      water(ctx, W, H, horizon, p, rng);
      // mangrove silhouettes
      ctx.fillStyle = "#020c09";
      for (let i = 0; i < 40; i++) {
        const x = rng() * W;
        const y = horizon - rng() * 26;
        ctx.beginPath();
        ctx.ellipse(x, y, 30 + rng() * 70, 16 + rng() * 26, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // gator eyes + ripples
      const gx = W * 0.36;
      const gy = H * 0.8;
      ctx.fillStyle = "#050f0c";
      ctx.beginPath();
      ctx.ellipse(gx, gy, 230, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.accent;
      ctx.shadowColor = p.accent;
      ctx.shadowBlur = 26;
      ctx.beginPath();
      ctx.ellipse(gx - 46, gy - 12, 11, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(gx + 46, gy - 12, 11, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#ffffff22";
      for (let i = 1; i < 5; i++) {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(gx, gy, 230 + i * 70, 26 + i * 12, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      neonText(ctx, "LEONIDA KEYS", W * 0.5, H * 0.94, 46, p.accent);
      break;
    }
    case "downtown-vice": {
      sky(ctx, W, H, p);
      stars(ctx, W, H, rng, 220);
      sun(ctx, W * 0.5, H * 0.3, 160, p);
      skyline(ctx, W, H * 0.74, 420, rng, "#0a0224", "#ffd36b");
      skyline(ctx, W, H * 0.82, 250, rng, "#05011a", "#ff7ad9");
      grid(ctx, W, H, H * 0.82, p.accent);
      neonText(ctx, "VICE CITY", W * 0.5, H * 0.13, 92, p.accent);
      break;
    }
    case "neon-motel": {
      sky(ctx, W, H, p);
      stars(ctx, W, H, rng, 120);
      // motel block
      ctx.fillStyle = "#140833";
      ctx.fillRect(0, H * 0.5, W, H * 0.5);
      ctx.fillStyle = "#1d0b45";
      ctx.fillRect(0, H * 0.5, W, 120);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = rng() > 0.5 ? "#ffcf7a" : "#3a1a6b";
        ctx.fillRect(40 + i * 175, H * 0.52, 90, 80);
      }
      // sign pole
      ctx.fillStyle = "#0a0322";
      ctx.fillRect(W * 0.5 - 14, H * 0.28, 28, H * 0.34);
      // sign board
      ctx.save();
      ctx.shadowColor = p.haze;
      ctx.shadowBlur = 60;
      ctx.fillStyle = "#1b0740";
      ctx.fillRect(W * 0.22, H * 0.12, W * 0.56, H * 0.2);
      ctx.restore();
      ctx.strokeStyle = p.haze;
      ctx.lineWidth = 6;
      ctx.strokeRect(W * 0.22, H * 0.12, W * 0.56, H * 0.2);
      neonText(ctx, "FLAMINGO", W * 0.5, H * 0.185, 78, p.haze);
      neonText(ctx, "VACANCY", W * 0.5, H * 0.272, 46, p.accent);
      // wet asphalt reflection
      const g = ctx.createLinearGradient(0, H * 0.72, 0, H);
      g.addColorStop(0, "#0a0520");
      g.addColorStop(1, "#1a0a3c");
      ctx.fillStyle = g;
      ctx.fillRect(0, H * 0.72, W, H * 0.28);
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.filter = "blur(6px)";
      ctx.translate(0, H * 1.44);
      ctx.scale(1, -1);
      neonText(ctx, "FLAMINGO", W * 0.5, H * 0.185, 78, p.haze);
      ctx.restore();
      palm(ctx, 110, H * 0.78, 420, rng, "#07021a");
      palm(ctx, W - 120, H * 0.8, 380, rng, "#07021a");
      break;
    }
    case "beach-patrol": {
      sky(ctx, W, H, p);
      clouds(ctx, W, H, rng, "#ffffff");
      sun(ctx, W * 0.78, H * 0.16, 90, p, false);
      // sea
      const sea = ctx.createLinearGradient(0, H * 0.52, 0, H * 0.72);
      sea.addColorStop(0, "#1fa7d9");
      sea.addColorStop(1, "#7fe3e0");
      ctx.fillStyle = sea;
      ctx.fillRect(0, H * 0.52, W, H * 0.2);
      // foam
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 90; i++) {
        ctx.globalAlpha = 0.2 + rng() * 0.5;
        ctx.fillRect(rng() * W, H * (0.66 + rng() * 0.06), 20 + rng() * 60, 3);
      }
      ctx.globalAlpha = 1;
      // sand
      const sand = ctx.createLinearGradient(0, H * 0.72, 0, H);
      sand.addColorStop(0, "#f2dcac");
      sand.addColorStop(1, "#d9b878");
      ctx.fillStyle = sand;
      ctx.fillRect(0, H * 0.72, W, H * 0.28);
      // lifeguard tower
      ctx.fillStyle = "#ff2e97";
      ctx.fillRect(W * 0.58, H * 0.52, 240, 150);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(W * 0.6, H * 0.55, 200, 60);
      ctx.fillStyle = "#3a2a10";
      ctx.fillRect(W * 0.6, H * 0.67, 16, 130);
      ctx.fillRect(W * 0.58 + 210, H * 0.67, 16, 130);
      palm(ctx, 150, H * 0.8, 420, rng, "#2a5b2d");
      palm(ctx, 300, H * 0.84, 340, rng, "#2a5b2d");
      break;
    }
    case "causeway": {
      sky(ctx, W, H, p);
      stars(ctx, W, H, rng, 160);
      sun(ctx, W * 0.5, H * 0.46, 190, p);
      // road
      ctx.fillStyle = p.ground;
      ctx.beginPath();
      ctx.moveTo(W * 0.5 - 30, H * 0.52);
      ctx.lineTo(W * 0.5 + 30, H * 0.52);
      ctx.lineTo(W * 1.25, H);
      ctx.lineTo(-W * 0.25, H);
      ctx.closePath();
      ctx.fill();
      // lane dashes
      ctx.fillStyle = "#ffe9a8";
      let y = H * 0.54;
      let dh = 3;
      while (y < H) {
        const t = (y - H * 0.52) / (H * 0.48);
        const wdt = 4 + t * 26;
        ctx.globalAlpha = 0.35 + t * 0.6;
        ctx.fillRect(W * 0.5 - wdt / 2, y, wdt, dh);
        y += dh * 3.2;
        dh *= 1.22;
      }
      ctx.globalAlpha = 1;
      // taillights
      for (let i = 0; i < 5; i++) {
        const t = rng();
        const ly = H * 0.56 + t * H * 0.3;
        const s = 4 + t * 16;
        ctx.save();
        ctx.shadowColor = "#ff3b30";
        ctx.shadowBlur = 30;
        ctx.fillStyle = "#ff3b30";
        ctx.fillRect(W * 0.5 - 60 - t * 160, ly, s, s * 0.6);
        ctx.fillRect(W * 0.5 + 40 + t * 160, ly, s, s * 0.6);
        ctx.restore();
      }
      // guard rails / poles
      for (let i = 0; i < 9; i++) {
        const t = i / 9;
        const py = H * 0.53 + Math.pow(t, 1.8) * H * 0.47;
        const ph = 40 + Math.pow(t, 1.8) * 420;
        ctx.fillStyle = "#07021a";
        ctx.fillRect(W * 0.5 - 90 - Math.pow(t, 1.8) * W * 0.62, py - ph, 10 + t * 18, ph);
        ctx.fillRect(W * 0.5 + 80 + Math.pow(t, 1.8) * W * 0.62, py - ph, 10 + t * 18, ph);
      }
      break;
    }
  }

  chroma(ctx, W, H);
  vignette(ctx, W, H, 0.7);
  grain(ctx, W, H, rng, 18);
}

/** Render one scene to a JPEG data URL. */
export function renderScene(id: SceneId, seed = 1): string {
  const { c, ctx } = makeCanvas();
  drawScene(id, ctx, mulberry(hash(id) + seed * 7919));
  return c.toDataURL("image/jpeg", 0.9);
}

/* ------------------------------------------------------------------ */
/* suspects                                                            */
/* ------------------------------------------------------------------ */

export type SuspectId = "suspect-a" | "suspect-b" | "suspect-c";

export const SUSPECTS: { id: SuspectId; label: string; hue: number }[] = [
  { id: "suspect-a", label: "SUBJECT 01", hue: 320 },
  { id: "suspect-b", label: "SUBJECT 02", hue: 190 },
  { id: "suspect-c", label: "SUBJECT 03", hue: 40 },
];

/**
 * A booking photo: height chart, harsh flash, faceless silhouette.
 * Deliberately anonymous — the whole point is that the player paints a face
 * on it in the editor.
 */
export function renderMugshot(id: SuspectId, seed = 3): string {
  const size = 900;
  const { c, ctx } = makeCanvas(size, size);
  const rng = mulberry(hash(id) + seed * 104729);
  const hue = SUSPECTS.find((s) => s.id === id)?.hue ?? 320;

  // wall
  const wall = ctx.createLinearGradient(0, 0, 0, size);
  wall.addColorStop(0, `hsl(${hue} 30% 22%)`);
  wall.addColorStop(1, `hsl(${hue} 24% 10%)`);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, size, size);

  // height chart
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "600 20px monospace";
  for (let ft = 4; ft <= 7; ft++) {
    for (let inch = 0; inch < 12; inch += 2) {
      const total = ft * 12 + inch;
      const y = size - ((total - 40) / 48) * size;
      if (y < 0 || y > size) continue;
      const major = inch === 0;
      ctx.lineWidth = major ? 3 : 1.4;
      ctx.beginPath();
      ctx.moveTo(size - (major ? 92 : 58), y);
      ctx.lineTo(size - 16, y);
      ctx.stroke();
      if (major) ctx.fillText(`${ft}'`, size - 132, y + 7);
    }
  }

  // flash pool
  const flash = ctx.createRadialGradient(size / 2, size * 0.38, 40, size / 2, size * 0.42, size * 0.7);
  flash.addColorStop(0, "rgba(255,255,255,0.22)");
  flash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = flash;
  ctx.fillRect(0, 0, size, size);

  // silhouette
  ctx.save();
  ctx.fillStyle = "#08030f";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  // shoulders
  ctx.beginPath();
  ctx.moveTo(size * 0.12, size);
  ctx.quadraticCurveTo(size * 0.3, size * 0.66, size * 0.5, size * 0.655);
  ctx.quadraticCurveTo(size * 0.7, size * 0.66, size * 0.88, size);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.44, size * 0.155, size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // hair mass, varies by suspect
  ctx.beginPath();
  if (id === "suspect-a") {
    ctx.ellipse(size * 0.5, size * 0.33, size * 0.185, size * 0.135, 0, 0, Math.PI * 2);
  } else if (id === "suspect-b") {
    ctx.ellipse(size * 0.5, size * 0.3, size * 0.16, size * 0.1, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(size * 0.5, size * 0.355, size * 0.2, size * 0.17, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();

  // rim light
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = `hsl(${hue} 100% 62% / 0.75)`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.44, size * 0.155, size * 0.2, 0, Math.PI * 0.75, Math.PI * 1.45);
  ctx.stroke();
  ctx.restore();

  // placard
  ctx.fillStyle = "#e9e2d4";
  ctx.fillRect(size * 0.22, size * 0.84, size * 0.56, size * 0.1);
  ctx.fillStyle = "#14101a";
  ctx.font = "700 30px monospace";
  ctx.textAlign = "center";
  ctx.fillText("LEONIDA S.O. — BOOKING", size * 0.5, size * 0.878);
  ctx.font = "700 24px monospace";
  ctx.fillText(
    `CASE ${Math.floor(rng() * 900000 + 100000)}`,
    size * 0.5,
    size * 0.916,
  );

  grain(ctx, size, size, rng, 22);
  return c.toDataURL("image/jpeg", 0.92);
}

/* ------------------------------------------------------------------ */
/* forensics — how much did the player actually change?                */
/* ------------------------------------------------------------------ */

export type Forensics = {
  /** % of sampled pixels that moved meaningfully. */
  altered: number;
  /** Mean per-channel delta, 0-255. */
  intensity: number;
  /** Warm/cool shift introduced by the edit, -100..100. */
  temperature: number;
  /** Did the frame get cropped or resized? */
  reframed: boolean;
  /** Rough count of near-opaque added regions (stickers, text, shapes). */
  coverage: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/**
 * Diff the original shot against what came out of the image editor.
 * Both are normalised to a 128x128 thumbnail first so crops and resizes
 * still compare cleanly.
 */
export async function analyzeEdit(
  originalSrc: string,
  editedSrc: string,
): Promise<Forensics> {
  const N = 128;
  const [a, b] = await Promise.all([loadImage(originalSrc), loadImage(editedSrc)]);

  const read = (img: HTMLImageElement) => {
    const { ctx } = makeCanvas(N, N);
    ctx.drawImage(img, 0, 0, N, N);
    return ctx.getImageData(0, 0, N, N).data;
  };

  const da = read(a);
  const db = read(b);

  let changed = 0;
  let sum = 0;
  let warmA = 0;
  let warmB = 0;
  let flat = 0;

  for (let i = 0; i < da.length; i += 4) {
    const d =
      Math.abs(da[i] - db[i]) +
      Math.abs(da[i + 1] - db[i + 1]) +
      Math.abs(da[i + 2] - db[i + 2]);
    sum += d / 3;
    if (d > 36) changed++;
    warmA += da[i] - da[i + 2];
    warmB += db[i] - db[i + 2];
    // A pixel that moved this far didn't get graded — it got painted over.
    if (d > 150) flat++;
  }

  const px = da.length / 4;
  const reframed =
    Math.abs(a.naturalWidth / a.naturalHeight - b.naturalWidth / b.naturalHeight) >
      0.02 || Math.abs(a.naturalWidth - b.naturalWidth) > 8;

  return {
    altered: Math.round((changed / px) * 100),
    intensity: Math.round(sum / px),
    temperature: Math.round(((warmB - warmA) / px / 255) * 100),
    reframed,
    coverage: Math.round((flat / px) * 100),
  };
}
