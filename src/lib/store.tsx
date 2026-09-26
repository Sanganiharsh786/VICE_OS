"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Forensics } from "./art";
import type { Evidence } from "./evidence";
import { FIRST_NAMES, LAST_NAMES, pick } from "./copy";
import {
  evaluate,
  rollBoard,
  type Contract,
  type ContractCtx,
  type ContractResult,
} from "./contracts";
import { sfx } from "./audio";

export type Comment = {
  id: string;
  handle: string;
  hue: number;
  badge?: "blue" | "verified";
  body: string;
};

export type Post = {
  id: string;
  image: string;
  original: string;
  title: string;
  location: string;
  caption: string;
  tags: string[];
  likes: number;
  comments: Comment[];
  forensics: Forensics | null;
  heatDelta: number;
  at: number;
};

export type Toast = {
  id: string;
  kind: "heat" | "cool" | "info" | "alert";
  title: string;
  body?: string;
};

/** A line the player's own post put on the police radio. */
export type Radio = {
  id: string;
  at: number;
  body: string;
  /** Marks it as caused by the player, so Scanner 7 can highlight it. */
  onYou: boolean;
};

/**
 * The bulletin the state is building out of the player's published photos.
 * MOST WANTED reads this, so the picture on the poster is a picture the
 * player edited.
 */
export type EvidenceRecord = {
  id: string;
  image: string;
  location: string;
  /** 0-100. How identifiable the export still was. */
  confidence: number;
  at: number;
};

/** A frame shot in Leonida Live this session, with what the lens caught. */
export type CapturedFrame = {
  src: string;
  title: string;
  location: string;
  sceneId?: string;
  evidence: Evidence[];
};

/** What one run at a given source frame came out at. */
export type Attempt = { scrub: number; heat: number };

export type State = {
  alias: string;
  handle: string;
  /** 0-100. Drives the wanted stars, the bounty, and the whole UI mood. */
  heat: number;
  posts: Post[];
  crimes: string[];
  mugshot: string | null;
  license: string | null;
  followers: number;
  toasts: Toast[];
  booted: boolean;
  /** False until localStorage has been read — nothing is written before then. */
  ready: boolean;

  /* ---- contracts ---- */
  cash: number;
  /** The three offers currently on the board. Session-only. */
  board: Contract[];
  /** The job you took, with the wall-clock deadline it has to land by. */
  active: { contract: Contract; deadline: number } | null;
  completed: number;
  failed: number;
  /** Last settlement, so the app can show a payout screen. */
  lastResult: ContractResult | null;

  /* ---- consequences ---- */
  /** Dispatch lines the player's own posts generated. Session-only. */
  radio: Radio[];
  /** Evidence the state has logged against the player. Session-only. */
  records: EvidenceRecord[];
  /** Has the player been through the intro? Persisted. */
  onboarded: boolean;
  /** Beats of the core loop the player has hit. Drives JUDGE MODE. */
  beats: string[];
  /** Is the guided walkthrough on? */
  judge: boolean;

  /* ---- the camera ---- */
  /**
   * Frames shot in Leonida Live this session, and every forensic scan run
   * against each source frame. Both live here rather than inside VICEGRAM so
   * that walking back out to the home screen doesn't throw away the run —
   * re-editing the same photograph and comparing the two outcomes is the
   * point of the whole project.
   */
  captured: CapturedFrame[];
  attempts: Record<string, Attempt>;
};

/** The loop, in order. JUDGE MODE walks a first-timer down this list. */
export const BEATS = [
  { id: "fixer", label: "Take a contract from THE FIXER" },
  { id: "shot", label: "Shoot a frame in LEONIDA LIVE" },
  { id: "vision", label: "Read the FORENSIC VISION scan" },
  { id: "edit", label: "Cover the evidence in the IMAGE LAB" },
  { id: "report", label: "Run forensics on your export" },
  { id: "post", label: "Publish it and take the heat" },
  { id: "wanted", label: "See it land in MOST WANTED" },
] as const;

type Action =
  | { type: "boot" }
  | { type: "post"; post: Post }
  | { type: "engage"; id: string; likes: number; comment?: Comment }
  | { type: "heat"; delta: number }
  | { type: "crime"; crime: string }
  | { type: "mugshot"; src: string }
  | { type: "license"; src: string }
  | { type: "alias"; alias: string }
  | { type: "toast"; toast: Toast }
  | { type: "untoast"; id: string }
  | { type: "hydrate"; state: Partial<State> }
  | { type: "board"; board: Contract[] }
  | { type: "accept"; contract: Contract; deadline: number }
  | { type: "settle"; result: ContractResult }
  | { type: "clearResult" }
  | { type: "radio"; line: Radio }
  | { type: "record"; record: EvidenceRecord }
  | { type: "onboarded" }
  | { type: "beat"; beat: string }
  | { type: "judge"; on: boolean }
  | { type: "captured"; frame: CapturedFrame }
  | { type: "attempt"; key: string; attempt: Attempt }
  | { type: "wipe" };

export const STAR_STEPS = [0, 12, 30, 50, 72, 90];

export function stars(heat: number) {
  let n = 0;
  for (let i = 1; i < STAR_STEPS.length; i++) if (heat >= STAR_STEPS[i]) n = i;
  return n;
}

export function bounty(heat: number) {
  return Math.round((heat * heat * 4.2 + heat * 820 + 1500) / 50) * 50;
}

function initial(): State {
  return {
    alias: "UNKNOWN SUBJECT",
    handle: "@you",
    heat: 6,
    posts: [],
    crimes: [],
    mugshot: null,
    license: null,
    followers: 1204,
    toasts: [],
    booted: false,
    ready: false,
    cash: 240,
    board: [],
    active: null,
    completed: 0,
    failed: 0,
    lastResult: null,
    radio: [],
    records: [],
    onboarded: false,
    beats: [],
    judge: false,
    captured: [],
    attempts: {},
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "boot":
      return { ...state, booted: true };
    case "post":
      return {
        ...state,
        posts: [action.post, ...state.posts],
        heat: clamp(state.heat + action.post.heatDelta),
        followers: state.followers + Math.round(action.post.likes * 0.06),
      };
    case "engage":
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.id
            ? {
                ...p,
                likes: action.likes,
                comments: action.comment ? [...p.comments, action.comment] : p.comments,
              }
            : p,
        ),
      };
    case "heat":
      return { ...state, heat: clamp(state.heat + action.delta) };
    case "crime":
      return state.crimes.includes(action.crime)
        ? state
        : { ...state, crimes: [...state.crimes, action.crime] };
    case "mugshot":
      return { ...state, mugshot: action.src };
    case "license":
      return { ...state, license: action.src };
    case "alias":
      return { ...state, alias: action.alias };
    case "toast":
      return { ...state, toasts: [...state.toasts, action.toast].slice(-3) };
    case "untoast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case "hydrate":
      return { ...state, ...action.state, ready: true };
    case "board":
      return { ...state, board: action.board };
    case "accept":
      return {
        ...state,
        active: { contract: action.contract, deadline: action.deadline },
        board: state.board.filter((c) => c.id !== action.contract.id),
        lastResult: null,
      };
    case "settle": {
      const { ok, paid, heat } = action.result;
      return {
        ...state,
        active: null,
        lastResult: action.result,
        cash: Math.max(0, state.cash + paid),
        heat: clamp(state.heat + heat),
        completed: state.completed + (ok ? 1 : 0),
        failed: state.failed + (ok ? 0 : 1),
      };
    }
    case "clearResult":
      return { ...state, lastResult: null };
    case "radio":
      return { ...state, radio: [...state.radio, action.line].slice(-12) };
    case "record":
      return { ...state, records: [action.record, ...state.records].slice(0, 8) };
    case "onboarded":
      return { ...state, onboarded: true };
    case "beat":
      return state.beats.includes(action.beat)
        ? state
        : { ...state, beats: [...state.beats, action.beat] };
    case "judge":
      return { ...state, judge: action.on };
    case "captured":
      return {
        ...state,
        captured: [action.frame, ...state.captured].slice(0, 12),
      };
    case "attempt":
      return {
        ...state,
        attempts: { ...state.attempts, [action.key]: action.attempt },
      };
    case "wipe":
      return {
        ...initial(),
        booted: true,
        ready: true,
        onboarded: true,
        alias: state.alias,
        handle: state.handle,
      };
    default:
      return state;
  }
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function randomAlias() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

type Store = State & {
  dispatch: (a: Action) => void;
  toast: (t: Omit<Toast, "id">) => void;
  starCount: number;
  bountyValue: number;
  /** Take a job. The clock starts now. */
  accept: (c: Contract) => void;
  /** Walk away — costs a fail, but no heat. */
  abandon: () => void;
  refreshBoard: () => void;
  /**
   * Called by the apps whenever the player finishes something a contract
   * could be about. Returns the settlement if this event closed a job.
   */
  settleContract: (ctx: ContractCtx) => ContractResult | null;
  /**
   * A published photo has consequences in three places at once: the radio,
   * the evidence file, and the heat bar. Routing them through one call keeps
   * the apps from each inventing their own version of the aftermath.
   */
  logConsequence: (a: {
    image: string;
    location: string;
    /** 0-100 identifiability of the export. */
    confidence: number;
    dispatch: string;
  }) => void;
  /** Tick off a beat of the core loop. No-op if already ticked. */
  mark: (beat: string) => void;
};

const Ctx = createContext<Store | null>(null);

const KEY = "vice-os:v1";

export function ViceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);

  // Only the light stuff is persisted — photos stay in memory so we never
  // blow past the localStorage quota mid-session.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<State>;
        dispatch({
          type: "hydrate",
          state: {
            alias:
              saved.alias && saved.alias !== "UNKNOWN SUBJECT"
                ? saved.alias
                : randomAlias(),
            handle: saved.handle,
            heat: saved.heat,
            crimes: saved.crimes ?? [],
            followers: saved.followers,
            cash: saved.cash,
            completed: saved.completed,
            failed: saved.failed,
            onboarded: saved.onboarded ?? false,
          },
        });
      } else {
        dispatch({ type: "hydrate", state: { alias: randomAlias() } });
      }
    } catch {
      // Private mode or a blocked storage API — run the session in memory.
      dispatch({ type: "hydrate", state: {} });
    }
  }, []);

  useEffect(() => {
    if (!state.ready) return;
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          alias: state.alias,
          handle: state.handle,
          heat: state.heat,
          crimes: state.crimes,
          followers: state.followers,
          cash: state.cash,
          completed: state.completed,
          failed: state.failed,
          onboarded: state.onboarded,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [
    state.ready,
    state.onboarded,
    state.alias,
    state.handle,
    state.heat,
    state.crimes,
    state.followers,
    state.cash,
    state.completed,
    state.failed,
  ]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    /*
     * Every consequential event in the game already raises a toast, so this is
     * the one place that needs to know a sound is due — the apps stay unaware
     * that the OS makes any noise at all.
     */
    if (t.kind === "heat" || t.kind === "alert") sfx.failed();
    else if (t.kind === "cool") sfx.paid();
    else sfx.tap();
    const id = uid();
    dispatch({ type: "toast", toast: { ...t, id } });
    setTimeout(() => dispatch({ type: "untoast", id }), 4200);
  }, []);

  /* ---------------- contracts ---------------- */

  // settleContract and the deadline watchdog both need the live job and the
  // live heat without re-creating themselves on every render, so both are
  // mirrored into refs after each commit.
  const heatRef = useRef(state.heat);
  const activeRef = useRef(state.active);
  useEffect(() => {
    heatRef.current = state.heat;
    activeRef.current = state.active;
  }, [state.heat, state.active]);

  const refreshBoard = useCallback(() => {
    dispatch({
      type: "board",
      board: rollBoard({ bounty: bounty(heatRef.current) }),
    });
  }, []);

  useEffect(() => {
    if (state.ready && state.board.length === 0 && !state.active) refreshBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ready]);

  const accept = useCallback((c: Contract) => {
    dispatch({
      type: "accept",
      contract: c,
      deadline: Date.now() + c.seconds * 1000,
    });
    // Taking the job is the beat — merely opening THE FIXER is not.
    dispatch({ type: "beat", beat: "fixer" });
  }, []);

  const settle = useCallback(
    (
      contract: Contract,
      marks: boolean[],
      reason: ContractResult["reason"],
    ): ContractResult => {
      const ok = reason === "delivered";
      const result: ContractResult = {
        contract,
        ok,
        marks,
        reason,
        paid: ok ? contract.reward : 0,
        heat: ok ? contract.heatOnSuccess : contract.heatOnFail,
      };
      dispatch({ type: "settle", result });
      return result;
    },
    [],
  );

  const settleContract = useCallback(
    (ctx: ContractCtx) => {
      const job = activeRef.current;
      if (!job || job.contract.event !== ctx.event) return null;
      const marks = evaluate(job.contract, ctx);
      const ok = marks.every(Boolean);
      return settle(job.contract, marks, ok ? "delivered" : "missed");
    },
    [settle],
  );

  const abandon = useCallback(() => {
    const job = activeRef.current;
    if (!job) return;
    settle(
      job.contract,
      job.contract.objectives.map(() => false),
      "missed",
    );
  }, [settle]);

  // Deadline watchdog.
  useEffect(() => {
    if (!state.active) return;
    const t = setInterval(() => {
      const job = activeRef.current;
      if (!job || Date.now() < job.deadline) return;
      settle(
        job.contract,
        job.contract.objectives.map(() => false),
        "expired",
      );
      toast({
        kind: "alert",
        title: "CONTRACT EXPIRED",
        body: `${job.contract.fixer} stopped answering. +${job.contract.heatOnFail} heat.`,
      });
    }, 500);
    return () => clearInterval(t);
  }, [state.active, settle, toast]);

  const logConsequence = useCallback<Store["logConsequence"]>((a) => {
    const at = Date.now();
    dispatch({
      type: "radio",
      line: { id: uid(), at, body: a.dispatch, onYou: true },
    });
    // Only a frame something can actually be matched against goes on file.
    if (a.confidence >= 25) {
      dispatch({
        type: "record",
        record: {
          id: uid(),
          image: a.image,
          location: a.location,
          confidence: Math.round(a.confidence),
          at,
        },
      });
    }
  }, []);

  const mark = useCallback((beat: string) => {
    dispatch({ type: "beat", beat });
  }, []);

  const value = useMemo<Store>(
    () => ({
      ...state,
      dispatch,
      toast,
      starCount: stars(state.heat),
      bountyValue: bounty(state.heat),
      accept,
      abandon,
      refreshBoard,
      settleContract,
      logConsequence,
      mark,
    }),
    [
      state,
      toast,
      accept,
      abandon,
      refreshBoard,
      settleContract,
      logConsequence,
      mark,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVice() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVice outside provider");
  return v;
}
