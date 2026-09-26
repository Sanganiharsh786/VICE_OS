"use client";

import { useEffect, useState } from "react";
import { heatOf, rawExposure, tintOf, type Evidence } from "@/lib/evidence";
import EvidenceBoxes from "./EvidenceBoxes";

const LINES = [
  "hashing frame…",
  "isolating subjects…",
  "measuring identifiability…",
  "pricing exposure…",
];

/**
 * What happens the instant the shutter fires. Before the player ever sees the
 * editor, the frame is shown back to them with every identifiable subject
 * bracketed and priced — so the job in the Image Lab is concrete.
 */
export default function ForensicVision({
  src,
  title,
  location,
  evidence,
  onOpenLab,
  onDiscard,
  onStreet,
}: {
  src: string;
  title: string;
  location: string;
  evidence: Evidence[];
  onOpenLab: () => void;
  onDiscard: () => void;
  /** Present when this frame was shot in Leonida Live — goes back to it. */
  onStreet?: () => void;
}) {
  const [step, setStep] = useState(0);
  const total = evidence.length;
  const done = step > total;

  // One tick reveals one subject; the last tick unlocks the button.
  useEffect(() => {
    if (step > total) return;
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 520 : 380);
    return () => clearTimeout(t);
  }, [step, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && done) onOpenLab();
      if (e.key === "Escape") onDiscard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, onOpenLab, onDiscard]);

  const exposure = rawExposure(evidence);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-vice-void/97 backdrop-blur-xl pop-in">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,230,255,0.14),transparent_55%)]" />

      <header className="relative z-10 flex items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <span className="text-lg text-vice-cyan">◉</span>
        <div className="min-w-0 flex-1">
          <p className="headline text-lg leading-none text-vice-cyan neon-cyan sm:text-2xl">
            FORENSIC VISION
          </p>
          <p className="mt-1 truncate font-mono text-[10px] tracking-[0.24em] text-white/45">
            {done ? "FRAME ANALYSED" : "SCANNING FRAME…"} · {location}
          </p>
        </div>
        {onStreet && (
          <button
            onClick={onStreet}
            className="rounded-lg border border-vice-cyan/35 px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-vice-cyan/80 transition hover:border-vice-cyan hover:text-vice-cyan"
            title="Back to Leonida Live — the frame stays in your roll"
          >
            ← STREET
          </button>
        )}
        <button
          onClick={onDiscard}
          className="rounded-lg border border-white/15 px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-white/55 transition hover:border-white/40 hover:text-white"
        >
          DISCARD
        </button>
      </header>

      <div className="vice-scroll relative z-10 flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:flex-row sm:items-start sm:p-6">
        {/* the frame */}
        <div className="mx-auto w-full max-w-[min(100%,380px)] shrink-0">
          <div className="relative overflow-hidden rounded-xl border border-vice-cyan/40 shadow-[0_0_60px_-20px_rgba(34,230,255,0.9)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={title} className="block w-full" />
            <EvidenceBoxes evidence={evidence} revealed={step} />
            {!done && (
              <>
                <div className="sweep absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-vice-cyan/45 to-transparent" />
                <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(34,230,255,0.08)_0px,rgba(34,230,255,0.08)_1px,transparent_1px,transparent_4px)]" />
              </>
            )}
          </div>
          <p className="mt-2 text-center font-mono text-[9px] tracking-[0.18em] text-white/35">
            {title}
          </p>
        </div>

        {/* the readout */}
        <div className="min-w-0 flex-1 sm:max-w-sm">
          {!done && (
            <div className="space-y-1.5 font-mono text-[10px] tracking-[0.14em] text-white/50">
              {LINES.slice(0, Math.min(step + 1, LINES.length)).map((l) => (
                <p key={l} className="rise-in">
                  <span className="text-vice-lime">›</span> {l}
                </p>
              ))}
            </div>
          )}

          {done && (
            <div className="rise-in">
              <p className="font-mono text-[9px] tracking-[0.26em] text-white/40">
                IDENTIFIABLE SUBJECTS
              </p>
              <p
                className="headline text-5xl leading-none"
                style={{
                  color: total ? "#ff3b30" : "#9dff3d",
                  textShadow: `0 0 28px ${total ? "#ff3b3088" : "#9dff3d88"}`,
                }}
              >
                {total}
              </p>

              <ul className="mt-4 space-y-1.5">
                {evidence.map((e, i) => (
                  <li
                    key={`${e.label}-${i}`}
                    className="rise-in flex items-center gap-2.5 rounded-lg border border-white/8 bg-black/35 px-2.5 py-2"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{
                        background: tintOf(e.kind),
                        boxShadow: `0 0 10px ${tintOf(e.kind)}`,
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-[0.12em] text-white/80">
                      {e.label}
                    </span>
                    <span className="font-mono text-[9px] tracking-[0.1em] text-white/35">
                      {e.kind}
                    </span>
                    <span
                      className="font-mono text-[11px] tabular-nums"
                      style={{ color: tintOf(e.kind) }}
                    >
                      +{heatOf(e.kind)}
                    </span>
                  </li>
                ))}
              </ul>

              {total === 0 && (
                <p className="mt-3 rounded-lg border border-vice-lime/30 bg-vice-lime/5 p-3 text-[12px] leading-snug text-white/70">
                  Nothing identifiable was in frame when the shutter fired. This
                  one is safe to post raw — but the Image Lab is still where the
                  style points live.
                </p>
              )}

              <div className="mt-4 flex items-end justify-between rounded-xl border border-vice-blood/30 bg-vice-blood/5 px-3 py-2.5">
                <p className="font-mono text-[9px] leading-relaxed tracking-[0.2em] text-white/45">
                  POTENTIAL
                  <br />
                  EXPOSURE
                </p>
                <p
                  className="headline text-3xl leading-none"
                  style={{
                    color: exposure ? "#ff3b30" : "#9dff3d",
                    textShadow: `0 0 20px ${exposure ? "#ff3b3088" : "#9dff3d88"}`,
                  }}
                >
                  {exposure > 0 ? `+${exposure}` : "0"} HEAT
                </p>
              </div>

              <p className="mt-3 text-[12px] leading-snug text-white/60">
                {exposure > 0
                  ? "Everything above survives into the post unless you cover it. The forensic scan re-reads these exact rectangles in whatever you export."
                  : "Nothing to hide. Anything you do in the lab is for the look of it."}
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="relative z-10 border-t border-white/10 p-4 sm:px-6">
        <button
          onClick={onOpenLab}
          disabled={!done}
          className="w-full rounded-xl bg-vice-pink px-4 py-3.5 font-mono text-[12px] font-bold tracking-[0.22em] text-vice-void shadow-[0_0_40px_-8px_rgba(255,46,151,0.9)] transition hover:brightness-110 disabled:opacity-30"
        >
          {done ? "OPEN THE IMAGE LAB →" : "ANALYSING…"}
        </button>
        <p className="mt-2 text-center font-mono text-[9px] tracking-[0.18em] text-white/30">
          THE EDIT DECIDES WHAT SURVIVES
        </p>
      </footer>
    </div>
  );
}
