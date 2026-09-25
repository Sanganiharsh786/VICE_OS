/**
 * The map of Leonida.
 *
 * The city is a 12 x 12 grid of 80-metre cells — roughly a square kilometre of
 * walkable ground — laid out as a tilemap so the whole plan is legible in one
 * screenful and can be retuned by editing characters rather than coordinates.
 *
 * Roads run along every cell boundary, so the grid doubles as the road
 * network: vertical roads at x = k * CELL, horizontal roads at z = k * CELL,
 * with an intersection wherever they cross. Traffic, crossings and signals are
 * all derived from that, which is why vehicles can actually follow lanes
 * instead of wandering.
 */

/** Size of one city cell, in metres. Block interior + the road around it. */
export const CELL = 80;
/** Cells per axis. */
export const GRID = 12;
/** Road centre lines run at x = k*CELL for k in [-HALF, HALF]. */
export const HALF = GRID / 2;
/** World extent in each direction from the origin. */
export const EXTENT = HALF * CELL; // 480

/** Full road width for an avenue (four lanes + turn space). */
export const AVENUE_W = 19;
/** Ordinary two-lane street. */
export const STREET_W = 13;
/** Distance from the road centre line to the kerb, per road. */
export const LANE_W = 3.4;

/**
 * Avenues are every third line. They get four lanes, wider pavements, bus
 * stops and the heavier traffic — the streets between them stay local.
 */
export function isAvenue(line: number) {
  return ((line % 3) + 3) % 3 === 0;
}

export function roadWidth(line: number) {
  return isAvenue(line) ? AVENUE_W : STREET_W;
}

/* ------------------------------------------------------------------ */
/* the tilemap                                                         */
/* ------------------------------------------------------------------ */

/**
 * One character per cell, north (-Z) at the top, west (-X) on the left.
 *
 *   I industrial   R residential   C commercial   D downtown   F financial
 *   O old town     P park          B beach        H harbour    M marina
 *   W open water
 */
const MAP = [
  "IIRRCDDFHHWW",
  "IIRRCDDFHHWW",
  "IRRPCDDFMBWW",
  "RRPPCDDDMBWW",
  "RRPCCDDDBBWW",
  "RRCCDDDDBBWW",
  "RRCCDDDOBBWW",
  "RRCOOOOOBBWW",
  "RRROOOOBBBWW",
  "IRRRCCBBBBWW",
  "IIIRRCCBBBWW",
  "IIIIRRCBBBWW",
] as const;

export type Terrain =
  | "industrial"
  | "residential"
  | "commercial"
  | "downtown"
  | "financial"
  | "oldtown"
  | "park"
  | "beach"
  | "harbor"
  | "marina"
  | "water";

const LEGEND: Record<string, Terrain> = {
  I: "industrial",
  R: "residential",
  C: "commercial",
  D: "downtown",
  F: "financial",
  O: "oldtown",
  P: "park",
  B: "beach",
  H: "harbor",
  M: "marina",
  W: "water",
};

/** Terrain of cell (i, j), i = column (west→east), j = row (north→south). */
export function terrainAt(i: number, j: number): Terrain {
  if (i < 0 || i >= GRID || j < 0 || j >= GRID) return "water";
  return LEGEND[MAP[j][i]] ?? "water";
}

/** Centre of cell (i, j) in world space. */
export function cellCentre(i: number, j: number): [number, number] {
  return [(i - HALF + 0.5) * CELL, (j - HALF + 0.5) * CELL];
}

/** Cell containing a world position. */
export function cellOf(x: number, z: number): [number, number] {
  return [
    Math.floor(x / CELL) + HALF,
    Math.floor(z / CELL) + HALF,
  ];
}

export function terrainOfPoint(x: number, z: number): Terrain {
  const [i, j] = cellOf(x, z);
  return terrainAt(i, j);
}

/** Land you can build on and drive through. */
export function isLand(t: Terrain) {
  return t !== "water";
}

/** Land that carries buildings rather than sand, water or grass. */
export function isBuilt(t: Terrain) {
  return (
    t === "industrial" ||
    t === "residential" ||
    t === "commercial" ||
    t === "downtown" ||
    t === "financial" ||
    t === "oldtown" ||
    t === "harbor" ||
    t === "beach"
  );
}

/* ------------------------------------------------------------------ */
/* district character                                                  */
/* ------------------------------------------------------------------ */

export type DistrictSpec = {
  name: string;
  /** How much of the block frontage gets built on. */
  density: number;
  /** Building height range, metres. */
  height: [number, number];
  /** Footprint depth back from the pavement. */
  depth: [number, number];
  /** Frontage width along the street. */
  width: [number, number];
  /** Which facade family to use. */
  facade: FacadeKind;
  /** Chance a block gets a surface car park instead of a courtyard. */
  parking: number;
  /** Street trees per block edge. */
  trees: number;
  /** Neon signage weight, 0..1. */
  neon: number;
  /** Relative vehicle count. */
  traffic: number;
  /** Relative pedestrian count. */
  crowd: number;
  /** Accent colour for the minimap and district cards. */
  tint: string;
};

export type FacadeKind =
  | "tower"
  | "office"
  | "apartment"
  | "shop"
  | "warehouse"
  | "colonial"
  | "resort";

export const DISTRICTS: Record<Terrain, DistrictSpec> = {
  downtown: {
    name: "DOWNTOWN",
    density: 0.92,
    height: [40, 135],
    depth: [20, 30],
    width: [18, 34],
    facade: "tower",
    parking: 0.15,
    trees: 2,
    neon: 0.8,
    traffic: 1.0,
    crowd: 1.0,
    tint: "#ff2e97",
  },
  financial: {
    name: "FINANCIAL DISTRICT",
    density: 0.88,
    height: [55, 170],
    depth: [22, 32],
    width: [22, 38],
    facade: "office",
    parking: 0.2,
    trees: 1,
    neon: 0.35,
    traffic: 0.85,
    crowd: 0.8,
    tint: "#22e6ff",
  },
  commercial: {
    name: "COMMERCIAL STRIP",
    density: 0.8,
    height: [10, 34],
    depth: [16, 24],
    width: [12, 24],
    facade: "shop",
    parking: 0.6,
    trees: 3,
    neon: 1.0,
    traffic: 0.8,
    crowd: 0.9,
    tint: "#ffb347",
  },
  residential: {
    name: "RESIDENTIAL",
    density: 0.68,
    height: [8, 26],
    depth: [12, 19],
    width: [11, 19],
    facade: "apartment",
    parking: 0.3,
    trees: 5,
    neon: 0.15,
    traffic: 0.45,
    crowd: 0.5,
    tint: "#9dff3d",
  },
  oldtown: {
    name: "OLD TOWN",
    density: 0.86,
    height: [9, 20],
    depth: [12, 18],
    width: [8, 14],
    facade: "colonial",
    parking: 0.12,
    trees: 4,
    neon: 0.55,
    traffic: 0.4,
    crowd: 0.85,
    tint: "#ff5ad9",
  },
  industrial: {
    name: "INDUSTRIAL YARDS",
    density: 0.55,
    height: [8, 22],
    depth: [24, 36],
    width: [22, 42],
    facade: "warehouse",
    parking: 0.75,
    trees: 1,
    neon: 0.1,
    traffic: 0.5,
    crowd: 0.2,
    tint: "#8d8aa6",
  },
  harbor: {
    name: "HARBOUR",
    density: 0.4,
    height: [7, 18],
    depth: [20, 30],
    width: [20, 36],
    facade: "warehouse",
    parking: 0.5,
    trees: 0,
    neon: 0.2,
    traffic: 0.35,
    crowd: 0.35,
    tint: "#5ad9ff",
  },
  beach: {
    name: "BEACHFRONT",
    density: 0.5,
    height: [12, 42],
    depth: [16, 24],
    width: [16, 28],
    facade: "resort",
    parking: 0.45,
    trees: 6,
    neon: 0.9,
    traffic: 0.55,
    crowd: 1.0,
    tint: "#ffd36b",
  },
  marina: {
    name: "MARINA",
    density: 0.25,
    height: [7, 16],
    depth: [14, 20],
    width: [14, 22],
    facade: "resort",
    parking: 0.5,
    trees: 3,
    neon: 0.5,
    traffic: 0.3,
    crowd: 0.5,
    tint: "#7ce7d6",
  },
  park: {
    name: "LEONIDA PARK",
    density: 0.06,
    height: [6, 10],
    depth: [10, 14],
    width: [10, 16],
    facade: "colonial",
    parking: 0.1,
    trees: 14,
    neon: 0.05,
    traffic: 0.25,
    crowd: 0.7,
    tint: "#57e08a",
  },
  water: {
    name: "OPEN WATER",
    density: 0,
    height: [0, 0],
    depth: [0, 0],
    width: [0, 0],
    facade: "resort",
    parking: 0,
    trees: 0,
    neon: 0,
    traffic: 0,
    crowd: 0,
    tint: "#2a4f8f",
  },
};

/**
 * The district a point belongs to.
 *
 * Roads run along cell boundaries, so a coastal road sits in the water cell
 * next to the land it serves and a naive lookup reports "OPEN WATER" while the
 * player is standing on dry tarmac. Water falls back to the nearest land
 * neighbour.
 */
export function districtAt(x: number, z: number) {
  const [i, j] = cellOf(x, z);
  let t = terrainAt(i, j);
  if (t === "water") {
    for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const n = terrainAt(i + di, j + dj);
      if (n !== "water") {
        t = n;
        break;
      }
    }
  }
  return DISTRICTS[t];
}

/* ------------------------------------------------------------------ */
/* named places                                                        */
/* ------------------------------------------------------------------ */

/**
 * Fast-travel targets and the labels stamped onto photographs.
 *
 * Every one of these sits on a road intersection, which is guaranteed open
 * ground — dropping the player at an arbitrary coordinate in a district lands
 * them inside a building about a third of the time.
 */
export const LANDMARK_SPOTS: { name: string; x: number; z: number }[] = [
  { name: "OCEAN DRIVE", x: 320, z: 80 },
  { name: "DOWNTOWN CORE", x: 0, z: 0 },
  { name: "LEONIDA TOWER", x: 80, z: -80 },
  { name: "LITTLE HAVANA", x: -80, z: 160 },
  { name: "VICE HARBOUR", x: 240, z: -400 },
  { name: "THE MARINA", x: 240, z: -240 },
  { name: "SUNSET PARK", x: -160, z: -160 },
  { name: "WEST YARDS", x: -320, z: -320 },
  { name: "VICE ARENA", x: -160, z: 160 },
  { name: "SOUTH BEACH", x: 320, z: 320 },
];

/** Nearest named place to a world position. */
export function placeName(x: number, z: number) {
  let best = LANDMARK_SPOTS[0];
  let bestD = Infinity;
  for (const s of LANDMARK_SPOTS) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  const district = districtAt(x, z).name;
  return best.name === district ? best.name : `${best.name}, ${district}`;
}
