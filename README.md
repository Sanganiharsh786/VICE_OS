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

## Four apps, three of them built on the editor

| App | What you edit | What comes out |
| --- | --- | --- |
| **VICEGRAM** | A shot from the procedurally painted camera roll, or your own photo | A post, a forensics report, and a change to your heat |
| **MOST WANTED** | A deliberately faceless booking plate — *you* paint the suspect | A composited WANTED bulletin with your live bounty, rap sheet and stars, downloadable as PNG |
| **LEONIDA DMV** | Your license portrait | A holographic state ID card with guilloche print, ghost portrait and a generated signature, downloadable as PNG |
| **SCANNER 7** | — | Radio + LSO dispatch whose chatter rate scales with your heat, plus a "lay low" cooldown to cool off |

## How the React Image Editor is used

The editor is not a side panel — it's the **Image Lab**, a full-screen mode the phone breaks
out into, wrapped in its own OS chrome ([`src/components/EditorStage.tsx`](src/components/EditorStage.tsx)):

- **Per-app missions.** Each app mounts the same editor with a different brief, accent colour
  and commit label (`RUN FORENSICS`, `SEND TO PRESS`, `ISSUE LICENSE`), so the tool reads as
  three different in-world machines.
- **Live state in the chrome.** The wrapper polls `ref.current.editor.hasChanges()` and shows
  `ORIGINAL FRAME` / `UNSAVED EDITS` in the header.
- **Two ways to commit.** The editor's own `onSave({ dataUrl })`, and the OS chrome's commit
  button which pulls `ref.current.editor.getImage()` — both land in the same handler.
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

1. Let it boot, tap to unlock, open **VICEGRAM**.
2. Pick *Ocean Drive, 7:41 PM* → the Image Lab opens.
3. Drop a sticker over the frame, push a filter, maybe crop it.
4. Hit **RUN FORENSICS** and watch the scan score your edit.
5. Tag it `#trunkfull`, post it, and watch heat, stars, bounty and the dispatch feed react.
6. Open **MOST WANTED**, paint a face on the blank booking plate, and print your bulletin.

## Project layout

```
src/
  app/            layout, page, icon, OG image, theme
  components/
    ViceOS.tsx      phone shell, boot / lock / home, desktop side panels
    EditorStage.tsx the Image Lab — the React Image Editor wrapper
    Backdrop.tsx    animated Leonida sunset
    ui.tsx          stars, heat meter, buttons, panels
    apps/           Vicegram, MostWanted, LeonidaID, Scanner
  lib/
    art.ts          procedural scenes, booking plates, forensic diff
    compose.ts      WANTED bulletin + Leonida ID compositors
    store.tsx       heat / stars / bounty / posts state
    copy.ts         all in-world writing
```

## Accessibility & notes

- `prefers-reduced-motion` disables the strobes, sweeps, grain and marquees.
- Works on mobile — the phone fills the viewport and the Image Lab goes full-screen.
- Heat, alias and charges persist in `localStorage`; photos stay in memory only, so the
  storage quota is never at risk.
- Names, places, characters and jokes are original. Nothing from Rockstar's assets is used
  or reproduced; this is an unofficial fan concept and is not affiliated with Rockstar Games.

## License

MIT.
