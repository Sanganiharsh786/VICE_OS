"use client";

import { useRef, useState } from "react";
import { composeWantedPoster, download } from "@/lib/compose";
import { CRIMES, money, pick } from "@/lib/copy";
import { randomAlias, useVice } from "@/lib/store";
import { readFile, useBookingPhotos } from "@/lib/useCameraRoll";
import EditorStage from "@/components/EditorStage";
import { AppHeader, Btn, Stars } from "@/components/ui";

type Mode =
  | { k: "pick" }
  | { k: "edit"; src: string }
  | { k: "printing" }
  | { k: "poster"; src: string };

export default function MostWanted({ onBack }: { onBack: () => void }) {
  const vice = useVice();
  const photos = useBookingPhotos();
  const [mode, setMode] = useState<Mode>(
    vice.mugshot ? { k: "pick" } : { k: "pick" },
  );
  const [aliasDraft, setAliasDraft] = useState(vice.alias);
  const fileRef = useRef<HTMLInputElement>(null);

  const caseNo = `LSO-${(vice.heat * 137 + 40219).toString().padStart(6, "0")}`;
  const lastSeen = vice.posts[0]?.location ?? "VICE BEACH";

  const build = async (photo: string) => {
    setMode({ k: "printing" });
    vice.dispatch({ type: "mugshot", src: photo });
    vice.dispatch({ type: "alias", alias: aliasDraft });
    // A bulletin with one charge looks empty — pad the sheet out to three.
    const crimes = [...vice.crimes];
    while (crimes.length < 3) {
      const extra = pick(CRIMES);
      if (!crimes.includes(extra)) crimes.push(extra);
    }
    try {
      const poster = await composeWantedPoster({
        photo,
        alias: aliasDraft,
        bounty: vice.bountyValue,
        stars: vice.starCount,
        crimes,
        lastSeen,
        caseNo,
      });
      setTimeout(() => setMode({ k: "poster", src: poster }), 900);

      // A printed bulletin closes out any "VANITY PRESS" style contract.
      const settled = vice.settleContract({
        event: "poster",
        bounty: vice.bountyValue,
      });
      if (settled) {
        vice.toast(
          settled.ok
            ? {
                kind: "cool",
                title: `${settled.contract.codename} — PAID`,
                body: `${money(settled.contract.reward)} for the bulletin.`,
              }
            : {
                kind: "alert",
                title: `${settled.contract.codename} — BLOWN`,
                body: `Bounty came in at ${money(vice.bountyValue)}. Not enough.`,
              },
        );
      }
    } catch {
      setMode({ k: "pick" });
      vice.toast({ kind: "alert", title: "PRINT FAILED", body: "The plotter jammed." });
    }
  };

  if (mode.k === "edit") {
    return (
      <EditorStage
        image={mode.src}
        mission={{
          title: "BOOKING PHOTO",
          brief:
            "The state has a blank record on you. Give the suspect a face before they print the bulletin.",
          hints: [
            "Draw + shapes build the face",
            "Stickers for scars, shades, cigars",
            "Text for the placard, filters for the flash",
          ],
          accent: "cyan",
          commitLabel: "SEND TO PRESS",
        }}
        onCommit={(dataUrl) => build(dataUrl)}
        onCancel={() => setMode({ k: "pick" })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        title="MOST WANTED"
        sub={`LEONIDA S.O. · ${caseNo}`}
        onBack={onBack}
        tint="#22e6ff"
        right={<Stars count={vice.starCount} size={12} />}
      />

      <div className="vice-scroll flex-1 overflow-y-auto p-4 pb-8">
        {mode.k === "pick" && (
          <>
            <div className="glass rounded-2xl p-4">
              <p className="font-mono text-[10px] tracking-[0.24em] text-white/45">
                CURRENT BOUNTY
              </p>
              <p
                className="headline mt-1 text-4xl text-vice-lime"
                style={{ textShadow: "0 0 22px rgba(157,255,61,0.7)" }}
              >
                {money(vice.bountyValue)}
              </p>
              <p className="mt-1 text-[11px] text-white/50">
                Scales with your heat. Post recklessly on VICEGRAM and the number
                climbs.
              </p>
            </div>

            <div className="mt-4">
              <p className="font-mono text-[10px] tracking-[0.24em] text-white/45">
                ALIAS ON FILE
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value.slice(0, 22))}
                  className="min-w-0 flex-1 rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 font-mono text-sm outline-none transition focus:border-vice-cyan"
                />
                <Btn tone="ghost" onClick={() => setAliasDraft(randomAlias())}>
                  ⟳
                </Btn>
              </div>
            </div>

            {/*
              Photos the player published that the forensic scan could still
              match. This is the continuity beat: the frame they edited in the
              Image Lab is now the state's evidence against them.
            */}
            {vice.records.length > 0 && (
              <div className="mt-5">
                <div className="flex items-baseline justify-between">
                  <p className="font-mono text-[10px] tracking-[0.24em] text-vice-blood">
                    EVIDENCE ON FILE
                  </p>
                  <p className="font-mono text-[9px] tracking-[0.16em] text-white/35">
                    FROM YOUR POSTS
                  </p>
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {vice.records.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setMode({ k: "edit", src: r.image })}
                      className="group relative h-28 w-24 shrink-0 overflow-hidden rounded-lg border border-vice-blood/50 transition hover:border-vice-blood hover:shadow-[0_0_24px_-6px_rgba(255,59,48,0.9)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.image}
                        alt={r.location}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-black/80 py-0.5 text-center font-mono text-[8px] tracking-[0.12em] text-vice-blood">
                        {r.confidence}% MATCH
                      </span>
                      <span className="absolute inset-x-0 top-0 truncate bg-black/70 px-1 py-0.5 font-mono text-[7px] tracking-[0.1em] text-white/60">
                        {r.location}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-white/30">
                  THE STATE KEPT WHAT YOUR EDIT LEFT BEHIND. USE ONE AS THE
                  BULLETIN PHOTO.
                </p>
              </div>
            )}

            <p className="mt-5 font-mono text-[10px] tracking-[0.24em] text-white/45">
              SELECT A BOOKING PLATE
            </p>
            <p className="mb-3 text-[11px] text-white/50">
              Every plate is deliberately faceless. You paint the suspect in the
              image lab.
            </p>

            <div className="grid grid-cols-3 gap-3">
              {photos.map((p) => (
                <button
                  key={p.id}
                  disabled={!p.src}
                  onClick={() => p.src && setMode({ k: "edit", src: p.src })}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-vice-plum transition hover:border-vice-cyan/70 hover:shadow-[0_0_30px_-8px_rgba(34,230,255,0.9)] disabled:cursor-wait"
                >
                  {p.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.src} alt={p.label} className="h-full w-full object-cover" />
                  ) : (
                    <div className="sweep absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-vice-cyan/25 to-transparent" />
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center font-mono text-[8px] tracking-[0.16em] text-white/70">
                    {p.label}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => fileRef.current?.click()}
              className="mt-3 w-full rounded-xl border border-dashed border-white/20 py-3 font-mono text-[10px] tracking-[0.18em] text-white/45 transition hover:border-vice-cyan hover:text-vice-cyan"
            >
              + USE YOUR OWN PHOTO
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setMode({ k: "edit", src: await readFile(f) });
                e.target.value = "";
              }}
            />

            {vice.crimes.length > 0 && (
              <div className="mt-5">
                <p className="font-mono text-[10px] tracking-[0.24em] text-white/45">
                  RAP SHEET
                </p>
                <ul className="mt-2 space-y-1">
                  {vice.crimes.map((c) => (
                    <li
                      key={c}
                      className="font-mono text-[10px] tracking-[0.1em] text-white/60"
                    >
                      <span className="text-vice-pink">▸</span> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {mode.k === "printing" && (
          <div className="flex h-full flex-col items-center justify-center py-16">
            <div className="spin-slow text-4xl text-vice-cyan">✳</div>
            <p className="headline mt-4 text-2xl neon-cyan text-vice-cyan">
              PRESSING BULLETIN
            </p>
            <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-white/40">
              DISTRIBUTING TO ALL LEONIDA UNITS…
            </p>
          </div>
        )}

        {mode.k === "poster" && (
          <div className="rise-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mode.src}
              alt="Wanted poster"
              className="w-full rounded-2xl border border-white/15 shadow-[0_20px_60px_-20px_rgba(255,46,151,0.8)]"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Btn
                tone="lime"
                onClick={() =>
                  download(
                    mode.src,
                    `wanted-${vice.alias.toLowerCase().replace(/\s+/g, "-")}.png`,
                  )
                }
              >
                ↓ DOWNLOAD
              </Btn>
              <Btn tone="ghost" onClick={() => setMode({ k: "pick" })}>
                REPRINT
              </Btn>
            </div>
            <p className="mt-3 text-center font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/30">
              SHARE IT WITH #BUILTWITHIMAGEEDITOR
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
