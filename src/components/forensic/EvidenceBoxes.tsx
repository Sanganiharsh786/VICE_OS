"use client";

import { tintOf, type Evidence } from "@/lib/evidence";
import type { EvidenceStatus } from "@/lib/forensics";

const STATUS_TINT: Record<EvidenceStatus, string> = {
  VISIBLE: "#ff3b30",
  PARTIAL: "#ffb347",
  HIDDEN: "#9dff3d",
  REMOVED: "#9dff3d",
};

/**
 * The scanning brackets drawn over a frame. Absolutely positioned inside a
 * `relative` parent that has the photo in it at its natural aspect, so the
 * normalised boxes the engine recorded land exactly where the subjects are.
 */
export default function EvidenceBoxes({
  evidence,
  revealed = Infinity,
  statuses,
  dim = false,
}: {
  evidence: Evidence[];
  /** Animate them in one at a time; pass Infinity for all at once. */
  revealed?: number;
  /** Colour by forensic outcome instead of by kind. */
  statuses?: EvidenceStatus[];
  dim?: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {evidence.map((e, i) => {
        if (!e.box || i >= revealed) return null;
        const tint = statuses?.[i] ? STATUS_TINT[statuses[i]] : tintOf(e.kind);
        const gone = statuses?.[i] === "HIDDEN" || statuses?.[i] === "REMOVED";
        return (
          <div
            key={`${e.label}-${i}`}
            className="absolute pop-in"
            style={{
              left: `${e.box.x * 100}%`,
              top: `${e.box.y * 100}%`,
              width: `${e.box.w * 100}%`,
              height: `${e.box.h * 100}%`,
              animationDelay: `${i * 140}ms`,
              opacity: dim ? 0.55 : 1,
            }}
          >
            {/* corner brackets rather than a full box — reads as a scanner */}
            {(
              [
                "left-0 top-0 border-l-2 border-t-2",
                "right-0 top-0 border-r-2 border-t-2",
                "left-0 bottom-0 border-l-2 border-b-2",
                "right-0 bottom-0 border-r-2 border-b-2",
              ] as const
            ).map((cls) => (
              <span
                key={cls}
                className={`absolute h-2.5 w-2.5 ${cls}`}
                style={{ borderColor: tint }}
              />
            ))}
            <span
              className="absolute inset-0"
              style={{ background: `${tint}1f`, outline: `1px solid ${tint}55` }}
            />
            <span
              className="absolute -top-4 left-0 whitespace-nowrap px-1 font-mono text-[8px] font-bold tracking-[0.14em]"
              style={{
                color: "#06010f",
                background: tint,
                textDecoration: gone ? "line-through" : undefined,
              }}
            >
              {e.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
