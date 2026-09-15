"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// Manhattan. Coordinates are [longitude, latitude].
const NYC_CENTER: [number, number] = [-73.9857, 40.7484];

// MapLibre is loaded from a CDN (see the <Script> in layout.tsx), so it lives
// on window. We pull its TYPES from the installed npm package for safety.
declare global {
  interface Window {
    maplibregl: typeof import("maplibre-gl");
  }
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);

  useEffect(() => {
    let cancelled = false;

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
        center: NYC_CENTER,
        zoom: 12,
      });

      // Zoom + compass buttons.
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      // "Find me" button (full geolocation wiring comes in M2).
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        "top-right"
      );

      mapRef.current = map;
    }

    init();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-screen w-screen" />;
}
