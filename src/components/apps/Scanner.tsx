"use client";

import { useEffect, useRef, useState } from "react";
import { DISPATCH, STATIONS, pick } from "@/lib/copy";
import { uid, useVice } from "@/lib/store";
import { AppHeader, Btn, HeatMeter } from "@/components/ui";
import { sfx } from "@/lib/audio";

type Line = { id: string; t: string; body: string; onYou?: boolean };

const stamp = (at: number) =>
  new Date(at).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export default function Scanner({ onBack }: { onBack: () => void }) {
  const vice = useVice();
  const [station, setStation] = useState(STATIONS[0].id);
  const [log, setLog] = useState<Line[]>([]);
  const [cooldown, setCooldown] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());

  // Chatter rate tracks your heat — quiet when you're clean, relentless at 5 stars.
  useEffect(() => {
    const every = Math.max(2200, 9000 - vice.heat * 62);
    const t = setInterval(() => {
      sfx.squelch();
      setLog((l) =>
        [...l, { id: uid(), t: stamp(Date.now()), body: pick(DISPATCH) }].slice(-24),
      );
    }, every);
    return () => clearInterval(t);
  }, [vice.heat]);

  /*
   * Lines the player's own posts put on the air. They arrive through the
   * store rather than the random pool, so the radio is a genuine consequence
   * of the last export rather than ambience.
   */
  useEffect(() => {
    const fresh = vice.radio.filter((r) => !seen.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach((r) => seen.current.add(r.id));
    setLog((l) =>
      [
        ...l,
        ...fresh.map((r) => ({
          id: r.id,
          t: stamp(r.at),
          body: r.body,
          onYou: true,
        })),
      ].slice(-24),
    );
  }, [vice.radio]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const layLow = () => {
    vice.dispatch({ type: "heat", delta: -9 });
    setCooldown(20);
    vice.toast({
      kind: "cool",
      title: "-9 HEAT",
      body: "Phone off, curtains drawn, one whole hour of nothing.",
    });
  };

  const active = STATIONS.find((s) => s.id === station)!;

  return (
    <div className="flex h-full flex-col">
      <AppHeader title="SCANNER 7" sub="RADIO + LSO DISPATCH" onBack={onBack} tint="#ffb347" />

      <div className="vice-scroll flex-1 overflow-y-auto p-4 pb-8">
        <div className="glass rounded-2xl p-4">
          <p className="font-mono text-[10px] tracking-[0.24em] text-white/45">
            NOW PLAYING
          </p>
          <p className="headline mt-1 text-2xl">{active.name}</p>
          <p className="text-[12px] text-vice-sun">{active.now}</p>
          <div className="mt-3 flex h-10 items-end gap-1">
            {Array.from({ length: 28 }).map((_, i) => (
              <span
                key={i}
                className="flex-1 origin-bottom rounded-sm bg-gradient-to-t from-vice-pink to-vice-cyan"
                style={{
                  height: "100%",
                  animation: `eq ${0.5 + ((i * 37) % 90) / 100}s ease-in-out ${(i % 7) * 0.08}s infinite alternate`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {STATIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStation(s.id)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                s.id === station
                  ? "border-vice-sun bg-vice-sun/10"
                  : "border-white/10 hover:border-white/30"
              }`}
            >
              <p className="font-mono text-[11px]">{s.name}</p>
              <p className="font-mono text-[8px] tracking-[0.18em] text-white/40">
                {s.genre}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <HeatMeter />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Btn tone="cyan" onClick={layLow} disabled={cooldown > 0} full>
            {cooldown > 0 ? `LAYING LOW… ${cooldown}s` : "LAY LOW (-9 HEAT)"}
          </Btn>
        </div>

        <p className="mt-5 font-mono text-[10px] tracking-[0.24em] text-white/45">
          DISPATCH FEED
        </p>
        <div
          ref={logRef}
          className="vice-scroll mt-2 h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/45 p-3"
        >
          {log.length === 0 && (
            <p className="font-mono text-[10px] text-white/30">…quiet out there…</p>
          )}
          {log.map((l) => (
            <p
              key={l.id}
              className={`rise-in font-mono text-[10px] leading-relaxed ${
                l.onYou ? "my-1 border-l-2 border-vice-blood pl-2" : ""
              }`}
            >
              <span className="text-white/30">{l.t}</span>{" "}
              <span className={l.onYou ? "text-vice-blood" : "text-vice-cyan"}>
                {l.onYou ? "ON YOUR POST:" : "DISPATCH:"}
              </span>{" "}
              <span className={l.onYou ? "text-white/85" : "text-white/65"}>
                {l.body}
              </span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
