import type { NextConfig } from "next";

/**
 * VICE OS has no server: one route, no API, nothing persisted anywhere but the
 * player's own browser. That makes it a static site, and `PAGES_BASE_PATH`
 * is what the Pages workflow sets to say "build it as one".
 *
 * Without that variable this stays an ordinary Next build, so `npm run dev`
 * and `npm run build && npm start` behave exactly as they always did.
 */
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = basePath
  ? {
      output: "export",
      basePath,
      assetPrefix: `${basePath}/`,
      // There is no image optimiser on a static host, and every picture in
      // this project is drawn on a canvas at runtime anyway.
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {};

export default nextConfig;
