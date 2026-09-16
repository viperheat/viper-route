"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import stationsData from "@/data/stations.json";
import SnakeGame from "@/components/SnakeGame";
import AvatarEditor from "@/components/AvatarEditor";
import RaceGame from "@/components/RaceGame";
import AccountSheet from "@/components/AccountSheet";
import { useAccount } from "@/lib/useAccount";
import { avatarSVG, loadAvatar, saveAvatar, type Avatar } from "@/lib/avatar";
import { MAP_PALETTE, UI } from "@/lib/theme";
import { Track, TrainMotion, type LL, type Waypoint } from "@/lib/trainMotion";

const NYC_FALLBACK: [number, number] = [-73.9857, 40.7484];

type Station = { id: string; name: string; lat: number; lon: number };
const STATIONS = stationsData as Station[];

const STATION_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: STATIONS.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { id: s.id, name: s.name },
  })),
};

declare global {
  interface Window {
    maplibregl: typeof import("maplibre-gl");
    __vrMap?: import("maplibre-gl").Map;
    __vrTrainsRefetch?: () => void;
    __vrTrainsState?: () => unknown[];
  }
}

type Arrival = {
  route: string;
  direction: "N" | "S";
  minutes: number;
  arrivalTimeIso: string;
};
type StationArrivals = {
  station: { id: string; name: string };
  updatedAt: string;
  arrivals: Arrival[];
};

const ROUTE_COLORS: Record<string, string> = {
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD",
  A: "#0039A6", C: "#0039A6", E: "#0039A6",
  B: "#FF6319", D: "#FF6319", F: "#FF6319", M: "#FF6319",
  N: "#FCCC0A", Q: "#FCCC0A", R: "#FCCC0A", W: "#FCCC0A",
  G: "#6CBE45",
  J: "#996633", Z: "#996633",
  L: "#A7A9AC",
  S: "#808183", H: "#808183", GS: "#808183", FS: "#808183",
  SI: "#0039A6", SIR: "#0039A6",
};
const DARK_TEXT = new Set(["N", "Q", "R", "W"]);
const baseRoute = (r: string) => r.replace(/X$/, "");
const routeColor = (r: string) => ROUTE_COLORS[baseRoute(r)] ?? "#4b5563";

// Map colors live in src/lib/theme.ts (applied over OpenFreeMap's dark base).
const PALETTE = MAP_PALETTE;

function Bullet({ route, size = 28 }: { route: string; size?: number }) {
  const label = baseRoute(route);
  const color = DARK_TEXT.has(label) ? "#000" : "#fff";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size, height: size, fontSize: size * 0.5,
        backgroundColor: routeColor(route), color,
      }}
    >
      {label}
    </span>
  );
}

const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
function stationLoc(id: string): { lat: number; lon: number } {
  const s = STATION_BY_ID.get(id);
  return s ? { lat: s.lat, lon: s.lon } : { lat: NYC_FALLBACK[1], lon: NYC_FALLBACK[0] };
}

// Nearest station to a [lon, lat] point (longitude scaled by latitude).
function nearestStation(lon: number, lat: number): Station {
  let best = STATIONS[0];
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const s of STATIONS) {
    const dLat = s.lat - lat;
    const dLon = (s.lon - lon) * k;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

// ---- Live train sprites ----
// Motion model lives in src/lib/trainMotion.ts (forward-only physics).
function lerp(a: LL, b: LL, f: number): LL {
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

// The "you are here" marker: plain pulsing dot, or the user's pixel avatar.
function paintUserMarker(el: HTMLDivElement, avatar: Avatar | null) {
  if (avatar) {
    el.className = "vr-user-avatar";
    el.innerHTML = avatarSVG(avatar, 36);
  } else {
    el.className = "vr-user-dot";
    el.innerHTML = "";
  }
}

// Tailwind's `md` breakpoint: side-panel layout on tablets/desktops.
const isDesktop = () =>
  typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;

// A train sprite: the line bullet plus a small chevron that points the way
// it's moving (rotated each frame; fades when the train is holding).
function trainMarkerEl(route: string, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "vr-train";
  el.style.cssText = "position:relative;width:22px;height:22px;transition:none;";
  const dark = DARK_TEXT.has(baseRoute(route));
  const bullet = document.createElement("div");
  bullet.className = "vr-train-bullet";
  bullet.textContent = baseRoute(route);
  bullet.style.cssText =
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
    "border-radius:9999px;font:700 12px system-ui,sans-serif;" +
    `background:${color};color:${dark ? "#000" : "#fff"};border:2px solid #fff;` +
    `box-shadow:0 0 8px ${color},0 0 2px rgba(0,0,0,.5);`;
  const arm = document.createElement("div");
  arm.className = "vr-train-arm";
  arm.style.cssText = "position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .4s;";
  const tip = document.createElement("div");
  tip.className = "vr-train-tip";
  tip.style.cssText =
    "position:absolute;left:50%;top:50%;width:0;height:0;margin-left:-4px;margin-top:-19px;" +
    `border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:7px solid ${color};` +
    `filter:drop-shadow(0 0 3px ${color});`;
  arm.appendChild(tip);
  el.appendChild(arm);
  el.appendChild(bullet);
  return el;
}

// Point a sprite's chevron along `headingDeg` (compass), given the map's bearing.
function aimTrain(el: HTMLDivElement, headingDeg: number | null, mapBearing: number, moving: boolean) {
  const arm = el.querySelector<HTMLDivElement>(".vr-train-arm");
  if (!arm) return;
  if (headingDeg === null || !moving) {
    arm.style.opacity = "0";
    return;
  }
  arm.style.opacity = "0.9";
  arm.style.transform = `rotate(${headingDeg - mapBearing}deg)`;
}

type ArrivalsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ok"; data: StationArrivals };

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const trainRaf = useRef<number | undefined>(undefined);
  const [trainsOn, setTrainsOn] = useState(true);

  // Remember the user's Live trains on/off choice (per device).
  useEffect(() => {
    async function load() {
      try {
        if (localStorage.getItem("vr.trains") === "off") setTrainsOn(false);
      } catch {
        /* storage unavailable — default on */
      }
    }
    load();
  }, []);
  function toggleTrains() {
    const next = !trainsOn;
    try {
      localStorage.setItem("vr.trains", next ? "on" : "off");
    } catch {
      /* ignore */
    }
    setTrainsOn(next);
  }
  const [status, setStatus] = useState<"locating" | "located" | "fallback">(
    "locating"
  );
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(
    null
  );
  const [arrivals, setArrivals] = useState<ArrivalsState>({ kind: "loading" });
  const [nearestId, setNearestId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [showSnake, setShowSnake] = useState(false);
  const [showRace, setShowRace] = useState(false);
  const closeRace = useCallback(() => setShowRace(false), []);
  // The "you are here" marker as state, so the race can move it.
  const [userMarkerObj, setUserMarkerObj] = useState<import("maplibre-gl").Marker | null>(null);
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [showAvatar, setShowAvatar] = useState(false);
  const avatarRef = useRef<Avatar | null>(null); // read by the geolocation callback

  // Load the saved avatar (per device) once.
  useEffect(() => {
    async function load() {
      setAvatar(loadAvatar());
    }
    load();
  }, []);
  // Repaint the marker whenever the avatar changes.
  useEffect(() => {
    avatarRef.current = avatar;
    const el = markerRef.current?.getElement() as HTMLDivElement | undefined;
    if (el) paintUserMarker(el, avatar);
  }, [avatar]);
  // ---- Optional account: sync avatar + favorites across devices.
  const account = useAccount();
  const [showAccount, setShowAccount] = useState(false);
  const profileAvatar = account.profile?.avatar ?? null;
  const profileLoaded = account.profile !== null;
  const { saveAvatarToProfile } = account;
  useEffect(() => {
    // On sign-in: the profile's avatar wins if it has one; otherwise push
    // the on-device avatar up so the next device gets it.
    async function sync() {
      if (!profileLoaded) return;
      if (profileAvatar) {
        saveAvatar(profileAvatar);
        setAvatar(profileAvatar);
      } else if (avatarRef.current) {
        await saveAvatarToProfile(avatarRef.current);
      }
    }
    sync();
  }, [profileLoaded, profileAvatar, saveAvatarToProfile]);
  function commitAvatar(a: Avatar | null) {
    saveAvatar(a);
    setAvatar(a);
    setShowAvatar(false);
    account.saveAvatarToProfile(a);
  }
  const isFav = selected ? account.favorites.includes(selected.id) : false;
  function pickStation(id: string) {
    const st = STATION_BY_ID.get(id);
    if (!st) return;
    setSelected({ id: st.id, name: st.name });
    setExpanded(true);
    mapRef.current?.flyTo({ center: [st.lon, st.lat], zoom: Math.max(mapRef.current.getZoom(), 14) });
  }
  // The map instance as state, so JSX (the snake game) can use it.
  const [mapObj, setMapObj] = useState<import("maplibre-gl").Map | null>(null);
  // Stable identity: the game's effect depends on it, so it must not change per render.
  const closeSnake = useCallback(() => setShowSnake(false), []);

  // ---- Map setup (once) ----
  useEffect(() => {
    let cancelled = false;

    // Recolor the base map layers to the Viper Route palette.
    function applyPalette(map: import("maplibre-gl").Map) {
      const style = map.getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        const id = layer.id;
        const lid = id.toLowerCase();
        try {
          if (layer.type === "background") {
            map.setPaintProperty(id, "background-color", PALETTE.land);
          } else if (layer.type === "fill") {
            if (lid.includes("water")) {
              map.setPaintProperty(id, "fill-color", PALETTE.water);
            } else if (/park|wood|grass|forest|golf|pitch|garden|cemetery|landcover|farmland|scrub/.test(lid)) {
              map.setPaintProperty(id, "fill-color", PALETTE.green);
            } else if (lid.includes("building")) {
              map.setPaintProperty(id, "fill-color", PALETTE.building);
            } else if (lid.includes("residential")) {
              map.setPaintProperty(id, "fill-color", PALETTE.residential);
            }
          } else if (layer.type === "line") {
            const R = PALETTE.road;
            if (lid.includes("water")) map.setPaintProperty(id, "line-color", PALETTE.water);
            else if (lid.includes("dashline")) map.setPaintProperty(id, "line-color", R.railDash);
            else if (lid.startsWith("railway")) map.setPaintProperty(id, "line-color", R.rail);
            else if (lid.includes("casing")) map.setPaintProperty(id, "line-color", R.casing);
            else if (lid.includes("motorway_inner")) map.setPaintProperty(id, "line-color", R.motorway);
            else if (lid.includes("major_inner")) map.setPaintProperty(id, "line-color", R.major);
            else if (lid.includes("path")) map.setPaintProperty(id, "line-color", R.path);
            else if (lid.includes("pier")) map.setPaintProperty(id, "line-color", R.pier);
            else if (lid.startsWith("highway")) map.setPaintProperty(id, "line-color", R.minor);
          } else if (layer.type === "symbol") {
            const L = PALETTE.label;
            const color = lid.startsWith("highway") ? L.road : lid.includes("water") ? L.water : L.place;
            map.setPaintProperty(id, "text-color", color);
            map.setPaintProperty(id, "text-halo-color", L.halo);
          }
        } catch {
          // ignore layers that don't accept the property
        }
      }
    }

    function addStations(map: import("maplibre-gl").Map) {
      if (map.getSource("stations")) return;
      map.addSource("stations", { type: "geojson", data: STATION_FC });
      // Soft cyan halo under each station, then the crisp dot on top.
      map.addLayer({
        id: "station-glow",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 13, 9, 15, 14, 17, 20],
          "circle-color": UI.accent2,
          "circle-blur": 1,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.15, 14, 0.35],
        },
      });
      map.addLayer({
        id: "station-dots",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 13, 4, 15, 6, 17, 8],
          "circle-color": "#0b1220",
          "circle-stroke-color": UI.accent2,
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });
      map.on("mouseenter", "station-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "station-dots", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "station-dots", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.properties?.id as string;
        const name = (f.properties?.name as string) ?? "Station";
        if (id) {
          setSelected({ id, name });
          setExpanded(true);
        }
      });
    }

    function locateUser(maplibregl: typeof import("maplibre-gl"), map: import("maplibre-gl").Map) {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!cancelled) setStatus("fallback");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const lon = pos.coords.longitude;
          const lat = pos.coords.latitude;
          // On phones the arrivals sheet covers the bottom of the map, so
          // shift the vantage point up to keep "you" in the visible part.
          const bottom = isDesktop() ? 0 : Math.round(window.innerHeight * 0.4);
          map.flyTo({
            center: [lon, lat],
            zoom: 14,
            essential: true,
            padding: { top: 0, bottom, left: 0, right: 0 },
          });

          const el = document.createElement("div");
          paintUserMarker(el, avatarRef.current);
          el.title = "That's you — tap to change your avatar";
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            setShowAvatar(true);
          });
          markerRef.current?.remove();
          markerRef.current = new maplibregl.Marker({ element: el })
            .setLngLat([lon, lat])
            .addTo(map);
          setUserMarkerObj(markerRef.current);
          setStatus("located");

          // Auto-open the nearest station (unless the user already picked one).
          const near = nearestStation(lon, lat);
          setNearestId(near.id);
          setSelected((prev) => prev ?? { id: near.id, name: near.name });
          setExpanded(true);
        },
        () => {
          if (!cancelled) setStatus("fallback");
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    }

    function init() {
      const maplibregl = window.maplibregl;
      if (!maplibregl) {
        if (!cancelled) setTimeout(init, 100);
        return;
      }
      if (mapRef.current || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/dark",
        center: NYC_FALLBACK,
        zoom: 12,
      });
      mapRef.current = map;
      window.__vrMap = map;
      setMapObj(map);

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        "top-right"
      );
      map.on("load", () => {
        applyPalette(map);
        addStations(map);
        locateUser(maplibregl, map);
      });
    }

    // Belt and braces: keep the canvas in step with the container when a
    // desktop window is resized across the side-panel breakpoint.
    const onResize = () => mapRef.current?.resize();
    window.addEventListener("resize", onResize);

    init();
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- Fetch arrivals for the selected station, refresh every 30s ----
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;

    async function load(initial: boolean) {
      if (initial && !cancelled) setArrivals({ kind: "loading" });
      try {
        const res = await fetch(
          `/api/arrivals?station=${encodeURIComponent(selected!.id)}`
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as StationArrivals;
        if (!cancelled) setArrivals({ kind: "ok", data });
      } catch {
        if (!cancelled) setArrivals({ kind: "error" });
      }
    }

    load(true);
    const t = setInterval(() => load(false), 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selected]);

  // ---- Live train sprites: forward-only physics with per-train memory ----
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = window.maplibregl;
    if (!map || !maplibregl || !selected || !trainsOn) return;

    type TrainState = {
      marker: import("maplibre-gl").Marker;
      el: HTMLDivElement;
      color: string;
      motion: TrainMotion; // forward-only position + speed along the path
      opacity: number;
      dying: boolean;
      gen: number;
    };
    // Only the trains heading to the open station live here (a few numbers
    // each, in memory). Switching stations drops them.
    const states = new Map<string, TrainState>();
    let cancelled = false;
    let clockOffset = 0; // Date.now() - server updatedAt (clock-skew correction)
    let gen = 0;
    let lastFrame = performance.now();
    let pathsDirty = false;
    const FADE_IN = 0.5; // s
    const FADE_OUT = 1.2; // s
    const stationId = selected.id;
    const serverNow = () => Date.now() - clockOffset;
    const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

    function ensurePathLayer() {
      if (map!.getSource("train-paths")) return;
      try {
        map!.addSource("train-paths", { type: "geojson", data: EMPTY });
        map!.addLayer({
          id: "train-paths",
          type: "line",
          source: "train-paths",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 3,
            "line-opacity": 0.4,
            "line-dasharray": [1.5, 1.5],
          },
        });
      } catch {
        /* style not ready yet — retry on the next fetch */
      }
    }

    function updatePaths() {
      ensurePathLayer();
      const src = map!.getSource("train-paths") as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      if (!src) return;
      const fc: FeatureCollection = {
        type: "FeatureCollection",
        features: [...states.values()]
          .filter((s) => !s.dying)
          .map((s) => ({
            type: "Feature",
            properties: { color: s.color },
            geometry: {
              type: "LineString",
              coordinates: s.motion.track.wp.map((w) => [w.lon, w.lat]),
            },
          })),
      };
      src.setData(fc);
    }

    async function fetchTrains() {
      try {
        const res = await fetch(
          `/api/trains?station=${encodeURIComponent(stationId)}`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          updatedAt?: string;
          trains?: {
            tripId: string;
            route: string;
            fromStop: LL;
            toStop: LL;
            fraction: number;
            path: { lat: number; lon: number; etaSeconds: number }[];
          }[];
        };
        if (cancelled) return;

        // Anchor every waypoint to the server's clock, then correct for skew.
        const serverMs = Date.parse(data.updatedAt ?? "") || Date.now();
        clockOffset = Date.now() - serverMs;
        gen++;
        const now = serverNow();

        function spawn(tripId: string, route: string, track: Track) {
          const color = routeColor(route);
          const el = trainMarkerEl(route, color);
          el.style.opacity = "0";
          const motion = new TrainMotion(track, now);
          const p = motion.position;
          const marker = new maplibregl!.Marker({ element: el })
            .setLngLat([p.lon, p.lat])
            .addTo(map!);
          states.set(tripId, { marker, el, color, motion, opacity: 0, dying: false, gen });
        }

        for (const t of data.trains || []) {
          const p0 = lerp(t.fromStop, t.toStop, t.fraction ?? 0);
          const wp: Waypoint[] = [
            { lat: p0.lat, lon: p0.lon, t: serverMs },
            ...(t.path || []).map((p) => ({
              lat: p.lat,
              lon: p.lon,
              t: serverMs + p.etaSeconds * 1000,
            })),
          ];
          const track = new Track(wp);
          const s = states.get(t.tripId);
          if (!s) {
            spawn(t.tripId, t.route, track);
          } else if (s.motion.update(track, now) === "reroute") {
            // Trip shape changed under us: fade the old sprite, start a fresh one.
            s.dying = true;
            states.delete(t.tripId);
            states.set(`${t.tripId}#old${gen}`, s);
            spawn(t.tripId, t.route, track);
          } else {
            s.dying = false;
            s.gen = gen;
          }
        }
        // Trains no longer reported: fade them out rather than popping.
        for (const s of states.values()) if (s.gen !== gen) s.dying = true;
        updatePaths();
      } catch {
        /* transient feed/fetch error — try again on the next interval */
      }
    }

    function frame() {
      if (cancelled) return;
      const nowP = performance.now();
      const dt = Math.min(0.1, (nowP - lastFrame) / 1000);
      lastFrame = nowP;
      const now = serverNow();
      for (const [id, s] of states) {
        const p = s.motion.step(now, dt);
        aimTrain(s.el, s.motion.heading(), map!.getBearing(), s.motion.v > 1.5);
        // Reached the station and the ETA has passed → fade out.
        if (!s.dying && s.motion.atEnd && now > s.motion.track.last.t + 3000) s.dying = true;
        s.opacity = Math.max(
          0,
          Math.min(1, s.opacity + (s.dying ? -dt / FADE_OUT : dt / FADE_IN))
        );
        s.el.style.opacity = String(s.opacity);
        s.marker.setLngLat([p.lon, p.lat]);
        if (s.dying && s.opacity <= 0) {
          s.marker.remove();
          states.delete(id);
          pathsDirty = true;
        }
      }
      if (pathsDirty) {
        updatePaths();
        pathsDirty = false;
      }
      trainRaf.current = requestAnimationFrame(frame);
    }

    window.__vrTrainsRefetch = fetchTrains;
    // Debug/verification hook: current motion state of every sprite.
    window.__vrTrainsState = () =>
      [...states.entries()].map(([id, s]) => ({
        id, s: Math.round(s.motion.s), v: +s.motion.v.toFixed(2), pos: s.motion.position,
        target: Math.round(s.motion.track.sAtTime(serverNow())),
        len: Math.round(s.motion.track.length), opacity: +s.opacity.toFixed(2), dying: s.dying,
      }));
    ensurePathLayer();
    fetchTrains();
    const interval = setInterval(fetchTrains, 20000);
    trainRaf.current = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      delete window.__vrTrainsRefetch;
      delete window.__vrTrainsState;
      clearInterval(interval);
      if (trainRaf.current) cancelAnimationFrame(trainRaf.current);
      for (const s of states.values()) s.marker.remove();
      states.clear();
      try {
        if (map.getLayer("train-paths")) map.removeLayer("train-paths");
        if (map.getSource("train-paths")) map.removeSource("train-paths");
      } catch {
        /* map may already be torn down */
      }
    };
  }, [selected, trainsOn]);

  // ---- Draggable sheet: snap transform when expanded/selected changes ----
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; base: number; moved: boolean } | null>(null);

  const peekOffset = () => {
    const sh = sheetRef.current?.offsetHeight ?? 0;
    const hh = headerRef.current?.offsetHeight ?? 76;
    return Math.max(0, sh - hh);
  };

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || drag.current) return;
    sheet.style.transition = "transform 0.25s ease";
    sheet.style.transform = expanded ? "translateY(0)" : `translateY(${peekOffset()}px)`;
  }, [expanded, selected, arrivals]);

  function onPointerDown(e: React.PointerEvent) {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = "none";
    drag.current = { startY: e.clientY, base: expanded ? 0 : peekOffset(), moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const sheet = sheetRef.current;
    if (!drag.current || !sheet) return;
    const off = peekOffset();
    let ty = drag.current.base + (e.clientY - drag.current.startY);
    ty = Math.min(Math.max(ty, 0), off);
    if (Math.abs(e.clientY - drag.current.startY) > 4) drag.current.moved = true;
    sheet.style.transform = `translateY(${ty}px)`;
  }
  function onPointerUp() {
    const sheet = sheetRef.current;
    if (!sheet || !drag.current) return;
    const off = peekOffset();
    const cur = parseFloat(sheet.style.transform.replace(/[^0-9.]/g, "")) || 0;
    const moved = drag.current.moved;
    drag.current = null;
    if (!moved) setExpanded((v) => !v);
    else setExpanded(cur < off / 2);
  }

  const soonest = arrivals.kind === "ok" ? arrivals.data.arrivals[0] : null;
  const subtitle =
    selected && nearestId === selected.id ? "Nearest station · live" : "Live arrivals";
  const statusText =
    status === "locating"
      ? "Finding you…"
      : status === "located"
        ? "You are here"
        : "Showing Midtown — turn on location to center on you";

  return (
    <div className="relative h-screen w-screen overflow-hidden md:flex">
      {/* Desktop / tablet: static side panel (the phone sheet, docked) */}
      <aside
        data-vr-panel
        className="vr-glow-edge hidden text-vr-text md:flex md:h-full md:w-[380px] md:shrink-0 md:flex-col md:border-r md:border-vr-border md:bg-vr-panel"
      >
        <div className="flex items-center justify-between gap-3 border-b border-vr-border px-4 py-3">
          <Brand />
          <div className="flex items-center gap-2">
            <TrainsToggle on={trainsOn} onToggle={toggleTrains} where="panel" />
            <AvatarChip avatar={avatar} onClick={() => setShowAvatar(true)} where="panel" />
          </div>
        </div>
        {selected ? (
          <>
            <div className="px-4 pb-3 pt-4">
              <StationHeader name={selected.name} subtitle={subtitle} soonest={soonest} fav={isFav} onFav={account.session ? () => account.toggleFavorite(selected.id) : undefined} />
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <StationBody
                arrivals={arrivals}
                footer="Live from the MTA · refreshes every 30s · click any station on the map"
                onRace={() => setShowRace(true)}
              />
              <FavoritesRow ids={account.favorites} current={selected.id} onPick={pickStation} />
              <AccountLine account={account} onOpen={() => setShowAccount(true)} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-vr-muted">
            {statusText}
          </div>
        )}
      </aside>

      {/* Map + phone overlays */}
      <div className="relative h-full w-full min-w-0 md:flex-1">
        <div ref={containerRef} className="h-full w-full" />

        <div className={`absolute left-4 top-4 z-10 md:hidden ${showSnake ? "hidden" : ""}`}>
          <Brand floating />
        </div>
        <div className={`absolute left-4 top-[68px] z-10 flex items-center gap-2 md:hidden ${showSnake ? "hidden" : ""}`}>
          <TrainsToggle on={trainsOn} onToggle={toggleTrains} where="float" />
          <AvatarChip avatar={avatar} onClick={() => setShowAvatar(true)} where="float" />
        </div>

        {/* Little snake in the corner — tap to play on the streets */}
        {!showSnake && (
          <button
            onClick={() => mapObj && setShowSnake(true)}
            data-vr-snake-launch
            aria-label="Play Subway Snake"
            title="Play Subway Snake"
            className={`vr-snake-launch absolute right-3 z-10 rounded-xl bg-vr-panel/85 p-1.5 shadow-lg backdrop-blur hover:bg-vr-panel-2 ${
              selected ? "bottom-[calc(58vh+12px)] md:bottom-8" : "bottom-8"
            }`}
          >
            <SnakeSprite />
          </button>
        )}

        {!selected && !showSnake && (
          <div
            data-vr-status
            className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-vr-panel/85 px-4 py-2 text-center text-sm text-vr-text shadow-lg backdrop-blur md:hidden"
          >
            {statusText}
          </div>
        )}

        {selected && !showSnake && !showRace && (
          <div
            ref={sheetRef}
            data-vr-sheet
            data-vr-sheet-state={expanded ? "expanded" : "peek"}
            className="vr-glow-edge absolute inset-x-0 bottom-0 z-20 flex h-[58vh] flex-col rounded-t-2xl bg-vr-panel text-vr-text shadow-2xl md:hidden"
            style={{ willChange: "transform" }}
          >
            {/* Header (stays visible when peeked) + drag handle */}
            <div
              ref={headerRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="shrink-0 cursor-grab touch-none select-none px-4 pb-3 pt-2 active:cursor-grabbing"
            >
              <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-vr-panel-3" />
              <StationHeader name={selected.name} subtitle={subtitle} soonest={soonest} fav={isFav} onFav={account.session ? () => account.toggleFavorite(selected.id) : undefined} />
            </div>

            {/* Body (hidden below the fold when peeked) */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <StationBody
                arrivals={arrivals}
                footer="Live from the MTA · refreshes every 30s · drag down for the map"
                onRace={() => setShowRace(true)}
              />
              <FavoritesRow ids={account.favorites} current={selected.id} onPick={pickStation} />
              <AccountLine account={account} onOpen={() => setShowAccount(true)} />
            </div>
          </div>
        )}

        {showSnake && mapObj && (
          <SnakeGame map={mapObj} onClose={closeSnake} />
        )}
        {showRace && mapObj && selected && (
          <RaceGame
            map={mapObj}
            stationId={selected.id}
            stationName={selected.name}
            stationLoc={stationLoc(selected.id)}
            userMarker={userMarkerObj}
            onClose={closeRace}
          />
        )}
      </div>

      {showAccount && <AccountSheet account={account} onClose={() => setShowAccount(false)} />}
      {showAvatar && (
        <AvatarEditor
          initial={avatar}
          onSave={commitAvatar}
          onReset={() => commitAvatar(null)}
          onClose={() => setShowAvatar(false)}
        />
      )}
    </div>
  );
}

// Saved stations as tappable chips (signed-in only).
function FavoritesRow({ ids, current, onPick }: { ids: string[]; current: string; onPick: (id: string) => void }) {
  if (ids.length === 0) return null;
  return (
    <div data-vr-favorites className="mt-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-vr-muted">★ Favorites</h3>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const st = STATION_BY_ID.get(id);
          if (!st) return null;
          const active = id === current;
          return (
            <button
              key={id}
              onClick={() => onPick(id)}
              className={`rounded-full px-3 py-1 text-xs ${active ? "bg-emerald-500/20 text-emerald-300" : "bg-vr-panel-2 text-vr-text-2 hover:bg-vr-panel-3"}`}
            >
              {st.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One-line account status under the station panel.
function AccountLine({ account, onOpen }: { account: ReturnType<typeof useAccount>; onOpen: () => void }) {
  if (!account.enabled) return null;
  return (
    <p className="mt-2 text-center text-[11px] text-vr-dim">
      {account.session ? (
        <>
          Signed in{account.profile?.handle ? ` as @${account.profile.handle}` : ""} ·{" "}
          <button data-vr-account-open onClick={onOpen} className="text-vr-muted hover:text-vr-text">account</button>
        </>
      ) : (
        <button data-vr-account-open onClick={onOpen} className="text-emerald-300/80 hover:text-emerald-300">
          Sign in to sync your avatar &amp; favorites
        </button>
      )}
    </p>
  );
}

// 12×8 pixel-art snake for the corner launcher.
function SnakeSprite() {
  const P = [
    "....GGGG....",
    "...GGGGGG...",
    "..GGwGGGGG..",
    "..GGGGGGGGG.",
    "R.GGG..GGGG.",
    "RRGG....GGGG",
    ".GGG....GGGG",
    "GGG......GGG",
  ];
  const fill: Record<string, string> = { G: "#34d399", w: "#052e16", R: "#f43f5e" };
  const rects: React.ReactNode[] = [];
  P.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (fill[ch]) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill[ch]} />);
    })
  );
  return (
    <svg viewBox="0 0 12 8" width="36" height="24" shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}

// Small round button showing the current avatar (or the plain dot).
function AvatarChip({
  avatar,
  onClick,
  where,
}: {
  avatar: Avatar | null;
  onClick: () => void;
  where: "panel" | "float";
}) {
  return (
    <button
      onClick={onClick}
      data-vr-avatar-chip={where}
      title="Your avatar"
      aria-label="Edit your avatar"
      className="flex h-8 w-8 items-center justify-center rounded-full bg-vr-panel/85 shadow-lg backdrop-blur hover:bg-vr-panel-2"
    >
      {avatar ? (
        <span className="flex" dangerouslySetInnerHTML={{ __html: avatarSVG(avatar, 22) }} />
      ) : (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />
      )}
    </button>
  );
}

function Brand({ floating = false }: { floating?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 text-vr-text ${
        floating ? "rounded-full bg-vr-panel/85 px-3 py-2 shadow-lg backdrop-blur" : ""
      }`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-black text-black shadow-[0_0_12px_rgba(52,211,153,.55)]">
        VR
      </span>
      <span className="text-sm font-bold">Viper Route</span>
    </div>
  );
}

function TrainsToggle({
  on,
  onToggle,
  where,
}: {
  on: boolean;
  onToggle: () => void;
  where: "panel" | "float";
}) {
  return (
    <button
      onClick={onToggle}
      data-vr-trains-toggle={where}
      aria-pressed={on}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg backdrop-blur ${
        on ? "bg-vr-panel/85 text-emerald-300" : "bg-vr-panel/70 text-vr-muted"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          on ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-vr-dim"
        }`}
      />
      Live trains {on ? "on" : "off"}
    </button>
  );
}

function StationHeader({
  name,
  subtitle,
  soonest,
  fav,
  onFav,
}: {
  name: string;
  subtitle: string;
  soonest: Arrival | null;
  fav?: boolean;
  onFav?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {onFav && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onFav(); }}
            data-vr-fav
            aria-pressed={fav}
            aria-label={fav ? "Remove from favorites" : "Add to favorites"}
            className={`shrink-0 text-lg leading-none ${fav ? "text-amber-300 [text-shadow:0_0_8px_rgba(252,211,77,.6)]" : "text-vr-dim hover:text-vr-muted"}`}
          >
            {fav ? "★" : "☆"}
          </button>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold leading-tight">{name}</h2>
          <p className="text-xs text-vr-muted">{subtitle}</p>
        </div>
      </div>
      {soonest && (
        <div className="flex shrink-0 items-center gap-2">
          <Bullet route={soonest.route} size={24} />
          <span className="font-mono text-sm tabular-nums text-emerald-300 [text-shadow:0_0_10px_rgba(52,211,153,.45)]">
            {soonest.minutes <= 0 ? "Now" : `${soonest.minutes} min`}
          </span>
        </div>
      )}
    </div>
  );
}

function StationBody({
  arrivals,
  footer,
  onRace,
}: {
  arrivals: ArrivalsState;
  footer: string;
  onRace: () => void;
}) {
  const north = arrivals.kind === "ok" ? arrivals.data.arrivals.filter((a) => a.direction === "N") : [];
  const south = arrivals.kind === "ok" ? arrivals.data.arrivals.filter((a) => a.direction === "S") : [];
  return (
    <>
      {arrivals.kind === "loading" && (
        <p className="py-6 text-center text-sm text-vr-muted">Loading live arrivals…</p>
      )}
      {arrivals.kind === "error" && (
        <p className="py-6 text-center text-sm text-vr-muted">
          Couldn’t load arrivals right now. It’ll retry automatically.
        </p>
      )}
      {arrivals.kind === "ok" && arrivals.data.arrivals.length === 0 && (
        <p className="py-6 text-center text-sm text-vr-muted">
          No upcoming trains reported right now.
        </p>
      )}
      {arrivals.kind === "ok" && arrivals.data.arrivals.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <ArrivalColumn title="↑ Northbound" arrivals={north} />
          <ArrivalColumn title="↓ Southbound" arrivals={south} />
        </div>
      )}
      <button
        onClick={onRace}
        data-vr-race-open
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-vr-panel-2 py-2 text-sm font-semibold text-emerald-300 hover:bg-vr-panel-3"
      >
        🏁 Race the Train <span className="text-xs font-normal text-vr-muted">· you vs. the next stop</span>
      </button>
      <p className="mt-3 border-t border-vr-border pt-2 text-center text-[11px] text-vr-dim">
        {footer}
      </p>
    </>
  );
}

function ArrivalColumn({ title, arrivals }: { title: string; arrivals: Arrival[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vr-muted">{title}</h3>
      {arrivals.length === 0 ? (
        <p className="text-sm text-vr-dim">—</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {arrivals.map((a, i) => (
            <li key={i} className="flex items-center gap-2">
              <Bullet route={a.route} />
              <span className="font-mono text-sm tabular-nums text-vr-text">
                {a.minutes <= 0 ? "Now" : `${a.minutes} min`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
