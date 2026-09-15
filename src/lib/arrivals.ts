import stationsData from "@/data/stations.json";
import stationStopIdsData from "@/data/station-stop-ids.json";
import { getAllStopTimeEvents } from "@/lib/gtfsFeeds";

type Station = { id: string; name: string; lat: number; lon: number };

const STATIONS = stationsData as Station[];
// Complexes where more than one GTFS parent stop_id serves the same named
// station (e.g. Times Sq-42 St spans 127, R16, 725, 902). See
// scripts/build-station-stop-ids.mjs for how this is derived/verified.
const STATION_STOP_IDS = stationStopIdsData as Record<string, string[]>;

const MAX_ARRIVALS = 8;

export interface Arrival {
  route: string;
  direction: "N" | "S";
  minutes: number;
  arrivalTimeIso: string;
}

export interface StationArrivals {
  station: { id: string; name: string };
  updatedAt: string;
  arrivals: Arrival[];
}

export class UnknownStationError extends Error {
  constructor(stationId: string) {
    super(`Unknown station id: ${stationId}`);
    this.name = "UnknownStationError";
  }
}

function findStation(stationId: string): Station | undefined {
  return STATIONS.find((s) => s.id === stationId);
}

function parentStopIdsFor(stationId: string): string[] {
  return STATION_STOP_IDS[stationId] ?? [stationId];
}

export async function getStationArrivals(stationId: string): Promise<StationArrivals> {
  const station = findStation(stationId);
  if (!station) {
    throw new UnknownStationError(stationId);
  }

  const targetStopIds = new Set<string>();
  for (const parentId of parentStopIdsFor(stationId)) {
    targetStopIds.add(`${parentId}N`);
    targetStopIds.add(`${parentId}S`);
  }

  const events = await getAllStopTimeEvents();
  const nowSeconds = Date.now() / 1000;

  const seen = new Set<string>();
  const arrivals: Arrival[] = [];

  for (const event of events) {
    if (!targetStopIds.has(event.stopId)) continue;
    if (event.time <= nowSeconds) continue;

    const dedupeKey = `${event.tripId}:${event.stopId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const direction = event.stopId.endsWith("N") ? "N" : "S";
    arrivals.push({
      route: event.routeId,
      direction,
      minutes: Math.round((event.time - nowSeconds) / 60),
      arrivalTimeIso: new Date(event.time * 1000).toISOString(),
    });
  }

  arrivals.sort((a, b) => a.minutes - b.minutes);

  return {
    station: { id: station.id, name: station.name },
    updatedAt: new Date().toISOString(),
    arrivals: arrivals.slice(0, MAX_ARRIVALS),
  };
}
