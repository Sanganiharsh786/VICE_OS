/**
 * THE SCRUB REEL.
 *
 * The forensic panel already decodes the editor's working canvas every 1.4s to
 * answer "how much of this is still identifiable". Those samples are kept
 * (`useLiveForensics`), which means the lab has, for free, a film of the edit —
 * not of the brush strokes, but of the *score falling*.
 *
 * This module turns that film into a 1280×720 video, rendered frame by frame
 * onto a canvas and captured through `MediaRecorder`. MP4 where the browser
 * will write one, WebM where it won't. Nothing is uploaded; the file is
 * assembled in the tab and handed to the download bar.
 */

import { fontVar, fontsReady, load } from "./compose";
import type { ReelFrame } from "@/components/forensic/useLiveForensics";

const W = 1280;
const H = 720;
const FPS = 30;

export type ReelMeta = {
  alias: string;
  /** The frame's in-world title, e.g. "OCEAN DRIVE, 19:42". */
  title: string;
  location: string;
  /** Final scrub rating from the authoritative scan, 0-100. */
  scrub: number;
  /** Final heat the publish would cost. */
  heat: number;
  /** How many identifiable subjects the lens caught. */
  subjects: number;
  /** The capture, as the lens took it. */
  before: string;
  /** The export the scan actually read. */
  after: string;
};

const PINK = "#ff2e97";
const CYAN = "#22e6ff";
const LIME = "#9dff3d";
const RED = "#ff3b30";

/** Identifiability → the colour the HUD uses for it everywhere else. */
function tint(identifiability: number) {
  return identifiability > 60 ? RED : identifiability > 25 ? "#ffb347" : LIME;
}

/** The first container the browser admits to being able to write. */
function pickMime(): { mime: string; ext: string } | null {
  const candidates: [string, string][] = [
    ["video/mp4;codecs=avc1.42E01E", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm;codecs=vp8", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ paint */

function backdrop(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#07030d";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.1, H);
  g.addColorStop(0, "rgba(255,46,151,0.16)");
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Film grain and scanlines, so the reel looks shot rather than exported. */
function grade(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#000";
  for (let y = (t * 60) % 4; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.restore();

  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, "transparent");
  v.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

/** Draws an image contained inside a box, centred, without distorting it. */
function contain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const k = Math.min(w / img.width, h / img.height);
  const dw = img.width * k;
  const dh = img.height * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  mono: string,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `${size}px ${mono}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

/* -------------------------------------------------------------- the shots */

type Shot = { ms: number; draw: (k: number, t: number) => void };

function buildStoryboard(
  ctx: CanvasRenderingContext2D,
  frames: { img: HTMLImageElement; identifiability: number }[],
  before: HTMLImageElement,
  after: HTMLImageElement,
  meta: ReelMeta,
): Shot[] {
  const display = fontVar("--font-display", "Arial Black, sans-serif");
  const mono = fontVar("--font-mono", "monospace");
  const shots: Shot[] = [];

  /* 01 — title card */
  shots.push({
    ms: 1700,
    draw: (k, t) => {
      backdrop(ctx);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = Math.min(1, k * 4);
      ctx.font = `92px ${display}`;
      ctx.shadowColor = PINK;
      ctx.shadowBlur = 40;
      ctx.fillStyle = PINK;
      ctx.fillText("SCRUB REEL", W / 2, H / 2 - 40);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      label(ctx, meta.title.toUpperCase(), W / 2, H / 2 + 30, 26, "#ffffffcc", mono, "center");
      label(
        ctx,
        meta.subjects > 0
          ? `${meta.location.toUpperCase()}  ·  ${meta.subjects} IDENTIFIABLE ${
              meta.subjects === 1 ? "SUBJECT" : "SUBJECTS"
            }`
          : `${meta.location.toUpperCase()}  ·  NO RECORDED SUBJECTS`,
        W / 2,
        H / 2 + 70,
        20,
        "#ffffff66",
        mono,
        "center",
      );
      label(ctx, `SHOT BY @${meta.alias.toUpperCase()}`, W / 2, H - 70, 18, CYAN, mono, "center");
      grade(ctx, t);
    },
  });

  /* 02 — the edit, frame by frame, with the meter draining */
  const per = Math.max(150, Math.min(460, 6200 / Math.max(1, frames.length)));
  frames.forEach((f, i) => {
    shots.push({
      ms: per,
      draw: (_k, t) => {
        backdrop(ctx);
        const box = contain(ctx, f.img, 90, 70, W - 180, H - 230);

        // bracket corners, the same language the forensic HUD uses
        ctx.strokeStyle = "#ffffff22";
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12);

        const c = tint(f.identifiability);
        label(
          ctx,
          meta.subjects > 0 ? "IDENTIFIABILITY" : "ORIGINAL FRAME LEFT",
          90,
          H - 104,
          18,
          "#ffffff55",
          mono,
        );
        ctx.font = `64px ${display}`;
        ctx.fillStyle = c;
        ctx.textAlign = "left";
        ctx.fillText(`${f.identifiability}%`, 90, H - 44);

        // meter
        const mx = 330;
        const mw = W - 420;
        ctx.fillStyle = "#ffffff14";
        ctx.fillRect(mx, H - 72, mw, 10);
        ctx.fillStyle = c;
        ctx.fillRect(mx, H - 72, (mw * f.identifiability) / 100, 10);

        label(
          ctx,
          `STEP ${String(i + 1).padStart(2, "0")} / ${String(frames.length).padStart(2, "0")}`,
          W - 90,
          H - 104,
          18,
          "#ffffff55",
          mono,
          "right",
        );
        label(ctx, "IMAGE LAB · LIVE FORENSIC SAMPLE", 90, 48, 17, PINK, mono);
        grade(ctx, t);
      },
    });
  });

  /* 03 — the verdict: what the lens saw against what survived */
  shots.push({
    ms: 3000,
    draw: (k, t) => {
      backdrop(ctx);
      const half = (W - 200) / 2;
      const b = contain(ctx, before, 70, 90, half, H - 300);
      const wipe = Math.min(1, k * 2.2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(W / 2 + 30, 90, half * wipe, H - 300);
      ctx.clip();
      contain(ctx, after, W / 2 + 30, 90, half, H - 300);
      ctx.restore();

      label(ctx, "WHAT THE LENS SAW", b.x, 68, 18, "#ffffff66", mono);
      label(ctx, "WHAT SURVIVED THE EDIT", W / 2 + 30, 68, 18, LIME, mono);

      const good = meta.scrub >= 66;
      ctx.textAlign = "center";
      ctx.font = `74px ${display}`;
      ctx.fillStyle = good ? LIME : RED;
      ctx.shadowColor = good ? LIME : RED;
      ctx.shadowBlur = 26;
      ctx.fillText(`${Math.round(meta.scrub)}% SCRUBBED`, W / 2, H - 116);
      ctx.shadowBlur = 0;
      label(
        ctx,
        `FINAL HEAT ${meta.heat >= 0 ? "+" : ""}${meta.heat}`,
        W / 2,
        H - 72,
        24,
        meta.heat > 0 ? RED : LIME,
        mono,
        "center",
      );
      grade(ctx, t);
    },
  });

  /* 04 — the stamp */
  shots.push({
    ms: 1400,
    draw: (k, t) => {
      backdrop(ctx);
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, 1 - Math.max(0, k - 0.75) * 4);
      ctx.font = `64px ${display}`;
      ctx.fillStyle = "#fff";
      ctx.fillText("VICE OS", W / 2, H / 2 - 10);
      label(ctx, "IMAGE LAB — UNLAYER ENGINE", W / 2, H / 2 + 40, 22, CYAN, mono, "center");
      label(
        ctx,
        "EVERY NUMBER IN THIS REEL WAS MEASURED OFF YOUR CANVAS",
        W / 2,
        H / 2 + 86,
        16,
        "#ffffff44",
        mono,
        "center",
      );
      ctx.globalAlpha = 1;
      grade(ctx, t);
    },
  });

  return shots;
}

/* --------------------------------------------------------------- recorder */

export class ReelUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelUnavailable";
  }
}

/**
 * Films the reel and returns the finished file.
 *
 * Throws `ReelUnavailable` when the browser has no `MediaRecorder` or no
 * container it will write — callers fall back to the flipbook, which is the
 * same frames without the encode.
 */
export async function recordScrubReel(
  frames: ReelFrame[],
  meta: ReelMeta,
): Promise<{ blob: Blob; ext: string }> {
  const container = pickMime();
  if (!container || typeof MediaRecorder === "undefined") {
    throw new ReelUnavailable("This browser can't record video.");
  }

  await fontsReady();
  const [decoded, before, after] = await Promise.all([
    Promise.all(
      frames.map(async (f) => ({
        img: await load(f.thumb),
        identifiability: f.identifiability,
      })),
    ),
    load(meta.before),
    load(meta.after),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ReelUnavailable("Canvas unavailable.");
  ctx.imageSmoothingQuality = "high";

  const shots = buildStoryboard(ctx, decoded, before, after, meta);
  const total = shots.reduce((a, s) => a + s.ms, 0);

  // Paint frame zero before the recorder starts, so the file never opens on
  // an empty canvas.
  shots[0].draw(0, 0);

  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType: container.mime,
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: container.mime }));
    recorder.onerror = () => reject(new ReelUnavailable("The recorder failed."));
  });

  recorder.start();
  const started = performance.now();

  await new Promise<void>((resolve) => {
    const step = () => {
      const elapsed = performance.now() - started;
      if (elapsed >= total) return resolve();

      // Find the shot this moment belongs to and hand it its own 0-1 progress.
      let acc = 0;
      for (const shot of shots) {
        if (elapsed < acc + shot.ms) {
          shot.draw((elapsed - acc) / shot.ms, elapsed / 1000);
          break;
        }
        acc += shot.ms;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  return { blob: await done, ext: container.ext };
}

/** Hands a finished reel to the browser's download bar. */
export function downloadReel(blob: Blob, ext: string, alias: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vice-os-scrub-reel-${alias.toLowerCase().replace(/\s+/g, "-")}.${ext}`;
  a.click();
  // Revoke on the next turn of the loop — Safari needs the element to have
  // actually navigated before the object URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
