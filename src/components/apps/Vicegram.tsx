"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  COMMENTERS,
  COMMENTS_HOT,
  COMMENTS_SAFE,
  COMMENTS_SCRUBBED,
  CAPTION_SEEDS,
  CRIMES,
  TAGS,
  dispatchFor,
  money,
  pick,
} from "@/lib/copy";
import { evaluate, TIER_TINT, type ContractCtx } from "@/lib/contracts";
import { rawExposure, type Evidence } from "@/lib/evidence";
import {
  heatFor,
  runForensics,
  type HeatBreakdown,
  type Report,
} from "@/lib/forensics";
import {
  uid,
  useVice,
  type Attempt,
  type Comment,
  type Post,
} from "@/lib/store";
import { readFile, useCameraRoll } from "@/lib/useCameraRoll";
import EditorStage from "@/components/EditorStage";
import ForensicVision from "@/components/forensic/ForensicVision";
import ForensicReport from "@/components/forensic/ForensicReport";
import Consequences, { type Consequence } from "@/components/forensic/Consequences";
import type {
  ReelFrame,
  TimelineStep,
} from "@/components/forensic/useLiveForensics";
import { sfx } from "@/lib/audio";
import { AppHeader, Btn, Chip, Stars, Tally } from "@/components/ui";
import type { StreetPhoto } from "@/components/apps/StreetMode";

/**
 * The 3D street is the heaviest thing in the app by an order of magnitude, so
 * it is only fetched when the player actually opens the camera.
 */
const StreetMode = dynamic(() => import("@/components/apps/StreetMode"), {
  ssr: false,
});

export type { Evidence };

type Frame = {
  src: string;
  title: string;
  location: string;
  /** Which camera-roll scene this came from — contracts can ask for one. */
  sceneId?: string;
  /**
   * Identifiable subjects the lens caught, when the frame was shot in Leonida
   * Live, each with the rectangle it occupied. These are what the edit has to
   * deal with.
   */
  evidence: Evidence[];
  /**
   * True when this frame was shot in Leonida Live rather than picked off the
   * roll or imported. It is what lets every stage downstream offer a way
   * straight back into the 3D street instead of dumping you in the film roll.
   */
  fromStreet?: boolean;
};

type Scanned = Frame & {
  original: string;
  report: Report;
  /** Edit history observed by the live panel on the way to this export. */
  timeline: TimelineStep[];
  /** Every settled canvas the panel filmed, for the scrub reel. */
  reel: ReelFrame[];
  /** What the last scan of this same frame came out at, if there was one. */
  previous?: Attempt;
};

type Mode =
  | { k: "roll" }
  | { k: "street" }
  | ({ k: "vision" } & Frame)
  | ({ k: "edit" } & Frame)
  | ({ k: "scan"; original: string } & Frame)
  | ({ k: "report" } & Scanned)
  | ({ k: "compose" } & Scanned)
  | { k: "aftermath"; steps: Consequence[] }
  | { k: "feed" };

export default function Vicegram({
  onBack,
  startInStreet = false,
}: {
  onBack: () => void;
  startInStreet?: boolean;
}) {
  const vice = useVice();
  const shots = useCameraRoll();
  const [mode, setMode] = useState<Mode>(
    startInStreet ? { k: "street" } : { k: "roll" },
  );
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>(["#leonidalive"]);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasPosts = vice.posts.length > 0;

  /* ---- the shutter hands straight to forensic vision ---- */
  const onShoot = (photo: StreetPhoto) => {
    const frame: Frame = {
      src: photo.src,
      title: photo.title,
      location: photo.location,
      evidence: photo.evidence,
      fromStreet: true,
    };
    vice.dispatch({ type: "captured", frame });
    vice.mark("shot");
    setMode({ k: "vision", ...frame });
  };

  /* ---- editor commit -> the authoritative scan ---- */
  const onCommit = async (
    dataUrl: string,
    timeline: TimelineStep[],
    reel: ReelFrame[],
  ) => {
    if (mode.k !== "edit") return;
    const frame: Frame = {
      src: mode.src,
      title: mode.title,
      location: mode.location,
      sceneId: mode.sceneId,
      evidence: mode.evidence,
      fromStreet: mode.fromStreet,
    };
    setMode({ k: "scan", ...frame, src: dataUrl, original: mode.src });

    const report = await runForensics(mode.src, dataUrl, mode.evidence);

    const previous = vice.attempts[mode.src];
    vice.dispatch({
      type: "attempt",
      key: mode.src,
      attempt: {
        scrub: Math.round(report.scrub),
        heat: heatFor(report, tags, TAGS).final,
      },
    });

    vice.mark("report");
    setCaption((c) => c || pick(CAPTION_SEEDS));
    setMode({
      k: "report",
      ...frame,
      src: dataUrl,
      original: mode.src,
      report,
      timeline,
      reel,
      previous,
    });
  };

  const backToLab = (m: Scanned) =>
    setMode({
      k: "edit",
      src: m.original,
      title: m.title,
      location: m.location,
      sceneId: m.sceneId,
      evidence: m.evidence,
      fromStreet: m.fromStreet,
    });

  /* ---- publish + consequences ---- */
  const publish = (m: Scanned, heat: HeatBreakdown) => {
    const report = m.report;
    const scrub = report.scrub;
    const heatDelta = heat.final;

    const chosen = TAGS.filter((t) => tags.includes(t.label));
    const reach = chosen.reduce((a, t) => a + t.reach, 0) + caption.length / 3;
    const likes = Math.round(
      (180 + reach * 26) *
        (0.7 + report.forensics.altered / 90) *
        (1 + Math.random() * 0.4),
    );

    const pool =
      scrub > 55 ? COMMENTS_SCRUBBED : heatDelta > 12 ? COMMENTS_HOT : COMMENTS_SAFE;
    const seedComments: Comment[] = Array.from({ length: 2 }, () => {
      const c = pick(COMMENTERS);
      return {
        id: uid(),
        handle: c.handle,
        hue: c.hue,
        badge: c.badge,
        body: pick(pool),
      };
    });

    const post: Post = {
      id: uid(),
      image: m.src,
      original: m.original,
      title: m.title,
      location: m.location,
      caption,
      tags,
      likes,
      comments: seedComments,
      forensics: report.forensics,
      heatDelta,
      at: Date.now(),
    };

    vice.dispatch({ type: "post", post });
    vice.mark("post");
    if (report.scrub > 20) vice.mark("edit");
    if (heatDelta > 10) vice.dispatch({ type: "crime", crime: pick(CRIMES) });

    // If a contract is live, this post is the delivery.
    const settled = vice.settleContract(ctxFor(m, tags, heatDelta));

    /*
     * How identifiable the export still is. With recorded subject rectangles
     * that is the mean of what survived; without them it falls back to the
     * whole-frame scrub, same as the forensic pass does.
     */
    const confidence = report.findings.length
      ? Math.round(
          report.findings.reduce((a, f) => a + (100 - f.concealment), 0) /
            report.findings.length,
        )
      : Math.round(Math.max(0, 100 - scrub));

    // Rolled once, so the radio and the aftermath card say the same thing.
    const radioLine = dispatchFor(m.location, confidence);

    vice.logConsequence({
      image: m.src,
      location: m.location,
      confidence,
      dispatch: radioLine,
    });

    if (settled) {
      vice.toast(
        settled.ok
          ? {
              kind: "cool",
              title: `${settled.contract.codename} — PAID`,
              body: `${money(settled.contract.reward)} from ${settled.contract.fixer}.`,
            }
          : {
              kind: "alert",
              title: `${settled.contract.codename} — BLOWN`,
              body: "The export didn't hit the brief. No payout.",
            },
      );
    }

    /* ---- the aftermath, played back one app at a time ---- */
    const steps: Consequence[] = [
      {
        app: "VICEGRAM",
        tint: "#ff2e97",
        headline: "POST PUBLISHED",
        body: `${likes.toLocaleString()} impressions and climbing. Forensic match on the export: ${confidence}%.`,
        stat: {
          k: "HEAT",
          v: `${heatDelta > 0 ? "+" : ""}${heatDelta}`,
          tint: heatDelta > 4 ? "#ff3b30" : "#9dff3d",
        },
        image: m.src,
      },
      {
        app: "SCANNER 7",
        tint: "#ffb347",
        headline: "NEW DISPATCH",
        body: `"${radioLine}"`,
        stat: {
          k: "WANTED",
          v: "★".repeat(Math.max(1, vice.starCount)) || "—",
          tint: "#ffd36b",
        },
      },
    ];

    if (confidence >= 25) {
      steps.push({
        app: "MOST WANTED",
        tint: "#22e6ff",
        headline: "NEW EVIDENCE",
        body: `Your export is on file against ${vice.alias}. The bulletin will print with this frame.`,
        stat: { k: "EVIDENCE CONFIDENCE", v: `${confidence}%` },
        image: m.src,
      });
    } else {
      steps.push({
        app: "MOST WANTED",
        tint: "#9dff3d",
        headline: "NOTHING ON FILE",
        body: "The export was too scrubbed to log. As far as the state is concerned, that photo isn't of anybody.",
        stat: { k: "EVIDENCE CONFIDENCE", v: `${confidence}%`, tint: "#9dff3d" },
      });
    }

    setTags(["#leonidalive"]);
    setCaption("");
    setMode({ k: "aftermath", steps });
  };

  /* ---- live engagement ticker on the feed ---- */
  useEffect(() => {
    if (mode.k !== "feed" || !hasPosts) return;
    const t = setInterval(() => {
      const p = vice.posts[0];
      if (!p) return;
      const hot = p.heatDelta > 12;
      const bump = Math.round(Math.random() * 40) + 6;
      const addComment = Math.random() > 0.62;
      const c = pick(COMMENTERS);
      vice.dispatch({
        type: "engage",
        id: p.id,
        likes: p.likes + bump,
        comment: addComment
          ? {
              id: uid(),
              handle: c.handle,
              hue: c.hue,
              badge: c.badge,
              body: pick(hot ? COMMENTS_HOT : COMMENTS_SAFE),
            }
          : undefined,
      });
      if (hot && Math.random() > 0.8) vice.dispatch({ type: "heat", delta: 1 });
    }, 2600);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.k, hasPosts, vice.posts[0]?.id, vice.posts[0]?.likes]);

  /* ---------------- full-screen stages ---------------- */

  if (mode.k === "street") {
    return (
      <StreetMode
        heat={vice.heat}
        onExit={() => setMode({ k: "roll" })}
        onShoot={onShoot}
      />
    );
  }

  if (mode.k === "vision") {
    const frame: Frame = {
      src: mode.src,
      title: mode.title,
      location: mode.location,
      sceneId: mode.sceneId,
      evidence: mode.evidence,
      fromStreet: mode.fromStreet,
    };
    return (
      <ForensicVision
        src={mode.src}
        title={mode.title}
        location={mode.location}
        evidence={mode.evidence}
        onOpenLab={() => {
          vice.mark("vision");
          setMode({ k: "edit", ...frame });
        }}
        onStreet={mode.fromStreet ? () => setMode({ k: "street" }) : undefined}
        onDiscard={() => setMode(mode.fromStreet ? { k: "street" } : { k: "roll" })}
      />
    );
  }

  if (mode.k === "edit") {
    const caught = mode.evidence;
    return (
      <EditorStage
        image={mode.src}
        evidence={caught}
        mission={{
          title: mode.title,
          brief: caught.length
            ? `The lens caught ${caught.length} identifiable ${
                caught.length === 1 ? "subject" : "subjects"
              }, worth +${rawExposure(caught)} heat. Cover them or keep them — the scan reads those exact rectangles.`
            : "Make it yours — then decide how much of the truth stays in frame.",
          hints: caught.length
            ? [
                "Stickers & shapes go over faces and plates",
                "Crop tight to lose the skyline that geotags you",
                "The rail on the right is reading your canvas live",
              ]
            : [
                "Filters + grade = style points",
                "Stickers & shapes cover faces, plates, landmarks",
                "Crop out anything that geolocates you",
              ],
          accent: "pink",
          commitLabel: "RUN FORENSICS",
          surface: "forensics",
        }}
        onCommit={onCommit}
        onStreet={mode.fromStreet ? () => setMode({ k: "street" }) : undefined}
        onCancel={() => setMode(mode.fromStreet ? { k: "street" } : { k: "roll" })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        title="VICEGRAM"
        sub={`${vice.handle} · ${vice.followers.toLocaleString()} FOLLOWERS`}
        onBack={onBack}
        right={<Stars count={vice.starCount} size={12} />}
      />

      <div className="vice-scroll flex-1 overflow-y-auto">
        {mode.k === "roll" && (
          <Roll
            shots={shots}
            captured={vice.captured}
            hasPosts={hasPosts}
            onFeed={() => setMode({ k: "feed" })}
            onStreet={() => setMode({ k: "street" })}
            onFrame={(f) =>
              setMode(f.evidence.length ? { k: "vision", ...f } : { k: "edit", ...f })
            }
            onImport={() => fileRef.current?.click()}
          />
        )}

        {mode.k === "scan" && <ScanCurtain src={mode.src} />}

        {mode.k === "report" && (
          <ForensicReport
            original={mode.original}
            edited={mode.src}
            evidence={mode.evidence}
            report={mode.report}
            timeline={mode.timeline}
            reel={mode.reel}
            alias={vice.alias}
            title={mode.title}
            location={mode.location}
            previous={mode.previous}
            heat={heatFor(mode.report, tags, TAGS)}
            onBackToLab={() => backToLab(mode)}
            onPublish={() => setMode({ k: "compose", ...modeAsScanned(mode) })}
          />
        )}

        {mode.k === "compose" && (
          <Composer
            frame={mode}
            caption={caption}
            setCaption={setCaption}
            tags={tags}
            setTags={setTags}
            onPublish={(heat) => publish(modeAsScanned(mode), heat)}
            onBackToReport={() => setMode({ k: "report", ...modeAsScanned(mode) })}
          />
        )}

        {mode.k === "aftermath" && (
          <Consequences steps={mode.steps} onDone={() => setMode({ k: "feed" })} />
        )}

        {mode.k === "feed" && <Feed onNew={() => setMode({ k: "roll" })} />}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const src = await readFile(f);
          setMode({
            k: "edit",
            src,
            title: "IMPORTED EVIDENCE",
            location: "UNKNOWN",
            evidence: [],
          });
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Strips the discriminant so a scanned stage can be handed to another one. */
function modeAsScanned(m: Scanned & { k: string }): Scanned {
  return {
    src: m.src,
    original: m.original,
    title: m.title,
    location: m.location,
    sceneId: m.sceneId,
    evidence: m.evidence,
    fromStreet: m.fromStreet,
    report: m.report,
    timeline: m.timeline,
    reel: m.reel,
    previous: m.previous,
  };
}

/** Everything a contract objective is allowed to see about this delivery. */
function ctxFor(m: Scanned, tags: string[], heatDelta: number): ContractCtx {
  return {
    event: "post",
    forensics: m.report.forensics,
    scrub: m.report.scrub,
    tags,
    sceneId: m.sceneId,
    heatDelta,
    findings: m.report.findings.map((f) => ({
      kind: f.kind,
      label: f.label,
      status: f.status,
      concealment: f.concealment,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* camera roll                                                         */
/* ------------------------------------------------------------------ */

function Roll({
  shots,
  captured,
  hasPosts,
  onFeed,
  onStreet,
  onFrame,
  onImport,
}: {
  shots: { id: string; src: string | null; title: string; location: string; time: string }[];
  captured: Frame[];
  hasPosts: boolean;
  onFeed: () => void;
  onStreet: () => void;
  onFrame: (f: Frame) => void;
  onImport: () => void;
}) {
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="headline text-2xl">CAMERA ROLL</p>
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/40">
            PICK A FRAME → OPEN THE IMAGE LAB
          </p>
        </div>
        {hasPosts && (
          <Btn tone="ghost" onClick={onFeed}>
            FEED
          </Btn>
        )}
      </div>

      {/* the 3D camera — this is where new frames come from */}
      <button
        onClick={onStreet}
        className="group relative mb-4 w-full overflow-hidden rounded-2xl border border-vice-cyan/40 bg-gradient-to-br from-vice-plum to-black p-4 text-left transition hover:border-vice-cyan hover:shadow-[0_0_40px_-10px_rgba(34,230,255,0.8)]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(255,46,151,0.28),transparent_60%)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-vice-cyan to-vice-pink text-xl text-vice-void">
            ▶
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold tracking-wide">
              SHOOT IN LEONIDA LIVE
            </p>
            <p className="font-mono text-[9px] leading-relaxed tracking-[0.14em] text-vice-cyan/80">
              WALK THE BLOCK IN 3D · FRAME IT · THE LENS LOGS THE EVIDENCE
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-vice-cyan/15 px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] text-vice-cyan">
            3D
          </span>
        </div>
      </button>

      {captured.length > 0 && (
        <div className="mb-4">
          <p className="font-mono text-[9px] tracking-[0.24em] text-white/40">
            SHOT IN LEONIDA · {captured.length}
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
            {captured.map((f, i) => (
              <button
                key={`${f.title}-${i}`}
                onClick={() => onFrame(f)}
                className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-vice-cyan/40 transition hover:border-vice-cyan"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.src} alt={f.title} className="h-full w-full object-cover" />
                {f.evidence.length > 0 && (
                  <span className="absolute right-1 top-1 rounded bg-vice-blood px-1 font-mono text-[8px] font-bold text-vice-void">
                    {f.evidence.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {shots.map((s) => (
          <button
            key={s.id}
            disabled={!s.src}
            onClick={() =>
              s.src &&
              onFrame({
                src: s.src,
                title: s.title,
                location: s.location,
                sceneId: s.id,
                evidence: [],
              })
            }
            className="group relative aspect-4/5 overflow-hidden rounded-xl border border-white/10 bg-vice-plum text-left transition hover:border-vice-pink/70 hover:shadow-[0_0_30px_-8px_rgba(255,46,151,0.9)] disabled:cursor-wait"
          >
            {s.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.src}
                alt={s.title}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="sweep absolute inset-x-0 h-20 bg-gradient-to-b from-transparent via-vice-pink/25 to-transparent" />
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2.5">
              <p className="truncate text-[11px] font-semibold">{s.title}</p>
              <p className="font-mono text-[8px] tracking-[0.18em] text-vice-cyan">
                {s.location} · {s.time}
              </p>
            </div>
            <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.14em] text-white/70 opacity-0 transition group-hover:opacity-100">
              EDIT
            </span>
          </button>
        ))}

        <button
          onClick={onImport}
          className="flex aspect-4/5 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 text-white/45 transition hover:border-vice-cyan hover:text-vice-cyan"
        >
          <span className="text-3xl leading-none">+</span>
          <span className="px-3 text-center font-mono text-[9px] leading-relaxed tracking-[0.16em]">
            IMPORT FROM
            <br />
            YOUR DEVICE
          </span>
        </button>
      </div>

      <p className="mt-4 text-center font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/30">
        EVERY SHOT IS PAINTED ON A CANVAS AT RUNTIME.
        <br />
        NOTHING HERE LEAVES YOUR BROWSER.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ScanCurtain({ src }: { src: string }) {
  // The forensic pass sweeping the export.
  useEffect(() => {
    sfx.scan();
  }, []);
  const lines = [
    "hashing export…",
    "comparing against source plate…",
    "re-reading subject rectangles…",
    "pricing what survived…",
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, lines.length - 1)), 430);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="p-4">
      <p className="headline text-2xl text-vice-cyan neon-cyan">FORENSIC SCAN</p>
      <div className="relative mt-3 overflow-hidden rounded-xl border border-vice-cyan/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="scanning" className="w-full opacity-80" />
        <div className="sweep absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-vice-cyan/45 to-transparent" />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(34,230,255,0.08)_0px,rgba(34,230,255,0.08)_1px,transparent_1px,transparent_4px)]" />
      </div>
      <div className="mt-4 space-y-1.5 font-mono text-[10px] tracking-[0.14em] text-white/50">
        {lines.slice(0, i + 1).map((l) => (
          <p key={l} className="rise-in">
            <span className="text-vice-lime">›</span> {l}
          </p>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

function Composer({
  frame,
  caption,
  setCaption,
  tags,
  setTags,
  onPublish,
  onBackToReport,
}: {
  frame: Scanned;
  caption: string;
  setCaption: (v: string) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  onPublish: (heat: HeatBreakdown) => void;
  onBackToReport: () => void;
}) {
  // Recomputed on every tag toggle, from the same function that takes the heat.
  const heat = heatFor(frame.report, tags, TAGS);

  return (
    <div className="p-4 pb-6 rise-in">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.src}
          alt="edited"
          className="h-28 w-24 shrink-0 rounded-lg border border-white/15 object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="headline text-xl leading-none">PUBLISH TO VICEGRAM</p>
          <p className="mt-1 text-[11px] leading-snug text-white/55">
            Scrub score {Math.round(frame.report.scrub)}%. Tags add exposure on top
            of what you left in the frame.
          </p>
          <button
            onClick={onBackToReport}
            className="mt-2 font-mono text-[9px] tracking-[0.18em] text-vice-cyan underline underline-offset-4"
          >
            ↩ BACK TO THE FORENSIC REPORT
          </button>
        </div>
      </div>

      <div className="mt-5">
        <p className="font-mono text-[10px] tracking-[0.24em] text-white/45">CAPTION</p>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 180))}
          rows={3}
          className="vice-scroll mt-2 w-full resize-none rounded-xl border border-white/12 bg-black/40 p-3 text-sm outline-none transition focus:border-vice-pink"
          placeholder="Say something you'll regret…"
        />
      </div>

      <div className="mt-4">
        <p className="font-mono text-[10px] tracking-[0.24em] text-white/45">
          TAGS — THE SPICY ONES TRAVEL FURTHER
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TAGS.map((t) => (
            <Chip
              key={t.label}
              active={tags.includes(t.label)}
              hot={t.heat >= 7}
              onClick={() =>
                setTags(
                  tags.includes(t.label)
                    ? tags.filter((x) => x !== t.label)
                    : [...tags, t.label],
                )
              }
            >
              {t.label}
              {t.heat >= 7 && " 🔥"}
            </Chip>
          ))}
        </div>
      </div>

      <ContractCheck ctx={ctxFor(frame, tags, heat.final)} />

      <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
        <div>
          <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">
            PROJECTED EXPOSURE
          </p>
          <p
            className={`font-mono text-lg tabular-nums ${heat.final > 0 ? "text-vice-pink" : "text-vice-lime"}`}
          >
            {heat.final > 0 ? "+" : ""}
            {heat.final} HEAT
          </p>
        </div>
        <Btn onClick={() => onPublish(heat)}>POST IT</Btn>
      </div>
    </div>
  );
}

/**
 * Live read on the active contract while the player is still in the composer,
 * so they can go back to the editor before they burn the job.
 */
function ContractCheck({ ctx }: { ctx: ContractCtx }) {
  const { active } = useVice();
  if (!active || active.contract.event !== "post") return null;

  const c = active.contract;
  const marks = evaluate(c, ctx);
  const met = marks.filter(Boolean).length;
  const all = met === marks.length;
  const tint = all ? "#9dff3d" : TIER_TINT[c.tier];

  return (
    <div
      className="mt-5 rounded-xl border p-3"
      style={{ borderColor: `${tint}55`, background: `${tint}0d` }}
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] tracking-[0.22em]" style={{ color: tint }}>
          CONTRACT · {c.codename}
        </p>
        <p className="font-mono text-[10px] tabular-nums text-white/60">
          {met}/{marks.length}
        </p>
      </div>
      <ul className="mt-2 space-y-1">
        {c.objectives.map((o, i) => (
          <li key={o.label} className="flex items-start gap-2 text-[11px] leading-snug">
            <span className={marks[i] ? "text-vice-lime" : "text-white/25"}>
              {marks[i] ? "✓" : "○"}
            </span>
            <span className={marks[i] ? "text-white/80" : "text-white/45"}>
              {o.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-white/35">
        {all
          ? `POST IT AND ${c.fixer} PAYS ${money(c.reward)}.`
          : "POSTING NOW BLOWS THE JOB — GO BACK TO THE IMAGE LAB."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Feed({ onNew }: { onNew: () => void }) {
  const { posts, handle } = useVice();
  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="headline text-2xl">FEED</p>
        <Btn tone="cyan" onClick={onNew}>
          + NEW POST
        </Btn>
      </div>

      {posts.map((p) => (
        <article key={p.id} className="mb-4 border-y border-white/8 bg-black/20 rise-in">
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-vice-pink to-vice-cyan p-px">
              <div className="flex h-full w-full items-center justify-center rounded-full bg-vice-void font-mono text-[10px]">
                U
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold">{handle}</p>
              <p className="font-mono text-[8px] tracking-[0.18em] text-white/40">
                {p.location}
              </p>
            </div>
            <span
              className={`rounded-md px-2 py-1 font-mono text-[9px] tracking-[0.12em] ${
                p.heatDelta > 0
                  ? "bg-vice-pink/15 text-vice-pink"
                  : "bg-vice-lime/15 text-vice-lime"
              }`}
            >
              {p.heatDelta > 0 ? "+" : ""}
              {p.heatDelta} HEAT
            </span>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.image} alt={p.caption} className="w-full" />

          <div className="px-4 py-3">
            <div className="flex items-center gap-4 text-white/70">
              <span className="text-vice-pink">♥</span>
              <Tally value={p.likes} className="font-mono text-[12px]" />
              <span className="ml-auto font-mono text-[9px] tracking-[0.16em] text-white/30">
                {p.forensics ? `${p.forensics.altered}% ALTERED` : ""}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-snug">
              <span className="font-semibold">{handle}</span>{" "}
              <span className="text-white/80">{p.caption}</span>
            </p>
            <p className="mt-1 text-[12px] text-vice-cyan">{p.tags.join(" ")}</p>

            <div className="mt-3 space-y-2">
              {p.comments.slice(-4).map((c) => (
                <div key={c.id} className="flex gap-2 rise-in">
                  <div
                    className="mt-0.5 h-5 w-5 shrink-0 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, hsl(${c.hue} 90% 60%), hsl(${c.hue + 40} 90% 45%))`,
                    }}
                  />
                  <p className="text-[12px] leading-snug">
                    <span
                      className={`font-semibold ${c.badge === "blue" ? "text-vice-cyan" : ""}`}
                    >
                      {c.handle}
                    </span>
                    {c.badge === "blue" && (
                      <span className="ml-1 rounded bg-vice-cyan/20 px-1 font-mono text-[8px] text-vice-cyan">
                        LSO
                      </span>
                    )}{" "}
                    <span className="text-white/65">{c.body}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </article>
      ))}

      {posts.length === 0 && (
        <p className="px-4 py-10 text-center font-mono text-[11px] tracking-[0.16em] text-white/35">
          NOTHING POSTED YET.
        </p>
      )}
    </div>
  );
}
