"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Forensics } from "./art";
import { FIRST_NAMES, LAST_NAMES, pick } from "./copy";

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
};

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
    case "wipe":
      return {
        ...initial(),
        booted: true,
        ready: true,
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
        }),
      );
    } catch {
      /* ignore */
    }
  }, [
    state.ready,
    state.alias,
    state.handle,
    state.heat,
    state.crimes,
    state.followers,
  ]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = uid();
    dispatch({ type: "toast", toast: { ...t, id } });
    setTimeout(() => dispatch({ type: "untoast", id }), 4200);
  }, []);

  const value = useMemo<Store>(
    () => ({
      ...state,
      dispatch,
      toast,
      starCount: stars(state.heat),
      bountyValue: bounty(state.heat),
    }),
    [state, toast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVice() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVice outside provider");
  return v;
}
