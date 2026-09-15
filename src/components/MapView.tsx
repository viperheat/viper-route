"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// Fallback center: Midtown Manhattan. Coordinates are [longitude, latitude].
const NYC_FALLBACK: [number, number] = [-73.9857, 40.7484];

// MapLibre is loaded from a CDN (see the <Script> in layout.tsx), so it lives
// on window. We pull its TYPES from the installed npm package for safety.
declare global {
  interface Window {
    maplibregl: typeof import("maplibre-gl");
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

          // "You are here" marker (pulsing dot, styled in globals.css).
          const el = document.createElement("div");
          el.className = "vr-user-dot";
          markerRef.current?.remove();
          markerRef.current = new maplibregl.Marker({ element: el })
            .setLngLat(here)
            .addTo(map);

          setStatus("located");
        },
        () => {
          // Denied, unavailable, or timed out — keep the Midtown fallback view.
          if (!cancelled) setStatus("fallback");
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    }

    function init() {
      const maplibregl = window.maplibregl;
      // The CDN script may not be ready yet on first paint — retry briefly.
      if (!maplibregl) {
        if (!cancelled) setTimeout(init, 100);
        return;
      }
      if (mapRef.current || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        // OpenFreeMap: free map tiles, no API key needed.
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: NYC_FALLBACK,
        zoom: 12,
      });
      mapRef.current = map;

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        "top-right"
      );

      map.on("load", () => locateUser(maplibregl, map));
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
