"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { renderScene } from "@/lib/art";
import { BOOT_LINES, DISPATCH, money, pick } from "@/lib/copy";
import { warmUpEditor } from "@/lib/editorConfig";
import { isMuted, onMuteChange, sfx, toggleMute, unlock } from "@/lib/audio";
import { useVice } from "@/lib/store";
import Backdrop from "@/components/Backdrop";
import Onboarding from "@/components/Onboarding";
import JudgeMode from "@/components/JudgeMode";
import Vicegram from "@/components/apps/Vicegram";
import MostWanted from "@/components/apps/MostWanted";
import LeonidaID from "@/components/apps/LeonidaID";
import Scanner from "@/components/apps/Scanner";
import Contracts, { clock, useCountdown } from "@/components/apps/Contracts";
import { rankFor, TIER_TINT } from "@/lib/contracts";
import { HeatMeter, Panel, Stars } from "@/components/ui";

type Screen =
  | "boot"
  | "lock"
  | "home"
  | "vicegram"
  | "wanted"
  | "id"
  | "scanner"
  | "contracts";

/**
 * What the home grid, JUDGE MODE and THE FIXER are allowed to ask for.
 *
 * LEONIDA LIVE is a *stage inside* VICEGRAM, not a screen of its own. It used
 * to be rendered from a second slot, which meant every trip between the street
 * and the film roll unmounted the camera app and threw away whatever frame was
 * mid-edit. Everything now goes through `go()`, which keeps one Vicegram
 * mounted and hands it the stage as a request it can decline.
 */
type Target = Screen | "street";

/** A stage VICEGRAM was asked to open at. The nonce makes a repeat ask land. */
export type CameraRequest = { stage: "street" | "roll"; n: number };

const APPS = [
  {
    id: "street" as const,
    name: "LEONIDA LIVE",
    sub: "walk it · shoot it · 3D",
    glyph: "▶",
    from: "#22e6ff",
    to: "#ff2e97",
    wide: true,
  },
  {
    id: "contracts" as const,
    name: "THE FIXER",
    sub: "contracts · payouts",
    glyph: "✎",
    from: "#ffb347",
    to: "#ff2e97",
    wide: true,
  },
  {
    id: "vicegram" as const,
    name: "VICEGRAM",
    sub: "shoot · edit · post",
    glyph: "◉",
    from: "#ff2e97",
    to: "#ff8a3c",
  },
  {
    id: "wanted" as const,
    name: "MOST WANTED",
    sub: "your bulletin",
    glyph: "★",
    from: "#22e6ff",
    to: "#2f6bff",
  },
  {
    id: "id" as const,
    name: "LEONIDA DMV",
    sub: "state ID kiosk",
    glyph: "▤",
    from: "#9dff3d",
    to: "#1fb87a",
  },
  {
    id: "scanner" as const,
    name: "SCANNER 7",
    sub: "radio · dispatch",
    glyph: "≋",
    from: "#ffb347",
    to: "#ff5f6d",
  },
];

export default function ViceOS() {
  const vice = useVice();
  const [screen, setScreen] = useState<Screen>("boot");
  const [camera, setCamera] = useState<CameraRequest>({ stage: "roll", n: 0 });
  /**
   * True while the camera app is holding work — a frame in the lab, a report
   * not yet published. The contract clock is deliberately reachable from every
   * app, so stepping out to THE FIXER and back has to be survivable; while
   * this is set the app stays mounted and is merely hidden.
   */
  const [camBusy, setCamBusy] = useState(false);
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [introDismissed, setIntroDismissed] = useState(false);
  const [introReplay, setIntroReplay] = useState(false);
  const alarm = vice.starCount >= 4;

  /*
   * First visit gets the explainer, once the boot sequence is out of the way
   * and localStorage has actually been read. Derived rather than pushed into
   * state by an effect, so there is no extra render on load.
   */
  const intro =
    introReplay ||
    (!introDismissed && vice.ready && !vice.onboarded && screen !== "boot");

  /**
   * The one way to change screens. Asking for the camera app — from the home
   * grid, from a contract, or from the guided card — raises a request rather
   * than remounting it, so a frame that is halfway through the lab survives
   * the jump. Vicegram ignores the request while an edit is in flight.
   */
  const go = (t: Target) => {
    if (t === "street" || t === "vicegram") {
      setCamera((c) => ({ stage: t === "street" ? "street" : "roll", n: c.n + 1 }));
      setScreen("vicegram");
      return;
    }
    setScreen(t);
  };

  const closeIntro = (startJudge: boolean) => {
    setIntroDismissed(true);
    setIntroReplay(false);
    vice.dispatch({ type: "onboarded" });
    if (startJudge) vice.dispatch({ type: "judge", on: true });
  };

  /*
   * Heat and stars are moved by half a dozen different systems; rather than
   * teach each of them to make a noise, the shell watches the two numbers that
   * matter and stings when they move. The ref starts at the hydrated value so
   * loading a saved session is silent.
   */
  const lastHeat = useRef<number | null>(null);
  const lastStars = useRef<number | null>(null);
  useEffect(() => {
    if (!vice.ready) return;
    if (lastHeat.current !== null && vice.heat !== lastHeat.current) {
      sfx.heat(vice.heat - lastHeat.current);
    }
    if (lastStars.current !== null && vice.starCount > lastStars.current) {
      sfx.starUp();
    }
    lastHeat.current = vice.heat;
    lastStars.current = vice.starCount;
  }, [vice.ready, vice.heat, vice.starCount]);

  /*
   * The one beat the shell itself can see. The rest are reported by the apps
   * at the moment the player actually does the thing — opening an app is not
   * the same as doing its job, which is why "fixer" now ticks inside accept().
   */
  useEffect(() => {
    if (screen === "wanted" && vice.posts.length > 0) vice.mark("wanted");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, vice.posts.length]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setWallpaper(renderScene("ocean-drive", 42));
      } catch {
        /* no canvas, live with the gradient */
      }
    }, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <Backdrop alarm={alarm} />

      <div className="relative z-10 mx-auto flex h-full max-w-[1500px] items-center justify-center gap-8 px-4 xl:gap-12">
        <SidePanelLeft />

        <Phone
          alarm={alarm}
          hud={
            screen !== "boot" && screen !== "lock" ? (
              <>
                <JudgeMode current={screen} onJump={go} />
                <ContractHUD
                  active={screen === "contracts"}
                  onOpen={() => setScreen("contracts")}
                />
              </>
            ) : null
          }
        >
          {screen === "boot" && <Boot onDone={() => setScreen("lock")} />}
          {screen === "lock" && (
            <Lock wallpaper={wallpaper} onUnlock={() => setScreen("home")} />
          )}
          {screen === "home" && (
            <Home
              wallpaper={wallpaper}
              onOpen={go}
              onLock={() => setScreen("lock")}
              onIntro={() => setIntroReplay(true)}
            />
          )}
          {/*
            One slot, one mount. LEONIDA LIVE arrives as a request on `camera`
            rather than as a second element, so walking out to the street and
            back never costs the player the frame they were working on — and
            while the app is holding work it is hidden rather than unmounted,
            so a detour to another app survives too. Vicegram drops `busy`
            itself when the player presses back, which is the one exit that
            does mean "I'm finished with this frame".
          */}
          {(screen === "vicegram" || camBusy) && (
            <div className={screen === "vicegram" ? "contents" : "hidden"}>
              <Vicegram
                onBack={() => setScreen("home")}
                request={camera}
                onBusy={setCamBusy}
              />
            </div>
          )}
          {screen === "wanted" && <MostWanted onBack={() => setScreen("home")} />}
          {screen === "id" && <LeonidaID onBack={() => setScreen("home")} />}
          {screen === "scanner" && <Scanner onBack={() => setScreen("home")} />}
          {screen === "contracts" && (
            <Contracts onBack={() => setScreen("home")} onJump={go} />
          )}

          <Toasts />
          {intro && <Onboarding onDone={() => closeIntro(true)} />}
        </Phone>

        <SidePanelRight />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* phone shell                                                         */
/* ------------------------------------------------------------------ */

function Phone({
  children,
  alarm,
  hud,
}: {
  children: React.ReactNode;
  alarm: boolean;
  hud?: React.ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <div
        className={`pointer-events-none absolute -inset-6 rounded-[4rem] blur-2xl transition-colors duration-700 ${
          alarm
            ? "bg-[conic-gradient(from_0deg,rgba(255,59,48,0.5),rgba(34,120,255,0.5),rgba(255,59,48,0.5))]"
            : "bg-[conic-gradient(from_0deg,rgba(255,46,151,0.35),rgba(34,230,255,0.3),rgba(255,46,151,0.35))]"
        }`}
      />
      <div className="relative h-[min(90dvh,860px)] w-[min(94vw,392px)] rounded-[2.75rem] border border-white/15 bg-gradient-to-b from-white/15 to-white/5 p-[3px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[2.6rem] bg-vice-void">
          <StatusBar />
          {hud}
          <div className="relative flex-1 overflow-hidden">{children}</div>
          <div className="flex justify-center py-2">
            <div className="h-1 w-28 rounded-full bg-white/25" />
          </div>
          <div className="scanlines pointer-events-none absolute inset-0 rounded-[2.6rem]" />
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  const { starCount, heat } = useVice();
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
    tick();
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative z-30 flex items-center justify-between px-5 pb-1 pt-3">
      <span className="font-mono text-[11px] tabular-nums">{now || "--:--"}</span>
      <div className="absolute left-1/2 top-2 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
      <div className="flex items-center gap-2">
        <Stars count={starCount} size={11} />
        <span
          className={`font-mono text-[10px] ${heat > 60 ? "text-vice-blood" : "text-white/45"}`}
        >
          {heat}°
        </span>
        <MuteToggle />
        <span className="text-[11px] text-white/60">▮</span>
      </div>
    </div>
  );
}

/**
 * A live contract has to be visible from inside whichever app you're using,
 * so the clock rides just under the status bar everywhere but boot/lock.
 */
function ContractHUD({
  active,
  onOpen,
}: {
  active: boolean;
  onOpen: () => void;
}) {
  const { active: job } = useVice();
  const left = useCountdown(job?.deadline ?? 0);
  if (!job) return null;

  const c = job.contract;
  const frac = Math.max(0, Math.min(1, left / (c.seconds * 1000)));
  const panic = left < 25000;
  const tint = panic ? "#ff3b30" : TIER_TINT[c.tier];

  return (
    <button
      onClick={onOpen}
      disabled={active}
      className="relative z-30 mx-3 mb-1 flex items-center gap-2 overflow-hidden rounded-lg border bg-black/50 px-2.5 py-1.5 text-left disabled:cursor-default"
      style={{ borderColor: `${tint}55` }}
    >
      <div
        className="absolute inset-y-0 left-0 opacity-15 transition-[width] duration-200"
        style={{ width: `${frac * 100}%`, background: tint }}
      />
      <span
        className={`relative h-1.5 w-1.5 shrink-0 rounded-full ${panic ? "flicker" : ""}`}
        style={{ background: tint, boxShadow: `0 0 8px ${tint}` }}
      />
      <span className="relative min-w-0 flex-1 truncate font-mono text-[9px] tracking-[0.16em] text-white/70">
        {c.codename}
        <span className="ml-1.5 text-white/35">
          {c.objectives.length} OBJ · {c.event === "poster" ? "BULLETIN" : "POST"}
        </span>
      </span>
      <span
        className="relative font-mono text-[11px] tabular-nums"
        style={{ color: tint }}
      >
        {clock(left)}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* boot / lock / home                                                  */
/* ------------------------------------------------------------------ */

function Boot({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);

  /*
   * The boot sequence is ~2s of typing on the compositor, which is dead time
   * on the network. Spend it pulling the Image Lab's bundle down so the first
   * press of EDIT opens on a canvas rather than the darkroom skeleton.
   */
  useEffect(() => {
    warmUpEditor();
  }, []);

  useEffect(() => {
    if (i >= BOOT_LINES.length) {
      const t = setTimeout(onDone, 550);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setI((v) => v + 1), i === 0 ? 420 : 210);
    return () => clearTimeout(t);
  }, [i, onDone]);

  return (
    <div className="flex h-full flex-col justify-end p-5 pb-10">
      <div className="mb-auto mt-10 text-center">
        <p className="headline flicker text-5xl text-vice-pink neon-text">VICE</p>
        <p className="headline text-5xl text-vice-cyan neon-cyan">OS</p>
      </div>
      <div className="space-y-1">
        {BOOT_LINES.slice(0, i).map((l, k) => (
          <p
            key={k}
            className={`font-mono text-[10px] leading-relaxed ${
              l.includes("FOUND") ? "text-vice-blood" : "text-vice-lime/80"
            }`}
          >
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Every sound in the OS is synthesised; this is the only control over them. */
function MuteToggle() {
  // The audio engine lives outside React; this is the standard way to read it
  // without an effect writing state on mount.
  const off = useSyncExternalStore(onMuteChange, isMuted, () => false);
  return (
    <button
      onClick={() => {
        unlock();
        toggleMute();
      }}
      aria-label={off ? "Unmute" : "Mute"}
      className="font-mono text-[10px] leading-none text-white/45 transition hover:text-white"
    >
      {off ? "♪̸" : "♪"}
    </button>
  );
}

function Lock({
  wallpaper,
  onUnlock,
}: {
  wallpaper: string | null;
  onUnlock: () => void;
}) {
  const { alias, heat, bountyValue } = useVice();
  return (
    <button
      onClick={() => {
        // Browsers hold the AudioContext until a real gesture; this is it.
        unlock();
        sfx.boot();
        onUnlock();
      }}
      className="group relative flex h-full w-full flex-col justify-between p-6 text-left"
    >
      {wallpaper && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={wallpaper}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/85" />

      <div className="relative mt-10 text-center">
        <p className="headline text-7xl leading-none">
          {new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.28em] text-white/60">
          LEONIDA · 88°F · HUMID
        </p>
      </div>

      <div className="relative space-y-3">
        <div className="glass rounded-2xl p-3">
          <p className="font-mono text-[9px] tracking-[0.22em] text-vice-cyan">
            LEONIDA S.O. — ALERT
          </p>
          <p className="mt-1 text-[13px] font-semibold">
            Bounty updated: {money(bountyValue)}
          </p>
          <p className="text-[11px] text-white/60">
            Subject &ldquo;{alias}&rdquo; · heat {heat}°. Tap to dismiss forever.
          </p>
        </div>
        <p className="text-center font-mono text-[10px] tracking-[0.24em] text-white/50 transition group-hover:text-white">
          TAP TO UNLOCK ↑
        </p>
      </div>
    </button>
  );
}

/** Little counter on the Fixer tile: jobs waiting, or the live one. */
function JobBadge() {
  const { board, active } = useVice();
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] ${
        active
          ? "bg-vice-blood/20 text-vice-blood"
          : "bg-vice-sun/20 text-vice-sun"
      }`}
    >
      {active ? "ON A JOB" : `${board.length} OPEN`}
    </span>
  );
}

function Home({
  wallpaper,
  onOpen,
  onLock,
  onIntro,
}: {
  wallpaper: string | null;
  onOpen: (id: Target) => void;
  onLock: () => void;
  onIntro: () => void;
}) {
  const { alias, handle, posts, bountyValue, starCount, judge, dispatch } =
    useVice();
  return (
    <div className="relative h-full">
      {wallpaper && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={wallpaper}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-35"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-vice-void/60 via-vice-void/80 to-vice-void" />

      <div className="vice-scroll relative h-full overflow-y-auto p-5">
        {/* heat widget */}
        <div className="glass rounded-2xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-[9px] tracking-[0.22em] text-white/45">
                SUBJECT
              </p>
              <p className="headline text-xl leading-tight">{alias}</p>
              <p className="font-mono text-[10px] text-vice-cyan">{handle}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[9px] tracking-[0.22em] text-white/45">
                BOUNTY
              </p>
              <p className="headline text-xl text-vice-lime">{money(bountyValue)}</p>
            </div>
          </div>
          <div className="mt-3">
            <HeatMeter />
          </div>
        </div>

        {/*
          The fast path for somebody who has never seen this before: a guided
          run down the whole loop, one action at a time.
        */}
        <button
          onClick={() => dispatch({ type: "judge", on: !judge })}
          className={`mt-3 flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
            judge
              ? "border-vice-lime bg-vice-lime/10"
              : "border-vice-lime/40 bg-black/40 hover:border-vice-lime"
          }`}
        >
          <span className="text-vice-lime">▶</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold tracking-wide text-vice-lime">
              {judge ? "JUDGE MODE IS ON" : "PLAY THE GUIDED DEMO"}
            </p>
            <p className="font-mono text-[9px] tracking-[0.12em] text-white/40">
              {judge
                ? "follow the card under the status bar"
                : "photo → forensics → edit → publish → consequences"}
            </p>
          </div>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onIntro();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onIntro();
              }
            }}
            className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 font-mono text-[8px] tracking-[0.12em] text-white/40 transition hover:border-white/50 hover:text-white"
          >
            INTRO
          </span>
        </button>

        {/* apps */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          {APPS.map((a) => (
            <button
              key={a.id}
              onClick={() => {
              sfx.select();
              onOpen(a.id);
            }}
              className={`group rounded-2xl border border-white/10 bg-black/40 p-3 text-left transition hover:-translate-y-0.5 hover:border-white/30 ${
                "wide" in a && a.wide ? "col-span-2 flex items-center gap-3" : ""
              }`}
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl text-vice-void shadow-lg transition group-hover:scale-105"
                style={{ background: `linear-gradient(135deg, ${a.from}, ${a.to})` }}
              >
                {a.glyph}
              </div>
              <div className={"wide" in a && a.wide ? "min-w-0 flex-1" : ""}>
                <p
                  className={`text-[12px] font-bold tracking-wide ${"wide" in a && a.wide ? "" : "mt-2.5"}`}
                >
                  {a.name}
                </p>
                <p className="font-mono text-[9px] tracking-[0.12em] text-white/40">
                  {a.sub}
                </p>
              </div>
              {a.id === "contracts" && <JobBadge />}
              {a.id === "street" && (
                <span className="shrink-0 rounded-full bg-vice-cyan/20 px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] text-vice-cyan">
                  3D
                </span>
              )}
            </button>
          ))}
        </div>

        {/* recent */}
        <div className="mt-5">
          <p className="font-mono text-[9px] tracking-[0.24em] text-white/40">
            RECENT ACTIVITY
          </p>
          {posts.length === 0 ? (
            <p className="mt-2 text-[12px] leading-snug text-white/50">
              Nothing on the record yet. Open{" "}
              <span className="text-vice-cyan">LEONIDA LIVE</span>, go shoot
              something, and see what the image lab does to your reputation.
            </p>
          ) : (
            <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
              {posts.slice(0, 6).map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.id}
                  src={p.image}
                  alt={p.caption}
                  className="h-16 w-14 shrink-0 rounded-lg border border-white/10 object-cover"
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[0.2em] text-white/30">
            WANTED LEVEL
          </span>
          <Stars count={starCount} size={13} />
        </div>

        <button
          onClick={onLock}
          className="mt-4 w-full rounded-xl border border-white/10 py-2 font-mono text-[9px] tracking-[0.24em] text-white/35 transition hover:border-white/30 hover:text-white/70"
        >
          LOCK DEVICE
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* toasts                                                              */
/* ------------------------------------------------------------------ */

function Toasts() {
  const { toasts } = useVice();
  const tone = {
    heat: "border-vice-pink/60 text-vice-pink",
    alert: "border-vice-blood/70 text-vice-blood",
    cool: "border-vice-lime/60 text-vice-lime",
    info: "border-vice-cyan/60 text-vice-cyan",
  };
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-40 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`glass-deep pop-in rounded-2xl border px-3 py-2.5 ${tone[t.kind]}`}
        >
          <p className="font-mono text-[11px] font-bold tracking-[0.16em]">{t.title}</p>
          {t.body && (
            <p className="mt-0.5 text-[11px] leading-snug text-white/70">{t.body}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* desktop side panels                                                 */
/* ------------------------------------------------------------------ */

function SidePanelLeft() {
  return (
    <aside className="hidden w-[300px] shrink-0 space-y-4 lg:block">
      <div>
        <p className="font-mono text-[10px] tracking-[0.3em] text-vice-cyan">
          BUILT WITH IMAGE EDITOR
        </p>
        <h1 className="headline mt-2 text-6xl leading-[0.82]">
          VICE
          <br />
          <span className="text-vice-pink neon-text">OS</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          A phone you&apos;d actually find in Leonida. Walk the block in 3D, raise the
          phone, take the shot — then decide in the image lab how much of the truth
          survives the edit. The state is watching the same photo you are.
        </p>
      </div>

      <Panel label="THE LOOP">
        <ol className="space-y-2.5 text-[12px] leading-snug text-white/65">
          <li>
            <span className="font-mono text-vice-cyan">01</span> Open{" "}
            <span className="text-vice-cyan">LEONIDA LIVE</span> and walk a real-time 3D
            street — rig, crowd and city all generated at runtime.
          </li>
          <li>
            <span className="font-mono text-vice-cyan">02</span> Raise the phone and
            shoot. The lens records every face, plate and landmark it caught —
            and the exact rectangle each one filled.
          </li>
          <li>
            <span className="font-mono text-vice-cyan">03</span>{" "}
            <span className="text-vice-cyan">FORENSIC VISION</span> brackets them
            and prices the frame before you ever open the editor.
          </li>
          <li>
            <span className="font-mono text-vice-pink">04</span> Edit it in the image
            lab: crop, grade, draw, sticker over the incriminating parts. The rail
            re-reads those rectangles while you work.
          </li>
          <li>
            <span className="font-mono text-vice-pink">05</span> Run forensics. Your
            export is diffed against the original, subject by subject, and what
            survived is what you pay for.
          </li>
          <li>
            <span className="font-mono text-vice-pink">06</span> Post it. The radio
            calls it in, the bulletin prints your own photo, and the street starts
            crossing the road.
          </li>
          <li>
            <span className="font-mono text-vice-sun">07</span> Or take a contract from{" "}
            <span className="text-vice-sun">THE FIXER</span> — half of them want the
            photo buried, half want it damning. Both are graded on the scan.
          </li>
        </ol>
      </Panel>

      <Panel label="STATUS">
        <HeatMeter />
      </Panel>
    </aside>
  );
}

function SidePanelRight() {
  const { posts, crimes, followers, bountyValue, alias, cash, completed } =
    useVice();
  const [feed, setFeed] = useState<string[]>([]);

  useEffect(() => {
    const t = setInterval(
      () => setFeed((f) => [pick(DISPATCH), ...f].slice(0, 5)),
      5200,
    );
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(
    () => [
      { k: "POSTS", v: posts.length.toString() },
      { k: "FOLLOWERS", v: followers.toLocaleString() },
      { k: "CHARGES", v: crimes.length.toString() },
      { k: "BOUNTY", v: money(bountyValue) },
      { k: "ON HAND", v: money(cash) },
      { k: "RANK", v: rankFor(completed) },
    ],
    [posts.length, followers, crimes.length, bountyValue, cash, completed],
  );

  return (
    <aside className="hidden w-[300px] shrink-0 space-y-4 xl:block">
      <Panel label={`FILE ON ${alias}`}>
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.k}>
              <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">
                {s.k}
              </p>
              <p className="headline text-xl">{s.v}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel label="LSO DISPATCH">
        <div className="space-y-2">
          {feed.length === 0 && (
            <p className="font-mono text-[10px] text-white/30">…scanning…</p>
          )}
          {feed.map((l, i) => (
            <p
              key={`${l}-${i}`}
              className="rise-in font-mono text-[10px] leading-relaxed text-white/55"
            >
              <span className="text-vice-cyan">▸</span> {l}
            </p>
          ))}
        </div>
      </Panel>

      <Panel label="COLOPHON">
        <p className="text-[12px] leading-relaxed text-white/60">
          Editing is powered by{" "}
          <a
            href="https://github.com/unlayer/react-image-editor"
            target="_blank"
            rel="noreferrer"
            className="text-vice-pink underline underline-offset-4"
          >
            @unlayer/react-image-editor
          </a>
          . Leonida Live runs on three.js. Everything else — the scenes, mugshots,
          posters, licenses, the humanoid rig and the whole city — is generated at
          runtime. No downloaded models, no uploads, no server.
        </p>
      </Panel>
    </aside>
  );
}
