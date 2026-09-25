import { ImageResponse } from "next/og";

export const alt = "VICE OS — Leonida Live";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card is the same every time, so it can be rendered once at build time —
 * which is also what lets the whole project come out as a static export for
 * GitHub Pages.
 */
export const dynamic = "force-static";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background:
            "linear-gradient(160deg,#05010f 0%,#1b0740 35%,#7a1b6e 70%,#ff5f6d 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: 8,
            color: "#22e6ff",
            display: "flex",
          }}
        >
          BUILT WITH IMAGE EDITOR
        </div>
        <div
          style={{
            fontSize: 150,
            fontWeight: 900,
            lineHeight: 1,
            marginTop: 16,
            display: "flex",
          }}
        >
          VICE OS
        </div>
        <div
          style={{
            fontSize: 34,
            marginTop: 24,
            maxWidth: 900,
            color: "rgba(255,255,255,0.8)",
            display: "flex",
          }}
        >
          A phone you&apos;d find in Leonida. Shoot a frame, edit it, and decide how
          much of the truth survives — forensics scores every export.
        </div>
        <div
          style={{
            fontSize: 24,
            marginTop: 40,
            letterSpacing: 4,
            color: "#9dff3d",
            display: "flex",
          }}
        >
          VICEGRAM · MOST WANTED · LEONIDA DMV · SCANNER 7
        </div>
      </div>
    ),
    size,
  );
}
