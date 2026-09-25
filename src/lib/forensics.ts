/**
 * FORENSIC VISION — the scoring half of VICE OS.
 *
 * Everything in here is a measurement of two actual images: the frame the
 * camera produced, and the file the Image Lab exported. Nothing is invented
 * for the sake of the UI. The whole-frame numbers still come from
 * `analyzeEdit` in art.ts, which remains the source of truth for altered
 * surface, coverage, grade shift and reframing; this module adds the part
 * that makes the edit a *game*: it re-reads the export inside the rectangle
 * each identifiable subject occupied, so hiding a face is scored on the face.
 *
 * METHOD (documented because §23 asks for it)
 *
 * Both images are normalised to the same square thumbnail before comparison,
 * which is how a crop or a resize still lines up. A subject's box is read at
 * the same normalised coordinates in both images and the per-pixel channel
 * delta inside it is bucketed:
 *
 *   delta > 150  → the pixel was painted over, not graded. Full credit.
 *   delta >  48  → the pixel moved enough that a matcher would struggle.
 *                  Partial credit, scaled by how far it moved.
 *
 * The mean of those credits is the subject's CONCEALMENT, 0-100. A crop that
 * removes the subject lands here too: the content at that location is now
 * something else entirely, so the deltas are enormous and concealment goes to
 * ~100. That is the correct answer — the subject is no longer recoverable
 * from the exported file — and it is why the report calls that case REMOVED
 * rather than HIDDEN.
 */

import { analyzeEdit, type Forensics } from "./art";
import { heatOf, type Box, type Evidence } from "./evidence";

export type { Forensics };

export type EvidenceStatus = "VISIBLE" | "PARTIAL" | "HIDDEN" | "REMOVED";

export type EvidenceFinding = {
  kind: string;
  label: string;
  box?: Box;
  /** 0-100. How much of the subject's footprint stopped being itself. */
  concealment: number;
  status: EvidenceStatus;
  /** Heat this subject is worth at full exposure. */
  raw: number;
  /** Heat it still costs after the edit. */
  remaining: number;
};

export type Report = {
  forensics: Forensics;
  findings: EvidenceFinding[];
  /** 0-100 composite of altered surface, coverage and reframing. */
  scrub: number;
  /** Sum of every subject's full price. */
  rawExposure: number;
  /** What the edit bought back. */
  discount: number;
  /** Heat from the evidence alone, after the edit. */
  evidenceHeat: number;
  /** Every subject hidden or removed, and there was something to hide. */
  perfect: boolean;
  /** At least one subject is still identifiable. */
  failed: boolean;
};

/* ------------------------------------------------------------------ */
/* whole-frame                                                         */
/* ------------------------------------------------------------------ */

/** How hard did the player scrub the frame? 0 = raw export, 100 = unrecognisable. */
export function scrubScore(f: Forensics) {
  return Math.max(
    0,
    Math.min(100, f.altered * 0.55 + f.coverage * 0.9 + (f.reframed ? 15 : 0)),
  );
}

export const EMPTY_FORENSICS: Forensics = {
  altered: 0,
  intensity: 0,
  temperature: 0,
  reframed: false,
  coverage: 0,
};

/* ------------------------------------------------------------------ */
/* region diff                                                         */
/* ------------------------------------------------------------------ */

const N = 192;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

function thumb(img: HTMLImageElement, n: number) {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, n, n);
  return ctx.getImageData(0, 0, n, n).data;
}

/**
 * Mean per-pixel "this stopped being itself" credit over a region, 0..1.
 * Pass no box to measure the whole frame.
 */
function creditOf(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  n: number,
  box?: Box,
) {
  const x0 = box ? Math.max(0, Math.floor(box.x * n)) : 0;
  const y0 = box ? Math.max(0, Math.floor(box.y * n)) : 0;
  const x1 = box ? Math.min(n, Math.ceil((box.x + box.w) * n)) : n;
  const y1 = box ? Math.min(n, Math.ceil((box.y + box.h) * n)) : n;
  if (x1 <= x0 || y1 <= y0) return 0;

  let credit = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * n + x) * 4;
      const d =
        Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2]);
      if (d > 150) credit += 1;
      else if (d > 48) credit += (d - 48) / 102;
      count++;
    }
  }
  return count ? credit / count : 0;
}

/**
 * Concealment of one box, 0-100.
 *
 * The raw region credit is normalised against the frame-wide credit first.
 * Exporting through the editor resamples and re-encodes the whole picture, so
 * every pixel moves a little even when the player changed nothing local; a
 * grade or a resize moves all of them a lot. That is a property of the frame,
 * not of the subject, and without this correction a global filter would read
 * as though every face had been covered. What is left after subtracting the
 * floor is the change that happened *here and not everywhere* — which is
 * exactly what covering a face is.
 *
 * Exported so the live panel in the Image Lab can run the identical maths on
 * a cheaper thumbnail while the player is still working.
 */
export function concealmentOf(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  n: number,
  box: Box,
  floor = 0,
) {
  const region = creditOf(a, b, n, box);
  if (floor >= 0.995) return Math.round(region * 100);
  return Math.max(0, Math.round(((region - floor) / (1 - floor)) * 100));
}

/** The frame-wide credit, to be passed to `concealmentOf` as its floor. */
export function noiseFloor(a: Uint8ClampedArray, b: Uint8ClampedArray, n: number) {
  return creditOf(a, b, n);
}

function statusFor(concealment: number, reframed: boolean): EvidenceStatus {
  if (concealment >= 80) return reframed && concealment >= 92 ? "REMOVED" : "HIDDEN";
  if (concealment >= 38) return "PARTIAL";
  return "VISIBLE";
}

/* ------------------------------------------------------------------ */
/* the authoritative pass                                              */
/* ------------------------------------------------------------------ */

/**
 * Run the full scan: whole-frame diff plus one reading per identifiable
 * subject. This is what the report, the heat and the contracts are scored on.
 */
export async function runForensics(
  originalSrc: string,
  editedSrc: string,
  evidence: Evidence[] | undefined,
): Promise<Report> {
  let forensics: Forensics;
  try {
    forensics = await analyzeEdit(originalSrc, editedSrc);
  } catch {
    forensics = EMPTY_FORENSICS;
  }

  const scrub = scrubScore(forensics);
  const findings: EvidenceFinding[] = [];

  const boxed = evidence?.filter((e) => e.box) ?? [];
  let a: Uint8ClampedArray | null = null;
  let b: Uint8ClampedArray | null = null;
  let floor = 0;
  if (boxed.length) {
    try {
      const [ia, ib] = await Promise.all([
        loadImage(originalSrc),
        loadImage(editedSrc),
      ]);
      a = thumb(ia, N);
      b = thumb(ib, N);
      /*
       * A reframed export no longer addresses the same content at the same
       * coordinates, so there is no meaningful "everywhere" to subtract — the
       * raw reading already answers the question the report asks, which is
       * whether the subject is still recoverable from this file at this spot.
       */
      floor = forensics.reframed ? 0 : noiseFloor(a, b, N);
    } catch {
      /* fall through to the whole-frame estimate below */
    }
  }

  for (const e of evidence ?? []) {
    const raw = heatOf(e.kind);
    /*
     * Imported and camera-roll frames have no box — the engine never saw
     * them. Those fall back to the whole-frame scrub, which is the same
     * discount curve the project shipped with.
     */
    const concealment =
      e.box && a && b
        ? concealmentOf(a, b, N, e.box, floor)
        : Math.round(Math.min(100, scrub * 1.18));
    const remaining = raw * (1 - concealment / 100);
    findings.push({
      kind: e.kind,
      label: e.label,
      box: e.box,
      concealment,
      status: statusFor(concealment, forensics.reframed),
      raw,
      remaining: Math.round(remaining * 10) / 10,
    });
  }

  const rawExposure = findings.reduce((s, f) => s + f.raw, 0);
  const evidenceHeat = findings.reduce((s, f) => s + f.remaining, 0);

  return {
    forensics,
    findings,
    scrub,
    rawExposure,
    discount: Math.round((rawExposure - evidenceHeat) * 10) / 10,
    evidenceHeat,
    perfect:
      findings.length > 0 &&
      findings.every((f) => f.status === "HIDDEN" || f.status === "REMOVED"),
    failed: findings.some((f) => f.status === "VISIBLE"),
  };
}

/* ------------------------------------------------------------------ */
/* heat                                                                */
/* ------------------------------------------------------------------ */

export type HeatLine = { label: string; value: number; kind: "add" | "sub" };

export type HeatBreakdown = {
  lines: HeatLine[];
  rawExposure: number;
  discount: number;
  final: number;
};

/**
 * The single formula for what a post costs. The composer's projection and the
 * heat actually taken both come through here, so the number the player is
 * shown before publishing is the number they get.
 */
export function heatFor(
  report: Report,
  tags: string[],
  tagTable: { label: string; heat: number }[],
): HeatBreakdown {
  const lines: HeatLine[] = [];

  for (const f of report.findings) {
    if (f.raw > 0) lines.push({ label: f.label, value: f.raw, kind: "add" });
  }

  const tagHeat = tagTable
    .filter((t) => tags.includes(t.label))
    .reduce((a, t) => a + t.heat, 0);
  if (tagHeat > 0) lines.push({ label: "TAGS", value: tagHeat, kind: "add" });

  // Posting at all puts the frame in front of people.
  const base = 6;
  lines.push({ label: "PUBLISHING", value: base, kind: "add" });

  const rawExposure = report.rawExposure + tagHeat + base;

  /*
   * The scrub discount applies to the whole post: the evidence discount is
   * measured per subject, the tag and publishing exposure is discounted by
   * how unrecognisable the frame as a whole became.
   */
  const frameDiscount = (tagHeat + base) * Math.min(0.85, report.scrub / 130);
  const discount = report.discount + frameDiscount;

  // A completely untouched upload is worse than a bad edit.
  const lazy = report.scrub < 8 ? 5 : -3;
  if (lazy > 0) lines.push({ label: "UNTOUCHED FRAME", value: lazy, kind: "add" });
  else lines.push({ label: "EDITED", value: -lazy, kind: "sub" });

  const final = Math.max(-6, Math.round(rawExposure - discount + lazy));

  return {
    lines,
    rawExposure: Math.round(rawExposure),
    discount: Math.round(discount),
    final,
  };
}

/* ------------------------------------------------------------------ */
/* heat tiers — how the city reads you                                 */
/* ------------------------------------------------------------------ */

export const HEAT_TIERS = [
  { at: 0, name: "QUIET", note: "Nobody is looking at you." },
  { at: 20, name: "NOTICED", note: "Heads turn when you walk past." },
  { at: 40, name: "AVOIDED", note: "People cross the street." },
  { at: 60, name: "DISPATCHED", note: "Scanner 7 is calling your description." },
  { at: 80, name: "STATEWIDE", note: "Every unit in Leonida has your photo." },
];

export function heatTier(heat: number) {
  return [...HEAT_TIERS].reverse().find((t) => heat >= t.at) ?? HEAT_TIERS[0];
}
