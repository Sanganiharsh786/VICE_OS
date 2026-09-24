"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { ImageEditorRef } from "@unlayer/react-image-editor";

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

/** Hoisted so a re-render never hands the editor a fresh options object. */
const EDITOR_OPTIONS = { theme: "dark" } as const;

/** The editor's own Save control, located by label inside our container. */
function findSaveButton(root: HTMLElement | null) {
  if (!root) return null;
  return (
    [...root.querySelectorAll("button")].find(
      (b) => b.textContent?.trim().toLowerCase() === "save",
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
};

const ACCENTS = {
  pink: {
    text: "text-vice-pink",
    border: "border-vice-pink/50",
    glow: "shadow-[0_0_40px_-8px_rgba(255,46,151,0.8)]",
    bg: "bg-vice-pink",
  },
  cyan: {
    text: "text-vice-cyan",
    border: "border-vice-cyan/50",
    glow: "shadow-[0_0_40px_-8px_rgba(34,230,255,0.8)]",
    bg: "bg-vice-cyan",
  },
  lime: {
    text: "text-vice-lime",
    border: "border-vice-lime/50",
    glow: "shadow-[0_0_40px_-8px_rgba(157,255,61,0.8)]",
    bg: "bg-vice-lime",
  },
} as const;

export default function EditorStage({
  image,
  mission,
  onCommit,
  onCancel,
}: {
  image: string;
  mission: StageMission;
  onCommit: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<ImageEditorRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const accent = ACCENTS[mission.accent];

  // Poll for unsaved edits so the chrome can reflect the editor's state.
  useEffect(() => {
    const t = setInterval(() => {
      const e = ref.current?.editor;
      if (!e) return;
      try {
        setTouched(e.hasChanges());
      } catch {
        /* editor still booting */
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
      onCommit(dataUrl);
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
    if (out) onCommit(out);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-vice-void/95 backdrop-blur-xl pop-in">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,46,151,0.16),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(34,230,255,0.12),transparent_55%)]" />

      {/* chrome: top */}
      <header className="relative z-10 flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${accent.border} ${accent.glow}`}>
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

      {/* the editor */}
      <div className="relative z-10 flex-1 overflow-hidden p-2 sm:p-4">
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
            options={EDITOR_OPTIONS}
            onLoad={() => setReady(true)}
            onSave={({ dataUrl }) => commit(dataUrl)}
            onCancel={onCancel}
            onLoadError={() => setReady(true)}
            onError={(err) => console.error("[vice-os] image lab:", err)}
          />
        </div>
      </div>
    </div>
  );
}
