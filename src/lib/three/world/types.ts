/**
 * The contract between the world and the rest of VICE OS.
 *
 * The evidence register is the important half. The city publishes every face,
 * number plate, landmark and piece of contraband that could incriminate you if
 * it ends up in a photograph; the shutter works out which of them were
 * actually in frame and unoccluded, and hands that list to the Image Lab. It
 * is what gives the editing session stakes.
 */

import type * as THREE from "three";

export type EvidenceKind = "FACE" | "PLATE" | "LANDMARK" | "CONTRABAND";

export type EvidenceTag = {
  kind: EvidenceKind;
  label: string;
  /** Followed every frame for moving subjects. */
  object: THREE.Object3D;
  /** Local offset from the object's origin to the incriminating detail. */
  offset: THREE.Vector3;
  /** Roughly how big the detail is, for the in-frame test. */
  radius: number;
};
