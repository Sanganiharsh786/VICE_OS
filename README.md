# VICE OS — Leonida Live

**An in-world smartphone for a GTA VI–style Leonida, where photo editing is the game mechanic.**

Built for the **Build with React Image Editor Challenge** · `#BuiltWithImageEditor`

> Shoot a frame. Take it into the Image Lab. Decide how much of the truth survives the
> edit — because the state is looking at the same photo you are.

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
camera roll → IMAGE LAB (React Image Editor) → forensic diff → caption + tags → post
                                                     ↓
                                    heat ↑↓ → stars → bounty → wanted poster
```

## Five apps, three of them built on the editor

| App | What you edit | What comes out |
| --- | --- | --- |
| **THE FIXER** | — | Timed contracts scored **entirely on the forensic diff of your export**: payouts, heat swings, a rank and a ledger |
| **VICEGRAM** | A shot from the procedurally painted camera roll, or your own photo | A post, a forensics report, and a change to your heat |
| **MOST WANTED** | A deliberately faceless booking plate — *you* paint the suspect | A composited WANTED bulletin with your live bounty, rap sheet and stars, downloadable as PNG |
| **LEONIDA DMV** | Your license portrait | A holographic state ID card with guilloche print, ghost portrait and a generated signature, downloadable as PNG |
| **SCANNER 7** | — | Radio + LSO dispatch whose chatter rate scales with your heat, plus a "lay low" cooldown to cool off |

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

There is no stock art, no asset pipeline and nothing copyrighted in this repo. Every
photo, mugshot, poster and ID is painted with **Canvas 2D in the browser**
([`src/lib/art.ts`](src/lib/art.ts), [`src/lib/compose.ts`](src/lib/compose.ts)) from a
seeded RNG and a handful of shared primitives — synthwave sun, perspective grid, palms,
skyline, water glitter, film grain, chromatic aberration.

Nothing you edit or upload leaves your browser. There is no backend.

## Stack

- **Next.js 16** (App Router, TypeScript, static export-friendly — one route, no server)
- **Tailwind CSS v4** with a Vice palette defined in `@theme`
- **[@unlayer/react-image-editor](https://github.com/unlayer/react-image-editor)** for all editing
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
2. Hit **OPEN VICEGRAM**, pick a shot → the Image Lab opens.
3. Drop a sticker over the frame, push a filter, maybe crop it.
4. Hit **RUN FORENSICS** and watch the scan score your edit against the brief.
5. Check the scorecard in the composer. Not there yet? Go back to the lab before you post.
6. Post it, collect the payout, and watch heat, stars, bounty and the dispatch feed react.
7. Open **MOST WANTED**, paint a face on the blank booking plate, and print your bulletin.

## Project layout

```
src/
  app/            layout, page, icon, OG image, theme
  components/
    ViceOS.tsx      phone shell, boot / lock / home, desktop side panels
    EditorStage.tsx the Image Lab — the React Image Editor wrapper
    Backdrop.tsx    animated Leonida sunset
    ui.tsx          stars, heat meter, buttons, panels
    apps/           Contracts, Vicegram, MostWanted, LeonidaID, Scanner
  lib/
    art.ts          procedural scenes, booking plates, forensic diff
    compose.ts      WANTED bulletin + Leonida ID compositors
    contracts.ts    job templates, objectives, scoring
    store.tsx       heat / stars / bounty / posts / contracts state
    copy.ts         all in-world writing
```

## Accessibility & notes

- `prefers-reduced-motion` disables the strobes, sweeps, grain and marquees.
- Works on mobile — the phone fills the viewport and the Image Lab goes full-screen.
- Heat, alias, charges, cash and your job record persist in `localStorage`; photos and the
  live contract stay in memory only, so the storage quota is never at risk.
- Names, places, characters and jokes are original. Nothing from Rockstar's assets is used
  or reproduced; this is an unofficial fan concept and is not affiliated with Rockstar Games.

## License

MIT.
