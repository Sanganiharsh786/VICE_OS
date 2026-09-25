/**
 * Evidence — what the lens caught, and what it costs you.
 *
 * A frame shot in Leonida Live carries a list of identifiable subjects with
 * the rectangle each one occupied when the shutter fired. That rectangle is
 * the whole reason the Image Lab has stakes: the forensic pass re-reads the
 * export inside those exact boxes, so covering a face is measured on the face
 * rather than on the picture as a whole.
 */

/** Normalised to the capture frame: 0..1, origin top-left. */
export type Box = { x: number; y: number; w: number; h: number };

export type Evidence = {
  kind: string;
  label: string;
  /** Present only for frames shot in Leonida Live. */
  box?: Box;
};

/** What each kind of identifiable subject is worth if you leave it in. */
export const EVIDENCE_HEAT: Record<string, number> = {
  FACE: 9,
  PLATE: 6,
  LANDMARK: 5,
  CONTRABAND: 12,
};

export const EVIDENCE_TINT: Record<string, string> = {
  FACE: "#ff2e97",
  PLATE: "#22e6ff",
  LANDMARK: "#ffb347",
  CONTRABAND: "#ff3b30",
};

export function heatOf(kind: string) {
  return EVIDENCE_HEAT[kind] ?? 4;
}

export function tintOf(kind: string) {
  return EVIDENCE_TINT[kind] ?? "#ffffff";
}

/** Total heat the frame is worth before any editing. */
export function rawExposure(evidence: Evidence[] | undefined) {
  if (!evidence?.length) return 0;
  return evidence.reduce((a, e) => a + heatOf(e.kind), 0);
}
