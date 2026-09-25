/**
 * Captures the README's media by playing the game.
 *
 * Everything in docs/media/ is a real frame of the running app, driven through
 * the actual loop — boot, street, shutter, forensic vision, the Image Lab, the
 * report — rather than mocked up. Re-run it after a UI change and the README
 * catches up:
 *
 *   npm run dev            # in one terminal
 *   npm run capture        # in another
 *
 * Uses the Chrome already on the machine (puppeteer-core, no bundled browser),
 * so nothing large is vendored into the repo to make pictures.
 */

import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const URL = process.env.CAPTURE_URL ?? "http://localhost:3000";
const OUT = "docs/media";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clicks the first button/link whose visible text contains `text`. */
async function clickText(page, text, { exact = false } = {}) {
  const hit = await page.evaluate(
    (t, isExact) => {
      const want = t.toLowerCase();
      const nodes = [
        ...document.querySelectorAll("button, a, [role='button']"),
      ].filter((n) => n.offsetParent !== null);
      const el = nodes.find((n) => {
        const s = (n.textContent ?? "").trim().toLowerCase();
        return isExact ? s === want : s.includes(want);
      });
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    exact,
  );
  if (!hit) console.warn(`    · no control matching "${text}"`);
  return hit;
}

async function shot(page, name) {
  await page.screenshot({
    path: `${OUT}/${name}.jpg`,
    quality: 88,
    type: "jpeg",
  });
  console.log(`  ✓ ${name}.jpg`);
}

/**
 * Walks past the intro cards and the lock screen.
 *
 * The onboarding is four cards on first run and absent afterwards, so this
 * clicks NEXT until it stops finding one rather than counting.
 */
async function enter(page) {
  await wait(3200);
  for (let i = 0; i < 6; i++) {
    const next =
      (await clickText(page, "next")) || (await clickText(page, "skip"));
    if (!next) break;
    await wait(500);
  }
  await wait(800);
  // The lock screen wants a tap anywhere on the phone.
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await wait(1400);
}

/** Back to the home screen from wherever we are. */
async function home(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape");
    await wait(300);
    await clickText(page, "‹");
    await wait(400);
  }
  await wait(600);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
    ],
    defaultViewport: VIEWPORT,
  });
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.warn("    page error:", m.text());
  });

  console.log(`→ ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });

  /* 01 — the desktop shell, still booting */
  await wait(1100);
  await shot(page, "banner");

  await enter(page);
  await shot(page, "home");

  /* 02 — LEONIDA LIVE: the 3D block, then the phone up, then the shutter */
  console.log("· leonida live");
  if (await clickText(page, "leonida live")) {
    await wait(9000); // engine boot, city build, first frames
    await shot(page, "street");

    // Walk a little so the shot isn't the spawn pose.
    await page.keyboard.down("KeyW");
    await wait(2200);
    await page.keyboard.up("KeyW");
    await wait(900);

    await clickText(page, "raise phone");
    await wait(2200);
    await shot(page, "viewfinder");

    await clickText(page, "shoot");
    await wait(5000);
    await shot(page, "forensic-vision"); // brackets + prices, pre-editor

    /* 03 — the Image Lab, opened on a frame that carries evidence */
    await clickText(page, "image lab");
    await clickText(page, "open the image lab");
    await wait(10_000);
    await shot(page, "image-lab-evidence");
  }

  await home(page);

  /* 04 — the lab on a camera-roll frame, for the tool rail */
  console.log("· image lab");
  await clickText(page, "vicegram");
  await wait(1600);
  if (await clickText(page, "edit")) {
    await wait(10_000);
    await shot(page, "image-lab");

    // Grade it so the report has something to measure, then scan.
    await clickText(page, "grade");
    await wait(1200);
    await page.evaluate(() => {
      const preset = [...document.querySelectorAll("*")].find((n) =>
        /vintage|polaroid/i.test(n.textContent ?? ""),
      );
      preset?.click();
    });
    await wait(3000);
    await clickText(page, "run forensics");
    await wait(6000);
    await shot(page, "forensic-report");

    await page.evaluate(() => window.scrollTo(0, 400));
    await wait(900);
    await shot(page, "scrub-reel");
  }

  await home(page);

  /* 05 — the rest of the phone */
  console.log("· the fixer");
  if (await clickText(page, "the fixer")) {
    await wait(2200);
    await shot(page, "the-fixer");
  }
  await home(page);

  console.log("· most wanted");
  if (await clickText(page, "most wanted")) {
    await wait(2200);
    await shot(page, "most-wanted");
  }

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
