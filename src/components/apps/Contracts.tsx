"use client";

import { useSyncExternalStore } from "react";
import { money } from "@/lib/copy";
import { rankFor, TIER_TINT, type Contract } from "@/lib/contracts";
import { useVice } from "@/lib/store";
import { AppHeader, Btn, Tally } from "@/components/ui";

export type JumpTarget = "vicegram" | "wanted";

export default function Contracts({
  onBack,
  onJump,
}: {
  onBack: () => void;
  onJump: (t: JumpTarget) => void;
}) {
  const vice = useVice();

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        title="THE FIXER"
        sub={`${rankFor(vice.completed)} · ${money(vice.cash)} ON HAND`}
        onBack={onBack}
        tint="#ffb347"
        right={
          <div className="text-right">
            <p className="font-mono text-[8px] tracking-[0.2em] text-white/40">
              JOBS
            </p>
            <p className="font-mono text-[11px] tabular-nums text-vice-lime">
              {vice.completed}
              <span className="text-white/30">/{vice.completed + vice.failed}</span>
            </p>
          </div>
        }
      />

      <div className="vice-scroll flex-1 overflow-y-auto p-4 pb-6">
        {vice.lastResult ? (
          <Settlement
            onDone={() => {
              vice.dispatch({ type: "clearResult" });
              // Fresh offers priced against whatever the heat is now.
              vice.refreshBoard();
            }}
          />
        ) : vice.active ? (
          <ActiveJob onJump={onJump} />
        ) : (
          <Board />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the board                                                           */
/* ------------------------------------------------------------------ */

function Board() {
  const vice = useVice();

  return (
    <>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="headline text-2xl">OPEN WORK</p>
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/40">
            THE JOB IS THE EDIT. THE EDIT IS SCORED.
          </p>
        </div>
        <Btn tone="ghost" onClick={vice.refreshBoard}>
          ↻ NEW
        </Btn>
      </div>

      <div className="space-y-3">
        {vice.board.map((c) => (
          <Offer key={c.id} contract={c} onAccept={() => vice.accept(c)} />
        ))}
        {vice.board.length === 0 && (
          <p className="py-10 text-center font-mono text-[11px] tracking-[0.16em] text-white/35">
            NOBODY&apos;S CALLING. HIT ↻ NEW.
          </p>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-3">
        <p className="font-mono text-[9px] tracking-[0.22em] text-white/40">LEDGER</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat k="ON HAND" v={money(vice.cash)} tint="#9dff3d" />
          <Stat k="DELIVERED" v={String(vice.completed)} tint="#22e6ff" />
          <Stat k="BLOWN" v={String(vice.failed)} tint="#ff3b30" />
        </div>
        <p className="mt-2.5 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/30">
          RANK: <span className="text-vice-sun">{rankFor(vice.completed)}</span>
        </p>
      </div>
    </>
  );
}

function Stat({ k, v, tint }: { k: string; v: string; tint: string }) {
  return (
    <div>
      <p className="font-mono text-[8px] tracking-[0.18em] text-white/35">{k}</p>
      <p className="headline text-base" style={{ color: tint }}>
        {v}
      </p>
    </div>
  );
}

function Offer({
  contract,
  onAccept,
}: {
  contract: Contract;
  onAccept: () => void;
}) {
  const tint = TIER_TINT[contract.tier];
  return (
    <article
      className="rise-in rounded-2xl border bg-black/35 p-3.5"
      style={{ borderColor: `${tint}44` }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 h-8 w-8 shrink-0 rounded-full"
          style={{
            background: `linear-gradient(135deg, hsl(${contract.hue} 90% 62%), hsl(${contract.hue + 40} 85% 45%))`,
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="headline truncate text-lg leading-none">
              {contract.codename}
            </p>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[8px] tracking-[0.14em]"
              style={{ background: `${tint}22`, color: tint }}
            >
              {contract.tier}
            </span>
          </div>
          <p className="font-mono text-[9px] tracking-[0.16em] text-white/40">
            {contract.fixer} · {contract.handle}
          </p>
        </div>
      </div>

      <p className="mt-2.5 text-[12px] leading-snug text-white/70">
        &ldquo;{contract.brief}&rdquo;
      </p>

      <ul className="mt-3 space-y-1.5">
        {contract.objectives.map((o) => (
          <li key={o.label} className="flex gap-2 text-[11px] leading-snug">
            <span style={{ color: tint }}>▸</span>
            <span className="text-white/75">
              {o.label}
              <span className="ml-1.5 font-mono text-[9px] tracking-[0.1em] text-white/30">
                {o.tool}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3.5 flex items-center justify-between border-t border-white/8 pt-3">
        <div className="flex gap-4">
          <div>
            <p className="font-mono text-[8px] tracking-[0.18em] text-white/35">PAYS</p>
            <p className="headline text-base text-vice-lime">
              {money(contract.reward)}
            </p>
          </div>
          <div>
            <p className="font-mono text-[8px] tracking-[0.18em] text-white/35">CLOCK</p>
            <p className="headline text-base">{contract.seconds}s</p>
          </div>
          <div>
            <p className="font-mono text-[8px] tracking-[0.18em] text-white/35">HEAT</p>
            <p
              className={`headline text-base ${contract.heatOnSuccess > 0 ? "text-vice-pink" : "text-vice-cyan"}`}
            >
              {contract.heatOnSuccess > 0 ? "+" : ""}
              {contract.heatOnSuccess}
            </p>
          </div>
        </div>
        <Btn onClick={onAccept}>TAKE IT</Btn>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* active job                                                          */
/* ------------------------------------------------------------------ */

function ActiveJob({ onJump }: { onJump: (t: JumpTarget) => void }) {
  const vice = useVice();
  const job = vice.active!;
  const c = job.contract;
  const tint = TIER_TINT[c.tier];
  const left = useCountdown(job.deadline);
  const frac = Math.max(0, Math.min(1, left / (c.seconds * 1000)));
  const panic = left < 25000;

  return (
    <div className="rise-in">
      <div className="flex items-center gap-4">
        <Dial frac={frac} left={left} tint={panic ? "#ff3b30" : tint} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] tracking-[0.22em]" style={{ color: tint }}>
            CONTRACT ACTIVE
          </p>
          <p className="headline truncate text-2xl leading-none">{c.codename}</p>
          <p className="font-mono text-[9px] tracking-[0.16em] text-white/40">
            {c.fixer} · {c.handle}
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-xl border-l-2 bg-black/30 p-3 text-[12px] leading-snug text-white/75"
        style={{ borderColor: tint }}
      >
        &ldquo;{c.brief}&rdquo;
      </p>

      <p className="mt-4 font-mono text-[10px] tracking-[0.24em] text-white/45">
        OBJECTIVES
      </p>
      <ul className="mt-2 space-y-2">
        {c.objectives.map((o, i) => (
          <li
            key={o.label}
            className="flex items-start gap-2.5 rounded-lg border border-white/8 bg-black/25 p-2.5"
          >
            <span className="mt-0.5 font-mono text-[10px] text-white/30">
              0{i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[12px] leading-snug text-white/85">{o.label}</p>
              <p className="font-mono text-[9px] tracking-[0.12em] text-white/35">
                → {o.tool}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Btn
          tone={c.event === "poster" ? "cyan" : "solid"}
          full
          onClick={() => onJump(c.event === "poster" ? "wanted" : "vicegram")}
        >
          {c.event === "poster" ? "OPEN MOST WANTED" : "OPEN VICEGRAM"}
        </Btn>
        <Btn tone="ghost" full onClick={vice.abandon}>
          WALK AWAY
        </Btn>
      </div>

      <p className="mt-3 text-center font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/30">
        THE FORENSIC SCAN OF YOUR EXPORT IS THE SCORE.
        <br />
        NOTHING ELSE COUNTS.
      </p>
    </div>
  );
}

function Dial({
  frac,
  left,
  tint,
}: {
  frac: number;
  left: number;
  tint: string;
}) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="5"
        />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={tint}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ filter: `drop-shadow(0 0 6px ${tint})` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-sm tabular-nums" style={{ color: tint }}>
          {clock(left)}
        </span>
      </div>
    </div>
  );
}

/** m:ss remaining. */
export function clock(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One shared 200ms clock for every countdown on screen. The wall clock is an
 * external store, so it's read through useSyncExternalStore rather than
 * sampled during render.
 */
const clockStore = (() => {
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(cb: () => void) {
      listeners.add(cb);
      if (!timer) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          listeners.forEach((l) => l());
        }, 200);
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    get: () => now,
  };
})();

/** Wall-clock countdown, ms remaining. */
export function useCountdown(deadline: number) {
  const now = useSyncExternalStore(
    clockStore.subscribe,
    clockStore.get,
    clockStore.get,
  );
  return Math.max(0, deadline - now);
}

/* ------------------------------------------------------------------ */
/* settlement                                                          */
/* ------------------------------------------------------------------ */

function Settlement({ onDone }: { onDone: () => void }) {
  const { lastResult: r } = useVice();
  if (!r) return null;
  const tint = r.ok ? "#9dff3d" : "#ff3b30";

  return (
    <div className="pop-in">
      <div
        className="rounded-2xl border p-5 text-center"
        style={{ borderColor: `${tint}66`, background: `${tint}0d` }}
      >
        <p className="font-mono text-[10px] tracking-[0.3em] text-white/45">
          {r.contract.codename}
        </p>
        <p
          className="headline mt-1 text-4xl leading-none"
          style={{ color: tint, textShadow: `0 0 26px ${tint}99` }}
        >
          {r.ok ? "DELIVERED" : r.reason === "expired" ? "TOO SLOW" : "BLOWN"}
        </p>
        <p className="mt-2 text-[12px] leading-snug text-white/60">
          {r.ok
            ? `${r.contract.fixer} paid without arguing. That never happens.`
            : r.reason === "expired"
              ? `${r.contract.fixer} stopped answering the phone.`
              : `${r.contract.fixer} looked at the export and hung up.`}
        </p>

        <div className="mt-4 flex items-center justify-center gap-6">
          <div>
            <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">PAID</p>
            <p className="headline text-2xl" style={{ color: tint }}>
              {r.paid > 0 ? "$" : ""}
              <Tally value={r.paid} />
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">HEAT</p>
            <p
              className={`headline text-2xl ${r.heat > 0 ? "text-vice-pink" : "text-vice-cyan"}`}
            >
              {r.heat > 0 ? "+" : ""}
              {r.heat}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 font-mono text-[10px] tracking-[0.24em] text-white/45">
        SCORECARD
      </p>
      <ul className="mt-2 space-y-1.5">
        {r.contract.objectives.map((o, i) => (
          <li
            key={o.label}
            className="flex items-start gap-2.5 rounded-lg border border-white/8 bg-black/25 p-2.5 text-[12px]"
          >
            <span className={r.marks[i] ? "text-vice-lime" : "text-vice-blood"}>
              {r.marks[i] ? "✓" : "✕"}
            </span>
            <span className={r.marks[i] ? "text-white/80" : "text-white/45 line-through"}>
              {o.label}
            </span>
          </li>
        ))}
      </ul>

      <Btn className="mt-4" full tone={r.ok ? "lime" : "ghost"} onClick={onDone}>
        BACK TO THE BOARD
      </Btn>
    </div>
  );
}
