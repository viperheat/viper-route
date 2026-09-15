"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Center on Manhattan to start. [longitude, latitude]
const NYC_CENTER: [number, number] = [-73.9857, 40.7484];

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    // Guard: only create the map once, and only when the container exists.
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // OpenFreeMap: free map tiles, no API key needed.
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: NYC_CENTER,
      zoom: 12,
    });

    // Zoom + compass buttons in the corner.
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    // Blue dot "find me" button (we'll wire up real geolocation in M2).
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "top-right"
    );

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}
