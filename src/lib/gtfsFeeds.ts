import pkg from "gtfs-realtime-bindings";
import type Long from "long";

const { transit_realtime } = pkg;

const FEED_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/";

// All 8 NYCT subway GTFS-realtime feeds. No API key required.
const FEED_PATHS = [
  "nyct%2Fgtfs", // 1-7, S
  "nyct%2Fgtfs-ace",
  "nyct%2Fgtfs-bdfm",
  "nyct%2Fgtfs-g",
  "nyct%2Fgtfs-jz",
  "nyct%2Fgtfs-nqrw",
  "nyct%2Fgtfs-l",
  "nyct%2Fgtfs-si",
] as const;

// How long a decoded feed is reused before being re-fetched. Keeps us well
// under any reasonable rate limit while staying close to real-time.
const FEED_TTL_MS = 20_000;

export interface StopTimeEvent {
  routeId: string;
  tripId: string;
  stopId: string;
  /** Unix seconds. */
  time: number;
}

/** One entry of a trip's TripUpdate.stop_time_update, in feed order (unfiltered). */
export interface TripStopTimeUpdate {
  stopId: string;
  /** Unix seconds; arrival, falling back to departure. */
  time: number;
}

export interface TripData {
  tripId: string;
  routeId: string;
  /** Feed order: for a STOPPED_AT vehicle, index 0 is the stop it's AT (time in the past). */
  stopTimeUpdates: TripStopTimeUpdate[];
}

/** Mirrors transit_realtime.VehiclePosition.VehicleStopStatus. */
export enum VehicleStopStatus {
  INCOMING_AT = 0,
  STOPPED_AT = 1,
  IN_TRANSIT_TO = 2,
}

export interface VehiclePositionData {
  tripId: string;
  routeId?: string;
  /** The stop this reading is anchored to; see VehicleStopStatus for how. */
  stopId?: string;
  currentStatus: VehicleStopStatus;
  /** Unix seconds. */
  timestamp?: number;
}

export interface DecodedFeed {
  trips: TripData[];
  vehicles: VehiclePositionData[];
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<DecodedFeed>;
}

const feedCache = new Map<string, CacheEntry>();

function toNumber(value: number | Long | null | undefined): number | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? value : Number(value);
}

function decodeFeed(buffer: Uint8Array): DecodedFeed {
  const feed = transit_realtime.FeedMessage.decode(buffer);
  const trips: TripData[] = [];
  const vehicles: VehiclePositionData[] = [];

  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    if (tripUpdate?.stopTimeUpdate) {
      const routeId = tripUpdate.trip?.routeId;
      const tripId = tripUpdate.trip?.tripId;
      if (routeId && tripId) {
        const stopTimeUpdates: TripStopTimeUpdate[] = [];
        for (const stu of tripUpdate.stopTimeUpdate) {
          if (!stu.stopId) continue;
          const time = toNumber(stu.arrival?.time ?? stu.departure?.time);
          if (time == null) continue;
          stopTimeUpdates.push({ stopId: stu.stopId, time });
        }
        trips.push({ tripId, routeId, stopTimeUpdates });
      }
    }

    const vehicle = entity.vehicle;
    const vTripId = vehicle?.trip?.tripId;
    if (vehicle && vTripId) {
      vehicles.push({
        tripId: vTripId,
        routeId: vehicle.trip?.routeId ?? undefined,
        stopId: vehicle.stopId ?? undefined,
        currentStatus: (vehicle.currentStatus ?? 0) as VehicleStopStatus,
        timestamp: toNumber(vehicle.timestamp),
      });
    }
  }

  return { trips, vehicles };
}

async function fetchFeed(feedPath: string): Promise<DecodedFeed> {
  const res = await fetch(FEED_BASE + feedPath);
  if (!res.ok) {
    throw new Error(`MTA feed ${feedPath} responded ${res.status}`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  return decodeFeed(buffer);
}

function getCachedFeed(feedPath: string): Promise<DecodedFeed> {
  const now = Date.now();
  const cached = feedCache.get(feedPath);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = fetchFeed(feedPath).catch((err) => {
    // Don't let a failed fetch poison the cache for the next request.
    feedCache.delete(feedPath);
    throw err;
  });

  feedCache.set(feedPath, { expiresAt: now + FEED_TTL_MS, promise });
  return promise;
}

/**
 * Fetches (or reuses cached) decoded feeds across all 8 subway feeds,
 * combined into one set of trips and one set of vehicle positions.
 * A single feed failing does not fail the rest.
 */
export async function getAllDecodedFeeds(): Promise<DecodedFeed> {
  const results = await Promise.allSettled(FEED_PATHS.map(getCachedFeed));

  const trips: TripData[] = [];
  const vehicles: VehiclePositionData[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      trips.push(...result.value.trips);
      vehicles.push(...result.value.vehicles);
    } else {
      console.error("gtfsFeeds: feed fetch failed", result.reason);
    }
  }
  return { trips, vehicles };
}

/**
 * Fetches (or reuses cached) stop-time events across all 8 subway feeds.
 * A single feed failing does not fail the rest.
 */
export async function getAllStopTimeEvents(): Promise<StopTimeEvent[]> {
  const { trips } = await getAllDecodedFeeds();
  const events: StopTimeEvent[] = [];
  for (const trip of trips) {
    for (const stu of trip.stopTimeUpdates) {
      events.push({ routeId: trip.routeId, tripId: trip.tripId, stopId: stu.stopId, time: stu.time });
    }
  }
  return events;
}
