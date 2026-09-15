"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import stationsData from "@/data/stations.json";

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

type ArrivalsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ok"; data: StationArrivals };

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const [status, setStatus] = useState<"locating" | "located" | "fallback">(
    "locating"
  );
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(
    null
  );
  const [arrivals, setArrivals] = useState<ArrivalsState>({ kind: "loading" });
  const [expanded, setExpanded] = useState(true);

  // ---- Map setup (once) ----
  useEffect(() => {
    let cancelled = false;

    function addStations(map: import("maplibre-gl").Map) {
      if (map.getSource("stations")) return;
      map.addSource("stations", { type: "geojson", data: STATION_FC });
      map.addLayer({
        id: "station-dots",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 13, 4, 15, 6, 17, 8],
          "circle-color": "#ffffff",
          "circle-stroke-color": "#10b981",
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
          map.flyTo({ center: [lon, lat], zoom: 14, essential: true });

          const el = document.createElement("div");
          el.className = "vr-user-dot";
          markerRef.current?.remove();
          markerRef.current = new maplibregl.Marker({ element: el })
            .setLngLat([lon, lat])
            .addTo(map);
          setStatus("located");

          // Auto-open the nearest station (unless the user already picked one).
          const near = nearestStation(lon, lat);
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

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        "top-right"
      );
      map.on("load", () => {
        addStations(map);
        locateUser(maplibregl, map);
      });
    }

    init();
    return () => {
      cancelled = true;
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

  const north = arrivals.kind === "ok" ? arrivals.data.arrivals.filter((a) => a.direction === "N") : [];
  const south = arrivals.kind === "ok" ? arrivals.data.arrivals.filter((a) => a.direction === "S") : [];
  const soonest = arrivals.kind === "ok" ? arrivals.data.arrivals[0] : null;

  return (
    <>
      <div ref={containerRef} className="h-screen w-screen" />

      {!selected && (
        <div
          data-vr-status
          className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-950/85 px-4 py-2 text-center text-sm text-neutral-100 shadow-lg backdrop-blur"
        >
          {status === "locating" && "Finding you…"}
          {status === "located" && "You are here"}
          {status === "fallback" && "Showing Midtown — turn on location to center on you"}
        </div>
      )}

      {selected && (
        <div
          ref={sheetRef}
          data-vr-sheet
          data-vr-sheet-state={expanded ? "expanded" : "peek"}
          className="absolute inset-x-0 bottom-0 z-20 flex h-[58vh] flex-col rounded-t-2xl bg-neutral-900 text-neutral-100 shadow-2xl"
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
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-neutral-700" />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold leading-tight">{selected.name}</h2>
                <p className="text-xs text-neutral-400">Nearest station · live</p>
              </div>
              {soonest && (
                <div className="flex shrink-0 items-center gap-2">
                  <Bullet route={soonest.route} size={24} />
                  <span className="text-sm text-neutral-200">
                    {soonest.minutes <= 0 ? "Now" : `${soonest.minutes} min`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Body (hidden below the fold when peeked) */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {arrivals.kind === "loading" && (
              <p className="py-6 text-center text-sm text-neutral-400">Loading live arrivals…</p>
            )}
            {arrivals.kind === "error" && (
              <p className="py-6 text-center text-sm text-neutral-400">
                Couldn’t load arrivals right now. It’ll retry automatically.
              </p>
            )}
            {arrivals.kind === "ok" && arrivals.data.arrivals.length === 0 && (
              <p className="py-6 text-center text-sm text-neutral-400">
                No upcoming trains reported right now.
              </p>
            )}
            {arrivals.kind === "ok" && arrivals.data.arrivals.length > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <ArrivalColumn title="↑ Northbound" arrivals={north} />
                <ArrivalColumn title="↓ Southbound" arrivals={south} />
              </div>
            )}
            <p className="mt-3 border-t border-neutral-800 pt-2 text-center text-[11px] text-neutral-500">
              Live from the MTA · refreshes every 30s · drag down for the map
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function ArrivalColumn({ title, arrivals }: { title: string; arrivals: Arrival[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
      {arrivals.length === 0 ? (
        <p className="text-sm text-neutral-600">—</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {arrivals.map((a, i) => (
            <li key={i} className="flex items-center gap-2">
              <Bullet route={a.route} />
              <span className="text-sm text-neutral-200">
                {a.minutes <= 0 ? "Now" : `${a.minutes} min`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
