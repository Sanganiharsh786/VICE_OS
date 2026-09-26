/**
 * Traffic signals — the timing plan, and where a lens actually sits.
 *
 * This is deliberately a tiny module with no three.js in it, because three
 * files need to agree about signals and any two of them importing each other
 * would close a cycle:
 *
 *  - `roads.ts` builds the mast, the housing and the painted stop line, and
 *    publishes the lens positions it used
 *  - `traffic.ts` colours those lenses and decides where a car has to stop
 *  - `city.ts` hands the list from one to the other
 *
 * That agreement used to be three sets of hand-written offsets. `city.ts`
 * re-derived lamp positions from the intersection centre with its own ±12 and
 * +9 constants, which did not match the mast `roads.ts` had built, so the three
 * coloured lamps floated four metres clear of the housing they belonged to.
 * And `traffic.ts` stopped cars 7.5m from the junction centre while the paint
 * put the stop line at `roadWidth/2 + 5` — on an avenue that is four metres
 * further out, so every car came to rest square in the middle of the zebra.
 * Both numbers live here now.
 */

export type Phase = "green" | "amber" | "red";

/**
 * One full plan, in seconds. The two axes get an identical half each, so a
 * single number describes both approaches and `lightState` just shifts the
 * east-west one by half a cycle.
 */
export const CYCLE = 28;
const HALF_CYCLE = CYCLE / 2;

/** Green, then amber, then whatever is left of the half as all-red. */
const GREEN = 9.5;
const AMBER = 3.2;

/**
 * The all-red clearance between one axis losing amber and the other gaining
 * green — 1.3s here.
 *
 * It is not decoration. Without it the cross street turns green on the exact
 * frame this one turns red, so anything still crossing the box is driven
 * through by traffic that has every right to be there. Amber used to be 1.2s
 * with no clearance at all, which is what made junctions look like vehicles
 * were ignoring the lights.
 */
export const ALL_RED = HALF_CYCLE - GREEN - AMBER;

/** Light shown to traffic on `axis` (0 = north-south) at this intersection. */
export function lightState(axis: 0 | 1, offset: number, t: number): Phase {
  const p = (((t + offset) % CYCLE) + CYCLE) % CYCLE;
  const local = axis === 0 ? p : (p + HALF_CYCLE) % CYCLE;
  if (local < GREEN) return "green";
  if (local < GREEN + AMBER) return "amber";
  return "red";
}

/**
 * How far behind the junction centre the paint goes.
 *
 * The zebra sits from `cross/2 + 0.6` to `cross/2 + 4.2`; the stop line is the
 * next 40cm behind it. `roads.ts` paints to this and `traffic.ts` brakes to it.
 */
export const STOP_BACK = 5;

/** Distance from a junction centre to the stop line on one approach. */
export function stopLineAt(crossWidth: number) {
  return crossWidth / 2 + STOP_BACK;
}

/**
 * Comfortable deceleration, m/s². Both the "can I still stop for this amber?"
 * test and the speed the controller asks for are derived from it, so a car
 * never commits to a stop it would have to skid into.
 */
export const BRAKE = 6.5;

/** Which lens of a head this is. Red, amber, green, then the two ped faces. */
export type LampSlot = 0 | 1 | 2 | 3 | 4;

/**
 * One animated lens, published by whatever built the housing around it.
 *
 * Everything static about a signal — pole, mast arm, backplate, visors — is
 * welded into the city's merged buffers. Only the lenses change colour, so
 * only they are instanced, and they carry the phase they answer to with them.
 */
export type SignalLamp = {
  x: number;
  y: number;
  z: number;
  /** Yaw that points the lens at the traffic it is talking to. */
  rot: number;
  /** Lens radius. */
  r: number;
  /** The approach whose phase this lens shows. 0 = north-south. */
  axis: 0 | 1;
  /** Seconds of offset into the global cycle — makes a green wave. */
  offset: number;
  slot: LampSlot;
};
