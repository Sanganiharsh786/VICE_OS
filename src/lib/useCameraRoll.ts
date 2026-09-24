"use client";

import { useEffect, useState } from "react";
import { SCENES, SUSPECTS, renderMugshot, renderScene, type Scene } from "./art";

export type Shot = Scene & { src: string | null };

/**
 * Paints the camera roll one frame at a time. Each scene is a full 1080x1350
 * canvas render, so they're staggered across ticks to keep the phone
 * responsive while the roll fills in.
 */
export function useCameraRoll() {
  const [shots, setShots] = useState<Shot[]>(() =>
    SCENES.map((s) => ({ ...s, src: null })),
  );

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const seed = Math.floor(Math.random() * 999) + 1;

    const tick = () => {
      if (cancelled || i >= SCENES.length) return;
      const scene = SCENES[i];
      try {
        const src = renderScene(scene.id, seed + i);
        setShots((prev) =>
          prev.map((s) => (s.id === scene.id ? { ...s, src } : s)),
        );
      } catch {
        /* canvas unavailable */
      }
      i++;
      setTimeout(tick, 30);
    };

    const t = setTimeout(tick, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  return shots;
}

export type Booking = { id: string; label: string; src: string | null };

export function useBookingPhotos() {
  const [photos, setPhotos] = useState<Booking[]>(() =>
    SUSPECTS.map((s) => ({ id: s.id, label: s.label, src: null })),
  );

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const seed = Math.floor(Math.random() * 999) + 1;
    const tick = () => {
      if (cancelled || i >= SUSPECTS.length) return;
      const s = SUSPECTS[i];
      try {
        const src = renderMugshot(s.id, seed + i);
        setPhotos((prev) => prev.map((p) => (p.id === s.id ? { ...p, src } : p)));
      } catch {
        /* ignore */
      }
      i++;
      setTimeout(tick, 30);
    };
    const t = setTimeout(tick, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  return photos;
}

/** Read a user-picked file into a data URL the editor can consume directly. */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(file);
  });
}
