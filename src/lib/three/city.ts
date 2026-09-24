/**
 * The block.
 *
 * Same rule as the rest of VICE OS: no downloaded assets. Every texture here
 * is painted into a canvas at boot (asphalt, window grids, neon signage,
 * plates), and every mesh is generated from parameters.
 *
 * The world also publishes an *evidence register* — the faces, plates and
 * landmarks that can incriminate you if they end up in a photo. That register
 * is what connects the 3D scene to the image editor: whatever the shutter
 * catches is what you then have to deal with in the Image Lab.
 */

import * as THREE from "three";

export type EvidenceKind = "FACE" | "PLATE" | "LANDMARK" | "CONTRABAND";

export type EvidenceTag = {
  kind: EvidenceKind;
  label: string;
  /** Followed each frame for moving subjects (pedestrians). */
  object: THREE.Object3D;
  /** Local offset from the object's origin to the incriminating detail. */
  offset: THREE.Vector3;
  /** Roughly how big the detail is, for the in-frame test. */
  radius: number;
};

export type Collider = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type City = {
  group: THREE.Group;
  colliders: Collider[];
  evidence: EvidenceTag[];
  /** Sidewalk waypoints the pedestrian AI walks between. */
  waypoints: THREE.Vector3[];
  sun: THREE.DirectionalLight;
  update: (t: number) => void;
  dispose: () => void;
};

const ROAD_HALF = 7;
const WALK_HALF = 11.4;
const BLOCK_LEN = 78;

/* ------------------------------------------------------------------ */
/* canvas textures                                                     */
/* ------------------------------------------------------------------ */

function texture(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
  repeat?: [number, number],
) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  draw(ctx);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amt: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function asphalt() {
  return texture(
    512,
    512,
    (c) => {
      c.fillStyle = "#2b2736";
      c.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 700; i++) {
        c.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`;
        const r = Math.random() * 3 + 0.5;
        c.beginPath();
        c.arc(Math.random() * 512, Math.random() * 512, r, 0, 7);
        c.fill();
      }
      // oil bloom
      for (let i = 0; i < 6; i++) {
        const g = c.createRadialGradient(
          Math.random() * 512,
          Math.random() * 512,
          2,
          256,
          256,
          70,
        );
        g.addColorStop(0, "rgba(0,0,0,0.35)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        c.fillRect(0, 0, 512, 512);
      }
      grain(c, 512, 512, 22);
    },
    [8, 34],
  );
}

function roadLine() {
  return texture(
    64,
    512,
    (c) => {
      c.fillStyle = "rgba(0,0,0,0)";
      c.clearRect(0, 0, 64, 512);
      c.fillStyle = "#e8e3c8";
      for (let y = 0; y < 512; y += 128) c.fillRect(22, y, 20, 74);
    },
    [1, 26],
  );
}

function sidewalk() {
  return texture(
    256,
    256,
    (c) => {
      c.fillStyle = "#454055";
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = "rgba(0,0,0,0.5)";
      c.lineWidth = 3;
      for (let i = 0; i <= 256; i += 64) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, 256);
        c.moveTo(0, i);
        c.lineTo(256, i);
        c.stroke();
      }
      grain(c, 256, 256, 26);
    },
    [3, 16],
  );
}

const WINDOW_HUES = ["#ffb347", "#22e6ff", "#ff2e97", "#9dff3d", "#ffe9a8"];

function facade(seed: number) {
  const rnd = mulberry(seed);
  return texture(256, 512, (c) => {
    const base = ["#1a1330", "#151226", "#221838", "#12161f"][
      Math.floor(rnd() * 4)
    ];
    c.fillStyle = base;
    c.fillRect(0, 0, 256, 512);

    const cols = 6;
    const rows = 16;
    const pw = 256 / cols;
    const ph = 512 / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const lit = rnd() > 0.52;
        if (!lit) {
          c.fillStyle = "rgba(0,0,0,0.55)";
          c.fillRect(x * pw + 6, y * ph + 6, pw - 12, ph - 14);
          continue;
        }
        const hue = WINDOW_HUES[Math.floor(rnd() * WINDOW_HUES.length)];
        c.fillStyle = hue;
        c.globalAlpha = 0.5 + rnd() * 0.5;
        c.fillRect(x * pw + 6, y * ph + 6, pw - 12, ph - 14);
        c.globalAlpha = 1;
      }
    }
    // horizontal floor bands
    c.fillStyle = "rgba(0,0,0,0.45)";
    for (let y = 0; y < rows; y++) c.fillRect(0, y * ph, 256, 5);
    grain(c, 256, 512, 16);
  });
}

function signTexture(text: string, color: string) {
  return texture(512, 128, (c) => {
    c.fillStyle = "#060109";
    c.fillRect(0, 0, 512, 128);
    c.font = "bold 76px 'Arial Black', Impact, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = color;
    c.shadowBlur = 34;
    c.fillStyle = color;
    c.fillText(text, 256, 68);
    c.fillText(text, 256, 68);
    c.shadowBlur = 0;
    c.fillStyle = "#fff";
    c.globalAlpha = 0.55;
    c.fillText(text, 256, 68);
  });
}

function plateTexture(code: string) {
  return texture(256, 128, (c) => {
    c.fillStyle = "#f2efe4";
    c.fillRect(0, 0, 256, 128);
    c.strokeStyle = "#1a2a6b";
    c.lineWidth = 7;
    c.strokeRect(6, 6, 244, 116);
    c.fillStyle = "#ff8a3c";
    c.font = "bold 20px sans-serif";
    c.textAlign = "center";
    c.fillText("LEONIDA", 128, 30);
    c.fillStyle = "#16224f";
    c.font = "bold 58px 'Arial Black', sans-serif";
    c.fillText(code, 128, 90);
  });
}

/** Tiny deterministic RNG so a rebuild of the block looks identical. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

const SIGNS: [string, string][] = [
  ["MALIBU", "#ff2e97"],
  ["PAWN 24H", "#22e6ff"],
  ["EL SOL", "#ffb347"],
  ["VACANCY", "#ff3b30"],
  ["CAFE CUBANO", "#9dff3d"],
  ["NO CREDIT", "#ff5ad9"],
  ["LIQUOR", "#22e6ff"],
  ["MOTEL", "#ffb347"],
];

export function buildCity(scene: THREE.Scene): City {
  const rnd = mulberry(1988);
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const evidence: EvidenceTag[] = [];
  const waypoints: THREE.Vector3[] = [];
  const disposables: { dispose: () => void }[] = [];
  const animated: { m: THREE.Mesh; base: number; rate: number; phase: number }[] =
    [];

  const keep = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  /* ---- sky ---- */
  const sky = new THREE.Mesh(
    keep(new THREE.SphereGeometry(400, 32, 20)),
    keep(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color("#140a32") },
          mid: { value: new THREE.Color("#6d1d63") },
          low: { value: new THREE.Color("#ff8a4c") },
        },
        vertexShader: `
          varying vec3 vP;
          void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: `
          varying vec3 vP;
          uniform vec3 top; uniform vec3 mid; uniform vec3 low;
          void main(){
            float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
            vec3 c = mix(low, mid, smoothstep(0.42, 0.62, h));
            c = mix(c, top, smoothstep(0.58, 0.95, h));
            // sun bloom sitting on the horizon down the street
            vec3 d = normalize(vP);
            float sun = pow(max(dot(d, normalize(vec3(0.12, 0.06, -1.0))), 0.0), 220.0);
            float halo = pow(max(dot(d, normalize(vec3(0.12, 0.06, -1.0))), 0.0), 8.0);
            c += vec3(1.0, 0.72, 0.42) * (sun * 2.2 + halo * 0.35);
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    ),
  );
  sky.frustumCulled = false;
  group.add(sky);

  scene.fog = new THREE.FogExp2(0x3a1140, 0.017);

  /* ---- road ---- */
  const road = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(ROAD_HALF * 2, BLOCK_LEN * 2)),
    keep(
      new THREE.MeshStandardMaterial({
        map: keep(asphalt()),
        roughness: 0.42,
        metalness: 0.25,
        color: 0xffffff,
      }),
    ),
  );
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  group.add(road);

  const line = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(0.42, BLOCK_LEN * 2)),
    keep(
      new THREE.MeshBasicMaterial({
        map: keep(roadLine()),
        transparent: true,
        opacity: 0.8,
      }),
    ),
  );
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.012;
  group.add(line);

  const walkMat = keep(
    new THREE.MeshStandardMaterial({
      map: keep(sidewalk()),
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  const curbGeo = keep(
    new THREE.BoxGeometry(WALK_HALF - ROAD_HALF, 0.16, BLOCK_LEN * 2),
  );
  for (const sx of [-1, 1]) {
    const walk = new THREE.Mesh(curbGeo, walkMat);
    walk.position.set((sx * (ROAD_HALF + WALK_HALF)) / 2, 0.08, 0);
    walk.receiveShadow = true;
    group.add(walk);
  }

  // neon smears on the wet road — cheap stand-in for real reflections
  const puddleMat = keep(
    new THREE.MeshBasicMaterial({
      color: 0xff2e97,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const puddleGeo = keep(new THREE.PlaneGeometry(2.6, 9));
  for (let i = 0; i < 16; i++) {
    const p = new THREE.Mesh(puddleGeo, puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(
      (rnd() - 0.5) * ROAD_HALF * 1.9,
      0.02,
      (rnd() - 0.5) * BLOCK_LEN * 1.7,
    );
    p.scale.setScalar(0.5 + rnd());
    group.add(p);
  }

  /* ---- buildings ---- */
  const facades = [facade(11), facade(29), facade(47), facade(63), facade(81)];
  facades.forEach((f) => keep(f));

  for (const sx of [-1, 1]) {
    let z = -BLOCK_LEN;
    while (z < BLOCK_LEN) {
      const depth = 9 + rnd() * 9;
      const width = 7 + rnd() * 7;
      const height = 8 + rnd() * 30;
      const x = sx * (WALK_HALF + depth / 2);
      const cz = z + width / 2;

      const tex = facades[Math.floor(rnd() * facades.length)].clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, Math.round(width / 5)), Math.max(1, Math.round(height / 4)));
      keep(tex);

      const mat = keep(
        new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 0.55,
          roughness: 0.82,
          metalness: 0.08,
        }),
      );
      const b = new THREE.Mesh(keep(new THREE.BoxGeometry(depth, height, width)), mat);
      b.position.set(x, height / 2, cz);
      b.castShadow = true;
      b.receiveShadow = true;
      group.add(b);

      colliders.push({
        minX: x - depth / 2,
        maxX: x + depth / 2,
        minZ: cz - width / 2,
        maxZ: cz + width / 2,
      });

      // a sign on roughly every other storefront
      if (rnd() > 0.35) {
        const [text, color] = SIGNS[Math.floor(rnd() * SIGNS.length)];
        const sTex = keep(signTexture(text, color));
        const sign = new THREE.Mesh(
          keep(new THREE.PlaneGeometry(Math.min(width * 0.8, 6), 1.5)),
          keep(
            new THREE.MeshBasicMaterial({
              map: sTex,
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          ),
        );
        sign.position.set(x - sx * (depth / 2 + 0.06), 3.4 + rnd() * 3, cz);
        sign.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(sign);
        animated.push({
          m: sign,
          base: 1,
          rate: 1.4 + rnd() * 5,
          phase: rnd() * 10,
        });

        const glow = new THREE.PointLight(new THREE.Color(color), 9, 13, 2);
        glow.position.copy(sign.position);
        glow.position.x -= sx * 0.7;
        group.add(glow);
      }

      z += width + 1 + rnd() * 3;
    }
  }

  /* ---- the landmark you should probably crop out ---- */
  const towerH = 46;
  const tower = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(2.4, 3.4, towerH, 10)),
    keep(
      new THREE.MeshStandardMaterial({
        color: 0x1b1030,
        roughness: 0.6,
        metalness: 0.4,
        emissive: new THREE.Color(0x2a0f3a),
        emissiveIntensity: 0.6,
      }),
    ),
  );
  tower.position.set(-24, towerH / 2, -46);
  tower.castShadow = true;
  group.add(tower);
  colliders.push({ minX: -28, maxX: -20, minZ: -50, maxZ: -42 });

  const crown = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(11, 3.2)),
    keep(
      new THREE.MeshBasicMaterial({
        map: keep(signTexture("LEONIDA", "#22e6ff")),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  crown.position.set(-24, towerH - 3, -45.2);
  group.add(crown);
  animated.push({ m: crown, base: 1, rate: 0.8, phase: 2 });
  evidence.push({
    kind: "LANDMARK",
    label: "LEONIDA TOWER",
    object: crown,
    offset: new THREE.Vector3(),
    radius: 6,
  });

  /* ---- palms ---- */
  const trunkGeo = keep(new THREE.CylinderGeometry(0.11, 0.2, 6.2, 7));
  const trunkMat = keep(new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 }));
  const frondGeo = keep(new THREE.PlaneGeometry(3.4, 0.55));
  const frondMat = keep(
    new THREE.MeshStandardMaterial({
      color: 0x1c6b4a,
      roughness: 0.85,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
    }),
  );
  for (const sx of [-1, 1]) {
    for (let z = -BLOCK_LEN + 6; z < BLOCK_LEN; z += 13) {
      const x = sx * (ROAD_HALF + 1.5);
      const zz = z + rnd() * 3;
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 3.1;
      trunk.rotation.z = (rnd() - 0.5) * 0.18;
      trunk.castShadow = true;
      palm.add(trunk);
      for (let f = 0; f < 7; f++) {
        const fr = new THREE.Mesh(frondGeo, frondMat);
        const a = (f / 7) * Math.PI * 2;
        fr.position.set(Math.cos(a) * 1.5, 6.1 - 0.2, Math.sin(a) * 1.5);
        fr.rotation.set(-0.35 + rnd() * 0.2, -a, 0.2);
        palm.add(fr);
      }
      palm.position.set(x, 0.16, zz);
      group.add(palm);

      // street lamp beside every other palm
      if ((z | 0) % 26 === 0) {
        const lamp = new THREE.PointLight(0xffc98a, 14, 18, 2);
        lamp.position.set(x, 5.4, zz);
        group.add(lamp);
        const bulb = new THREE.Mesh(
          keep(new THREE.SphereGeometry(0.16, 8, 6)),
          keep(new THREE.MeshBasicMaterial({ color: 0xffd9a8 })),
        );
        bulb.position.copy(lamp.position);
        group.add(bulb);
      }
    }
  }

  /* ---- parked cars, each with a readable plate ---- */
  const CAR_COLORS = [0xff2e97, 0x22e6ff, 0xffb347, 0x9dff3d, 0xe8e4dc, 0x2f6bff];
  const PLATES = ["VC 4 LIFE", "8QX 220", "LEO 991", "TRNK FL", "77 VICE"];
  const wheelGeo = keep(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12));
  const wheelMat = keep(new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.95 }));

  for (let i = 0; i < 8; i++) {
    const sx = i % 2 === 0 ? -1 : 1;
    const z = -BLOCK_LEN + 12 + i * 18 + rnd() * 6;
    const car = new THREE.Group();
    const color = CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)];

    const body = new THREE.Mesh(
      keep(new THREE.BoxGeometry(1.85, 0.62, 4.3)),
      keep(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.28,
          metalness: 0.75,
        }),
      ),
    );
    body.position.y = 0.72;
    body.castShadow = true;
    car.add(body);

    const cabin = new THREE.Mesh(
      keep(new THREE.BoxGeometry(1.66, 0.55, 2.1)),
      keep(
        new THREE.MeshStandardMaterial({
          color: 0x0a0a14,
          roughness: 0.15,
          metalness: 0.9,
        }),
      ),
    );
    cabin.position.set(0, 1.28, -0.2);
    cabin.castShadow = true;
    car.add(cabin);

    for (const wx of [-0.92, 0.92]) {
      for (const wz of [-1.45, 1.45]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.34, wz);
        car.add(w);
      }
    }

    const tail = new THREE.Mesh(
      keep(new THREE.BoxGeometry(1.5, 0.12, 0.05)),
      keep(new THREE.MeshBasicMaterial({ color: 0xff2b2b })),
    );
    tail.position.set(0, 0.86, -2.17);
    car.add(tail);

    const code = PLATES[i % PLATES.length];
    const plate = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(0.52, 0.26)),
      keep(new THREE.MeshBasicMaterial({ map: keep(plateTexture(code)) })),
    );
    plate.position.set(0, 0.62, -2.18);
    plate.rotation.y = Math.PI;
    car.add(plate);

    car.position.set(sx * (ROAD_HALF - 1.5), 0, z);
    car.rotation.y = sx > 0 ? Math.PI : 0;
    group.add(car);

    colliders.push({
      minX: car.position.x - 1.2,
      maxX: car.position.x + 1.2,
      minZ: z - 2.4,
      maxZ: z + 2.4,
    });

    evidence.push({
      kind: "PLATE",
      label: `PLATE ${code}`,
      object: plate,
      offset: new THREE.Vector3(),
      radius: 0.45,
    });
  }

  /* ---- sidewalk waypoints for pedestrians ---- */
  for (const sx of [-1, 1]) {
    for (let z = -BLOCK_LEN + 8; z < BLOCK_LEN - 8; z += 11) {
      waypoints.push(
        new THREE.Vector3(sx * (ROAD_HALF + 2.2 + rnd() * 1.6), 0, z + rnd() * 4),
      );
    }
  }

  /* ---- lighting ---- */
  // The sun sits on the horizon straight down the street, so the player is
  // backlit by design. The hemisphere has to carry the road and the fill has
  // to carry the character, or everything below eye level goes to pure black.
  const hemi = new THREE.HemisphereLight(0xffa8d8, 0x4a3560, 1.9);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xffb178, 2.4);
  sun.position.set(14, 16, -52);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.bias = -0.0009;
  group.add(sun);
  group.add(sun.target);

  const fill = new THREE.DirectionalLight(0x6fe6ff, 1.35);
  fill.position.set(-16, 9, 24);
  group.add(fill);

  const bounce = new THREE.DirectionalLight(0xff7ac0, 0.6);
  bounce.position.set(18, 4, 20);
  group.add(bounce);

  scene.add(group);

  return {
    group,
    colliders,
    evidence,
    waypoints,
    sun,
    update(t) {
      // neon flicker — a couple of the signs are on their last legs
      for (const a of animated) {
        const m = a.m.material as THREE.MeshBasicMaterial;
        const f = Math.sin(t * a.rate + a.phase);
        const glitch = Math.sin(t * 31 + a.phase * 7) > 0.93 ? 0.35 : 1;
        m.opacity = a.base * (0.78 + f * 0.12) * glitch;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      scene.remove(group);
      scene.fog = null;
    },
  };
}

export const CITY_BOUNDS = { road: ROAD_HALF, walk: WALK_HALF, len: BLOCK_LEN };

/** Push a capsule out of every box it overlaps. */
export function resolveCollisions(
  pos: THREE.Vector3,
  radius: number,
  colliders: Collider[],
) {
  for (const c of colliders) {
    if (
      pos.x < c.minX - radius ||
      pos.x > c.maxX + radius ||
      pos.z < c.minZ - radius ||
      pos.z > c.maxZ + radius
    )
      continue;

    const dxMin = pos.x - (c.minX - radius);
    const dxMax = c.maxX + radius - pos.x;
    const dzMin = pos.z - (c.minZ - radius);
    const dzMax = c.maxZ + radius - pos.z;
    const m = Math.min(dxMin, dxMax, dzMin, dzMax);
    if (m === dxMin) pos.x = c.minX - radius;
    else if (m === dxMax) pos.x = c.maxX + radius;
    else if (m === dzMin) pos.z = c.minZ - radius;
    else pos.z = c.maxZ + radius;
  }
  const lim = CITY_BOUNDS.len - 3;
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
  pos.x = Math.max(-CITY_BOUNDS.walk - 0.4, Math.min(CITY_BOUNDS.walk + 0.4, pos.x));
}
