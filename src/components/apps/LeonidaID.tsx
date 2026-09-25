"use client";

import { useRef, useState } from "react";
import { composeLicense, download } from "@/lib/compose";
import { randomAlias, useVice } from "@/lib/store";
import { readFile, useBookingPhotos } from "@/lib/useCameraRoll";
import EditorStage from "@/components/EditorStage";
import { AppHeader, Btn } from "@/components/ui";

const ADDRESSES = [
  "14 OCEAN DR, VICE BEACH",
  "ROOM 7, MOTEL FLAMINGO",
  "SLIP 22, KEYS MARINA",
  "1800 CAUSEWAY, OUTBOUND",
];

const RESTRICTIONS = [
  "NONE",
  "CORRECTIVE LENSES",
  "DAYLIGHT ONLY",
  "NO BOATS",
  "SUPERVISED",
];

type Mode = { k: "form" } | { k: "edit"; src: string } | { k: "card"; src: string };

export default function LeonidaID({ onBack }: { onBack: () => void }) {
  const vice = useVice();
  const photos = useBookingPhotos();
  const [mode, setMode] = useState<Mode>({ k: "form" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const [name, setName] = useState(vice.alias);
  const [dob, setDob] = useState("03/14/1997");
  const [address, setAddress] = useState(ADDRESSES[0]);
  const [rest, setRest] = useState(RESTRICTIONS[0]);
  const [cls, setCls] = useState("E");

  const dln = `L${(name.length * 7331 + dob.length * 991 + 100000).toString().slice(0, 6)}-${(vice.heat + 17).toString().padStart(2, "0")}`;

  const issue = async (photo: string) => {
    vice.dispatch({ type: "alias", alias: name });
    try {
      const card = await composeLicense({
        photo,
        name,
        dob,
        address,
        licenseNo: dln,
        classLetter: cls,
        restrictions: rest,
        expires: "09/2031",
      });
      vice.dispatch({ type: "license", src: card });
      setMode({ k: "card", src: card });
      vice.toast({
        kind: "info",
        title: "ID ISSUED",
        body: "Laminated. Slightly warm. Do not question it.",
      });
    } catch {
      setMode({ k: "form" });
    }
  };

  if (mode.k === "edit") {
    return (
      <EditorStage
        image={mode.src}
        mission={{
          title: "DMV PORTRAIT",
          brief:
            "One shot, no retakes — except you have unlimited retakes, because this is a photo editor.",
          hints: [
            "Crop square and centre the head",
            "Filters fix the fluorescent lighting",
            "Text + stickers if you want a disguise on file",
          ],
          accent: "lime",
          commitLabel: "ISSUE LICENSE",
          surface: "license",
        }}
        onCommit={issue}
        onCancel={() => setMode({ k: "form" })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        title="LEONIDA DMV"
        sub="DRIVER LICENSE KIOSK · NOW SERVING"
        onBack={onBack}
        tint="#9dff3d"
      />

      <div className="vice-scroll flex-1 overflow-y-auto p-4 pb-8">
        {mode.k === "form" && (
          <>
            <p className="text-[12px] leading-snug text-white/60">
              Fill the form, then take your portrait. The kiosk photographer is on
              break, so you&apos;ll be editing it yourself.
            </p>

            <div className="mt-4 space-y-3">
              <Field label="FULL NAME">
                <div className="flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 22))}
                    className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
                  />
                  <button
                    onClick={() => setName(randomAlias())}
                    className="font-mono text-[10px] text-vice-lime"
                  >
                    ⟳
                  </button>
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="DATE OF BIRTH">
                  <input
                    value={dob}
                    onChange={(e) => setDob(e.target.value.slice(0, 10))}
                    className="w-full bg-transparent font-mono text-sm outline-none"
                  />
                </Field>
                <Field label="CLASS">
                  <select
                    value={cls}
                    onChange={(e) => setCls(e.target.value)}
                    className="w-full bg-transparent font-mono text-sm outline-none [&>option]:bg-vice-ink"
                  >
                    {["E", "A", "M", "CDL"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="ADDRESS">
                <select
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-transparent font-mono text-sm outline-none [&>option]:bg-vice-ink"
                >
                  {ADDRESSES.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>

              <Field label="RESTRICTIONS">
                <select
                  value={rest}
                  onChange={(e) => setRest(e.target.value)}
                  className="w-full bg-transparent font-mono text-sm outline-none [&>option]:bg-vice-ink"
                >
                  {RESTRICTIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>

              <Field label="LICENSE NUMBER">
                <span className="font-mono text-sm text-white/50">{dln}</span>
              </Field>
            </div>

            <p className="mt-5 font-mono text-[10px] tracking-[0.24em] text-white/45">
              PORTRAIT SOURCE
            </p>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {photos.map((p) => (
                <button
                  key={p.id}
                  disabled={!p.src}
                  onClick={() => p.src && setMode({ k: "edit", src: p.src })}
                  className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-vice-plum transition hover:border-vice-lime/70 disabled:cursor-wait"
                >
                  {p.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.src} alt={p.label} className="h-full w-full object-cover" />
                  ) : (
                    <div className="sweep absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-vice-lime/25 to-transparent" />
                  )}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Btn tone="ghost" onClick={() => fileRef.current?.click()}>
                + UPLOAD
              </Btn>
              {vice.mugshot && (
                <Btn tone="ghost" onClick={() => setMode({ k: "edit", src: vice.mugshot! })}>
                  REUSE MUGSHOT
                </Btn>
              )}
            </div>
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
          </>
        )}

        {mode.k === "card" && (
          <div className="rise-in">
            <div
              className="[perspective:1200px]"
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setTilt({
                  x: ((e.clientY - r.top) / r.height - 0.5) * -16,
                  y: ((e.clientX - r.left) / r.width - 0.5) * 20,
                });
              }}
              onMouseLeave={() => setTilt({ x: 0, y: 0 })}
            >
              <div
                className="relative overflow-hidden rounded-2xl shadow-[0_30px_70px_-25px_rgba(157,255,61,0.7)] transition-transform duration-200"
                style={{
                  transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mode.src} alt="Leonida driver license" className="w-full" />
                <div
                  className="holo pointer-events-none absolute inset-0 mix-blend-overlay"
                  style={{
                    background:
                      "linear-gradient(110deg, transparent 20%, rgba(255,255,255,0.55) 45%, rgba(34,230,255,0.4) 55%, transparent 80%)",
                  }}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Btn
                tone="lime"
                onClick={() =>
                  download(
                    mode.src,
                    `leonida-id-${name.toLowerCase().replace(/\s+/g, "-")}.png`,
                  )
                }
              >
                ↓ DOWNLOAD
              </Btn>
              <Btn tone="ghost" onClick={() => setMode({ k: "form" })}>
                RETAKE
              </Btn>
            </div>
            <p className="mt-3 text-center font-mono text-[9px] tracking-[0.14em] text-white/30">
              NOT VALID ANYWHERE. ESPECIALLY NOT LEONIDA.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-xl border border-white/12 bg-black/35 px-3 py-2 transition focus-within:border-vice-lime">
      <span className="font-mono text-[9px] tracking-[0.22em] text-white/40">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
