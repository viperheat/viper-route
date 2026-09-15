"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import stationsData from "@/data/stations.json";

// Fallback center: Midtown Manhattan. Coordinates are [longitude, latitude].
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

// ---- Arrivals API types (matches /api/arrivals) ----
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

// ---- MTA line colors for the route "bullets" ----
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
// Yellow lines read better with black text.
const DARK_TEXT = new Set(["N", "Q", "R", "W"]);

function baseRoute(route: string): string {
  // "7X" express -> "7"; keep letters as-is.
  return route.replace(/X$/, "");
}
function routeColor(route: string): string {
  return ROUTE_COLORS[baseRoute(route)] ?? "#4b5563";
}

function Bullet({ route }: { route: string }) {
  const label = baseRoute(route);
  const bg = routeColor(route);
  const color = DARK_TEXT.has(label) ? "#000" : "#fff";
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
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

  // ---- Map setup (runs once) ----
  useEffect(() => {
    let cancelled = false;

    function addStations(
      maplibregl: typeof import("maplibre-gl"),
      map: import("maplibre-gl").Map
    ) {
      if (map.getSource("stations")) return;
      map.addSource("stations", { type: "geojson", data: STATION_FC });
      map.addLayer({
        id: "station-dots",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            10, 2, 13, 4, 15, 6, 17, 8,
          ],
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
        if (id) setSelected({ id, name });
      });
    }

    function locateUser(
      maplibregl: typeof import("maplibre-gl"),
      map: import("maplibre-gl").Map
    ) {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!cancelled) setStatus("fallback");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const here: [number, number] = [
            pos.coords.longitude,
            pos.coords.latitude,
          ];
          map.flyTo({ center: here, zoom: 14, essential: true });
          const el = document.createElement("div");
          el.className = "vr-user-dot";
          markerRef.current?.remove();
          markerRef.current = new maplibregl.Marker({ element: el })
            .setLngLat(here)
            .addTo(map);
          setStatus("located");
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
        style: "https://tiles.openfreemap.org/styles/liberty",
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
        addStations(maplibregl, map);
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

  const north =
    arrivals.kind === "ok"
      ? arrivals.data.arrivals.filter((a) => a.direction === "N")
      : [];
  const south =
    arrivals.kind === "ok"
      ? arrivals.data.arrivals.filter((a) => a.direction === "S")
      : [];

  return (
    <>
      <div ref={containerRef} className="h-screen w-screen" />

      {/* Locating status pill (hidden when a station sheet is open) */}
      {!selected && (
        <div
          data-vr-status
          className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-950/85 px-4 py-2 text-center text-sm text-neutral-100 shadow-lg backdrop-blur"
        >
          {status === "locating" && "Finding you…"}
          {status === "located" && "You are here"}
          {status === "fallback" &&
            "Showing Midtown — turn on location to center on you"}
        </div>
      )}

      {/* Arrivals bottom sheet */}
      {selected && (
        <div
          data-vr-sheet
          className="absolute inset-x-0 bottom-0 z-20 max-h-[55vh] overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 text-neutral-100 shadow-2xl"
        >
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold leading-tight">{selected.name}</h2>
              <p className="text-xs text-neutral-400">Live arrivals</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="rounded-full px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              ✕
            </button>
          </div>

          {arrivals.kind === "loading" && (
            <p className="py-6 text-center text-sm text-neutral-400">
              Loading live arrivals…
            </p>
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
            Live from the MTA · refreshes every 30s
          </p>
        </div>
      )}
    </>
  );
}

function ArrivalColumn({
  title,
  arrivals,
}: {
  title: string;
  arrivals: Arrival[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </h3>
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
