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

/** Clicks the first element matching a CSS selector. */
async function clickSelector(page, selector) {
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!hit) console.warn(`    · nothing matching "${selector}"`);
  return hit;
}

/** Holds a key down for `ms`, which is how the engine reads movement and look. */
async function press(page, code, ms) {
  await page.keyboard.down(code);
  await wait(ms);
  await page.keyboard.up(code);
  await wait(200);
}

/** Turns the camera by `radians`. `Q` and `E` swing it at 2.1 rad/s. */
const turn = (page, code, radians) => press(page, code, (radians / 2.1) * 1000);

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
    // engine boot, then the world build: a square kilometre of city is welded
    // into its merged buffers before the first frame
    await wait(16_000);

    // Downtown, pulled-back camera, walked forward off the junction — the
    // avenue is the frame that shows what the city actually is.
    await page.keyboard.press("Digit2");
    await wait(600);
    await page.keyboard.press("KeyC");
    await wait(400);
    await page.keyboard.down("KeyW");
    await wait(2600);
    await page.keyboard.up("KeyW");
    await wait(1200);
    await shot(page, "street");

    /*
     * Two frames of the world itself, from the beachfront.
     *
     * The headings below are computed rather than eyeballed. Nothing above
     * touches the look controls, so the camera is still on the spawn yaw of
     * -PI/2 and `Q`/`E` swing it at a known 2.1 rad/s — which makes "face the
     * observation wheel from forty metres down the beach" a division instead
     * of a number somebody nudged until it looked right. Note that the
     * movement keys are camera-relative: at this yaw it is `A` that walks
     * south, not `S`.
     */
    await page.keyboard.press("Digit1");
    await wait(900);
    // SOUTH BEACH is the tenth landmark, past the end of the number row
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("KeyT");
      await wait(420);
    }
    await page.keyboard.press("KeyC"); // wide -> cinematic, to fit the ride in
    await wait(400);

    // ~40m south down the beach road: far enough to see all of the wheel
    await page.keyboard.down("ShiftLeft");
    await press(page, "KeyA", 8000);
    await page.keyboard.up("ShiftLeft");
    await turn(page, "KeyE", 2.1); // back onto the wheel, now north-east of us
    await press(page, "KeyR", 540); // and up, to get all 76 metres of it in
    await wait(1800);
    await shot(page, "boardwalk");

    /*
     * The vehicles, up close.
     *
     * Sprinting at the kerb rather than creeping to a mark is deliberate: the
     * parked stock is solid, so the run ends with the lens against a wing.
     */
    await press(page, "KeyV", 540); // level again
    await page.keyboard.press("KeyC"); // cinematic -> shoulder
    await wait(250);
    await page.keyboard.press("KeyC"); // shoulder -> wide
    await wait(250);
    await turn(page, "KeyQ", 0.53); // straight up the beach road
    await page.keyboard.down("ShiftLeft");
    await press(page, "KeyD", 2500); // across to the kerb and its parked stock
    await page.keyboard.up("ShiftLeft");
    await wait(1800);
    await shot(page, "traffic");

    // back to the avenue for the shutter sequence, which wants a busy frame
    await page.keyboard.press("Digit2");
    await wait(1400);
    await page.keyboard.press("KeyC"); // cinematic -> shoulder, for the phone
    await page.keyboard.down("KeyW");
    await wait(2000);
    await page.keyboard.up("KeyW");
    await wait(1200);

    await clickText(page, "raise phone");
    await wait(2200);
    await shot(page, "viewfinder");

    await clickText(page, "shoot");
    await wait(4000);
    // shots land on the film roll now; opening one is what enters the lab
    await clickSelector(page, "[data-roll-shot]");
    await wait(4000);
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
