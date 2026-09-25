/**
 * Every sound in VICE OS, synthesised.
 *
 * There are no audio files in this repository, for the same reason there are no
 * models or textures: the shutter is a noise burst through a band-pass, the
 * radio squelch is filtered white noise, the heat sting is two detuned saws on
 * an envelope. It all costs a few hundred bytes of code and nothing to license.
 *
 * Browsers will not start an AudioContext until the player has touched the
 * page, so nothing is created until `unlock()` is called from the lock screen's
 * tap — before that every call here is a cheap no-op.
 */

const MUTE_KEY = "vice-os:muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
/** Shared noise buffer — regenerating white noise per hit is pure waste. */
let noise: AudioBuffer | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/**
 * Subscribe to mute changes so the status bar can show the right glyph.
 * Shaped for `useSyncExternalStore`: the callback takes nothing and the
 * returned unsubscribe returns nothing.
 */
export function onMuteChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode — the session keeps the setting in memory */
  }
  if (master && ctx) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
  }
  notify();
  return muted;
}

/**
 * Called from the first real gesture. Safe to call repeatedly — later calls
 * just resume a suspended context, which is what the tab needs after the
 * player switches away and back.
 */
export function unlock() {
  if (typeof window === "undefined") return;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();

      try {
        muted = localStorage.getItem(MUTE_KEY) === "1";
      } catch {
        muted = false;
      }
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);

      // 2s of white noise, reused by every percussive and radio sound.
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      notify();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio on this device — the game is fully playable without it */
  }
}

/* ------------------------------------------------------------- primitives */

type ToneOpts = {
  type?: OscillatorType;
  /** Start frequency, Hz. */
  from: number;
  /** End frequency, Hz. Defaults to `from` — a flat tone. */
  to?: number;
  /** Seconds. */
  dur?: number;
  gain?: number;
  /** Seconds to wait before it starts. */
  delay?: number;
};

function tone({
  type = "sine",
  from,
  to = from,
  dur = 0.18,
  gain = 0.25,
  delay = 0,
}: ToneOpts) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);

  // A short attack stops the click that a hard gate would put on every note.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

type BurstOpts = {
  dur?: number;
  gain?: number;
  /** Band-pass centre, Hz. */
  freq?: number;
  q?: number;
  delay?: number;
  type?: BiquadFilterType;
};

/** A shaped burst of the shared noise buffer — clicks, hiss, static. */
function burst({
  dur = 0.08,
  gain = 0.3,
  freq = 2200,
  q = 1.2,
  delay = 0,
  type = "bandpass",
}: BurstOpts) {
  if (!ctx || !master || !noise || muted) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  // Start at a random offset so repeated hits don't phase into a tone.
  const offset = Math.random() * 1.5;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(filter).connect(g).connect(master);
  src.start(t, offset, dur + 0.05);
  src.stop(t + dur + 0.05);
}

/* ----------------------------------------------------------------- sounds */

export const sfx = {
  /** Soft UI tick — app icons, list rows. */
  tap() {
    tone({ type: "triangle", from: 880, to: 1180, dur: 0.055, gain: 0.1 });
  },

  /** Confirming press — opening an app, taking a contract. */
  select() {
    tone({ type: "triangle", from: 520, to: 1040, dur: 0.11, gain: 0.14 });
    tone({ type: "sine", from: 1560, dur: 0.07, gain: 0.05, delay: 0.05 });
  },

  /** Back, cancel, discard. */
  back() {
    tone({ type: "triangle", from: 760, to: 380, dur: 0.1, gain: 0.11 });
  },

  /** The phone waking up. */
  boot() {
    tone({ type: "sine", from: 220, to: 660, dur: 0.5, gain: 0.12 });
    tone({ type: "sine", from: 330, to: 990, dur: 0.6, gain: 0.08, delay: 0.08 });
  },

  /**
   * The shutter: a mirror slap and a curtain, a few milliseconds apart. Two
   * bursts rather than one is the whole difference between a camera and a tap.
   */
  shutter() {
    burst({ dur: 0.035, gain: 0.5, freq: 3400, q: 0.8 });
    burst({ dur: 0.07, gain: 0.32, freq: 1300, q: 1.6, delay: 0.045 });
    tone({ type: "square", from: 180, to: 90, dur: 0.05, gain: 0.07, delay: 0.04 });
  },

  /** The forensic pass running over the export. */
  scan() {
    tone({ type: "sawtooth", from: 180, to: 1500, dur: 0.75, gain: 0.07 });
    burst({ dur: 0.7, gain: 0.05, freq: 5200, q: 0.5, type: "highpass" });
  },

  /** The verdict landing. `good` is a perfect or near-perfect scrub. */
  verdict(good: boolean) {
    if (good) {
      tone({ type: "triangle", from: 523, dur: 0.16, gain: 0.16 });
      tone({ type: "triangle", from: 659, dur: 0.16, gain: 0.15, delay: 0.1 });
      tone({ type: "triangle", from: 880, dur: 0.34, gain: 0.14, delay: 0.2 });
    } else {
      tone({ type: "sawtooth", from: 220, to: 160, dur: 0.34, gain: 0.13 });
      tone({ type: "sawtooth", from: 165, to: 110, dur: 0.44, gain: 0.11, delay: 0.09 });
    }
  },

  /** Heat moving. Rises when you cost yourself, falls when you cool off. */
  heat(delta: number) {
    if (delta === 0) return;
    const up = delta > 0;
    tone({
      type: "sawtooth",
      from: up ? 150 : 520,
      to: up ? 480 : 180,
      dur: 0.4,
      gain: 0.1,
    });
  },

  /** Radio squelch before a dispatch line. */
  squelch() {
    burst({ dur: 0.05, gain: 0.14, freq: 1800, q: 3 });
    burst({ dur: 0.1, gain: 0.07, freq: 900, q: 0.8, delay: 0.05 });
  },

  /** A wanted star going up. */
  starUp() {
    tone({ type: "square", from: 660, to: 990, dur: 0.1, gain: 0.12 });
    tone({ type: "square", from: 990, to: 1320, dur: 0.14, gain: 0.1, delay: 0.09 });
  },

  /** A contract paying out. */
  paid() {
    tone({ type: "triangle", from: 784, dur: 0.11, gain: 0.15 });
    tone({ type: "triangle", from: 1046, dur: 0.11, gain: 0.14, delay: 0.09 });
    tone({ type: "triangle", from: 1318, dur: 0.3, gain: 0.13, delay: 0.18 });
  },

  /** A contract blown, or the clock running out. */
  failed() {
    tone({ type: "sawtooth", from: 300, to: 180, dur: 0.2, gain: 0.13 });
    tone({ type: "sawtooth", from: 200, to: 90, dur: 0.5, gain: 0.12, delay: 0.16 });
  },
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
