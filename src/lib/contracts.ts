/**
 * Contracts — the job board that gives the image editor a scoreboard.
 *
 * A fixer wants a photo handled a specific way. The only thing that decides
 * whether you delivered is the forensic diff of your actual export against
 * the original frame, so every objective here is a statement about how the
 * player used the editor: how much surface they altered, how much they
 * covered, whether they reframed, how far they pushed the grade.
 */

import type { Forensics } from "./art";
import { SCENES, type SceneId } from "./art";

export type ContractEvent = "post" | "poster";

/** Everything an objective is allowed to look at. */
export type ContractCtx = {
  event: ContractEvent;
  forensics?: Forensics;
  /** 0-100 composite of altered/coverage/reframe — see Vicegram. */
  scrub?: number;
  tags?: string[];
  sceneId?: string;
  heatDelta?: number;
  bounty?: number;
};

export type Objective = {
  label: string;
  /** Short nudge at the tool that gets it done. */
  tool: string;
  test: (c: ContractCtx) => boolean;
  /** 0..1 for the live meter; undefined when it's pass/fail only. */
  progress?: (c: ContractCtx) => number;
};

export type Tier = "LOW" | "MID" | "HIGH";

export type Contract = {
  id: string;
  codename: string;
  fixer: string;
  handle: string;
  hue: number;
  brief: string;
  event: ContractEvent;
  objectives: Objective[];
  seconds: number;
  reward: number;
  heatOnSuccess: number;
  heatOnFail: number;
  tier: Tier;
};

export type ContractResult = {
  contract: Contract;
  ok: boolean;
  /** Per-objective outcome, same order as contract.objectives. */
  marks: boolean[];
  reason: "delivered" | "missed" | "expired";
  paid: number;
  heat: number;
};

export const RANKS = [
  { at: 0, name: "RUNNER" },
  { at: 2, name: "EARNER" },
  { at: 4, name: "OPERATOR" },
  { at: 7, name: "FIXER" },
  { at: 10, name: "KINGPIN" },
];

export function rankFor(completed: number) {
  return [...RANKS].reverse().find((r) => completed >= r.at)?.name ?? "RUNNER";
}

const FIXERS = [
  {
    fixer: "MARISOL DEL RIO",
    handle: "@the_broker",
    hue: 320,
  },
  {
    fixer: "UNCLE T",
    handle: "@swamp_logistics",
    hue: 140,
  },
  {
    fixer: "KRISTY V",
    handle: "@vicefm_nightshift",
    hue: 275,
  },
  {
    fixer: "THE ACCOUNTANT",
    handle: "@ledger_leonida",
    hue: 45,
  },
];

const pct = (v: number, target: number) => Math.max(0, Math.min(1, v / target));

/* ------------------------------------------------------------------ */
/* objective builders                                                  */
/* ------------------------------------------------------------------ */

const obj = {
  scrubOver: (n: number): Objective => ({
    label: `Scrub rating ${n}% or higher`,
    tool: "cover, crop, blow out the grade",
    test: (c) => (c.scrub ?? 0) >= n,
    progress: (c) => pct(c.scrub ?? 0, n),
  }),
  scrubUnder: (n: number): Objective => ({
    label: `Scrub rating ${n}% or lower`,
    tool: "leave the frame readable",
    test: (c) => (c.scrub ?? 100) <= n,
    progress: (c) => pct(n, Math.max(1, c.scrub ?? 100)),
  }),
  coverage: (n: number): Objective => ({
    label: `Overlay coverage ${n}% or higher`,
    tool: "stickers, shapes, draw",
    test: (c) => (c.forensics?.coverage ?? 0) >= n,
    progress: (c) => pct(c.forensics?.coverage ?? 0, n),
  }),
  altered: (n: number): Objective => ({
    label: `Surface altered ${n}% or higher`,
    tool: "filters, brush, text",
    test: (c) => (c.forensics?.altered ?? 0) >= n,
    progress: (c) => pct(c.forensics?.altered ?? 0, n),
  }),
  grade: (n: number): Objective => ({
    label: `Grade shift of ${n} or more`,
    tool: "filter → hue & temperature",
    test: (c) => Math.abs(c.forensics?.temperature ?? 0) >= n,
    progress: (c) => pct(Math.abs(c.forensics?.temperature ?? 0), n),
  }),
  reframe: (): Objective => ({
    label: "Reframe the shot",
    tool: "crop or resize",
    test: (c) => Boolean(c.forensics?.reframed),
  }),
  heatUnder: (n: number): Objective => ({
    label: n <= 0 ? "Gain no heat at all" : `Gain ${n} heat or less`,
    tool: "scrub hard, tag light",
    test: (c) => (c.heatDelta ?? 99) <= n,
  }),
  heatOver: (n: number): Objective => ({
    label: `Gain ${n} heat or more`,
    tool: "post it raw, tag it loud",
    test: (c) => (c.heatDelta ?? 0) >= n,
    progress: (c) => pct(c.heatDelta ?? 0, n),
  }),
  tag: (label: string): Objective => ({
    label: `Tag it ${label}`,
    tool: "composer → tags",
    test: (c) => Boolean(c.tags?.includes(label)),
  }),
  tagCount: (n: number): Objective => ({
    label: `Use at least ${n} tags`,
    tool: "composer → tags",
    test: (c) => (c.tags?.length ?? 0) >= n,
    progress: (c) => pct(c.tags?.length ?? 0, n),
  }),
  scene: (id: SceneId): Objective => ({
    label: `Shoot ${SCENES.find((s) => s.id === id)?.title ?? id}`,
    tool: "camera roll",
    test: (c) => c.sceneId === id,
  }),
  bounty: (n: number): Objective => ({
    label: `Print a bulletin worth $${n.toLocaleString()} or more`,
    tool: "MOST WANTED → send to press",
    test: (c) => (c.bounty ?? 0) >= n,
    progress: (c) => pct(c.bounty ?? 0, n),
  }),
};

/* ------------------------------------------------------------------ */
/* templates                                                           */
/* ------------------------------------------------------------------ */

/** What the board knows about the player when it rolls the offers. */
export type BoardEnv = { bounty: number };

type Template = (
  r: () => number,
  env: BoardEnv,
) => Omit<Contract, "id" | "fixer" | "handle" | "hue">;

const TEMPLATES: Template[] = [
  (r) => {
    const n = 55 + Math.floor(r() * 15);
    return {
      codename: "THE CLEANER",
      brief:
        "I don't care what it looks like when you're done. I care that nobody can match it to the frame it came from.",
      event: "post",
      objectives: [obj.scrubOver(n)],
      seconds: 150,
      reward: 9000 + Math.floor(r() * 3000),
      heatOnSuccess: -7,
      heatOnFail: 3,
      tier: "LOW",
    };
  },
  (r) => ({
    codename: "PROOF OF LIFE",
    brief:
      "Buyer wants to believe you were standing there. Touch it up if you must, but the place has to still read.",
    event: "post",
    objectives: [obj.scrubUnder(18 + Math.floor(r() * 6)), obj.tag("#leonidalive")],
    seconds: 120,
    reward: 12000 + Math.floor(r() * 4000),
    heatOnSuccess: 11,
    heatOnFail: 2,
    tier: "MID",
  }),
  (r) => ({
    codename: "THE REBRAND",
    brief:
      "Same photo, different night. Push the colour until the timestamp is a lie.",
    event: "post",
    objectives: [obj.grade(22 + Math.floor(r() * 10)), obj.altered(45)],
    seconds: 165,
    reward: 10500 + Math.floor(r() * 3500),
    heatOnSuccess: -3,
    heatOnFail: 4,
    tier: "MID",
  }),
  (r) => ({
    codename: "WITNESS PROTECTION",
    brief:
      "There are three faces in that shot and two of them are mine. Put something over them. Anything.",
    event: "post",
    objectives: [obj.coverage(16 + Math.floor(r() * 8)), obj.scrubOver(40)],
    seconds: 150,
    reward: 13000 + Math.floor(r() * 4000),
    heatOnSuccess: -9,
    heatOnFail: 6,
    tier: "MID",
  }),
  () => ({
    codename: "PAPER TRAIL",
    brief:
      "The landmark in the corner puts me on a map. Cut it out of the frame, then cover whatever's left.",
    event: "post",
    objectives: [obj.reframe(), obj.coverage(8)],
    seconds: 135,
    reward: 11000,
    heatOnSuccess: -5,
    heatOnFail: 5,
    tier: "LOW",
  }),
  () => ({
    codename: "GHOST POST",
    brief:
      "Publish it and move the needle zero degrees. If heat goes up by even one, you never worked for me.",
    event: "post",
    objectives: [obj.heatUnder(0)],
    seconds: 180,
    reward: 16000,
    heatOnSuccess: -4,
    heatOnFail: 8,
    tier: "HIGH",
  }),
  (r) => ({
    codename: "MAKE SOME NOISE",
    brief:
      "I need the whole state looking the other way for about an hour. Give them something to look at.",
    event: "post",
    objectives: [obj.heatOver(16 + Math.floor(r() * 6)), obj.tagCount(3)],
    seconds: 140,
    reward: 18000 + Math.floor(r() * 5000),
    heatOnSuccess: 6,
    heatOnFail: 2,
    tier: "HIGH",
  }),
  (r) => {
    const scene = SCENES[Math.floor(r() * SCENES.length)];
    return {
      codename: "LOCATION SCOUT",
      brief: `Client's picky. They want ${scene.title} and they want it to look expensive.`,
      event: "post",
      objectives: [obj.scene(scene.id), obj.altered(35)],
      seconds: 160,
      reward: 9500 + Math.floor(r() * 2500),
      heatOnSuccess: 2,
      heatOnFail: 3,
      tier: "LOW",
    };
  },
  (r, env) => ({
    codename: "VANITY PRESS",
    brief:
      "My guy collects bulletins. Paint yourself a face, run it through the press, and make the number big.",
    event: "poster",
    // Always a stretch on the current bounty, so the job is only winnable
    // by heating yourself up first — never impossible, never free.
    objectives: [
      obj.bounty(Math.round(Math.max(9000, env.bounty * (1.3 + r() * 0.3)) / 500) * 500),
    ],
    seconds: 240,
    reward: 15000 + Math.floor(r() * 6000),
    heatOnSuccess: 4,
    heatOnFail: 2,
    tier: "HIGH",
  }),
];

let counter = 0;

export function rollContract(env: BoardEnv, seedIndex = 0): Contract {
  const r = Math.random;
  const t =
    TEMPLATES[(Math.floor(r() * TEMPLATES.length) + seedIndex) % TEMPLATES.length];
  const f = FIXERS[Math.floor(r() * FIXERS.length)];
  return {
    id: `c${Date.now().toString(36)}${counter++}`,
    ...f,
    ...t(r, env),
  };
}

/** Three distinct offers. */
export function rollBoard(env: BoardEnv): Contract[] {
  const seen = new Set<string>();
  const out: Contract[] = [];
  for (let i = 0; out.length < 3 && i < 40; i++) {
    const c = rollContract(env, i);
    if (seen.has(c.codename)) continue;
    seen.add(c.codename);
    out.push(c);
  }
  return out;
}

export function evaluate(contract: Contract, ctx: ContractCtx) {
  return contract.objectives.map((o) => o.test(ctx));
}

export const TIER_TINT: Record<Tier, string> = {
  LOW: "#9dff3d",
  MID: "#22e6ff",
  HIGH: "#ff2e97",
};
