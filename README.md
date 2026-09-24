# VICE OS — Leonida Live

**An in-world smartphone for a GTA VI–style Leonida, where photo editing is the game
mechanic — and the photos are ones you go out and take yourself, in 3D.**

Built for the **Build with React Image Editor Challenge** · `#BuiltWithImageEditor`

> Walk the block. Raise the phone. Shoot a frame. Take it into the Image Lab and decide
> how much of the truth survives the edit — because the state is looking at the same
> photo you are.

---

## The idea

Most photo-editor demos are a canvas with a Save button. VICE OS makes the edit *matter*.

You're holding a phone that belongs to someone with a growing problem. Everything you
post to **VICEGRAM** raises your **heat** — and heat drives your wanted stars, your bounty,
the police chatter on the scanner, and the strobing red-and-blue at the edges of the
screen. But before anything is published, a forensic pass diffs your export against the
original frame and scores how identifiable it still is.

**Slap a sticker over the face, crop out the landmark, blow out the grade — and the heat you
gain drops.** Post it raw with `#trunkfull` and the whole state hears about it.

That's the loop: *the image editor is the gameplay.*

```
LEONIDA LIVE (real-time 3D)  →  shutter  →  IMAGE LAB (React Image Editor)
   walk · frame · shoot          ↓             crop / grade / cover
                          evidence register        ↓
                       (faces, plates, landmarks)  forensic diff
                                   ↘               ↓
                                    scored against your export → heat ↑↓ → stars → bounty
```

## Six apps, four of them built on the editor

| App | What you edit | What comes out |
| --- | --- | --- |
| **LEONIDA LIVE** | — | A real-time 3D block you walk in third person. The shutter renders a 1080×1350 frame **and a list of every identifiable subject the lens caught**, then opens the Image Lab on it |
| **THE FIXER** | — | Timed contracts scored **entirely on the forensic diff of your export**: payouts, heat swings, a rank and a ledger |
| **VICEGRAM** | A shot from the procedurally painted camera roll, or your own photo | A post, a forensics report, and a change to your heat |
| **MOST WANTED** | A deliberately faceless booking plate — *you* paint the suspect | A composited WANTED bulletin with your live bounty, rap sheet and stars, downloadable as PNG |
| **LEONIDA DMV** | Your license portrait | A holographic state ID card with guilloche print, ghost portrait and a generated signature, downloadable as PNG |
| **SCANNER 7** | — | Radio + LSO dispatch whose chatter rate scales with your heat, plus a "lay low" cooldown to cool off |

## LEONIDA LIVE: the frames are yours now

The camera roll used to be the only source of images. Now there's a street.

**LEONIDA LIVE** is a real-time WebGL scene — a block of Leonida at golden hour, rendered
with three.js — that you walk in third person. Press `F` (or **RAISE PHONE**) and the
camera drops into the phone: first person, 4:5 viewfinder, thirds grid. Press the shutter
and the engine re-renders the frame at **1080×1350**, develops it with a film pass and a
geotag stamp, and hands it straight to the Image Lab.

### The part that makes it gameplay, not a tech demo

The world keeps an **evidence register** — every pedestrian's head, every parked car's
plate, the neon crown on Leonida Tower. At the instant the shutter fires, each tag is
projected into the capture camera's frustum and then ray-tested for occlusion, so the
photo comes with a list of exactly what was visible and identifiable:

> *The lens caught 3 identifiable subjects: PLATE TRNK FL, SUBJECT B, SUBJECT C. Whatever
> you leave in stays in.*

That list becomes the editor's brief, and it is **priced**: a face is worth 9 heat, a plate
6, the tower 5 — discounted by your scrub rating. So the composer can tell you
`+22 HEAT · Still identifiable. Go back to the lab and cover it.` The 3D mode's only job
is to give the image editor something real to be about.

### Realistic movement, solved rather than animated

There is **no rigged model, no `.glb`, no Blender, no animation clips.** The character is
built and animated from numbers at runtime, like everything else in this repo
([`src/lib/three/rig.ts`](src/lib/three/rig.ts),
[`src/lib/three/locomotion.ts`](src/lib/three/locomotion.ts)):

- **The rig** is a 21-bone hierarchy posed into a relaxed A-pose. Tapered tubes are then
  swept along the *posed* bone world transforms and every vertex is weighted against the
  bone segments it belongs to, so the mesh deforms properly at elbows and knees — and
  every animated rotation stays a small delta from bind, which is what stops shoulders
  from collapsing when the arms swing.
- **Stride length scales with speed** (1.6 m per cycle at a walk ≈ 115 steps/min, 3.2 m at
  a sprint ≈ 180), and gait frequency is derived as `speed / stride`. During stance the
  foot travels backward relative to the body at exactly the body's speed — so in world
  space it does not move. **No foot sliding, at any speed.**
- **Both legs and both arms run through an analytic two-bone IK solve**, with the knee and
  elbow placed explicitly from a pole vector. Limbs bend because of where they have to
  reach, not because a curve said so.
- **The pelvis** bobs twice per stride, sways toward the stance foot, and drops on the
  swing side (Trendelenburg gait); the shoulders counter-rotate against it.
- **Heel strike, foot flat and toe-off** are three separate ankle angles driven off the
  same gait phase, set in world space so the sole stays parallel to the road no matter how
  the leg ended up bent.
- **Arms lag the shoulders through a spring**, so they carry mass and overshoot; the elbow
  tightens as the pace builds.
- Turning banks the body, acceleration pitches it, landing compresses it, and standing
  still blends into breathing and a slow weight shift.

The same solver drives the player and the whole crowd. Pedestrians walk sidewalk
waypoints, watch you when you get close, and **break away and run once your heat passes
45** — which is exactly when you most want a photo of them.

### Everything else in the scene

Procedural buildings with painted window grids and flickering neon signage, palms, street
lamps, wet-asphalt neon smears, parked cars with readable plates, a landmark tower, and a
gradient sky with a sun sitting on the horizon down the street. Post chain is bloom →
tone map → a film pass with grain, vignette and chromatic aberration; at heat 50+ the
police strobe bleeds in at the edges of the lens.

Quality toggle, touch joystick + drag-look on mobile, pointer lock with a drag-look
fallback where the browser refuses it, and a clean failure card if WebGL is unavailable —
the rest of the phone still works without it.

## Contracts: the editor gets a scoreboard

A fixer wants a photo handled a specific way, and the only thing that decides whether you
delivered is what the forensic scan finds in your export
([`src/lib/contracts.ts`](src/lib/contracts.ts)):

> **THE CLEANER** — *"I don't care what it looks like when you're done. I care that nobody
> can match it to the frame it came from."* · Scrub rating 66% or higher · 150s · $9,850 · **-7 heat**

Nine job templates roll against your current heat, so the board is never impossible and never
free. Objectives map one-to-one onto editor tools — `coverage` wants stickers and shapes,
`grade shift` wants the filter panel, `reframe` wants crop or resize, and **GHOST POST** wants
you to publish without moving the needle a single degree.

- A live countdown rides under the status bar in **every** app, so you can feel the clock
  while you're inside the Image Lab.
- The composer shows the contract scorecard *before* you publish — `1/2 objectives met`,
  with "posting now blows the job" — so you can go back and keep editing.
- Delivering pays cash and usually cools you off; blowing it or running out the clock adds
  heat. Rank climbs RUNNER → EARNER → OPERATOR → FIXER → KINGPIN.
- **VANITY PRESS** settles against a printed bulletin instead of a post, so the contract
  system spans two of the three editor surfaces.

## How the React Image Editor is used

The editor is not a side panel — it's the **Image Lab**, a full-screen mode the phone breaks
out into, wrapped in its own OS chrome ([`src/components/EditorStage.tsx`](src/components/EditorStage.tsx)):

- **Per-app missions.** Each app mounts the same editor with a different brief, accent colour
  and commit label (`RUN FORENSICS`, `SEND TO PRESS`, `ISSUE LICENSE`), so the tool reads as
  three different in-world machines.
- **Live state in the chrome.** The wrapper polls `ref.current.editor.hasChanges()` and shows
  `ORIGINAL FRAME` / `UNSAVED EDITS` in the header.
- **Two ways to commit, one export.** The editor's own Save fires `onSave({ dataUrl })`; the
  OS chrome's commit button drives that same control so both produce an identical flattened
  export. (`getImage()` returns the working canvas *before* the active filter preset is baked
  in — a filter-only edit would otherwise come back byte-identical and read 0% on the
  forensic diff. It's kept as a fallback so the player can never get stuck in the lab.)
- **`onCancel`, `onLoadError`, `onError`** are all wired; `Escape` discards.
- Mounted through `next/dynamic` with a themed skeleton, `options` hoisted to a module
  constant so a re-render never triggers a remount.

Every export then goes somewhere real — a feed post, a Canvas-composited bulletin, or a
laminated ID — instead of just being downloaded.

## Forensics: reading the edit

[`analyzeEdit()`](src/lib/art.ts) normalises the original and the editor's export to 128×128
and diffs them pixel by pixel:

| Metric | Meaning |
| --- | --- |
| `altered` | % of pixels that moved meaningfully — grading, drawing, anything |
| `coverage` | % of pixels replaced outright — stickers, shapes, solid text |
| `temperature` | warm/cool shift your grade introduced |
| `reframed` | whether crop/resize changed the composition |

Those roll into a **scrub rating**, and the scrub rating discounts the heat your tags would
otherwise earn. Aspect-ratio changes are handled, so cropping counts too.

## Everything is drawn at runtime

There is no stock art, no asset pipeline, no downloaded model and nothing copyrighted in
this repo. Every photo, mugshot, poster and ID is painted with **Canvas 2D in the browser**
([`src/lib/art.ts`](src/lib/art.ts), [`src/lib/compose.ts`](src/lib/compose.ts)) from a
seeded RNG and a handful of shared primitives — synthwave sun, perspective grid, palms,
skyline, water glitter, film grain, chromatic aberration.

**The 3D holds to the same rule.** The humanoid rig, its skinned surface, the city,
the asphalt, the window grids, the neon signs and the licence plates are all generated
from parameters and canvas textures at boot
([`src/lib/three/`](src/lib/three)) — which is also why there is nothing to download and
nothing to license.

Nothing you edit or upload leaves your browser. There is no backend.

## Stack

- **Next.js 16** (App Router, TypeScript, static export-friendly — one route, no server)
- **Tailwind CSS v4** with a Vice palette defined in `@theme`
- **[@unlayer/react-image-editor](https://github.com/unlayer/react-image-editor)** for all editing
- **three.js** (WebGL2, `EffectComposer` post chain) for Leonida Live — loaded through
  `next/dynamic` so it only ships when you open the camera
- Canvas 2D for generation and compositing
- `next/font` (Anton / Space Grotesk / JetBrains Mono), read back into canvas so the posters
  use the same typography as the UI

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

```bash
npm run build && npm start
```

## Try this first

1. Let it boot, tap to unlock, open **THE FIXER** and take a contract — the clock starts.
2. Open **LEONIDA LIVE**. `WASD` to walk, `Shift` to sprint, mouse to look. Get close to
   a pedestrian or a parked car and watch the **IN FRAME** readout light up.
3. Press `F` to raise the phone, frame the 4:5 shot, and hit the shutter.
4. The Image Lab opens on your photo, with a brief naming everything the lens caught.
5. Sticker over the faces, crop out the tower, push the grade.
6. Hit **RUN FORENSICS** — the composer prices the evidence you *didn't* cover.
7. Not there yet? Go back to the lab. Then post it and watch heat, stars, bounty and the
   dispatch feed react. Sprint past a pedestrian at heat 45+ and they'll run from you.
8. Open **MOST WANTED**, paint a face on the blank booking plate, and print your bulletin.

## Project layout

```
src/
  app/            layout, page, icon, OG image, theme
  components/
    ViceOS.tsx      phone shell, boot / lock / home, desktop side panels
    EditorStage.tsx the Image Lab — the React Image Editor wrapper
    Backdrop.tsx    animated Leonida sunset
    ui.tsx          stars, heat meter, buttons, panels
    apps/           Contracts, Vicegram, MostWanted, LeonidaID, Scanner,
                    StreetMode (the Leonida Live shell, HUD and shutter)
  lib/
    three/
      rig.ts        procedural humanoid — skeleton, skinned surface, weights
      locomotion.ts gait solver, two-bone IK, full-body procedural animation
      city.ts       the block, its canvas textures and the evidence register
      engine.ts     renderer, camera rig, crowd, post chain, photo capture
    art.ts          procedural scenes, booking plates, forensic diff
    compose.ts      WANTED bulletin + Leonida ID compositors
    contracts.ts    job templates, objectives, scoring
    store.tsx       heat / stars / bounty / posts / contracts state
    copy.ts         all in-world writing
```

## Accessibility & notes

- `prefers-reduced-motion` disables the strobes, sweeps, grain and marquees — including
  the wanted-level strobe inside Leonida Live.
- Works on mobile — the phone fills the viewport, the Image Lab goes full-screen, and
  Leonida Live swaps to a touch joystick, drag-look and on-screen run/jump/shutter.
- Leonida Live has a HIGH/LOW quality toggle (shadows, antialiasing, bloom strength,
  crowd size, pixel ratio) and degrades to a readable failure card without WebGL.
- Heat, alias, charges, cash and your job record persist in `localStorage`; photos and the
  live contract stay in memory only, so the storage quota is never at risk.
- Names, places, characters and jokes are original. Nothing from Rockstar's assets is used
  or reproduced; this is an unofficial fan concept and is not affiliated with Rockstar Games.

## License

MIT.
