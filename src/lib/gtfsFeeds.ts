import pkg from "gtfs-realtime-bindings";

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

interface CacheEntry {
  expiresAt: number;
  promise: Promise<StopTimeEvent[]>;
}

const feedCache = new Map<string, CacheEntry>();

function decodeFeed(buffer: Uint8Array): StopTimeEvent[] {
  const feed = transit_realtime.FeedMessage.decode(buffer);
  const events: StopTimeEvent[] = [];

  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate?.stopTimeUpdate) continue;

    const routeId = tripUpdate.trip?.routeId;
    const tripId = tripUpdate.trip?.tripId;
    if (!routeId || !tripId) continue;

    for (const stu of tripUpdate.stopTimeUpdate) {
      if (!stu.stopId) continue;
      const time = stu.arrival?.time ?? stu.departure?.time;
      if (time == null) continue;

      events.push({
        routeId,
        tripId,
        stopId: stu.stopId,
        time: typeof time === "number" ? time : Number(time),
      });
    }
  }

  return events;
}

async function fetchFeed(feedPath: string): Promise<StopTimeEvent[]> {
  const res = await fetch(FEED_BASE + feedPath);
  if (!res.ok) {
    throw new Error(`MTA feed ${feedPath} responded ${res.status}`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  return decodeFeed(buffer);
}

function getCachedFeed(feedPath: string): Promise<StopTimeEvent[]> {
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
 * Fetches (or reuses cached) stop-time events across all 8 subway feeds.
 * A single feed failing does not fail the rest.
 */
export async function getAllStopTimeEvents(): Promise<StopTimeEvent[]> {
  const results = await Promise.allSettled(FEED_PATHS.map(getCachedFeed));

  const events: StopTimeEvent[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      events.push(...result.value);
    } else {
      console.error("gtfsFeeds: feed fetch failed", result.reason);
    }
  }
  return events;
}
