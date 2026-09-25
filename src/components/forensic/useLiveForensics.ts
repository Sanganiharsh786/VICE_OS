"use client";

import { useEffect, useRef, useState } from "react";
import { concealmentOf, noiseFloor } from "@/lib/forensics";
import type { Evidence } from "@/lib/evidence";

/** Cheaper than the authoritative pass — this one runs while you're working. */
const N = 96;

/** One entry in the edit history the report plays back. */
export type TimelineStep = {
  label: string;
  /** Mean identifiability across every subject at this point, 0-100. */
  identifiability: number;
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
};

function decode(src: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = N;
      c.height = N;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("canvas unavailable"));
      ctx.drawImage(img, 0, 0, N, N);
      resolve(ctx.getImageData(0, 0, N, N).data);
    };
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

const START: TimelineStep = { label: "ORIGINAL", identifiability: 100 };

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
 */
export function useLiveForensics(
  getWorkingImage: () => string | null | undefined,
  original: string,
  evidence: Evidence[],
  enabled: boolean,
): LiveReading {
  const [reading, setReading] = useState<LiveReading>({
    concealment: evidence.map(() => 0),
    identifiability: 100,
    live: false,
    timeline: [START],
  });

  const baseRef = useRef<Uint8ClampedArray | null>(null);
  const busy = useRef(false);
  const lastSrc = useRef<string | null>(null);
  const lastFloor = useRef(0);

  /*
   * A new frame means every reading so far is about a different picture.
   * Reset during render rather than in an effect so the panel never paints
   * one frame's numbers over another frame's image.
   */
  const [frameKey, setFrameKey] = useState(original);
  if (frameKey !== original) {
    setFrameKey(original);
    setReading({
      concealment: evidence.map(() => 0),
      identifiability: 100,
      live: false,
      timeline: [START],
    });
  }

  useEffect(() => {
    // Cached thumbnails belong to the previous frame.
    baseRef.current = null;
    lastSrc.current = null;
    lastFloor.current = 0;

    const boxed = evidence.filter((e) => e.box);
    if (!enabled || boxed.length === 0) return;

    let cancelled = false;

    const tick = async () => {
      if (busy.current) return;
      const src = getWorkingImage();
      if (!src || src === lastSrc.current) return;
      busy.current = true;
      try {
        if (!baseRef.current) baseRef.current = await decode(original);
        const now = await decode(src);
        if (cancelled) return;
        lastSrc.current = src;
        const base = baseRef.current;
        // Same frame-wide correction the authoritative pass applies, so a
        // global filter doesn't read as though every face had been covered.
        const floor = noiseFloor(base, now, N);
        const floorJump = floor - lastFloor.current > 0.08;
        lastFloor.current = floor;

        const concealment = evidence.map((e) =>
          e.box ? concealmentOf(base, now, N, e.box, floor) : 0,
        );
        const withBox = concealment.filter((_, i) => evidence[i].box);
        const identifiability = Math.round(
          100 - withBox.reduce((a, c) => a + c, 0) / Math.max(1, withBox.length),
        );

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
