"use client";

import { useEffect, useRef, useState } from "react";
import {
  downloadReel,
  recordScrubReel,
  ReelUnavailable,
  type ReelMeta,
} from "@/lib/reel";
import type { ReelFrame } from "./useLiveForensics";

/**
 * The reel, as a flipbook.
 *
 * Every frame here is a sample the forensic panel already took off the
 * editor's working canvas, so the playback is not a reconstruction — it's the
 * measurement log, in order. Playing it is the clearest possible answer to
 * "what did the image editor actually do in this game": the picture changes
 * and the identifiability number falls with it.
 */
export default function ScrubReel({
  frames,
  meta,
  accent = "#ff2e97",
}: {
  frames: ReelFrame[];
  meta: ReelMeta;
  accent?: string;
}) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(
      () =>
        setI((v) => {
          // Rest on the finished frame rather than looping straight past it.
          if (v >= frames.length - 1) {
            setPlaying(false);
            return v;
          }
          return v + 1;
        }),
      Math.max(160, Math.min(520, 5200 / frames.length)),
    );
    return () => clearInterval(t);
  }, [playing, frames.length]);

  if (frames.length < 2) return null;

  const frame = frames[Math.min(i, frames.length - 1)];
  /*
   * With recorded subject rectangles the number is how identifiable those
   * subjects still are. Without them there is no subject to be identifiable,
   * so the reel reports the honest equivalent: how much of the picture the
   * lens produced is still on screen.
   */
  const metric = meta.subjects > 0 ? "IDENTIFIABLE" : "ORIGINAL LEFT";
  const tint =
    frame.identifiability > 60
      ? "#ff3b30"
      : frame.identifiability > 25
        ? "#ffb347"
        : "#9dff3d";

  const save = async () => {
    setSaving(true);
    setNote("FILMING…");
    try {
      const { blob, ext } = await recordScrubReel(frames, meta);
      downloadReel(blob, ext, meta.alias);
      if (alive.current) setNote(`SAVED · ${ext.toUpperCase()}`);
    } catch (err) {
      if (!alive.current) return;
      setNote(
        err instanceof ReelUnavailable
          ? "THIS BROWSER WON'T RECORD VIDEO — THE FLIPBOOK ABOVE IS THE SAME FRAMES."
          : "THE RECORDER FAILED. TRY AGAIN.",
      );
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[9px] tracking-[0.22em] text-white/40">
          SCRUB REEL
        </p>
        <p className="font-mono text-[9px] tabular-nums tracking-[0.12em] text-white/30">
          {frames.length} FRAMES · SPANNING{" "}
          {(frames.at(-1)!.at / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="relative mt-2 overflow-hidden rounded-lg border border-white/10 bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.thumb}
          alt={`edit step ${i + 1} of ${frames.length}`}
          className="block max-h-[220px] w-full object-contain"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-6">
          <span className="font-mono text-[9px] tracking-[0.16em] text-white/45">
            {metric}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{ width: `${frame.identifiability}%`, background: tint }}
            />
          </div>
          <span
            className="font-mono text-[10px] tabular-nums"
            style={{ color: tint }}
          >
            {frame.identifiability}%
          </span>
        </div>
        <span className="absolute left-1.5 top-1.5 bg-black/70 px-1 font-mono text-[8px] tracking-[0.16em] text-white/55">
          {i === 0
            ? "AS THE LENS TOOK IT"
            : i === frames.length - 1
              ? "AS THE SCAN READ IT"
              : `STEP ${i}/${frames.length - 2}`}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={i}
        onChange={(e) => {
          setPlaying(false);
          setI(Number(e.target.value));
        }}
        aria-label="scrub through the edit"
        className="mt-2 w-full accent-[var(--reel-accent)]"
        style={{ ["--reel-accent" as string]: accent }}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            if (i >= frames.length - 1) setI(0);
            setPlaying((v) => !v);
          }}
          className="rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[9px] tracking-[0.18em] text-white/70 transition hover:border-white/40 hover:text-white"
        >
          {playing ? "❚❚ PAUSE" : "▶ REPLAY"}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 font-mono text-[9px] font-bold tracking-[0.18em] text-vice-void transition disabled:opacity-40"
          style={{ background: accent }}
        >
          {saving ? "FILMING…" : "SAVE THE REEL · VIDEO"}
        </button>
        {note && (
          <span className="font-mono text-[9px] tracking-[0.12em] text-white/40">
            {note}
          </span>
        )}
      </div>

      <p className="mt-2 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-white/25">
        THE MIDDLE FRAMES ARE LIVE SAMPLES OFF YOUR CANVAS; THE LAST ONE IS THE
        EXPORTED FILE, READ BY THE AUTHORITATIVE SCAN.
      </p>
    </div>
  );
}
