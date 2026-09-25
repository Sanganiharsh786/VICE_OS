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

/** One subject's outcome, as read back by the forensic pass. */
export type Finding = {
  kind: string;
  label: string;
  status: "VISIBLE" | "PARTIAL" | "HIDDEN" | "REMOVED";
  concealment: number;
};

/** Everything an objective is allowed to look at. */
export type ContractCtx = {
  event: ContractEvent;
  forensics?: Forensics;
  /** 0-100 composite of altered/coverage/reframe — see lib/forensics. */
  scrub?: number;
  tags?: string[];
  sceneId?: string;
  heatDelta?: number;
  bounty?: number;
  /**
   * Per-subject verdicts. Only frames shot in Leonida Live carry these, which
   * is why every objective built on them says so in its `tool` line.
   */
  findings?: Finding[];
};

const gone = (f: Finding) => f.status === "HIDDEN" || f.status === "REMOVED";
const readable = (f: Finding) => f.status === "VISIBLE";

export type Objective = {
  label: string;
  /** Short nudge at the tool that gets it done. */
  tool: string;
  test: (c: ContractCtx) => boolean;
  /** 0..1 for the live meter; undefined when it's pass/fail only. */
  progress?: (c: ContractCtx) => number;
};

export type Tier = "LOW" | "MID" | "HIGH";

/**
 * Two kinds of job, and the whole point is that they pull in opposite
 * directions. CLEANUP pays you to make the photo unusable; EVIDENCE pays you
 * to make it damning — and takes the heat that comes with it.
 */
export type Category = "CLEANUP" | "EVIDENCE";

export const CATEGORY_NOTE: Record<Category, string> = {
  CLEANUP: "HIDE WHAT THE LENS CAUGHT",
  EVIDENCE: "KEEP IT READABLE",
};

export type Contract = {
  id: string;
  codename: string;
  fixer: string;
  handle: string;
  hue: number;
  brief: string;
  category: Category;
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
  /* ---- evidence objectives (Leonida Live frames only) ---- */
  subjects: (n: number): Objective => ({
    label: `Catch ${n}+ identifiable ${n === 1 ? "subject" : "subjects"} in frame`,
    tool: "LEONIDA LIVE → get close before the shutter",
    test: (c) => (c.findings?.length ?? 0) >= n,
    progress: (c) => pct(c.findings?.length ?? 0, n),
  }),
  hideAll: (): Objective => ({
    label: "Leave nothing identifiable in the export",
    tool: "cover every bracket in the Image Lab",
    test: (c) => Boolean(c.findings?.length) && c.findings!.every(gone),
    progress: (c) =>
      c.findings?.length
        ? c.findings.filter(gone).length / c.findings.length
        : 0,
  }),
  hideKind: (kind: string): Objective => ({
    label: `Hide every ${kind.toLowerCase()} in the frame`,
    tool: `sticker or shape over each ${kind.toLowerCase()}`,
    test: (c) => {
      const of = c.findings?.filter((f) => f.kind === kind) ?? [];
      return of.length > 0 && of.every(gone);
    },
    progress: (c) => {
      const of = c.findings?.filter((f) => f.kind === kind) ?? [];
      return of.length ? of.filter(gone).length / of.length : 0;
    },
  }),
  keepKind: (kind: string): Objective => ({
    label: `Keep a ${kind.toLowerCase()} clearly readable`,
    tool: `shoot a ${kind.toLowerCase()} and do NOT cover it`,
    test: (c) => Boolean(c.findings?.some((f) => f.kind === kind && readable(f))),
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
  /* ---------------- CLEANUP — make it unusable ---------------- */
  (r) => {
    const n = 55 + Math.floor(r() * 15);
    return {
      codename: "THE CLEANER",
      brief:
        "I don't care what it looks like when you're done. I care that nobody can match it to the frame it came from.",
      category: "CLEANUP",
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
    codename: "NO FACES",
    brief:
      "Go out, shoot somebody, and bring me back a photo where they aren't anybody. Every face covered. I'll know if you missed one.",
    category: "CLEANUP",
    event: "post",
    objectives: [obj.subjects(1), obj.hideKind("FACE")],
    seconds: 210,
    reward: 14000 + Math.floor(r() * 4000),
    heatOnSuccess: -8,
    heatOnFail: 6,
    tier: "MID",
  }),
  (r) => ({
    codename: "THE GHOST FRAME",
    brief:
      "Everything the lens caught, gone. Faces, plates, the tower, all of it. One bracket left readable and we never spoke.",
    category: "CLEANUP",
    event: "post",
    objectives: [obj.subjects(2), obj.hideAll()],
    seconds: 240,
    reward: 24000 + Math.floor(r() * 6000),
    heatOnSuccess: -12,
    heatOnFail: 9,
    tier: "HIGH",
  }),
  (r) => ({
    codename: "THE REBRAND",
    brief:
      "Same photo, different night. Push the colour until the timestamp is a lie.",
    category: "CLEANUP",
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
    category: "CLEANUP",
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
    category: "CLEANUP",
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
    category: "CLEANUP",
    event: "post",
    objectives: [obj.heatUnder(0)],
    seconds: 180,
    reward: 16000,
    heatOnSuccess: -4,
    heatOnFail: 8,
    tier: "HIGH",
  }),

  /* ---------------- EVIDENCE — make it damning ---------------- */
  (r) => ({
    codename: "THE WITNESS",
    brief:
      "I need a face on the record. Their face. Frame them, publish it, and don't you dare touch it with a sticker. Yes, it'll cost you.",
    category: "EVIDENCE",
    event: "post",
    objectives: [obj.keepKind("FACE"), obj.scrubUnder(30)],
    seconds: 210,
    reward: 25000 + Math.floor(r() * 7000),
    heatOnSuccess: 18,
    heatOnFail: 4,
    tier: "HIGH",
  }),
  (r) => ({
    codename: "PLATE READER",
    brief:
      "Somebody's car was somewhere it shouldn't have been. Get me the plate, readable, in a post with a location on it.",
    category: "EVIDENCE",
    event: "post",
    objectives: [obj.keepKind("PLATE"), obj.tag("#whowasdriving")],
    seconds: 200,
    reward: 21000 + Math.floor(r() * 5000),
    heatOnSuccess: 13,
    heatOnFail: 3,
    tier: "HIGH",
  }),
  (r) => ({
    codename: "PROOF OF LIFE",
    brief:
      "Buyer wants to believe you were standing there. Touch it up if you must, but the place has to still read.",
    category: "EVIDENCE",
    event: "post",
    objectives: [obj.scrubUnder(18 + Math.floor(r() * 6)), obj.tag("#leonidalive")],
    seconds: 120,
    reward: 12000 + Math.floor(r() * 4000),
    heatOnSuccess: 11,
    heatOnFail: 2,
    tier: "MID",
  }),
  (r) => ({
    codename: "MAKE SOME NOISE",
    brief:
      "I need the whole state looking the other way for about an hour. Give them something to look at.",
    category: "EVIDENCE",
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
      category: "EVIDENCE",
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
    category: "EVIDENCE",
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

/**
 * Three distinct offers, always including at least one of each category —
 * the choice between burying a photo and publishing it is the decision the
 * board exists to put in front of the player, so it can never roll away.
 */
export function rollBoard(env: BoardEnv): Contract[] {
  const seen = new Set<string>();
  const out: Contract[] = [];

  const take = (want?: Category) => {
    for (let i = 0; i < 60; i++) {
      const c = rollContract(env, i);
      if (seen.has(c.codename)) continue;
      if (want && c.category !== want) continue;
      seen.add(c.codename);
      out.push(c);
      return;
    }
  };

  take("CLEANUP");
  take("EVIDENCE");
  take();
  // Shuffle so the categories aren't always in the same slots.
  return out.sort(() => Math.random() - 0.5);
}

export function evaluate(contract: Contract, ctx: ContractCtx) {
  return contract.objectives.map((o) => o.test(ctx));
}

export const TIER_TINT: Record<Tier, string> = {
  LOW: "#9dff3d",
  MID: "#22e6ff",
  HIGH: "#ff2e97",
};
