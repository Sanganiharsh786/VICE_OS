/** All the in-world writing lives here. Original characters, original jokes. */

export type Commenter = {
  handle: string;
  tag: string;
  hue: number;
  /** cop accounts sniff around when your heat is high */
  badge?: "blue" | "verified";
};

export const COMMENTERS: Commenter[] = [
  { handle: "@tallahassee_tony", tag: "airboat guy", hue: 150 },
  { handle: "@lucia_wasnt_here", tag: "alibi specialist", hue: 320, badge: "verified" },
  { handle: "@jason_offgrid", tag: "keys, boats, problems", hue: 200 },
  { handle: "@flamingo_room7", tag: "front desk", hue: 350 },
  { handle: "@neonpawn_official", tag: "we buy anything", hue: 45, badge: "verified" },
  { handle: "@gator.jpg", tag: "reptile content", hue: 100 },
  { handle: "@strand_patrol_2", tag: "LEONIDA S.O.", hue: 220, badge: "blue" },
  { handle: "@vicefm_nightshift", tag: "97.1 VICE FM", hue: 280, badge: "verified" },
  { handle: "@sunset_repo_co", tag: "your car, our lot", hue: 25 },
  { handle: "@dolphin_dave", tag: "boat rentals", hue: 190 },
];

export const COMMENTS_SAFE = [
  "this composition is criminal (affectionate)",
  "the grade on this is unreal",
  "ok but where is this exactly",
  "saving this for my mood board",
  "you edited this to death and it WORKED",
  "the colors are eating",
  "putting this on the motel lobby TV",
  "certified Leonida moment",
  "whoever framed this deserves a raise",
  "sending this to my cousin, he'll know the spot",
];

export const COMMENTS_HOT = [
  "delete this. seriously.",
  "bro that's a plate number in the corner",
  "my uncle works at the substation. he's seen it.",
  "you're gonna want an alibi for 7:41 PM",
  "reverse image search does exist you know",
  "this is now state's exhibit B",
  "metadata. METADATA.",
  "three people already screenshotted this",
  "hope that reflection isn't who i think it is",
  "we are watching this account. — LSO",
];

export const COMMENTS_SCRUBBED = [
  "clean. nothing in frame. respect.",
  "no faces, no plates, no problem",
  "this is how you post",
  "forensics is gonna hate you",
  "you scrubbed it so hard it became art",
  "unidentifiable and unbothered",
];

export const TAGS = [
  { label: "#leonidalive", heat: 2, reach: 14 },
  { label: "#nofilterneeded", heat: 1, reach: 8 },
  { label: "#goldenhour", heat: 1, reach: 11 },
  { label: "#gatorcontent", heat: 3, reach: 18 },
  { label: "#cashonly", heat: 7, reach: 22 },
  { label: "#trunkfull", heat: 12, reach: 31 },
  { label: "#whowasdriving", heat: 10, reach: 27 },
  { label: "#bordercrossing", heat: 14, reach: 35 },
  { label: "#justvibes", heat: 0, reach: 6 },
];

export const CAPTION_SEEDS = [
  "Golden hour hits different when you're leaving town.",
  "Nothing happened here. Look at the palm trees instead.",
  "Room 7. Cash only. Great ice machine.",
  "Told him the boat was rented. It was, technically.",
  "Two hours of traffic and one very quiet passenger.",
  "If anyone asks, I was at the beach all day.",
];

export const CRIMES = [
  "GRAND THEFT AUTO — CONVERTIBLE",
  "UNLAWFUL AIRBOAT OPERATION",
  "TRESPASS — ROOFTOP, DOWNTOWN",
  "POSSESSION OF AN UNREGISTERED VIBE",
  "FLEEING A TOLL BOOTH",
  "IMPERSONATING A LIFEGUARD",
  "RECKLESS POSTING",
  "TAMPERING WITH EVIDENCE (PHOTOSHOP)",
  "FELONY OVERSHARING",
  "SMUGGLING — CITRUS",
];

export const FIRST_NAMES = [
  "LUCIANA",
  "JAYSON",
  "MARISOL",
  "DEVON",
  "RAFA",
  "NIKKI",
  "ORLANDO",
  "SASHA",
];

export const LAST_NAMES = [
  "CRUZ",
  "DELACROIX",
  "BENNETT",
  "ORTEGA",
  "HALLOWAY",
  "VEGA",
  "SANTOS",
  "REYES",
];

export const STATIONS = [
  { id: "vice-fm", name: "97.1 VICE FM", genre: "SYNTHWAVE", now: "Neon Causeway — MIDNIGHT VALET" },
  { id: "swamp-hz", name: "88.3 SWAMP HZ", genre: "SWAMP FUNK", now: "Airboat Shuffle — THE KEYMEN" },
  { id: "strand", name: "104.5 STRAND", genre: "LATIN POP", now: "Sal y Sol — MARISOL DEL RIO" },
  { id: "scanner", name: "SCANNER 7", genre: "LSO DISPATCH", now: "Unit 4, respond to Route 41" },
];

export const DISPATCH = [
  "Unit 12, be advised — suspect posting from a moving vehicle.",
  "We have a photo. It's... actually really well composed.",
  "Copy that, running the hashtag through the system.",
  "All units, the account went private. Stand by.",
  "Dispatch, that's the fourth sunset this week.",
  "Be advised: subject uses filters. Facial rec is struggling.",
];

export const BOOT_LINES = [
  "VICE OS 6.0 — LEONIDA BUILD",
  "mounting /dev/oceanview",
  "loading neon subsystem ......... OK",
  "calibrating humidity sensor .... 94%",
  "syncing VICEGRAM ............... OK",
  "checking outstanding warrants ..",
  "checking outstanding warrants .. 3 FOUND",
  "suppressing warrant notification",
  "welcome back.",
];

/**
 * The radio line a freshly published photo generates. Reads back what the
 * forensic scan actually found, so the dispatch is a consequence of the edit
 * rather than set dressing.
 */
export function dispatchFor(location: string, confidence: number) {
  const where = location.toLowerCase();
  if (confidence >= 70)
    return pick([
      `All units — clear photographic evidence out of ${where}. Subject is identifiable.`,
      `We have a face and a location. ${location}. Somebody go look.`,
      `That post is admissible. Repeat, admissible. ${location}.`,
    ]);
  if (confidence >= 35)
    return pick([
      `Partial match on a photo from ${where}. Enhance and re-run it.`,
      `Units responding to ${where}. Possible photo evidence detected.`,
      `Got something out of ${where}. Half a subject. Working on it.`,
    ]);
  return pick([
    `New post out of ${where}. Nothing in it we can use.`,
    `Facial rec came back empty on the ${where} frame. Again.`,
    `Whoever's editing these knows exactly what they're doing.`,
  ]);
}

export function pick<T>(arr: T[], rnd = Math.random): T {
  return arr[Math.floor(rnd() * arr.length)];
}

export function money(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}
