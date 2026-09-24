"use client";

/** The world behind the phone: an animated Leonida sunset, all CSS + SVG. */
export default function Backdrop({ alarm }: { alarm: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* sky */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#05010f_0%,#1b0740_28%,#7a1b6e_52%,#ff5f6d_72%,#ffb347_86%,#2a0430_100%)]" />

      {/* sun */}
      <div className="absolute left-1/2 top-[34%] -translate-x-1/2">
        <div className="floaty relative h-[46vmin] w-[46vmin]">
          <div className="absolute inset-0 rounded-full bg-[linear-gradient(180deg,#fff3c4_0%,#ffd36b_35%,#ff2e97_75%,#c71585_100%)] shadow-[0_0_140px_40px_rgba(255,46,151,0.35)]" />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "repeating-linear-gradient(180deg, transparent 0 22px, rgba(6,1,15,0.9) 22px 28px)",
              maskImage: "linear-gradient(180deg, transparent 45%, #000 55%)",
              WebkitMaskImage: "linear-gradient(180deg, transparent 45%, #000 55%)",
            }}
          />
        </div>
      </div>

      {/* stars */}
      <svg className="absolute inset-x-0 top-0 h-1/3 w-full opacity-70">
        {Array.from({ length: 70 }).map((_, i) => {
          const x = (i * 97) % 100;
          const y = (i * 53) % 100;
          const r = ((i * 17) % 10) / 8 + 0.4;
          return (
            <circle
              key={i}
              cx={`${x}%`}
              cy={`${y}%`}
              r={r}
              fill="#fff"
              opacity={0.25 + ((i * 13) % 60) / 100}
            />
          );
        })}
      </svg>

      {/* ocean + grid */}
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(180deg,#43104f_0%,#1a0836_40%,#06010f_100%)]">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(34,230,255,0.5) 0 2px, transparent 2px 80px), repeating-linear-gradient(0deg, rgba(34,230,255,0.4) 0 2px, transparent 2px 60px)",
            transform: "perspective(320px) rotateX(70deg)",
            transformOrigin: "top",
          }}
        />
      </div>

      {/* palms */}
      <svg
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-[42%] w-full"
      >
        <g fill="#06010f">
          <Palm x={70} />
          <Palm x={1130} flip />
          <Palm x={200} scale={0.7} />
          <Palm x={1000} scale={0.66} flip />
        </g>
      </svg>

      {/* haze */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_60%,transparent_20%,rgba(6,1,15,0.75)_85%)]" />
      <div className="scanlines absolute inset-0" />
      <div className="grain absolute inset-0 overflow-hidden" />

      {alarm && (
        <>
          <div className="cops-left absolute inset-y-0 left-0 w-2/5 bg-[radial-gradient(ellipse_at_left,rgba(255,59,48,0.7),transparent_72%)]" />
          <div className="cops-right absolute inset-y-0 right-0 w-2/5 bg-[radial-gradient(ellipse_at_right,rgba(34,120,255,0.7),transparent_72%)]" />
        </>
      )}
    </div>
  );
}

function Palm({ x, scale = 1, flip }: { x: number; scale?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} 400) scale(${flip ? -scale : scale} ${scale})`}>
      <path d="M0 0 C -6 -120 -14 -200 -34 -268 L -22 -272 C -4 -204 6 -120 12 0 Z" />
      {Array.from({ length: 7 }).map((_, i) => {
        const a = -150 + i * 25;
        const r = (a * Math.PI) / 180;
        const ex = -28 + Math.cos(r) * 110;
        const ey = -270 + Math.sin(r) * 70;
        return (
          <path
            key={i}
            d={`M -28 -270 Q ${-28 + Math.cos(r) * 60} ${-270 + Math.sin(r) * 34 - 26} ${ex} ${ey} Q ${-28 + Math.cos(r) * 62} ${-270 + Math.sin(r) * 40 + 6} -28 -262 Z`}
          />
        );
      })}
    </g>
  );
}
