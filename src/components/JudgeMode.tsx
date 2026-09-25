"use client";

import { BEATS, useVice } from "@/lib/store";

/**
 * A guided run through the whole loop, for somebody seeing VICE OS for the
 * first time. It doesn't play the game for you — it names the one thing to do
 * next and ticks off each beat as the apps report it, so nobody has to hunt
 * through menus to find the part that matters.
 */
export default function JudgeMode({ onJump }: { onJump: (id: string) => void }) {
  const { beats, judge, dispatch } = useVice();
  if (!judge) return null;

  const nextIndex = BEATS.findIndex((b) => !beats.includes(b.id));
  const done = nextIndex === -1;
  const next = done ? null : BEATS[nextIndex];

  /** Which app each beat happens in, so the card can take you there. */
  const JUMP: Record<string, string> = {
    fixer: "contracts",
    shot: "street",
    vision: "street",
    edit: "street",
    report: "street",
    post: "street",
    wanted: "wanted",
  };

  return (
    <div className="pointer-events-auto relative z-30 mx-3 mb-1 rounded-xl border border-vice-lime/40 bg-black/70 p-2.5 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-vice-lime shadow-[0_0_8px_#9dff3d]" />
        <p className="flex-1 font-mono text-[8px] tracking-[0.24em] text-vice-lime">
          JUDGE MODE · {beats.length}/{BEATS.length}
        </p>
        <button
          onClick={() => dispatch({ type: "judge", on: false })}
          className="font-mono text-[8px] tracking-[0.18em] text-white/35 transition hover:text-white"
        >
          EXIT
        </button>
      </div>

      {done ? (
        <p className="mt-1.5 text-[11px] leading-snug text-white/75">
          That&apos;s the whole loop. The same photograph, edited two ways, gives
          you two different cities to walk back into.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[12px] font-semibold leading-snug">
            {next!.label}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => onJump(JUMP[next!.id])}
              className="rounded-lg bg-vice-lime px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.14em] text-vice-void transition hover:brightness-110"
            >
              TAKE ME THERE →
            </button>
            <div className="flex flex-1 gap-1">
              {BEATS.map((b) => (
                <span
                  key={b.id}
                  title={b.label}
                  className="h-0.5 flex-1 rounded-full"
                  style={{
                    background: beats.includes(b.id)
                      ? "#9dff3d"
                      : "rgba(255,255,255,0.14)",
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
