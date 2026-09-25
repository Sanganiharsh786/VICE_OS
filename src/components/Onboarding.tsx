"use client";

import { useEffect, useState } from "react";

const CARDS = [
  {
    kicker: "WELCOME TO LEONIDA",
    line: "Your camera sees everything.",
    sub: "Walk a real-time 3D block. Raise the phone. The lens logs every face, plate and landmark it catches.",
    tint: "#22e6ff",
  },
  {
    kicker: "THE EDITOR IS THE MECHANIC",
    line: "Edit the evidence.",
    sub: "Cover a face. Crop out the skyline. Whatever you leave in the frame is what the state gets to keep.",
    tint: "#ff2e97",
  },
  {
    kicker: "FORENSICS SCORES YOU",
    line: "Beat the scan.",
    sub: "Your export is diffed against the original, subject by subject. The scan decides your heat, your bounty and your payout.",
    tint: "#9dff3d",
  },
  {
    kicker: "THE CITY REACTS",
    line: "Survive the consequences.",
    sub: "Post it and the radio calls it in, the bulletin prints, and the street starts crossing the road when it sees you.",
    tint: "#ffb347",
  },
];

/**
 * Thirty seconds of context so a first-timer knows what the app is before
 * they touch it. Skippable everywhere, shown once, and never in the way of
 * somebody who already knows.
 */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i >= CARDS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "Enter" || e.key === " ") {
        if (last) onDone();
        else setI((v) => v + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, onDone]);

  const card = CARDS[i];

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col justify-between bg-vice-void/97 p-6 backdrop-blur-xl"
      role="dialog"
      aria-label="How VICE OS works"
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] tracking-[0.3em] text-white/35">
          VICE OS · {i + 1}/{CARDS.length}
        </p>
        <button
          onClick={onDone}
          className="font-mono text-[9px] tracking-[0.22em] text-white/40 underline underline-offset-4 transition hover:text-white"
        >
          SKIP
        </button>
      </div>

      <div key={i} className="rise-in">
        <p
          className="font-mono text-[10px] tracking-[0.28em]"
          style={{ color: card.tint }}
        >
          {card.kicker}
        </p>
        <p
          className="headline mt-3 text-4xl leading-none"
          style={{ textShadow: `0 0 26px ${card.tint}66` }}
        >
          {card.line}
        </p>
        <p className="mt-4 text-[14px] leading-relaxed text-white/65">{card.sub}</p>
      </div>

      <div>
        <div className="mb-4 flex gap-1.5">
          {CARDS.map((c, k) => (
            <span
              key={c.kicker}
              className="h-0.5 flex-1 rounded-full transition-colors duration-300"
              style={{ background: k <= i ? card.tint : "rgba(255,255,255,0.14)" }}
            />
          ))}
        </div>
        <button
          onClick={() => (last ? onDone() : setI((v) => v + 1))}
          className="w-full rounded-xl py-3.5 font-mono text-[11px] font-bold tracking-[0.24em] text-vice-void transition hover:brightness-110"
          style={{ background: card.tint, boxShadow: `0 0 40px -10px ${card.tint}` }}
        >
          {last ? "ENTER LEONIDA →" : "NEXT"}
        </button>
        <p className="mt-2 text-center font-mono text-[9px] tracking-[0.18em] text-white/25">
          THE EDITOR ISN&apos;T A TOOL. IT&apos;S THE GAME.
        </p>
      </div>
    </div>
  );
}
