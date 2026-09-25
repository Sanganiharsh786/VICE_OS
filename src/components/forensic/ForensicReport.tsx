"use client";

import { useEffect, useState } from "react";
import { tintOf, type Evidence } from "@/lib/evidence";
import type { HeatBreakdown, Report, EvidenceStatus } from "@/lib/forensics";
import type { TimelineStep } from "./useLiveForensics";
import EvidenceBoxes from "./EvidenceBoxes";

const STATUS_TINT: Record<EvidenceStatus, string> = {
  VISIBLE: "#ff3b30",
  PARTIAL: "#ffb347",
  HIDDEN: "#9dff3d",
  REMOVED: "#9dff3d",
};

/** Counts a value up once, so the headline numbers land rather than appear. */
function useCountUp(value: number, ms = 900) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/**
 * What the camera captured versus what survives in the export, priced.
 * This is the payoff screen — it is the one place where the player can see,
 * side by side, that the same photograph produced a different outcome because
 * of what they did in the editor.
 */
export default function ForensicReport({
  original,
  edited,
  evidence,
  report,
  heat,
  timeline = [],
  previous,
  onBackToLab,
  onPublish,
}: {
  original: string;
  edited: string;
  evidence: Evidence[];
  report: Report;
  heat: HeatBreakdown;
  /** How the frame got here, as observed by the live panel. */
  timeline?: TimelineStep[];
  /** The last scan of this same source frame, if the player has been back. */
  previous?: { scrub: number; heat: number };
  onBackToLab: () => void;
  onPublish: () => void;
}) {
  const scrub = Math.round(report.scrub);
  const shownScrub = Math.round(useCountUp(scrub));
  const hasSubjects = report.findings.length > 0;

  const verdict = report.perfect
    ? { t: "PERFECT SCRUB", c: "#9dff3d", s: "Nothing in this file can be matched to what the lens saw." }
    : report.failed
      ? { t: "SCRUB FAILED", c: "#ff3b30", s: "The image is still identifiable. Publishing it is a choice." }
      : hasSubjects
        ? { t: "SAFE TO PUBLISH", c: "#22e6ff", s: "Recognisable in places, but you covered what mattered." }
        : scrub > 55
          ? { t: "UNIDENTIFIABLE", c: "#9dff3d", s: "Forensics can't place this frame. Post freely." }
          : scrub > 22
            ? { t: "PARTIALLY SCRUBBED", c: "#22e6ff", s: "Recognisable, but you covered the worst of it." }
            : { t: "RAW FRAME", c: "#ff3b30", s: "Everything in this shot is admissible. Your call." };

  const statuses = report.findings.map((f) => f.status);

  // A rare result deserves a beat of its own before the numbers.
  const [celebrating, setCelebrating] = useState(report.perfect);
  useEffect(() => {
    if (!report.perfect) return;
    const t = setTimeout(() => setCelebrating(false), 2600);
    return () => clearTimeout(t);
  }, [report.perfect]);

  if (celebrating) {
    return (
      <PerfectScrub
        report={report}
        heat={heat}
        edited={edited}
        onDone={() => setCelebrating(false)}
      />
    );
  }

  return (
    <div className="p-4 pb-8 rise-in">
      <div className="flex items-baseline justify-between">
        <p className="headline text-2xl text-vice-cyan neon-cyan">FORENSIC REPORT</p>
        {report.perfect && (
          <span className="pop-in rounded-full bg-vice-lime px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.14em] text-vice-void">
            ★ PERFECT
          </span>
        )}
      </div>

      {/* before / after */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Frame src={original} label="CAPTURED" evidence={evidence} tone="#ff3b30" />
        {/*
          A reframed export no longer shares coordinates with the capture, so
          drawing the original rectangles on it would point at the wrong
          pixels. The per-subject table below carries the verdict instead.
        */}
        <Frame
          src={edited}
          label="EXPORT"
          evidence={report.forensics.reframed ? [] : evidence}
          statuses={statuses}
          tone={verdict.c}
        />
      </div>

      {/* verdict */}
      <div
        className="mt-4 rounded-xl border p-3.5"
        style={{ borderColor: `${verdict.c}55`, background: `${verdict.c}0d` }}
      >
        <p
          className="headline text-2xl leading-none"
          style={{ color: verdict.c, textShadow: `0 0 20px ${verdict.c}88` }}
        >
          {verdict.t}
        </p>
        <p className="mt-1.5 text-[12px] leading-snug text-white/65">{verdict.s}</p>
      </div>

      {/* per-subject */}
      {hasSubjects && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between font-mono text-[9px] tracking-[0.22em] text-white/35">
            <span>SUBJECT</span>
            <span>CAPTURED → EXPORT</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {report.findings.map((f, i) => (
              <li
                key={`${f.label}-${i}`}
                className="rise-in flex items-center gap-2 rounded-lg border border-white/8 bg-black/30 px-2.5 py-2"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: tintOf(f.kind) }}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-[0.1em] text-white/75">
                  {f.label}
                </span>
                <span className="font-mono text-[9px] tracking-[0.1em] text-vice-blood/80">
                  VISIBLE
                </span>
                <span className="text-white/25">→</span>
                <span
                  className="font-mono text-[10px] font-bold tracking-[0.1em]"
                  style={{ color: STATUS_TINT[f.status] }}
                >
                  {f.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        The same photograph, scanned twice. Nothing states the thesis of this
        project faster than these two rows side by side.
      */}
      {previous && (
        <div className="mt-4 rounded-xl border border-vice-cyan/40 bg-vice-cyan/5 p-3 pop-in">
          <p className="font-mono text-[9px] tracking-[0.24em] text-vice-cyan">
            SAME PHOTO · DIFFERENT OUTCOME
          </p>
          <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums">
            <span className="text-white/30" />
            <span className="text-right text-[8px] tracking-[0.16em] text-white/35">
              SCRUB
            </span>
            <span className="text-right text-[8px] tracking-[0.16em] text-white/35">
              HEAT
            </span>

            <span className="tracking-[0.12em] text-white/45">LAST ATTEMPT</span>
            <span className="text-right text-white/50">{previous.scrub}%</span>
            <span className="text-right text-white/50">
              {previous.heat > 0 ? "+" : ""}
              {previous.heat}
            </span>

            <span className="tracking-[0.12em] text-white/80">THIS EXPORT</span>
            <span className="text-right text-vice-lime">{scrub}%</span>
            <span
              className={
                heat.final > previous.heat
                  ? "text-right text-vice-pink"
                  : "text-right text-vice-lime"
              }
            >
              {heat.final > 0 ? "+" : ""}
              {heat.final}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-white/55">
            {heat.final < previous.heat
              ? `The edit is the only thing that changed, and it took ${previous.heat - heat.final} heat off the same frame.`
              : heat.final > previous.heat
                ? `That version costs ${heat.final - previous.heat} more heat than your last one.`
                : "Same frame, same cost. The edit didn't move the needle."}
          </p>
        </div>
      )}

      {/* how the frame got here */}
      {timeline.length > 1 && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="font-mono text-[9px] tracking-[0.22em] text-white/40">
            EDIT HISTORY
          </p>
          <ol className="mt-2 space-y-1">
            {timeline.map((t, i) => (
              <li
                key={`${t.label}-${i}`}
                className="rise-in flex items-baseline justify-between gap-3"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-[0.12em] text-white/60">
                  <span className="text-white/25">
                    {i === 0 ? "●" : "↓"}
                  </span>{" "}
                  {t.label}
                </span>
                <span
                  className="font-mono text-[10px] tabular-nums"
                  style={{
                    color:
                      t.identifiability > 60
                        ? "#ff3b30"
                        : t.identifiability > 25
                          ? "#ffb347"
                          : "#9dff3d",
                  }}
                >
                  {t.identifiability}%
                </span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-1">
              <span className="font-mono text-[10px] tracking-[0.12em] text-white/40">
                <span className="text-white/25">↓</span> EXPORT
              </span>
              <span className="font-mono text-[10px] tracking-[0.1em] text-vice-lime">
                SCANNED
              </span>
            </li>
          </ol>
          <p className="mt-2 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-white/25">
            IDENTIFIABILITY AS MEASURED WHILE YOU WORKED
          </p>
        </div>
      )}

      {/* headline numbers */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-black/35 p-3">
          <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">
            SCRUB SCORE
          </p>
          <p
            className="headline text-4xl leading-none"
            style={{ color: verdict.c, textShadow: `0 0 20px ${verdict.c}66` }}
          >
            {shownScrub}%
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/35 p-3">
          <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">HEAT</p>
          <p className="headline text-4xl leading-none">
            <span className="text-vice-blood/70">{heat.rawExposure}</span>
            <span className="mx-1 text-white/25">→</span>
            <span className={heat.final > 4 ? "text-vice-pink" : "text-vice-lime"}>
              {heat.final}
            </span>
          </p>
        </div>
      </div>

      {/* breakdown */}
      <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
        <p className="font-mono text-[9px] tracking-[0.22em] text-white/40">
          HEAT BREAKDOWN
        </p>
        <ul className="mt-2 space-y-1 font-mono text-[10px] tabular-nums">
          {heat.lines.map((l, i) => (
            <li key={`${l.label}-${i}`} className="flex justify-between gap-2">
              <span className="min-w-0 truncate tracking-[0.1em] text-white/50">
                {l.label}
              </span>
              <span className={l.kind === "add" ? "text-vice-pink" : "text-vice-lime"}>
                {l.kind === "add" ? "+" : "−"}
                {l.value}
              </span>
            </li>
          ))}
          <li className="flex justify-between gap-2 border-t border-white/10 pt-1">
            <span className="tracking-[0.1em] text-white/40">RAW EXPOSURE</span>
            <span className="text-vice-pink">+{heat.rawExposure}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="tracking-[0.1em] text-white/40">SCRUB DISCOUNT</span>
            <span className="text-vice-lime">−{heat.discount}</span>
          </li>
          <li className="flex justify-between gap-2 border-t border-white/10 pt-1 text-[12px] font-bold">
            <span className="tracking-[0.1em] text-white/60">FINAL HEAT</span>
            <span className={heat.final > 4 ? "text-vice-pink" : "text-vice-lime"}>
              {heat.final > 0 ? "+" : ""}
              {heat.final}
            </span>
          </li>
        </ul>
      </div>

      {/* whole-frame measurements, kept visible so the score is auditable */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[9px] tracking-[0.14em] text-white/35">
        <Read k="SURFACE ALTERED" v={`${report.forensics.altered}%`} />
        <Read k="OVERLAY COVERAGE" v={`${report.forensics.coverage}%`} />
        <Read k="GRADE SHIFT" v={`${report.forensics.temperature}`} />
        <Read k="REFRAMED" v={report.forensics.reframed ? "YES" : "NO"} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          onClick={onBackToLab}
          className="rounded-xl border border-white/15 px-3 py-3 font-mono text-[10px] font-bold tracking-[0.16em] text-white/70 transition hover:border-vice-cyan hover:text-vice-cyan"
        >
          ↩ RETURN TO LAB
        </button>
        <button
          onClick={onPublish}
          className={`rounded-xl px-3 py-3 font-mono text-[10px] font-bold tracking-[0.16em] text-vice-void transition hover:brightness-110 ${
            report.failed ? "bg-vice-blood text-white" : "bg-vice-lime"
          }`}
        >
          {report.failed ? "PUBLISH ANYWAY" : "PUBLISH →"}
        </button>
      </div>
    </div>
  );
}

/**
 * PERFECT SCRUB. Every subject the lens caught is gone from the export — a
 * result worth about two and a half seconds of the screen before the report.
 */
function PerfectScrub({
  report,
  heat,
  edited,
  onDone,
}: {
  report: Report;
  heat: HeatBreakdown;
  edited: string;
  onDone: () => void;
}) {
  return (
    <button
      onClick={onDone}
      className="flex w-full flex-col items-center p-6 py-10 text-center pop-in"
      aria-label="Continue to the forensic report"
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={edited}
          alt=""
          className="h-36 w-28 rounded-lg border border-vice-lime/60 object-cover shadow-[0_0_60px_-12px_rgba(157,255,61,0.9)]"
        />
        <div className="sweep absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-vice-lime/40 to-transparent" />
      </div>

      <p
        className="headline mt-5 text-4xl leading-none text-vice-lime"
        style={{ textShadow: "0 0 30px rgba(157,255,61,0.7)" }}
      >
        PERFECT SCRUB
      </p>

      <ul className="mt-5 w-full max-w-[260px] space-y-1.5">
        {report.findings.map((f, i) => (
          <li
            key={`${f.label}-${i}`}
            className="rise-in flex items-baseline justify-between gap-3 border-b border-white/8 pb-1 font-mono text-[10px] tracking-[0.12em]"
            style={{ animationDelay: `${180 + i * 120}ms` }}
          >
            <span className="min-w-0 truncate text-white/60">{f.label}</span>
            <span className="text-vice-lime">
              {f.concealment}% {f.status}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-end gap-6">
        <div>
          <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">
            SCRUB SCORE
          </p>
          <p className="headline text-3xl text-vice-lime">
            {Math.round(report.scrub)}%
          </p>
        </div>
        <div>
          <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">HEAT</p>
          <p className="headline text-3xl">
            <span className="text-vice-blood/70">{heat.rawExposure}</span>
            <span className="mx-1 text-white/25">→</span>
            <span className="text-vice-lime">{heat.final}</span>
          </p>
        </div>
      </div>

      <p className="mt-5 font-mono text-[9px] tracking-[0.22em] text-white/30">
        NOTHING IN THIS FILE IS ANYBODY · TAP TO CONTINUE
      </p>
    </button>
  );
}

function Read({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{k}</span>
      <span className="tabular-nums text-white/60">{v}</span>
    </div>
  );
}

function Frame({
  src,
  label,
  evidence,
  statuses,
  tone,
}: {
  src: string;
  label: string;
  evidence: Evidence[];
  statuses?: EvidenceStatus[];
  tone: string;
}) {
  return (
    <div>
      <div
        className="relative overflow-hidden rounded-lg border"
        style={{ borderColor: `${tone}66` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} className="block w-full" />
        <EvidenceBoxes evidence={evidence} statuses={statuses} />
      </div>
      <p
        className="mt-1 text-center font-mono text-[9px] tracking-[0.2em]"
        style={{ color: tone }}
      >
        {label}
      </p>
    </div>
  );
}
