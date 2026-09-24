"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeEdit, type Forensics } from "@/lib/art";
import {
  COMMENTERS,
  COMMENTS_HOT,
  COMMENTS_SAFE,
  COMMENTS_SCRUBBED,
  CAPTION_SEEDS,
  CRIMES,
  TAGS,
  pick,
} from "@/lib/copy";
import { uid, useVice, type Comment, type Post } from "@/lib/store";
import { readFile, useCameraRoll } from "@/lib/useCameraRoll";
import EditorStage from "@/components/EditorStage";
import { AppHeader, Btn, Chip, Stars, Tally } from "@/components/ui";

type Mode =
  | { k: "roll" }
  | { k: "edit"; src: string; title: string; location: string }
  | {
      k: "scan";
      src: string;
      original: string;
      title: string;
      location: string;
    }
  | {
      k: "compose";
      src: string;
      original: string;
      title: string;
      location: string;
      forensics: Forensics;
    }
  | { k: "feed" };

/** How hard did the player scrub the frame? 0 = raw upload, 100 = unrecognisable. */
function scrubScore(f: Forensics) {
  return Math.max(
    0,
    Math.min(100, f.altered * 0.55 + f.coverage * 0.9 + (f.reframed ? 15 : 0)),
  );
}

export default function Vicegram({ onBack }: { onBack: () => void }) {
  const vice = useVice();
  const shots = useCameraRoll();
  const [mode, setMode] = useState<Mode>({ k: "roll" });
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>(["#leonidalive"]);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasPosts = vice.posts.length > 0;

  /* ---- editor commit -> forensic scan ---- */
  const onCommit = async (dataUrl: string) => {
    if (mode.k !== "edit") return;
    setMode({
      k: "scan",
      src: dataUrl,
      original: mode.src,
      title: mode.title,
      location: mode.location,
    });
    let forensics: Forensics;
    try {
      forensics = await analyzeEdit(mode.src, dataUrl);
    } catch {
      forensics = {
        altered: 0,
        intensity: 0,
        temperature: 0,
        reframed: false,
        coverage: 0,
      };
    }
    // let the scanner animation breathe
    setTimeout(() => {
      setCaption(pick(CAPTION_SEEDS));
      setMode({
        k: "compose",
        src: dataUrl,
        original: mode.src,
        title: mode.title,
        location: mode.location,
        forensics,
      });
    }, 1900);
  };

  const publish = () => {
    if (mode.k !== "compose") return;
    const f = mode.forensics;
    const scrub = scrubScore(f);
    const chosen = TAGS.filter((t) => tags.includes(t.label));
    const exposure = chosen.reduce((a, t) => a + t.heat, 0) + 6;
    const reach = chosen.reduce((a, t) => a + t.reach, 0) + caption.length / 3;

    const heatDelta = Math.max(
      -6,
      Math.round(exposure * (1 - scrub / 130) + (scrub < 8 ? 5 : -3)),
    );
    const likes = Math.round(
      (180 + reach * 26) * (0.7 + f.altered / 90) * (1 + Math.random() * 0.4),
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
      image: mode.src,
      original: mode.original,
      title: mode.title,
      location: mode.location,
      caption,
      tags,
      likes,
      comments: seedComments,
      forensics: f,
      heatDelta,
      at: Date.now(),
    };

    vice.dispatch({ type: "post", post });
    if (heatDelta > 10) vice.dispatch({ type: "crime", crime: pick(CRIMES) });

    vice.toast(
      heatDelta > 0
        ? {
            kind: heatDelta > 12 ? "alert" : "heat",
            title: `+${heatDelta} HEAT`,
            body:
              heatDelta > 12
                ? "That frame is evidence. Somebody screenshotted it."
                : "Posted. The algorithm noticed.",
          }
        : {
            kind: "cool",
            title: `${heatDelta} HEAT`,
            body: "Scrubbed clean. Forensics got nothing.",
          },
    );

    setTags(["#leonidalive"]);
    setMode({ k: "feed" });
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

  /* ---------------- editor overlay ---------------- */
  if (mode.k === "edit") {
    return (
      <EditorStage
        image={mode.src}
        mission={{
          title: mode.title,
          brief:
            "Make it yours — then decide how much of the truth stays in frame.",
          hints: [
            "Filters + grade = style points",
            "Stickers & shapes cover faces, plates, landmarks",
            "Crop out anything that geolocates you",
          ],
          accent: "pink",
          commitLabel: "RUN FORENSICS",
        }}
        onCommit={onCommit}
        onCancel={() => setMode({ k: "roll" })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        title="VICEGRAM"
        sub={`${vice.handle} · ${vice.followers.toLocaleString()} FOLLOWERS`}
        onBack={onBack}
        right={
          <div className="flex items-center gap-2">
            <Stars count={vice.starCount} size={12} />
          </div>
        }
      />

      <div className="vice-scroll flex-1 overflow-y-auto">
        {mode.k === "roll" && (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="headline text-2xl">CAMERA ROLL</p>
                <p className="font-mono text-[10px] tracking-[0.2em] text-white/40">
                  PICK A FRAME → OPEN THE IMAGE LAB
                </p>
              </div>
              {hasPosts && (
                <Btn tone="ghost" onClick={() => setMode({ k: "feed" })}>
                  FEED
                </Btn>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {shots.map((s) => (
                <button
                  key={s.id}
                  disabled={!s.src}
                  onClick={() =>
                    s.src &&
                    setMode({
                      k: "edit",
                      src: s.src,
                      title: s.title,
                      location: s.location,
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
                onClick={() => fileRef.current?.click()}
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
                });
                e.target.value = "";
              }}
            />

            <p className="mt-4 text-center font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/30">
              EVERY SHOT IS PAINTED ON A CANVAS AT RUNTIME.
              <br />
              NOTHING HERE LEAVES YOUR BROWSER.
            </p>
          </div>
        )}

        {mode.k === "scan" && <Scanner src={mode.src} />}

        {mode.k === "compose" && (
          <Composer
            src={mode.src}
            forensics={mode.forensics}
            caption={caption}
            setCaption={setCaption}
            tags={tags}
            setTags={setTags}
            onPublish={publish}
            onBackToEdit={() =>
              setMode({
                k: "edit",
                src: mode.original,
                title: mode.title,
                location: mode.location,
              })
            }
          />
        )}

        {mode.k === "feed" && (
          <Feed onNew={() => setMode({ k: "roll" })} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Scanner({ src }: { src: string }) {
  const lines = [
    "hashing frame…",
    "comparing against source plate…",
    "measuring altered surface…",
    "estimating identifiability…",
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

function Bar({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] tracking-[0.2em] text-white/40">
          {label}
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: tint }}>
          {value}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${Math.min(100, value)}%`, background: tint }}
        />
      </div>
    </div>
  );
}

function Composer({
  src,
  forensics,
  caption,
  setCaption,
  tags,
  setTags,
  onPublish,
  onBackToEdit,
}: {
  src: string;
  forensics: Forensics;
  caption: string;
  setCaption: (v: string) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  onPublish: () => void;
  onBackToEdit: () => void;
}) {
  const scrub = Math.round(scrubScore(forensics));
  const verdict =
    scrub > 60
      ? { t: "UNIDENTIFIABLE", c: "#9dff3d", s: "Forensics can't place this frame. Post freely." }
      : scrub > 28
        ? { t: "PARTIALLY SCRUBBED", c: "#22e6ff", s: "Recognisable, but you covered the worst of it." }
        : { t: "RAW FRAME", c: "#ff3b30", s: "Everything in this shot is admissible. Your call." };

  const chosen = TAGS.filter((t) => tags.includes(t.label));
  const projected = chosen.reduce((a, t) => a + t.heat, 0) + 6;

  return (
    <div className="p-4 pb-6 rise-in">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="edited"
          className="h-28 w-24 shrink-0 rounded-lg border border-white/15 object-cover"
        />
        <div className="min-w-0 flex-1">
          <p
            className="headline text-xl leading-none"
            style={{ color: verdict.c, textShadow: `0 0 18px ${verdict.c}88` }}
          >
            {verdict.t}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-white/55">{verdict.s}</p>
          <button
            onClick={onBackToEdit}
            className="mt-2 font-mono text-[9px] tracking-[0.18em] text-vice-cyan underline underline-offset-4"
          >
            ↩ BACK TO THE IMAGE LAB
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Bar label="SURFACE ALTERED" value={forensics.altered} tint="#ff2e97" />
        <Bar label="OVERLAY COVERAGE" value={forensics.coverage} tint="#22e6ff" />
        <Bar label="GRADE SHIFT" value={Math.abs(forensics.temperature)} tint="#ffb347" />
        <Bar label="SCRUB RATING" value={scrub} tint="#9dff3d" />
      </div>
      {forensics.reframed && (
        <p className="mt-2 font-mono text-[9px] tracking-[0.16em] text-vice-lime">
          ✓ REFRAMED — ORIGINAL COMPOSITION NO LONGER MATCHES
        </p>
      )}

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

      <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
        <div>
          <p className="font-mono text-[9px] tracking-[0.2em] text-white/40">
            PROJECTED EXPOSURE
          </p>
          <p className="font-mono text-lg tabular-nums text-vice-pink">
            +{Math.max(0, Math.round(projected * (1 - scrub / 130)))} HEAT
          </p>
        </div>
        <Btn onClick={onPublish}>POST IT</Btn>
      </div>
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
