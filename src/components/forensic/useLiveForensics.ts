"use client";

import { useEffect, useRef, useState } from "react";
import { concealmentOf, noiseFloor } from "@/lib/forensics";
import type { Evidence } from "@/lib/evidence";

/** Cheaper than the authoritative pass — this one runs while you're working. */
const N = 96;

/** Long edge of the frames kept for the scrub reel. */
const THUMB = 384;

/**
 * How many reel frames to keep. Past this, the middle is thinned rather than
 * the head or tail dropped, so the reel always spans the whole session — the
 * bare capture at one end, the scrubbed export at the other.
 */
const REEL_CAP = 30;

/** One entry in the edit history the report plays back. */
export type TimelineStep = {
  label: string;
  /** Mean identifiability across every subject at this point, 0-100. */
  identifiability: number;
};

/**
 * One frame of the SCRUB REEL: the canvas as it stood at that moment, and
 * what the forensic maths read off it.
 *
 * The rival mechanic in this genre films *what you drew*. This films what the
 * scan could still see while you drew it, which is the only number the game
 * actually cares about.
 */
export type ReelFrame = {
  /** A small JPEG of the working canvas. */
  thumb: string;
  /** 0-100 identifiability left across every boxed subject. */
  identifiability: number;
  /** ms since the lab opened. */
  at: number;
};

export type LiveReading = {
  /** 0-100 per subject, same index order as `evidence`. */
  concealment: number[];
  /** Mean identifiability left across every subject, 0-100. */
  identifiability: number;
  /** True once a reading has actually been taken. */
  live: boolean;
  /** How the frame got from 100% identifiable to wherever it is now. */
  timeline: TimelineStep[];
  /** Every settled canvas, in order, for the report's reel. */
  reel: ReelFrame[];
};

type Sample = { pixels: Uint8ClampedArray; thumb: string };

/**
 * Decodes once and produces both readings we need from it: the 96×96 buffer
 * the region maths runs on, and a JPEG small enough to keep thirty of.
 */
function sample(src: string, withThumb: boolean): Promise<Sample> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = N;
      c.height = N;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("canvas unavailable"));
      ctx.drawImage(img, 0, 0, N, N);
      const pixels = ctx.getImageData(0, 0, N, N).data;

      let thumb = "";
      if (withThumb) {
        const k = THUMB / Math.max(img.width, img.height, 1);
        const t = document.createElement("canvas");
        t.width = Math.max(1, Math.round(img.width * Math.min(1, k)));
        t.height = Math.max(1, Math.round(img.height * Math.min(1, k)));
        const tctx = t.getContext("2d");
        if (tctx) {
          tctx.drawImage(img, 0, 0, t.width, t.height);
          thumb = t.toDataURL("image/jpeg", 0.72);
        }
      }
      resolve({ pixels, thumb });
    };
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

const START: TimelineStep = { label: "ORIGINAL", identifiability: 100 };

/**
 * Share of the frame that moved far enough to matter, 0-100.
 *
 * Used as the reel's identifiability reading on frames with no recorded
 * subject rectangles — an imported picture, or one of the camera roll's
 * painted scenes. There is no face to measure there, so the honest question
 * is how much of the original picture is still on screen, and the reel says
 * so rather than inventing a subject.
 */
function alteredPct(
  base: Uint8ClampedArray,
  now: Uint8ClampedArray,
  n: number,
): number {
  let moved = 0;
  const total = n * n;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const d = Math.max(
      Math.abs(base[p] - now[p]),
      Math.abs(base[p + 1] - now[p + 1]),
      Math.abs(base[p + 2] - now[p + 2]),
    );
    if (d > 24) moved++;
  }
  return (moved / total) * 100;
}

/**
 * Thins the middle of a full reel.
 *
 * Dropping the oldest frame would lose the bare capture, which is the whole
 * point of the before/after. Dropping every other middle frame keeps both
 * ends and just lowers the frame rate of the stretch in between.
 */
function thin(reel: ReelFrame[]): ReelFrame[] {
  if (reel.length <= REEL_CAP) return reel;
  const head = reel[0];
  const tail = reel.slice(-2);
  const middle = reel.slice(1, -2).filter((_, i) => i % 2 === 0);
  return [head, ...middle, ...tail];
}

/**
 * Names the step from the measurement itself.
 *
 * The editor doesn't publish an operation log, so rather than guess at tool
 * names this reads the diff: if one subject's concealment jumped, that
 * subject just got covered; if the whole frame moved instead, the player
 * graded or recropped it. Every label here is therefore something the
 * forensic pass actually observed.
 */
function labelFor(
  prev: number[],
  next: number[],
  evidence: Evidence[],
  floorJump: boolean,
): string | null {
  let best = -1;
  let bestGain = 0;
  for (let i = 0; i < next.length; i++) {
    const gain = next[i] - (prev[i] ?? 0);
    if (gain > bestGain) {
      bestGain = gain;
      best = i;
    }
  }
  if (best >= 0 && bestGain >= 12) {
    const e = evidence[best];
    return `${e.label} ${next[best] >= 80 ? "COVERED" : "OBSCURED"}`;
  }
  if (floorJump) return "FRAME GRADED";
  return null;
}

/**
 * Samples the editor's working canvas on a slow interval and runs the same
 * region maths the final report uses, so the forensic panel moves while the
 * player paints. It is deliberately labelled an estimate in the UI: the
 * working canvas does not have the active filter preset baked in, which is
 * exactly why the authoritative scan runs off the exported file instead.
 *
 * The same loop feeds the SCRUB REEL — the frames were already being decoded
 * to answer the forensic question, so filming the session costs one extra
 * canvas draw per sample and nothing else.
 */
export function useLiveForensics(
  getWorkingImage: () => string | null | undefined,
  original: string,
  evidence: Evidence[],
  enabled: boolean,
): LiveReading {
  const blank = (): LiveReading => ({
    concealment: evidence.map(() => 0),
    identifiability: 100,
    live: false,
    timeline: [START],
    reel: [],
  });

  const [reading, setReading] = useState<LiveReading>(blank);

  const baseRef = useRef<Uint8ClampedArray | null>(null);
  const busy = useRef(false);
  const lastSrc = useRef<string | null>(null);
  const lastFloor = useRef(0);
  const openedAt = useRef(0);

  /*
   * A new frame means every reading so far is about a different picture.
   * Reset during render rather than in an effect so the panel never paints
   * one frame's numbers over another frame's image.
   */
  const [frameKey, setFrameKey] = useState(original);
  if (frameKey !== original) {
    setFrameKey(original);
    setReading(blank());
  }

  useEffect(() => {
    // Cached thumbnails belong to the previous frame.
    baseRef.current = null;
    lastSrc.current = null;
    lastFloor.current = 0;
    openedAt.current = performance.now();

    // The loop runs for any frame the player is working on, not just ones
    // carrying subject rectangles: with no boxes there is nothing to score
    // per subject, but the reel still films the edit and reads the frame as
    // a whole. Only the per-subject meters go quiet.
    if (!enabled) return;

    let cancelled = false;

    const tick = async () => {
      if (busy.current) return;
      const src = getWorkingImage();
      if (!src || src === lastSrc.current) return;
      busy.current = true;
      try {
        if (!baseRef.current) {
          // The bare capture opens the reel: frame zero is always what the
          // lens handed over, before anything was done to it.
          const first = await sample(original, true);
          if (cancelled) return;
          baseRef.current = first.pixels;
          if (first.thumb) {
            setReading((prev) =>
              prev.reel.length
                ? prev
                : {
                    ...prev,
                    reel: [
                      { thumb: first.thumb, identifiability: 100, at: 0 },
                    ],
                  },
            );
          }
        }
        const now = await sample(src, true);
        if (cancelled) return;
        lastSrc.current = src;
        const base = baseRef.current;
        // Same frame-wide correction the authoritative pass applies, so a
        // global filter doesn't read as though every face had been covered.
        const floor = noiseFloor(base, now.pixels, N);
        const floorJump = floor - lastFloor.current > 0.08;
        lastFloor.current = floor;

        const concealment = evidence.map((e) =>
          e.box ? concealmentOf(base, now.pixels, N, e.box, floor) : 0,
        );
        const withBox = concealment.filter((_, i) => evidence[i].box);
        const identifiability = withBox.length
          ? Math.round(100 - withBox.reduce((a, c) => a + c, 0) / withBox.length)
          : Math.round(
              Math.max(0, 100 - alteredPct(base, now.pixels, N)),
            );
        const at = Math.round(performance.now() - openedAt.current);

        setReading((prev) => {
          const label = labelFor(prev.concealment, concealment, evidence, floorJump);
          return {
            concealment,
            identifiability,
            live: true,
            timeline:
              label && label !== prev.timeline.at(-1)?.label
                ? [...prev.timeline, { label, identifiability }].slice(-8)
                : prev.timeline,
            reel: now.thumb
              ? thin([...prev.reel, { thumb: now.thumb, identifiability, at }])
              : prev.reel,
          };
        });
      } catch {
        /* the editor was mid-render — try again next tick */
      } finally {
        busy.current = false;
      }
    };

    const t = setInterval(tick, 1400);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, original, evidence, getWorkingImage]);

  return reading;
}
