"use client";

import { useEffect, useRef } from "react";
import {
  CELL,
  DISTRICTS,
  GRID,
  HALF,
  LANDMARK_SPOTS,
  isAvenue,
  terrainAt,
} from "@/lib/three/world/layout";

const SIZE = 168;
const SPAN = GRID * CELL;
const SCALE = SIZE / SPAN;

/**
 * The whole city on one 168-pixel tile.
 *
 * A kilometre of grid needs an orientation aid or every junction looks like
 * the last one. It draws the district tilemap straight from the same table the
 * world generator reads, so the map cannot drift out of step with the city —
 * there is only one description of Leonida and this is a view of it.
 */
export default function Minimap({
  x,
  z,
  yaw,
  onTravel,
}: {
  x: number;
  z: number;
  yaw: number;
  onTravel?: (n: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);

  // the city itself never changes, so it's painted once and blitted
  useEffect(() => {
    const cv = document.createElement("canvas");
    cv.width = SIZE;
    cv.height = SIZE;
    const c = cv.getContext("2d");
    if (!c) return;

    c.fillStyle = "#0a0714";
    c.fillRect(0, 0, SIZE, SIZE);

    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const t = terrainAt(i, j);
        c.fillStyle = DISTRICTS[t].tint;
        c.globalAlpha = t === "water" ? 0.5 : 0.34;
        c.fillRect(i * CELL * SCALE, j * CELL * SCALE, CELL * SCALE + 0.5, CELL * SCALE + 0.5);
      }
    }
    c.globalAlpha = 1;

    // road grid, avenues heavier
    for (let k = -HALF; k <= HALF; k++) {
      const p = (k + HALF) * CELL * SCALE;
      c.strokeStyle = isAvenue(k) ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.16)";
      c.lineWidth = isAvenue(k) ? 1.6 : 0.7;
      c.beginPath();
      c.moveTo(p, 0);
      c.lineTo(p, SIZE);
      c.moveTo(0, p);
      c.lineTo(SIZE, p);
      c.stroke();
    }

    base.current = cv;
  }, []);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const bg = base.current;
      if (!cv || !bg) return;
      const c = cv.getContext("2d");
      if (!c) return;

      c.clearRect(0, 0, SIZE, SIZE);
      c.drawImage(bg, 0, 0);

      const px = (x + HALF * CELL) * SCALE;
      const pz = (z + HALF * CELL) * SCALE;

      // landmarks
      for (const s of LANDMARK_SPOTS) {
        const lx = (s.x + HALF * CELL) * SCALE;
        const lz = (s.z + HALF * CELL) * SCALE;
        c.fillStyle = "rgba(255,233,168,0.85)";
        c.beginPath();
        c.arc(lx, lz, 1.9, 0, 7);
        c.fill();
      }

      // view cone
      c.save();
      c.translate(px, pz);
      c.rotate(-yaw);
      c.fillStyle = "rgba(34,230,255,0.18)";
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, 26, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      c.closePath();
      c.fill();

      // the player
      c.fillStyle = "#ff2e97";
      c.strokeStyle = "rgba(0,0,0,0.8)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, -5);
      c.lineTo(3.6, 4);
      c.lineTo(0, 2);
      c.lineTo(-3.6, 4);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [x, z, yaw]);

  return (
    <div className="glass-deep overflow-hidden rounded-xl p-1.5">
      <canvas
        ref={ref}
        width={SIZE}
        height={SIZE}
        className="block rounded-lg"
        style={{ width: SIZE, height: SIZE }}
        onClick={(e) => {
          if (!onTravel) return;
          // nearest named place to wherever the map was clicked
          const r = e.currentTarget.getBoundingClientRect();
          const wx = ((e.clientX - r.left) / r.width) * SPAN - HALF * CELL;
          const wz = ((e.clientY - r.top) / r.height) * SPAN - HALF * CELL;
          let best = 0;
          let bestD = Infinity;
          LANDMARK_SPOTS.forEach((s, i) => {
            const d = (s.x - wx) ** 2 + (s.z - wz) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          onTravel(best);
        }}
      />
    </div>
  );
}
