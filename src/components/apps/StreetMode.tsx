"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  StreetEngine,
  developPhoto,
  type Quality,
  type Stats,
} from "@/lib/three/engine";

export type StreetPhoto = {
  src: string;
  title: string;
  location: string;
  evidence: { kind: string; label: string }[];
};

const EMPTY: Stats = {
  speed: 0,
  heading: "N",
  aiming: false,
  inFrame: [],
  fps: 60,
};

const KIND_TINT: Record<string, string> = {
  FACE: "#ff2e97",
  PLATE: "#22e6ff",
  LANDMARK: "#ffb347",
  CONTRABAND: "#ff3b30",
};

/**
 * The 3D half of the loop. You walk Leonida in third person, raise the phone,
 * and whatever the shutter catches becomes the frame you take into the Image
 * Lab — including a list of everything identifiable that was in it.
 */
export default function StreetMode({
  heat,
  onExit,
  onShoot,
}: {
  heat: number;
  onExit: () => void;
  onShoot: (photo: StreetPhoto) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StreetEngine | null>(null);
  const statsRef = useRef<Stats>(EMPTY);

  const [stats, setStats] = useState<Stats>(EMPTY);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState<Quality>("high");

  /* ---------------- engine lifecycle ---------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let engine: StreetEngine | null = null;
    // one frame of breathing room so the loading card paints before the
    // world build blocks the thread
    const t = setTimeout(() => {
      try {
        engine = new StreetEngine({
          canvas,
          container: wrap,
          quality,
          onStats: (s) => {
            statsRef.current = s;
          },
        });
        engineRef.current = engine;
        engine.start();
        setReady(true);
      } catch (err) {
        console.error("[vice-os] street mode:", err);
        setFailed(
          err instanceof Error && /webgl/i.test(err.message)
            ? "This device can't open a WebGL context."
            : "The street didn't load on this device.",
        );
      }
    }, 60);

    return () => {
      clearTimeout(t);
      engine?.dispose();
      engineRef.current = null;
    };
  }, [quality]);

  // Publishing every frame would re-render React 60x a second for no reason.
  useEffect(() => {
    const t = setInterval(() => setStats(statsRef.current), 140);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    engineRef.current?.setHeat(heat);
  }, [heat, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  /* ---------------- shutter ---------------- */
  const shoot = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || busy) return;
    setBusy(true);
    engine.setAim(true);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    try {
      const shot = engine.capture();
      const src = await developPhoto(shot.dataUrl, shot.title, shot.location);
      onShoot({
        src,
        title: shot.title,
        location: shot.location,
        evidence: shot.evidence,
      });
    } catch (err) {
      console.error("[vice-os] capture:", err);
      setBusy(false);
    }
  }, [busy, onShoot]);

  /* ---------------- touch controls ---------------- */
  const stickRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });

  const stickMove = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId) return;
    const el = stickRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2);
    let dy = (e.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    setKnob({ x: dx, y: dy });
    engineRef.current?.setStick(dx, dy);
  };

  const stickEnd = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId) return;
    stickId.current = null;
    setKnob({ x: 0, y: 0 });
    engineRef.current?.setStick(0, 0);
  };

  if (failed) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-vice-void p-8 text-center">
        <p className="headline text-3xl text-vice-blood">SIGNAL LOST</p>
        <p className="max-w-sm text-sm text-white/60">{failed}</p>
        <p className="max-w-sm font-mono text-[10px] leading-relaxed tracking-[0.14em] text-white/35">
          THE CAMERA ROLL STILL HAS PAINTED FRAMES — THE IMAGE LAB WORKS EITHER WAY.
        </p>
        <button
          onClick={onExit}
          className="rounded-lg bg-vice-pink px-5 py-2 font-mono text-[10px] font-bold tracking-[0.2em] text-vice-void"
        >
          BACK TO THE PHONE
        </button>
      </div>
    );
  }

  const aiming = stats.aiming;

  return (
    <div className="fixed inset-0 z-50 bg-vice-void pop-in">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none select-none"
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") return;
            if (lookId.current === null) {
              lookId.current = e.pointerId;
              lookLast.current = { x: e.clientX, y: e.clientY };
            }
          }}
          onPointerMove={(e) => {
            if (lookId.current !== e.pointerId) return;
            engineRef.current?.addLook(
              e.clientX - lookLast.current.x,
              e.clientY - lookLast.current.y,
            );
            lookLast.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            if (lookId.current === e.pointerId) lookId.current = null;
          }}
          onPointerCancel={() => {
            lookId.current = null;
          }}
        />
      </div>

      {/* viewfinder mask — the 4:5 crop the shutter actually keeps */}
      {aiming && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-full" style={{ aspectRatio: "4 / 5" }}>
            <div className="absolute inset-0 border border-white/25" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/10" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/10" />
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/10" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/10" />
            <span className="absolute left-2 top-2 font-mono text-[10px] tracking-[0.2em] text-vice-pink">
              ● REC 4:5
            </span>
            <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-vice-pink/70" />
          </div>
          <div className="absolute inset-0 shadow-[inset_0_0_140px_60px_rgba(0,0,0,0.75)]" />
        </div>
      )}

      {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}

      {/* top chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="glass-deep pointer-events-auto rounded-xl px-3 py-2">
          <p className="font-mono text-[9px] tracking-[0.24em] text-vice-cyan">
            VICE OS // LEONIDA LIVE
          </p>
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-white/55">
            {stats.heading} · {(stats.speed * 3.6).toFixed(0)} KM/H ·{" "}
            {stats.fps.toFixed(0)} FPS
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => setQuality((q) => (q === "high" ? "low" : "high"))}
            className="glass-deep rounded-xl px-3 py-2 font-mono text-[9px] tracking-[0.18em] text-white/60 transition hover:text-white"
          >
            {quality === "high" ? "HIGH" : "LOW"}
          </button>
          <button
            onClick={onExit}
            className="glass-deep rounded-xl px-3 py-2 font-mono text-[9px] tracking-[0.18em] text-white/70 transition hover:text-vice-pink"
          >
            EXIT ✕
          </button>
        </div>
      </div>

      {/* what the lens can identify right now */}
      <div className="pointer-events-none absolute right-4 top-24 w-[190px] space-y-1.5">
        <p className="text-right font-mono text-[9px] tracking-[0.24em] text-white/40">
          IN FRAME
        </p>
        {stats.inFrame.length === 0 ? (
          <p className="text-right font-mono text-[10px] text-vice-lime/70">
            NOTHING IDENTIFIABLE
          </p>
        ) : (
          stats.inFrame.slice(0, 5).map((e) => (
            <p
              key={e.label}
              className="text-right font-mono text-[10px] tracking-[0.1em]"
              style={{ color: KIND_TINT[e.kind] ?? "#fff" }}
            >
              {e.label}
            </p>
          ))
        )}
      </div>

      {/* bottom chrome */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 sm:p-6">
        {/* left: stick (touch) / key legend (desktop) */}
        <div
          ref={stickRef}
          onPointerDown={(e) => {
            stickId.current = e.pointerId;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            stickMove(e);
          }}
          onPointerMove={stickMove}
          onPointerUp={stickEnd}
          onPointerCancel={stickEnd}
          className="relative h-28 w-28 shrink-0 touch-none rounded-full border border-white/15 bg-black/35 backdrop-blur md:hidden"
        >
          <div
            className="absolute left-1/2 top-1/2 h-11 w-11 rounded-full bg-white/25"
            style={{
              transform: `translate(-50%,-50%) translate(${knob.x * 34}px, ${knob.y * 34}px)`,
            }}
          />
        </div>

        <div className="hidden md:block">
          <div className="glass-deep rounded-xl px-3 py-2 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/45">
            <p>
              <span className="text-vice-cyan">WASD</span> MOVE ·{" "}
              <span className="text-vice-cyan">SHIFT</span> SPRINT ·{" "}
              <span className="text-vice-cyan">SPACE</span> JUMP
            </p>
            <p>
              <span className="text-vice-cyan">MOUSE</span> LOOK (CLICK TO GRAB) ·{" "}
              <span className="text-vice-cyan">F</span> RAISE PHONE
            </p>
          </div>
        </div>

        {/* right: camera controls */}
        <div className="flex items-center gap-3">
          <button
            onPointerDown={() => engineRef.current?.setRun(true)}
            onPointerUp={() => engineRef.current?.setRun(false)}
            onPointerLeave={() => engineRef.current?.setRun(false)}
            className="h-14 w-14 shrink-0 touch-none rounded-full border border-white/20 bg-black/40 font-mono text-[9px] tracking-[0.12em] text-white/70 backdrop-blur md:hidden"
          >
            RUN
          </button>
          <button
            onClick={() => engineRef.current?.jump()}
            className="h-14 w-14 shrink-0 touch-none rounded-full border border-white/20 bg-black/40 font-mono text-[9px] tracking-[0.12em] text-white/70 backdrop-blur md:hidden"
          >
            JUMP
          </button>
          <button
            onClick={() => {
              const on = engineRef.current?.toggleAim();
              setStats((s) => ({ ...s, aiming: !!on }));
            }}
            className={`rounded-xl border px-4 py-3 font-mono text-[10px] font-bold tracking-[0.18em] transition ${
              aiming
                ? "border-vice-cyan bg-vice-cyan/15 text-vice-cyan"
                : "border-white/20 bg-black/40 text-white/70"
            }`}
          >
            {aiming ? "PHONE UP" : "RAISE PHONE"}
          </button>
          <button
            onClick={shoot}
            disabled={busy}
            className="group relative h-20 w-20 shrink-0 rounded-full border-4 border-white/80 bg-transparent transition disabled:opacity-50"
            aria-label="Take the shot"
          >
            <span className="absolute inset-1.5 rounded-full bg-vice-pink transition group-hover:brightness-110 group-active:scale-90" />
            <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold tracking-[0.1em] text-vice-void">
              {busy ? "…" : "SHOOT"}
            </span>
          </button>
        </div>
      </div>

      {/* hint strip */}
      {!aiming && ready && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[7.5rem] text-center font-mono text-[10px] tracking-[0.2em] text-white/35 md:bottom-28">
          RAISE THE PHONE TO FRAME A 4:5 SHOT · THE SHUTTER FEEDS THE IMAGE LAB
        </p>
      )}

      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-vice-void">
          <p className="headline flicker text-4xl text-vice-pink neon-text">
            LEONIDA
          </p>
          <p className="font-mono text-[10px] tracking-[0.3em] text-vice-cyan">
            BUILDING THE BLOCK…
          </p>
          <p className="max-w-xs text-center font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/30">
            SKELETONS RIGGED · SURFACES SKINNED · SIGNAGE PAINTED — ALL AT RUNTIME,
            NO ASSETS
          </p>
        </div>
      )}
    </div>
  );
}
