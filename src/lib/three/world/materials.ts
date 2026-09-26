/**
 * Every material in the city, in one place.
 *
 * Two reasons it lives here rather than beside the geometry that uses it:
 * materials are the unit of batching (one material = one draw call for all the
 * geometry welded into it), and the emissive ones need to be walkable as a
 * single list, because `city.ts` sets the glow on all of them in one pass.
 *
 * Note the complete absence of point lights. The old block put a PointLight
 * behind every neon sign, which meant every material in the scene recompiled
 * around a growing light list — unusable past a couple of dozen. Lit windows,
 * signage and lamp spill are all emissive geometry plus bloom now, so the city
 * can carry thousands of "lights" for free.
 */

import * as THREE from "three";
import type { TextureLib } from "./textures";
import type { FacadeKind } from "./layout";

export type Materials = ReturnType<typeof buildMaterials>;

function surface(map: THREE.Texture | null, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04,
    ...o,
  });
}

export function buildMaterials(tex: TextureLib) {
  const all: THREE.Material[] = [];
  const keep = <T extends THREE.Material>(m: T) => {
    all.push(m);
    return m;
  };

  /** Materials whose emissive is set from the city's one lighting setup. */
  const emissives: THREE.MeshStandardMaterial[] = [];
  const glowing = <T extends THREE.MeshStandardMaterial>(m: T) => {
    emissives.push(m);
    return m;
  };

  const facade = {} as Record<FacadeKind, THREE.Material[]>;
  (Object.keys(tex.facades) as FacadeKind[]).forEach((kind) => {
    facade[kind] = tex.facades[kind].map((t) =>
      keep(
        glowing(
          surface(t, {
            emissiveMap: t,
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: 0.62,
            roughness: kind === "tower" || kind === "office" ? 0.42 : 0.86,
            metalness: kind === "tower" ? 0.18 : 0.05,
          }),
        ),
      ),
    );
  });

  return {
    /* --- ground --- */
    road: keep(surface(tex.asphalt, { roughness: 0.82, metalness: 0.1 })),
    pavement: keep(surface(tex.concrete, { roughness: 0.94 })),
    sand: keep(surface(tex.sand, { roughness: 1 })),
    grass: keep(surface(tex.grass, { roughness: 1 })),
    dirt: keep(surface(tex.dirt, { roughness: 1 })),
    roof: keep(surface(tex.roof, { roughness: 0.95 })),

    /* --- buildings --- */
    facade,
    storefront: tex.storefronts.map((t) =>
      keep(
        glowing(
          surface(t, {
            emissiveMap: t,
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: 0.85,
            roughness: 0.6,
          }),
        ),
      ),
    ),
    service: tex.serviceBases.map((t) => keep(surface(t, { roughness: 0.88 }))),
    graffiti: tex.graffiti.map((t) =>
      keep(
        glowing(
          surface(t, {
            emissiveMap: t,
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: 0.22,
            roughness: 0.95,
          }),
        ),
      ),
    ),

    /* --- untextured structure: kerbs, poles, railings, hulls --- */
    prop: keep(surface(null, { roughness: 0.85, metalness: 0.1 })),
    // same reasoning as the vehicles: without an environment map, metalness is
    // a one-way trip to black
    metal: keep(surface(null, { roughness: 0.42, metalness: 0.3 })),
    glass: keep(
      surface(null, {
        roughness: 0.14,
        metalness: 0.25,
        transparent: true,
        opacity: 0.55,
      }),
    ),
    /*
     * Leaves are thin and translucent: sunlight comes through them, so the
     * underside of a canopy is green, not black. Without the emissive floor a
     * row of palms seen end-on merges into one dark slab across the sky, which
     * is exactly what a double-sided lit quad does when you stand under it.
     */
    foliage: keep(
      surface(null, {
        roughness: 0.92,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(0x16331f),
        emissiveIntensity: 1,
      }),
    ),

    /* --- emissive: signage, lamp bulbs, light pools, markings --- */
    sign: keep(
      new THREE.MeshBasicMaterial({
        map: tex.signAtlas,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
    neon: keep(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
    /** Soft pools of light on the ground under lamps and signs. */
    pool: keep(
      new THREE.MeshBasicMaterial({
        map: tex.glow,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
    marking: keep(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    ),

    emissives,
    keep,
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}
