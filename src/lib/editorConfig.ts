/**
 * The Image Lab's three personalities.
 *
 * VICE OS mounts one editor — `@unlayer/react-image-editor` — but the phone
 * presents it as three different in-world machines: the forensic darkroom
 * behind VICEGRAM, the state's press plotter behind MOST WANTED, and the DMV's
 * portrait booth. The difference is not chrome. It's the editor's own
 * vocabulary: `translations` renames every tool, panel label and toolbar
 * control in the rail, and `features.imageEditor.tools.*.icon` swaps the glyph,
 * so the tool the player reaches for is named after what it does *to the
 * evidence* rather than what it does to pixels.
 *
 * Draw is not "Draw". On the forensic surface it is REDACT.
 */

import type { ImageEditorOptions } from "@unlayer/react-image-editor";

export type Surface = "forensics" | "press" | "license";

/* ------------------------------------------------------------------ icons */

/**
 * Icons are handed to the editor as raw SVG markup. They're drawn on a 24×24
 * box with `currentColor` so the editor's own dark theme keeps tinting them.
 */
const icon = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** A redaction marker: chisel tip, fat barrel, a laid-down stroke under it. */
const REDACTION_MARKER = icon(
  `<path d="M14.8 3.6 20.4 9.2 10.2 19.4H4.6v-5.6z"/>` +
    `<path d="M12.2 6.2 17.8 11.8"/>` +
    `<path d="M3 21.6h18" stroke-width="3" stroke-linecap="butt"/>`,
);

/** A blackout box being dropped over a face. */
const BLACKOUT = icon(
  `<circle cx="12" cy="8.4" r="3.4"/>` +
    `<path d="M5.4 20.2a6.6 6.6 0 0 1 13.2 0"/>` +
    `<rect x="4.2" y="6.4" width="15.6" height="4.4" rx="0.6" fill="currentColor" stroke="none"/>`,
);

/** A reticle: crop as "decide what the state gets to see". */
const RETICLE = icon(
  `<path d="M7 2.6v11.8a2 2 0 0 0 2 2h11.8"/>` +
    `<path d="M2.6 7H14.4a2 2 0 0 1 2 2v11.8"/>` +
    `<circle cx="11.6" cy="11.6" r="1.2" fill="currentColor" stroke="none"/>`,
);

/** A retouch brush for the DMV booth. */
const RETOUCH = icon(
  `<path d="M4 20c2.8.4 4.6-.8 5.4-3"/>` +
    `<path d="M9.4 17 18 8.4a2.4 2.4 0 0 0-3.4-3.4L6 13.6"/>` +
    `<path d="M13.2 6.8 17.2 10.8"/>`,
);

/** A press stamp for the bulletin plotter. */
const PRESS_STAMP = icon(
  `<path d="M8 3.4h8l-1.4 6.2h2.8a3 3 0 0 1 3 3v2.6H3.6V12.6a3 3 0 0 1 3-3h2.8z"/>` +
    `<rect x="3.6" y="18.2" width="16.8" height="2.4" rx="0.8" fill="currentColor" stroke="none"/>`,
);

/* ----------------------------------------------------------- translations */

type Dict = Record<string, string>;

/**
 * Shared across all three surfaces: the toolbar verbs and the undo/redo rail,
 * set in the OS's own voice so nothing on screen reads like a stock component.
 */
const COMMON: Dict = {
  "image_editor.toolbar.undo": "STEP BACK",
  "image_editor.toolbar.redo": "STEP FORWARD",
  "image_editor.toolbar.zoom_in": "PUSH IN",
  "image_editor.toolbar.zoom_out": "PULL BACK",
  "image_editor.toolbar.fit_to_screen": "FIT PLATE",
  "image_editor.toolbar.apply": "COMMIT",
  "image_editor.tools.merge": "FLATTEN",
  "image_editor.tools.corners": "ROUND OFF",
  "image_editor.actions.done": "DONE",
  "image_editor.actions.dismiss": "LEAVE IT",
  "editor.image.brush_size": "Nozzle width",
  "editor.image.brush_type": "Tip",
  "editor.image.outline_width": "Line weight",
  "labels.undo": "STEP BACK",
  "labels.redo": "STEP FORWARD",
};

const SURFACES: Record<
  Surface,
  { dict: Dict; icons: Partial<Record<"draw" | "stickers" | "crop", string>> }
> = {
  /**
   * The forensic darkroom. Every tool is named for the effect it has on the
   * scan that runs the moment you commit: you are not drawing, you are
   * destroying a match.
   */
  forensics: {
    dict: {
      "image_editor.toolbar.save": "RUN FORENSICS",
      "image_editor.toolbar.cancel": "DISCARD FRAME",
      "image_editor.tools.draw": "REDACT",
      "image_editor.tools.stickers": "COVER",
      "image_editor.tools.shapes": "BLOCK",
      "image_editor.tools.crop": "REFRAME",
      "image_editor.tools.resize": "RESCALE",
      "image_editor.tools.filter": "GRADE",
      "image_editor.tools.text": "CAPTION",
      "image_editor.tools.frame": "BORDER",
      "image_editor.labels.drawing": "Redaction",
      "image_editor.labels.sticker": "Cover",
      "image_editor.labels.shape": "Block",
      "image_editor.labels.text": "Caption",
      "image_editor.labels.image": "Capture",
      "image_editor.filters.blur": "Defocus",
      "image_editor.filters.grayscale": "Mono",
      "image_editor.filters.noise": "Grain",
      "image_editor.filters.brightness": "Exposure",
      "image_editor.filters.sharpen": "Resolve",
      "image_editor.filters.color": "Tint",
      "editor.image.brush_color": "Marker colour",
      "editor.image.confirm_cancel_title": "Leave the frame unscrubbed?",
      "editor.image.confirm_cancel_message":
        "Nothing you did here has been scanned. The capture goes back to the roll as the lens took it.",
      "editor.image.confirm_discard": "Drop it",
      "editor.image.confirm_keep_editing": "Keep scrubbing",
    },
    icons: { draw: REDACTION_MARKER, stickers: BLACKOUT, crop: RETICLE },
  },

  /** The state's bulletin plotter. You are building a suspect, not a photo. */
  press: {
    dict: {
      "image_editor.toolbar.save": "SEND TO PRESS",
      "image_editor.toolbar.cancel": "PULL THE PLATE",
      "image_editor.tools.draw": "SKETCH",
      "image_editor.tools.stickers": "FACE KIT",
      "image_editor.tools.shapes": "BUILD",
      "image_editor.tools.crop": "TO PLATE",
      "image_editor.tools.resize": "RESCALE",
      "image_editor.tools.filter": "FLASH",
      "image_editor.tools.text": "PLACARD",
      "image_editor.tools.frame": "BOOKING",
      "image_editor.labels.drawing": "Sketch",
      "image_editor.labels.sticker": "Feature",
      "image_editor.labels.shape": "Build",
      "image_editor.labels.text": "Placard",
      "image_editor.labels.image": "Plate",
      "editor.image.brush_color": "Pencil",
    },
    icons: { draw: PRESS_STAMP, stickers: BLACKOUT, crop: RETICLE },
  },

  /** The DMV booth. Bureaucratic, unbothered, laminating whatever you hand it. */
  license: {
    dict: {
      "image_editor.toolbar.save": "ISSUE LICENSE",
      "image_editor.toolbar.cancel": "VOID APPLICATION",
      "image_editor.tools.draw": "RETOUCH",
      "image_editor.tools.stickers": "DISGUISE",
      "image_editor.tools.shapes": "OVERLAY",
      "image_editor.tools.crop": "TO SPEC",
      "image_editor.tools.resize": "RESCALE",
      "image_editor.tools.filter": "LIGHTING",
      "image_editor.tools.text": "ANNOTATE",
      "image_editor.tools.frame": "LAMINATE",
      "image_editor.labels.drawing": "Retouch",
      "image_editor.labels.sticker": "Disguise",
      "image_editor.labels.shape": "Overlay",
      "image_editor.labels.text": "Annotation",
      "image_editor.labels.image": "Portrait",
      "editor.image.brush_color": "Retouch colour",
    },
    icons: { draw: RETOUCH, stickers: BLACKOUT, crop: RETICLE },
  },
};

/* --------------------------------------------------------------- assembly */

const CACHE = new Map<Surface, ImageEditorOptions>();

/**
 * The full options object for a surface.
 *
 * Memoised per surface because the component hands `options` straight to the
 * editor: a fresh object identity on every render would re-apply the mount
 * options and, in the worst case, remount the canvas mid-edit.
 */
export function editorOptions(surface: Surface): ImageEditorOptions {
  const hit = CACHE.get(surface);
  if (hit) return hit;

  const { dict, icons } = SURFACES[surface];
  const options: ImageEditorOptions = {
    theme: "dark",
    locale: "en",
    translations: { en: { ...COMMON, ...dict } },
    features: {
      imageEditor: {
        enabled: true,
        tools: {
          draw: icons.draw ? { enabled: true, icon: icons.draw } : true,
          stickers: icons.stickers
            ? { enabled: true, icon: icons.stickers }
            : true,
          crop: icons.crop ? { enabled: true, icon: icons.crop } : true,
        },
      },
    },
  };
  CACHE.set(surface, options);
  return options;
}

/**
 * The labels our translations put on the editor's own Save control, in the
 * order the chrome should look for them. `EditorStage` locates that button by
 * text to route its commit through the editor rather than `getImage()`; since
 * we renamed it, "save" alone no longer finds it.
 */
export const SAVE_LABELS = [
  ...Object.values(SURFACES).map((s) => s.dict["image_editor.toolbar.save"]),
  "save",
].map((s) => s.toLowerCase());

/** The same, for the control our translations renamed away from "cancel". */
export const CANCEL_LABELS = [
  ...Object.values(SURFACES).map((s) => s.dict["image_editor.toolbar.cancel"]),
  "cancel",
].map((s) => s.toLowerCase());

/* ---------------------------------------------------------------- warm-up */

const EMBED = "https://cdn.unlayer.com/image-editor/embed.js";
let warmed = false;

/**
 * Fetches the editor's embed bundle while the player is still on the boot
 * sequence, so the first press of EDIT opens on a canvas instead of a spinner.
 *
 * Safe to call repeatedly and safe to fail: if the CDN is unreachable the
 * editor's own loader will try again at mount time and `onLoadError` covers
 * the rest.
 */
export function warmUpEditor() {
  if (warmed || typeof window === "undefined") return;
  warmed = true;

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "script";
  link.href = EMBED;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);

  // The embed installs window.ImageEditor, whose load() pulls the versioned
  // bundle. Doing it here means mount-time work is already cached.
  const script = document.createElement("script");
  script.src = EMBED;
  script.async = true;
  script.onload = () => {
    void window.ImageEditor?.load().catch(() => {
      /* offline — the component's own loader will report it */
    });
  };
  script.onerror = () => {
    /* offline — degrade to loading at mount time */
  };
  document.head.appendChild(script);
}
