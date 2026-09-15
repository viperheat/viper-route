"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import stationsData from "@/data/stations.json";

// Fallback center: Midtown Manhattan. Coordinates are [longitude, latitude].
const NYC_FALLBACK: [number, number] = [-73.9857, 40.7484];

type Station = { id: string; name: string; lat: number; lon: number };
const STATIONS = stationsData as Station[];

// Build the station points once (GeoJSON the map can render as one layer).
const STATION_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: STATIONS.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { name: s.name },
  })),
};

// MapLibre is loaded from a CDN (see the <Script> in layout.tsx), so it lives
// on window. We pull its TYPES from the installed npm package for safety.
declare global {
  interface Window {
    maplibregl: typeof import("maplibre-gl");
    __vrMap?: import("maplibre-gl").Map;
  }
}

type LocStatus = "locating" | "located" | "fallback";

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const [status, setStatus] = useState<LocStatus>("locating");

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
          // Dots grow as you zoom in.
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10, 2,
            13, 4,
            15, 6,
            17, 8,
          ],
          "circle-color": "#ffffff",
          "circle-stroke-color": "#10b981", // emerald
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });

      // Pointer cursor over stations.
      map.on("mouseenter", "station-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "station-dots", () => {
        map.getCanvas().style.cursor = "";
      });

      // Click a station -> popup with its name.
      map.on("click", "station-dots", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const name = (f.properties?.name as string) ?? "Station";
        const geom = f.geometry;
        const coords =
          geom.type === "Point"
            ? (geom.coordinates as [number, number])
            : [e.lngLat.lng, e.lngLat.lat];
        new maplibregl.Popup({ offset: 12, closeButton: false })
          .setLngLat(coords as [number, number])
          .setHTML(
            `<div style="font:600 13px system-ui,sans-serif;color:#111">${name}</div>`
          )
          .addTo(map);
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

  return (
    <>
      <div ref={containerRef} className="h-screen w-screen" />
      <div
        data-vr-status
        className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-950/85 px-4 py-2 text-center text-sm text-neutral-100 shadow-lg backdrop-blur"
      >
        {status === "locating" && "Finding you…"}
        {status === "located" && "You are here"}
        {status === "fallback" &&
          "Showing Midtown — turn on location to center on you"}
      </div>
    </>
  );
}
