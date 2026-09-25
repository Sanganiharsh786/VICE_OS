/**
 * The city you can see but never reach.
 *
 * A ring of simplified towers sits outside the playable grid, between one and
 * three kilometres out. It costs one draw call and it is doing the single most
 * important job in the whole world build: it removes the map edge. Stand
 * anywhere in Leonida, look outward, and the city keeps going.
 *
 * These are deliberately crude — flat-shaded slabs with a window texture and
 * no detail at all — because at that distance silhouette and depth cueing are
 * the only things the eye can resolve.
 */

import * as THREE from "three";
import { MeshBuilder } from "./builder";
import { EXTENT } from "./layout";
import { mulberry } from "./rng";
import { TILE_H, TILE_W, type TextureLib } from "./textures";

export function buildSkyline(tex: TextureLib) {
  const rnd = mulberry(4242);
  const b = new MeshBuilder();

  const rings: [number, number, number, number, number][] = [
    // [radius, count, minHeight, maxHeight, widthScale]
    [EXTENT + 420, 90, 40, 190, 1],
    [EXTENT + 980, 80, 60, 260, 1.7],
    [EXTENT + 1900, 60, 90, 330, 3.0],
  ];

  for (const [radius, count, hMin, hMax, ws] of rings) {
    for (let i = 0; i < count; i++) {
      // biased away from due east, which is open sea
      let a = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.06;
      if (Math.cos(a) > 0.72 && rnd() > 0.25) continue;
      a += (rnd() - 0.5) * 0.04;

      const r = radius * (0.85 + rnd() * 0.5);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = hMin + Math.pow(rnd(), 1.6) * (hMax - hMin);
      const w = (16 + rnd() * 30) * ws;
      const d = (16 + rnd() * 30) * ws;
      // desaturated and lifted toward the haze colour with distance
      const haze = Math.min(0.75, (r - EXTENT) / 2600);
      const tint = new THREE.Color(0x8fa0c8).lerp(new THREE.Color(0xff9a6c), 0.35);
      tint.lerp(new THREE.Color(0x4a2a5c), haze);

      b.box(x, h / 2, z, w, h, d, {
        tint,
        uvScale: [TILE_W, TILE_H],
        snapUv: true,
        ao: 0.25,
        shade: true,
      });
      if (h > 150 && rnd() > 0.5) {
        b.box(x, h + 12, z, w * 0.4, 24, d * 0.4, { tint, uvScale: [TILE_W, TILE_H], snapUv: true });
      }
    }
  }

  const geo = b.build();
  if (!geo) return null;

  const facade = tex.facades.tower[1];
  const mat = new THREE.MeshBasicMaterial({
    map: facade,
    vertexColors: true,
    fog: true,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.renderOrder = -2;
  return { mesh, geo, mat };
}
