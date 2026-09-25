"use client";

import { useEffect, useState } from "react";

export type Consequence = {
  app: string;
  tint: string;
  headline: string;
  body: string;
  /** Optional stat pinned to the bottom of the card. */
  stat?: { k: string; v: string; tint?: string };
  image?: string;
};

/**
 * The aftermath, played back one app at a time. This is the beat that makes
 * the loop legible: the player watches their edit land in the feed, on the
 * police radio, and in the state's evidence file, in that order.
 */
export default function Consequences({
  steps,
  onDone,
}: {
  steps: Consequence[];
  onDone: () => void;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (i >= steps.length) return;
    const t = setTimeout(() => setI((v) => v + 1), 2400);
    return () => clearTimeout(t);
  }, [i, steps.length]);

  useEffect(() => {
    if (i >= steps.length) {
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
    }
  }, [i, steps.length, onDone]);

  return (
    <div className="flex h-full flex-col justify-center p-4">
      <div className="space-y-3">
        {steps.slice(0, i + 1).map((s, k) => (
          <article
            key={`${s.app}-${k}`}
            className="rise-in rounded-2xl border bg-black/50 p-3.5"
            style={{
              borderColor: `${s.tint}55`,
              background: `linear-gradient(160deg, ${s.tint}12, rgba(6,1,15,0.75))`,
              opacity: k === i ? 1 : 0.55,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: s.tint, boxShadow: `0 0 8px ${s.tint}` }}
              />
              <p
                className="font-mono text-[9px] tracking-[0.26em]"
                style={{ color: s.tint }}
              >
                {s.app}
              </p>
            </div>
            <div className="mt-2 flex gap-3">
              {s.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.image}
                  alt=""
                  className="h-16 w-14 shrink-0 rounded-md border border-white/15 object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="headline text-xl leading-none">{s.headline}</p>
                <p className="mt-1.5 text-[12px] leading-snug text-white/65">
                  {s.body}
                </p>
              </div>
            </div>
            {s.stat && (
              <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-2">
                <span className="font-mono text-[9px] tracking-[0.2em] text-white/40">
                  {s.stat.k}
                </span>
                <span
                  className="headline text-lg"
                  style={{ color: s.stat.tint ?? s.tint }}
                >
                  {s.stat.v}
                </span>
              </div>
            )}
          </article>
        ))}
      </div>

      <button
        onClick={onDone}
        className="mt-5 self-center font-mono text-[10px] tracking-[0.24em] text-white/35 underline underline-offset-4 transition hover:text-white"
      >
        {i >= steps.length ? "CONTINUE →" : "SKIP →"}
      </button>
    </div>
  );
}
