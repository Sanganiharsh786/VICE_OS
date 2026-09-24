"use client";

import { useEffect, useState, type ReactNode } from "react";
import { STAR_STEPS, useVice } from "@/lib/store";

export function Star({ filled, size = 14 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={filled ? "drop-shadow-[0_0_6px_rgba(255,211,107,0.9)]" : ""}
    >
      <path
        d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z"
        fill={filled ? "#ffd36b" : "rgba(255,255,255,0.14)"}
        stroke={filled ? "#fff3cf" : "rgba(255,255,255,0.2)"}
        strokeWidth="1"
      />
    </svg>
  );
}

export function Stars({ count, size = 14 }: { count: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} filled={i < count} size={size} />
      ))}
    </div>
  );
}

export function HeatMeter({ compact = false }: { compact?: boolean }) {
  const { heat, starCount } = useVice();
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.24em] text-white/45">
          HEAT
        </span>
        <span className="font-mono text-[10px] tabular-nums text-white/70">
          {heat}/100
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${heat}%`,
            background:
              "linear-gradient(90deg,#22e6ff,#9dff3d 32%,#ffb347 62%,#ff2e97 84%,#ff3b30)",
            boxShadow: "0 0 14px rgba(255,46,151,0.7)",
          }}
        />
        {STAR_STEPS.slice(1).map((s) => (
          <div
            key={s}
            className="absolute inset-y-0 w-px bg-vice-void/70"
            style={{ left: `${s}%` }}
          />
        ))}
      </div>
      {!compact && (
        <div className="mt-2 flex items-center justify-between">
          <Stars count={starCount} />
          <span className="font-mono text-[10px] tracking-[0.18em] text-white/40">
            {["CLEAN", "NOTICED", "PERSON OF INTEREST", "APB", "TASK FORCE", "STATEWIDE"][
              starCount
            ]}
          </span>
        </div>
      )}
    </div>
  );
}

export function Panel({
  label,
  children,
  className = "",
  action,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`glass rounded-2xl p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[10px] tracking-[0.26em] text-white/45">
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AppHeader({
  title,
  sub,
  onBack,
  right,
  tint = "#ff2e97",
}: {
  title: string;
  sub?: string;
  onBack: () => void;
  right?: ReactNode;
  tint?: string;
}) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 px-4 py-3 backdrop-blur-xl"
      style={{
        background: `linear-gradient(180deg, ${tint}22, rgba(6,1,15,0.9))`,
      }}
    >
      <button
        onClick={onBack}
        aria-label="Back to home"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/70 transition hover:border-white/50 hover:text-white"
      >
        ‹
      </button>
      <div className="min-w-0 flex-1">
        <p className="headline truncate text-lg leading-none">{title}</p>
        {sub && (
          <p className="truncate font-mono text-[9px] tracking-[0.22em] text-white/40">
            {sub}
          </p>
        )}
      </div>
      {right}
    </header>
  );
}

export function Btn({
  children,
  onClick,
  tone = "solid",
  disabled,
  className = "",
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "solid" | "ghost" | "cyan" | "lime" | "danger";
  disabled?: boolean;
  className?: string;
  full?: boolean;
}) {
  const tones: Record<string, string> = {
    solid:
      "bg-vice-pink text-vice-void hover:brightness-110 shadow-[0_0_24px_-6px_rgba(255,46,151,0.9)]",
    cyan: "bg-vice-cyan text-vice-void hover:brightness-110 shadow-[0_0_24px_-6px_rgba(34,230,255,0.9)]",
    lime: "bg-vice-lime text-vice-void hover:brightness-110 shadow-[0_0_24px_-6px_rgba(157,255,61,0.9)]",
    danger: "bg-vice-blood text-white hover:brightness-110",
    ghost:
      "border border-white/15 text-white/70 hover:border-white/40 hover:text-white",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/** Counts a number up so stat changes feel alive. */
export function Tally({ value, className = "" }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    let raf = 0;
    const from = shown;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span className={`tabular-nums ${className}`}>{shown.toLocaleString()}</span>;
}

export function Chip({
  children,
  active,
  onClick,
  hot,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  hot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] transition ${
        active
          ? hot
            ? "border-vice-blood bg-vice-blood/20 text-vice-blood"
            : "border-vice-cyan bg-vice-cyan/15 text-vice-cyan"
          : "border-white/12 text-white/50 hover:border-white/35 hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}
