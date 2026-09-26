"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageEditorRef } from "@unlayer/react-image-editor";
import { heatOf, tintOf, rawExposure, type Evidence } from "@/lib/evidence";
import {
  CANCEL_LABELS,
  editorOptions,
  SAVE_LABELS,
  type Surface,
} from "@/lib/editorConfig";
import EvidenceBoxes from "@/components/forensic/EvidenceBoxes";
import {
  useLiveForensics,
  type ReelFrame,
  type TimelineStep,
} from "@/components/forensic/useLiveForensics";

const ImageEditor = dynamic(() => import("@unlayer/react-image-editor"), {
  ssr: false,
  loading: () => <StageSkeleton />,
});

function StageSkeleton() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-vice-ink">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,46,151,0.18),transparent_60%)]" />
      <div className="sweep absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-vice-cyan/25 to-transparent" />
      <div className="relative text-center">
        <p className="headline text-3xl text-vice-cyan neon-cyan">IMAGE LAB</p>
        <p className="mt-2 font-mono text-[11px] tracking-[0.3em] text-white/50">
          WARMING UP THE DARKROOM…
        </p>
      </div>
    </div>
  );
}

/**
 * The editor's own Save control, located by the label our `translations` put
 * on it. Each surface renames it (RUN FORENSICS / SEND TO PRESS / ISSUE
 * LICENSE), so this matches any of them — and still matches the stock "save"
 * if a future editor build stops honouring the override.
 */
function findSaveButton(root: HTMLElement | null) {
  if (!root) return null;
  return (
    [...root.querySelectorAll("button")].find((b) =>
      SAVE_LABELS.includes(b.textContent?.trim().toLowerCase() ?? ""),
    ) ?? null
  );
}

export type StageMission = {
  /** Big label for what the player is editing. */
  title: string;
  /** One line of in-world direction. */
  brief: string;
  /** Three nudges shown as a checklist. */
  hints: string[];
  accent: "pink" | "cyan" | "lime";
  commitLabel: string;
  /**
   * Which in-world machine this is. Drives the editor's own vocabulary and
   * tool icons through `translations` / `features` — see `lib/editorConfig`.
   */
  surface: Surface;
};

const ACCENTS = {
  pink: {
    text: "text-vice-pink",
    border: "border-vice-pink/50",
    glow: "shadow-[0_0_40px_-8px_rgba(255,46,151,0.8)]",
    bg: "bg-vice-pink",
    raw: "#ff2e97",
  },
  cyan: {
    text: "text-vice-cyan",
    border: "border-vice-cyan/50",
    glow: "shadow-[0_0_40px_-8px_rgba(34,230,255,0.8)]",
    bg: "bg-vice-cyan",
    raw: "#22e6ff",
  },
  lime: {
    text: "text-vice-lime",
    border: "border-vice-lime/50",
    glow: "shadow-[0_0_40px_-8px_rgba(157,255,61,0.8)]",
    bg: "bg-vice-lime",
    raw: "#9dff3d",
  },
} as const;

const EMPTY_EVIDENCE: Evidence[] = [];

export default function EditorStage({
  image,
  mission,
  evidence = EMPTY_EVIDENCE,
  onCommit,
  onCancel,
  onStreet,
}: {
  image: string;
  mission: StageMission;
  /**
   * Identifiable subjects the lens caught. When present, the lab turns into a
   * scored job: the rail shows what is still readable and the commit button
   * is the forensic scan.
   */
  evidence?: Evidence[];
  /**
   * The export, the edit history the live panel observed getting there, and
   * every settled canvas it filmed on the way.
   */
  onCommit: (
    dataUrl: string,
    timeline: TimelineStep[],
    reel: ReelFrame[],
  ) => void;
  onCancel: () => void;
  /**
   * Present when this frame came in from Leonida Live. The lab is a full-screen
   * stage with no phone chrome around it, so without this the only way back to
   * the 3D street is out through the film roll — which is not a route anyone
   * finds on their own.
   */
  onStreet?: () => void;
}) {
  const ref = useRef<ImageEditorRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const accent = ACCENTS[mission.accent];
  // Memoised per surface inside editorOptions(), so the identity is stable
  // across renders and the editor never re-applies its mount options.
  const options = editorOptions(mission.surface);

  const boxed = useMemo(() => evidence.filter((e) => e.box), [evidence]);
  const scored = evidence.length > 0;

  /*
   * Poll for unsaved edits so the chrome can reflect the editor's state — and
   * while we're in the DOM anyway, mark the editor's own save/cancel pair.
   *
   * Teaching the toolbar our vocabulary left RUN FORENSICS on screen twice,
   * once in the OS chrome and once in the editor's own bar. The chrome's copy
   * is the one carrying the mission, so the editor's is marked and hidden by a
   * single CSS rule — the rest of that bar (step back, step forward, layers,
   * zoom) stays. The button still exists, which matters: `commit()` drives it.
   */
  useEffect(() => {
    const t = setInterval(() => {
      const e = ref.current?.editor;
      if (e) {
        try {
          setTouched(e.hasChanges());
        } catch {
          /* editor still booting */
        }
      }
      const root = stage.current;
      if (!root) return;
      for (const b of root.querySelectorAll("button")) {
        const text = b.textContent?.trim().toLowerCase() ?? "";
        if (SAVE_LABELS.includes(text) || CANCEL_LABELS.includes(text)) {
          b.dataset.viceDupe = "1";
        }
      }
    }, 900);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const working = useCallback(() => {
    try {
      return ref.current?.editor?.getImage();
    } catch {
      return null;
    }
  }, []);

  const live = useLiveForensics(working, image, evidence, ready && touched);

  // `commit` is called from the editor's own save handler, which closes over
  // whatever render created it — the timeline is read from a ref so a save
  // always ships the latest history rather than a stale one.
  const liveRef = useRef({ timeline: live.timeline, reel: live.reel });
  useEffect(() => {
    liveRef.current = { timeline: live.timeline, reel: live.reel };
  }, [live.timeline, live.reel]);

  /**
   * Hand the edit back to the app.
   *
   * Called with a dataUrl by the editor's own onSave. Called bare by our
   * commit button, and that path deliberately routes through the editor's
   * Save control rather than getImage(): getImage() returns the working
   * canvas *before* the active filter preset is baked in, so a
   * filter-only edit would come back byte-identical to the original and
   * the forensic diff would read 0%.
   */
  const commit = (dataUrl?: string | null) => {
    if (dataUrl) {
      onCommit(dataUrl, liveRef.current.timeline, liveRef.current.reel);
      return;
    }
    const save = findSaveButton(stage.current);
    if (save) {
      save.click();
      return;
    }
    // The editor's markup changed out from under us — fall back to the
    // flattened canvas so the player never gets stuck in the lab.
    const out = ref.current?.editor?.getImage();
    if (out) onCommit(out, liveRef.current.timeline, liveRef.current.reel);
  };

  /**
   * Put the capture back on the canvas without leaving the lab.
   *
   * `editor.reset(image)` clears the undo stack and reloads the frame, which
   * is exactly the "start this one again, the other way" move the whole game
   * is built around — the player can take a second run at the same photograph
   * and the report will put both outcomes side by side. Doing it through the
   * editor rather than by remounting keeps the tool rail, the zoom and the
   * warmed bundle in place, so the reset is instant.
   */
  const reshoot = () => {
    const e = ref.current?.editor;
    if (!e) return;
    void Promise.resolve(e.reset(image)).catch(() => {
      /* the editor refused — the DISCARD route still works */
    });
  };

  const exposure = rawExposure(evidence);
  const estimatedHeat = scored
    ? Math.round(
        evidence.reduce(
          (a, e, i) => a + heatOf(e.kind) * (1 - (live.concealment[i] ?? 0) / 100),
          0,
        ),
      )
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-vice-void/95 backdrop-blur-xl pop-in">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,46,151,0.16),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(34,230,255,0.12),transparent_55%)]" />

      {/* chrome: top */}
      <header className="relative z-10 flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg border ${accent.border} ${accent.glow}`}
        >
          <span className={`text-lg ${accent.text}`}>◉</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="headline truncate text-lg leading-none sm:text-2xl">
            {mission.title}
          </p>
          <p className="mt-1 truncate font-mono text-[10px] tracking-[0.24em] text-white/45">
            VICE OS // IMAGE LAB — UNLAYER ENGINE
          </p>
        </div>

        <div className="hidden items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-white/50 md:flex">
          <span
            className={`h-1.5 w-1.5 rounded-full ${touched ? accent.bg : "bg-white/25"}`}
          />
          {touched ? "UNSAVED EDITS" : "ORIGINAL FRAME"}
        </div>

        <div className="flex items-center gap-2">
          {scored && (
            <button
              onClick={() => setRailOpen((v) => !v)}
              className="rounded-lg border border-vice-cyan/40 px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-vice-cyan transition hover:bg-vice-cyan/10 lg:hidden"
              aria-expanded={railOpen}
            >
              {railOpen ? "HIDE ✕" : `EVIDENCE ${evidence.length}`}
            </button>
          )}
          {touched && (
            <button
              onClick={reshoot}
              className="hidden rounded-lg border border-white/15 px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-white/60 transition hover:border-vice-cyan/60 hover:text-vice-cyan sm:block"
              title="Put the untouched capture back on the canvas and take another run at it"
            >
              START OVER
            </button>
          )}
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
            onClick={onCancel}
            className="rounded-lg border border-white/15 px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white"
          >
            DISCARD
          </button>
          <button
            onClick={() => commit()}
            disabled={!ready}
            className={`rounded-lg px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em] text-vice-void transition disabled:opacity-40 ${accent.bg} hover:brightness-110`}
          >
            {mission.commitLabel}
          </button>
        </div>
      </header>

      {/* brief strip */}
      <div className="relative z-10 flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-white/5 bg-black/30 px-4 py-2 sm:px-6">
        <p className="line-clamp-2 text-xs text-white/70">{mission.brief}</p>
        <ul className="hidden flex-wrap gap-x-4 gap-y-1 sm:flex">
          {mission.hints.map((h) => (
            <li
              key={h}
              className="font-mono text-[10px] tracking-[0.12em] text-white/40"
            >
              <span className={accent.text}>▸</span> {h}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1">
        {/* the editor — always the biggest thing on screen */}
        <div className="min-w-0 flex-1 overflow-hidden p-2 sm:p-4">
          <div
            ref={stage}
            className="image-lab relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40"
          >
            <ImageEditor
              ref={ref}
              image={image}
              // The stage supplies the height (see .image-lab in globals.css);
              // a min-height here would only fight it.
              minHeight={0}
              style={{ height: "100%", width: "100%" }}
              options={options}
              onLoad={() => setReady(true)}
              onSave={({ dataUrl }) => commit(dataUrl)}
              onCancel={onCancel}
              onLoadError={() => setReady(true)}
              onError={(err) => console.error("[vice-os] image lab:", err)}
            />
          </div>
        </div>

        {/* forensic rail */}
        {scored && (
          <aside
            className={`vice-scroll w-[272px] shrink-0 overflow-y-auto border-l border-white/10 bg-black/50 p-4 lg:block ${
              railOpen
                ? "absolute inset-y-0 right-0 z-20 block backdrop-blur-xl"
                : "hidden"
            }`}
          >
            <p className="font-mono text-[9px] tracking-[0.26em] text-white/40">
              FORENSIC STATUS
            </p>

            {boxed.length > 0 && (
              <div className="relative mt-3 overflow-hidden rounded-lg border border-white/15">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="original frame" className="block w-full" />
                <EvidenceBoxes evidence={evidence} dim />
                <span className="absolute left-1 top-1 bg-black/70 px-1 font-mono text-[7px] tracking-[0.16em] text-white/60">
                  ORIGINAL FRAME
                </span>
              </div>
            )}

            <div className="mt-4">
              <Meter
                label="IDENTIFIABILITY"
                value={boxed.length ? live.identifiability : 100}
                tint={
                  live.identifiability > 60
                    ? "#ff3b30"
                    : live.identifiability > 25
                      ? "#ffb347"
                      : "#9dff3d"
                }
                invert
              />
            </div>

            <div className="mt-4 space-y-3">
              {evidence.map((e, i) => (
                <Meter
                  key={`${e.label}-${i}`}
                  label={e.label}
                  value={100 - (live.concealment[i] ?? 0)}
                  tint={tintOf(e.kind)}
                  invert
                />
              ))}
            </div>

            {live.timeline.length > 1 && (
              <div className="mt-5">
                <p className="font-mono text-[9px] tracking-[0.26em] text-white/40">
                  EDIT HISTORY
                </p>
                <ol className="mt-2 space-y-0.5">
                  {live.timeline.map((s, i) => (
                    <li key={`${s.label}-${i}`} className="rise-in">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-[9px] tracking-[0.12em] text-white/60">
                          {s.label}
                        </span>
                        <span className="font-mono text-[9px] tabular-nums text-vice-cyan">
                          {s.identifiability}%
                        </span>
                      </div>
                      {i < live.timeline.length - 1 && (
                        <span className="ml-1 block font-mono text-[9px] leading-tight text-white/20">
                          ↓
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-3">
              <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">
                ESTIMATED HEAT
              </p>
              <p
                className="headline text-3xl leading-none"
                style={{
                  color: estimatedHeat > 4 ? "#ff3b30" : "#9dff3d",
                }}
              >
                {estimatedHeat > 0 ? `+${estimatedHeat}` : "0"}
              </p>
              <p className="mt-1 font-mono text-[9px] tracking-[0.12em] text-white/30">
                RAW EXPOSURE WAS +{exposure}
              </p>
            </div>

            <p className="mt-3 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-white/30">
              {live.live
                ? "LIVE ESTIMATE FROM THE WORKING CANVAS. THE AUTHORITATIVE SCAN RUNS ON THE EXPORTED FILE."
                : boxed.length
                  ? "START EDITING — THE PANEL READS YOUR CANVAS EVERY FEW SECONDS."
                  : "THIS FRAME HAS NO RECORDED SUBJECT RECTANGLES. THE SCAN WILL SCORE THE WHOLE SURFACE."}
            </p>

            <button
              onClick={() => commit()}
              disabled={!ready}
              className={`mt-4 w-full rounded-xl px-4 py-3 font-mono text-[11px] font-bold tracking-[0.2em] text-vice-void transition disabled:opacity-40 ${accent.bg} hover:brightness-110`}
            >
              {mission.commitLabel}
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  tint,
  invert = false,
}: {
  label: string;
  value: number;
  tint: string;
  /** Fill drains as the number drops — used for "how much is left readable". */
  invert?: boolean;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[9px] tracking-[0.16em] text-white/45">
          {label}
        </span>
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{ color: invert && v < 25 ? "#9dff3d" : tint }}
        >
          {v}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{
            width: `${v}%`,
            background: invert && v < 25 ? "#9dff3d" : tint,
          }}
        />
      </div>
    </div>
  );
}
