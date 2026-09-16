// Viper Route "neon night" theme — the one place to tune colors.
// UI colors are mirrored as Tailwind tokens in src/app/globals.css (@theme);
// the map palette below is applied to OpenFreeMap's dark style at runtime.

export const MAP_PALETTE = {
  land: "#070b14", // deep blue-black
  residential: "#0a0f1b",
  water: "#082a3d", // electric teal, kept dark
  green: "#0b2420", // dark mint parks
  building: "#101828",
  road: {
    path: "#131c31",
    minor: "#182543",
    major: "#213256",
    motorway: "#2a3f6e",
    casing: "rgba(64, 92, 150, 0.45)",
    rail: "#1a2440",
    railDash: "#070b14",
    pier: "#182543",
  },
  label: {
    road: "#6f82ad",
    place: "#a5b4d6",
    water: "#3ea6c9",
    halo: "#070b14",
  },
};

export const UI = {
  accent: "#34d399", // emerald — the brand
  accent2: "#22d3ee", // cyan — "you", location, stations
};
