/**
 * Canvas compositors.
 *
 * The image editor hands back a flat data URL; these functions drop that
 * result into an in-world document — a sheriff's bulletin, a state ID — so
 * the thing the player edited becomes an artifact they can download.
 */

import { money } from "./copy";

/** next/font generates hashed family names; grab the real one off :root. */
function fontVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v ? `${v}, ${fallback}` : fallback;
}

export async function fontsReady() {
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  }
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

function ctxOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  return { c, ctx };
}

/** cover-fit an image into a rect */
function cover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function halftone(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 0.08) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < h; y += 6) {
    for (let x = 0; x < w; x += 6) {
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
  ctx.restore();
}

function barcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: string,
) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  ctx.fillStyle = "#ffffff";
  let cx = x;
  while (cx < x + w) {
    s = (s * 1103515245 + 12345) >>> 0;
    const bw = 2 + (s % 7);
    if (s % 3) ctx.fillRect(cx, y, bw, h);
    cx += bw + 2 + (s % 4);
  }
}

/* ------------------------------------------------------------------ */
/* WANTED bulletin                                                     */
/* ------------------------------------------------------------------ */

export type PosterData = {
  photo: string;
  alias: string;
  bounty: number;
  stars: number;
  crimes: string[];
  lastSeen: string;
  caseNo: string;
};

export async function composeWantedPoster(d: PosterData): Promise<string> {
  await fontsReady();
  const W = 1000;
  const H = 1560;
  const { c, ctx } = ctxOf(W, H);
  const display = fontVar("--font-display", "Arial Black, sans-serif");
  const mono = fontVar("--font-mono", "monospace");

  // paper
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#14002c");
  bg.addColorStop(0.5, "#0a0119");
  bg.addColorStop(1, "#2a0430");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  halftone(ctx, W, H, 0.06);

  // glow bars
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const beam = ctx.createLinearGradient(0, 0, 0, H);
  beam.addColorStop(0, "#ff2e9733");
  beam.addColorStop(0.5, "#00000000");
  beam.addColorStop(1, "#22e6ff22");
  ctx.fillStyle = beam;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // header rule
  ctx.fillStyle = "#22e6ff";
  ctx.fillRect(48, 54, W - 96, 5);
  ctx.font = `22px ${mono}`;
  ctx.fillStyle = "#9df0ff";
  ctx.textAlign = "left";
  ctx.fillText("LEONIDA STATE SHERIFF'S OFFICE", 48, 100);
  ctx.textAlign = "right";
  ctx.fillText(`CASE ${d.caseNo}`, W - 48, 100);

  // WANTED
  ctx.textAlign = "center";
  ctx.save();
  ctx.font = `190px ${display}`;
  ctx.shadowColor = "#ff2e97";
  ctx.shadowBlur = 50;
  ctx.fillStyle = "#ff2e97";
  ctx.fillText("WANTED", W / 2, 300);
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#fff0f7";
  ctx.fillText("WANTED", W / 2, 300);
  ctx.restore();

  ctx.font = `26px ${mono}`;
  ctx.fillStyle = "#ffd36b";
  ctx.fillText("DEAD LINE  •  ALIVE PREFERRED  •  ARMED & PHOTOGENIC", W / 2, 344);

  // photo plate
  const px = 130;
  const py = 384;
  const pw = W - 260;
  const ph = 620;
  ctx.save();
  ctx.shadowColor = "#22e6ff88";
  ctx.shadowBlur = 40;
  roundRect(ctx, px - 10, py - 10, pw + 20, ph + 20, 10);
  ctx.fillStyle = "#050110";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, px, py, pw, ph, 4);
  ctx.clip();
  try {
    const img = await load(d.photo);
    cover(ctx, img, px, py, pw, ph);
  } catch {
    ctx.fillStyle = "#1a0836";
    ctx.fillRect(px, py, pw, ph);
  }
  // duotone wash so any photo reads as a bulletin
  ctx.globalCompositeOperation = "soft-light";
  const duo = ctx.createLinearGradient(px, py, px + pw, py + ph);
  duo.addColorStop(0, "#ff2e97");
  duo.addColorStop(1, "#22e6ff");
  ctx.fillStyle = duo;
  ctx.fillRect(px, py, pw, ph);
  ctx.globalCompositeOperation = "source-over";
  // scanlines
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000";
  for (let y = py; y < py + ph; y += 4) ctx.fillRect(px, y, pw, 1.5);
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.strokeStyle = "#ffffff33";
  ctx.lineWidth = 2;
  roundRect(ctx, px, py, pw, ph, 4);
  ctx.stroke();

  // corner ticks
  ctx.strokeStyle = "#22e6ff";
  ctx.lineWidth = 4;
  const t = 34;
  [
    [px, py, 1, 1],
    [px + pw, py, -1, 1],
    [px, py + ph, 1, -1],
    [px + pw, py + ph, -1, -1],
  ].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + t * sx, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + t * sy);
    ctx.stroke();
  });

  // alias
  ctx.textAlign = "center";
  ctx.font = `76px ${display}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(d.alias.toUpperCase(), W / 2, py + ph + 92);

  // bounty
  ctx.font = `28px ${mono}`;
  ctx.fillStyle = "#9df0ff";
  ctx.fillText("REWARD FOR INFORMATION LEADING TO ARREST", W / 2, py + ph + 138);
  ctx.save();
  ctx.font = `104px ${display}`;
  ctx.shadowColor = "#9dff3d";
  ctx.shadowBlur = 34;
  ctx.fillStyle = "#9dff3d";
  ctx.fillText(money(d.bounty), W / 2, py + ph + 228);
  ctx.restore();

  // stars
  const sy2 = py + ph + 276;
  const sw = 44;
  const total = 5;
  for (let i = 0; i < total; i++) {
    const sx = W / 2 - ((total - 1) * sw) / 2 + i * sw;
    drawStar(ctx, sx, sy2, 17, i < d.stars ? "#ffd36b" : "#ffffff22");
  }

  // crimes
  ctx.textAlign = "left";
  ctx.font = `20px ${mono}`;
  ctx.fillStyle = "#9df0ff";
  ctx.fillText("WANTED IN CONNECTION WITH", 130, 1330);
  ctx.font = `22px ${mono}`;
  d.crimes.slice(0, 4).forEach((cr, i) => {
    const y = 1372 + i * 32;
    ctx.fillStyle = "#ff8fc7";
    ctx.fillText("▸", 130, y);
    ctx.fillStyle = "#e9dcff";
    ctx.fillText(cr.slice(0, 44), 160, y);
  });

  // footer
  ctx.fillStyle = "#ffffff18";
  ctx.fillRect(48, 1506, W - 96, 2);
  ctx.font = `18px ${mono}`;
  ctx.fillStyle = "#8f7fb0";
  ctx.fillText(`LAST SEEN: ${d.lastSeen}`, 48, 1540);
  barcode(ctx, W - 330, 1524, 282, 20, d.caseNo + d.alias);

  return c.toDataURL("image/png");
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  if (fill !== "#ffffff22") {
    ctx.shadowColor = fill;
    ctx.shadowBlur = 18;
  }
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* LEONIDA state ID                                                    */
/* ------------------------------------------------------------------ */

export type LicenseData = {
  photo: string;
  name: string;
  dob: string;
  address: string;
  licenseNo: string;
  classLetter: string;
  restrictions: string;
  expires: string;
};

export async function composeLicense(d: LicenseData): Promise<string> {
  await fontsReady();
  const W = 1300;
  const H = 820;
  const { c, ctx } = ctxOf(W, H);
  const display = fontVar("--font-display", "Arial Black, sans-serif");
  const mono = fontVar("--font-mono", "monospace");

  roundRect(ctx, 0, 0, W, H, 44);
  ctx.clip();

  // card base
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, "#f6f0ff");
  base.addColorStop(0.45, "#dff6ff");
  base.addColorStop(1, "#ffe6f4");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // guilloche waves
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  for (let i = 0; i < 46; i++) {
    ctx.strokeStyle = i % 2 ? "#ff2e9755" : "#22a7ff55";
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y =
        H * 0.5 +
        Math.sin((x / W) * Math.PI * 4 + i * 0.32) * (60 + i * 5) +
        Math.cos((x / W) * Math.PI * 7 - i * 0.2) * 22;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // header band
  const band = ctx.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, "#1b0740");
  band.addColorStop(0.6, "#7a1b6e");
  band.addColorStop(1, "#ff2e97");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, 132);
  ctx.font = `62px ${display}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText("LEONIDA", 44, 92);
  ctx.font = `26px ${mono}`;
  ctx.fillStyle = "#ffd9ee";
  ctx.fillText("DRIVER LICENSE", 372, 88);
  ctx.textAlign = "right";
  ctx.font = `24px ${mono}`;
  ctx.fillStyle = "#c9f4ff";
  ctx.fillText("STATE OF LEONIDA · DEPT. OF MOTOR VEHICLES", W - 44, 88);

  // portrait
  const px = 52;
  const py = 176;
  const pw = 350;
  const ph = 460;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 14);
  ctx.fillStyle = "#1a0836";
  ctx.fill();
  ctx.clip();
  try {
    const img = await load(d.photo);
    cover(ctx, img, px, py, pw, ph);
  } catch {
    /* leave the plate empty */
  }
  ctx.restore();
  ctx.strokeStyle = "#1b0740";
  ctx.lineWidth = 4;
  roundRect(ctx, px, py, pw, ph, 14);
  ctx.stroke();

  // ghost portrait
  ctx.save();
  ctx.globalAlpha = 0.28;
  roundRect(ctx, W - 250, 500, 180, 236, 10);
  ctx.clip();
  try {
    const img = await load(d.photo);
    cover(ctx, img, W - 250, 500, 180, 236);
  } catch {
    /* ignore */
  }
  ctx.restore();

  // fields
  const fx = 452;
  let fy = 214;
  const field = (label: string, value: string, size = 38) => {
    ctx.textAlign = "left";
    ctx.font = `20px ${mono}`;
    ctx.fillStyle = "#7a5b96";
    ctx.fillText(label, fx, fy);
    ctx.font = `${size}px ${display}`;
    ctx.fillStyle = "#170a2e";
    ctx.fillText(value, fx, fy + 42);
    fy += 92;
  };

  field("1 NAME", d.name.toUpperCase().slice(0, 22), 44);
  field("3 DOB", d.dob);
  field("8 ADDRESS", d.address.toUpperCase().slice(0, 26), 30);

  ctx.font = `20px ${mono}`;
  ctx.fillStyle = "#7a5b96";
  ctx.fillText("4d DLN", fx, fy);
  ctx.font = `36px ${mono}`;
  ctx.fillStyle = "#170a2e";
  ctx.fillText(d.licenseNo, fx, fy + 40);

  ctx.font = `20px ${mono}`;
  ctx.fillStyle = "#7a5b96";
  ctx.fillText("9 CLASS", W - 300, 214);
  ctx.font = `44px ${display}`;
  ctx.fillStyle = "#170a2e";
  ctx.fillText(d.classLetter, W - 300, 258);

  ctx.font = `20px ${mono}`;
  ctx.fillStyle = "#7a5b96";
  ctx.fillText("12 REST", W - 300, 312);
  ctx.font = `22px ${mono}`;
  ctx.fillStyle = "#170a2e";
  ctx.fillText(d.restrictions.slice(0, 16), W - 300, 344);

  ctx.font = `20px ${mono}`;
  ctx.fillStyle = "#7a5b96";
  ctx.fillText("4b EXP", W - 300, 398);
  ctx.font = `28px ${mono}`;
  ctx.fillStyle = "#b3005e";
  ctx.fillText(d.expires, W - 300, 432);

  // signature
  ctx.save();
  ctx.strokeStyle = "#170a2e";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  let sx = px + 10;
  const sy = 700;
  ctx.moveTo(sx, sy);
  let seed = 0;
  for (let i = 0; i < d.name.length; i++) seed += d.name.charCodeAt(i);
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    sx += 12;
    ctx.quadraticCurveTo(
      sx - 6,
      sy - 30 * Math.sin(seed * 0.7 + i * 1.7) * (1 - t * 0.4),
      sx,
      sy + 8 * Math.cos(seed + i),
    );
  }
  ctx.stroke();
  ctx.restore();
  ctx.font = `18px ${mono}`;
  ctx.fillStyle = "#7a5b96";
  ctx.fillText("SIGNATURE", px + 10, 744);

  // holographic sheen
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.35;
  const holo = ctx.createLinearGradient(0, H, W, 0);
  holo.addColorStop(0, "#ff2e9700");
  holo.addColorStop(0.35, "#22e6ff66");
  holo.addColorStop(0.5, "#ffffff88");
  holo.addColorStop(0.65, "#ff2e9766");
  holo.addColorStop(1, "#9dff3d00");
  ctx.fillStyle = holo;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // palm watermark
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.translate(700, 706);
  ctx.strokeStyle = "#1b0740";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, 90);
  ctx.quadraticCurveTo(10, 20, 4, -60);
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (Math.PI / 6) * i;
    ctx.beginPath();
    ctx.moveTo(4, -60);
    ctx.quadraticCurveTo(
      4 + Math.cos(a) * 46,
      -60 + Math.sin(a) * 30,
      4 + Math.cos(a) * 82,
      -60 + Math.sin(a) * 52 + 26,
    );
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#1b0740";
  ctx.fillRect(0, H - 14, W, 14);

  return c.toDataURL("image/png");
}

export function download(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
