// Your "you are here" avatar: a 16×16 pixel sprite shown inside a circle.
// Stored on-device as 16 rows of 16 characters — "." is transparent, any
// other character indexes AVATAR_PALETTE. Small enough to live in localStorage
// and (later) in a user profile.

export const AVATAR_SIZE = 16;
export const AVATAR_KEY = "vr.avatar";

export const AVATAR_PALETTE: { ch: string; hex: string; name: string }[] = [
  { ch: "0", hex: "#34d399", name: "Emerald" },
  { ch: "1", hex: "#059669", name: "Deep green" },
  { ch: "2", hex: "#052e16", name: "Forest" },
  { ch: "3", hex: "#ffffff", name: "White" },
  { ch: "4", hex: "#0a0a0a", name: "Black" },
  { ch: "5", hex: "#f43f5e", name: "Rose" },
  { ch: "6", hex: "#fbbf24", name: "Amber" },
  { ch: "7", hex: "#60a5fa", name: "Sky" },
  { ch: "8", hex: "#a78bfa", name: "Violet" },
  { ch: "9", hex: "#fb923c", name: "Orange" },
  { ch: "a", hex: "#f9a8d4", name: "Pink" },
  { ch: "b", hex: "#78350f", name: "Brown" },
  { ch: "c", hex: "#fcd9b6", name: "Peach" },
  { ch: "d", hex: "#525252", name: "Gray" },
];
const HEX_BY_CH: Record<string, string> = Object.fromEntries(
  AVATAR_PALETTE.map((p) => [p.ch, p.hex])
);

export type Avatar = string[]; // AVATAR_SIZE rows × AVATAR_SIZE chars

export const EMPTY_AVATAR: Avatar = Array.from({ length: AVATAR_SIZE }, () =>
  ".".repeat(AVATAR_SIZE)
);

// Starter sprites so the first tap already shows something fun.
export const AVATAR_PRESETS: { name: string; rows: Avatar }[] = [
  {
    name: "Smiley",
    rows: [
      "................",
      "................",
      "....66666666....",
      "...6666666666...",
      "..666666666666..",
      "..664466664466..",
      "..664466664466..",
      "..666666666666..",
      "..666666666666..",
      "..664666666466..",
      "..666444444666..",
      "...6666666666...",
      "....66666666....",
      "................",
      "................",
      "................",
    ],
  },
  {
    name: "Snake",
    rows: [
      "................",
      "......0000......",
      ".....000000.....",
      "....00300000....",
      "....00000000....",
      "....000..0005...",
      "...0000..00055..",
      "...00.....000...",
      "..000.....000...",
      "..00.......000..",
      "..00........00..",
      "..000......000..",
      "...0000..0000...",
      "....00000000....",
      "......0000......",
      "................",
    ],
  },
  {
    name: "Viper",
    rows: [
      "................",
      "................",
      "...0........0...",
      "...00......00...",
      "...000....000...",
      "...0000..0000...",
      "...00.0000.00...",
      "...00..00..00...",
      "...00......00...",
      "...00......00...",
      "...00......00...",
      "...00......00...",
      "...00......00...",
      "................",
      "................",
      "................",
    ],
  },
];

export function isValidAvatar(x: unknown): x is Avatar {
  return (
    Array.isArray(x) &&
    x.length === AVATAR_SIZE &&
    x.every((r) => typeof r === "string" && r.length === AVATAR_SIZE)
  );
}

export function loadAvatar(): Avatar | null {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidAvatar(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAvatar(a: Avatar | null) {
  try {
    if (a) localStorage.setItem(AVATAR_KEY, JSON.stringify(a));
    else localStorage.removeItem(AVATAR_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function avatarIsEmpty(a: Avatar): boolean {
  return a.every((r) => !/[^.]/.test(r));
}

// SVG markup for the sprite, clipped to a circle, crisp pixels. `px` is the
// rendered size; `ring` adds the emerald border used on the map.
export function avatarSVG(a: Avatar, px: number, ring = true): string {
  const n = AVATAR_SIZE;
  const rects: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const hex = HEX_BY_CH[a[y][x]];
      if (hex) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`);
    }
  }
  const id = `vr-av-${Math.random().toString(36).slice(2, 8)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges">` +
    `<defs><clipPath id="${id}"><circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}"/></clipPath></defs>` +
    `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="#0c0f14"/>` +
    `<g clip-path="url(#${id})">${rects.join("")}</g>` +
    (ring ? `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2 - 0.5}" fill="none" stroke="#ffffff" stroke-width="1"/>` : "") +
    `</svg>`
  );
}
