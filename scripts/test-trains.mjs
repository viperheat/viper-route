// Fetches + decodes the LIVE MTA GTFS-realtime feeds (no API key, no Next.js
// server involved) and prints a few "ghost train" positions heading toward
// Times Sq-42 St, to sanity-check the fromStop/toStop/fraction inference in
// src/lib/trains.ts before it's exercised through the API route.
//
// Usage: node scripts/test-trains.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pkg from "gtfs-realtime-bindings";

const { transit_realtime } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const FEED_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/";
const FEED_PATHS = [
  "nyct%2Fgtfs",
  "nyct%2Fgtfs-ace",
  "nyct%2Fgtfs-bdfm",
  "nyct%2Fgtfs-g",
  "nyct%2Fgtfs-jz",
  "nyct%2Fgtfs-nqrw",
  "nyct%2Fgtfs-l",
  "nyct%2Fgtfs-si",
];

const STATIONS = JSON.parse(readFileSync(path.join(ROOT, "src/data/stations.json"), "utf8"));
const STATION_STOP_IDS = JSON.parse(
  readFileSync(path.join(ROOT, "src/data/station-stop-ids.json"), "utf8")
);

const TEST_STATION_ID = "127"; // Times Sq-42 St
const MAX_TRAINS = 6;
const FALLBACK_SEGMENT_SECONDS = 90;

function parentStopIdsFor(stationId) {
  return STATION_STOP_IDS[stationId] ?? [stationId];
}

function buildStopLocationIndex() {
  const index = new Map();
  for (const s of STATIONS) index.set(s.id, { id: s.id, name: s.name, lat: s.lat, lon: s.lon });
  for (const [primaryId, siblingIds] of Object.entries(STATION_STOP_IDS)) {
    const primary = index.get(primaryId);
    if (!primary) continue;
    for (const siblingId of siblingIds) {
      if (!index.has(siblingId)) index.set(siblingId, primary);
    }
  }
  return index;
}
const STOP_LOCATIONS = buildStopLocationIndex();

function parentIdOf(feedStopId) {
  return feedStopId.slice(0, -1);
}
function directionOf(feedStopId) {
  return feedStopId.endsWith("N") ? "N" : "S";
}
function resolveStop(feedStopId) {
  return feedStopId ? STOP_LOCATIONS.get(parentIdOf(feedStopId)) : undefined;
}

async function fetchAllDecoded() {
  const start = Date.now();
  const perFeed = await Promise.all(
    FEED_PATHS.map(async (p) => {
      const res = await fetch(FEED_BASE + p);
      if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
      const buffer = new Uint8Array(await res.arrayBuffer());
      const feed = transit_realtime.FeedMessage.decode(buffer);

      const trips = [];
      const vehicles = [];
      for (const entity of feed.entity) {
        const tu = entity.tripUpdate;
        if (tu?.stopTimeUpdate && tu.trip?.routeId && tu.trip?.tripId) {
          const stopTimeUpdates = [];
          for (const stu of tu.stopTimeUpdate) {
            if (!stu.stopId) continue;
            const time = stu.arrival?.time ?? stu.departure?.time;
            if (time == null) continue;
            stopTimeUpdates.push({ stopId: stu.stopId, time: Number(time) });
          }
          trips.push({ tripId: tu.trip.tripId, routeId: tu.trip.routeId, stopTimeUpdates });
        }
        const v = entity.vehicle;
        if (v?.trip?.tripId) {
          vehicles.push({
            tripId: v.trip.tripId,
            routeId: v.trip.routeId,
            stopId: v.stopId || undefined,
            currentStatus: v.currentStatus ?? 0,
            timestamp: v.timestamp != null ? Number(v.timestamp) : undefined,
          });
        }
      }
      return { path: p, trips, vehicles };
    })
  );
  console.log(`Fetched + decoded all 8 feeds in ${Date.now() - start}ms\n`);
  return {
    trips: perFeed.flatMap((f) => f.trips),
    vehicles: perFeed.flatMap((f) => f.vehicles),
  };
}

function buildPredecessorIndex(trips) {
  const votes = new Map();
  for (const trip of trips) {
    const stops = trip.stopTimeUpdates;
    for (let i = 0; i < stops.length - 1; i++) {
      const key = `${trip.routeId}:${stops[i + 1].stopId}`;
      const predecessor = stops[i].stopId;
      let counts = votes.get(key);
      if (!counts) votes.set(key, (counts = new Map()));
      counts.set(predecessor, (counts.get(predecessor) ?? 0) + 1);
    }
  }
  const winner = new Map();
  for (const [key, counts] of votes) {
    let bestId = "";
    let bestCount = -1;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        bestId = id;
        bestCount = count;
      }
    }
    winner.set(key, bestId);
  }
  return winner;
}

function estimateSegmentSeconds(trips, routeId, fromStopId, toStopId) {
  const samples = [];
  for (const trip of trips) {
    if (trip.routeId !== routeId) continue;
    const stops = trip.stopTimeUpdates;
    for (let i = 0; i < stops.length - 1; i++) {
      if (stops[i].stopId === fromStopId && stops[i + 1].stopId === toStopId) {
        const dur = stops[i + 1].time - stops[i].time;
        if (dur > 0) samples.push(dur);
      }
    }
  }
  if (samples.length === 0) return FALLBACK_SEGMENT_SECONDS;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function findTargetMatch(trip, targetStopIds, nowSeconds) {
  for (let i = 0; i < trip.stopTimeUpdates.length; i++) {
    const stu = trip.stopTimeUpdates[i];
    if (stu.time > nowSeconds && targetStopIds.has(stu.stopId)) {
      return { index: i, stopId: stu.stopId, time: stu.time };
    }
  }
  return undefined;
}

function buildPath(trip, fromIndex, throughIndex, nowSeconds) {
  const path = [];
  for (let i = fromIndex; i <= throughIndex; i++) {
    const stu = trip.stopTimeUpdates[i];
    const loc = resolveStop(stu.stopId);
    if (!loc) continue;
    path.push({ ...loc, etaSeconds: Math.round(stu.time - nowSeconds) });
  }
  return path;
}

function getStationTrains(stationId, trips, vehicles) {
  const station = STATIONS.find((s) => s.id === stationId);
  if (!station) throw new Error(`Unknown test station id ${stationId}`);

  const targetStopIds = new Set();
  for (const parentId of parentStopIdsFor(stationId)) {
    targetStopIds.add(`${parentId}N`);
    targetStopIds.add(`${parentId}S`);
  }

  const vehicleByTripId = new Map();
  for (const v of vehicles) vehicleByTripId.set(v.tripId, v);

  const predecessorIndex = buildPredecessorIndex(trips);
  const nowSeconds = Date.now() / 1000;
  const trains = [];

  for (const trip of trips) {
    const match = findTargetMatch(trip, targetStopIds, nowSeconds);
    if (!match) continue;

    const vehicle = vehicleByTripId.get(trip.tripId);
    if (!vehicle || trip.stopTimeUpdates.length === 0) continue;

    const first = trip.stopTimeUpdates[0];
    let toStopId, fromStopId, fraction, pathStartIndex;

    if (vehicle.currentStatus === 1 /* STOPPED_AT */) {
      toStopId = first.stopId;
      fromStopId = first.stopId;
      fraction = 0;
      pathStartIndex = 1;
    } else {
      toStopId = first.stopId;
      fromStopId = predecessorIndex.get(`${trip.routeId}:${toStopId}`);
      pathStartIndex = 0;
      if (!fromStopId) {
        fromStopId = toStopId;
        fraction = vehicle.currentStatus === 0 /* INCOMING_AT */ ? 1 : 0;
      } else {
        const segmentSeconds = estimateSegmentSeconds(trips, trip.routeId, fromStopId, toStopId);
        fraction = clamp01(1 - (first.time - nowSeconds) / segmentSeconds);
      }
    }

    const fromLoc = resolveStop(fromStopId);
    const toLoc = resolveStop(toStopId);
    if (!fromLoc || !toLoc) continue;

    trains.push({
      tripId: trip.tripId,
      route: trip.routeId,
      direction: directionOf(match.stopId),
      status: ["INCOMING_AT", "STOPPED_AT", "IN_TRANSIT_TO"][vehicle.currentStatus] ?? vehicle.currentStatus,
      fromStop: fromLoc,
      toStop: toLoc,
      fraction,
      etaToStationSeconds: Math.round(match.time - nowSeconds),
      path: buildPath(trip, pathStartIndex, match.index, nowSeconds),
    });
  }

  trains.sort((a, b) => a.etaToStationSeconds - b.etaToStationSeconds);
  return { station, trains: trains.slice(0, MAX_TRAINS) };
}

function isRealNycCoord(lat, lon) {
  return lat > 40.4 && lat < 41.0 && lon > -74.3 && lon < -73.6;
}

async function main() {
  const { trips, vehicles } = await fetchAllDecoded();
  console.log(`${trips.length} trip updates, ${vehicles.length} vehicle positions in this snapshot.\n`);

  const { station, trains } = getStationTrains(TEST_STATION_ID, trips, vehicles);
  console.log(`--- Ghost trains heading to ${station.name} (id ${station.id}) ---\n`);

  if (trains.length === 0) {
    console.error("FAIL: no trains found heading to the test station.");
    process.exit(1);
  }

  let allSane = true;

  for (const t of trains) {
    console.log(`${t.route} ${t.direction}  trip ${t.tripId}  status=${t.status}`);
    console.log(
      `  ${t.fromStop.name} (${t.fromStop.id}) -> ${t.toStop.name} (${t.toStop.id})  fraction=${t.fraction.toFixed(2)}`
    );
    console.log(`  eta to ${station.name}: ${t.etaToStationSeconds}s`);
    console.log(
      `  path: ${t.path.map((p) => `${p.name}(+${p.etaSeconds}s)`).join(" -> ")}`
    );

    if (t.fraction < 0 || t.fraction > 1) {
      console.error(`  FAIL: fraction ${t.fraction} out of [0,1] range`);
      allSane = false;
    }
    for (const loc of [t.fromStop, t.toStop, ...t.path]) {
      if (!isRealNycCoord(loc.lat, loc.lon)) {
        console.error(`  FAIL: implausible coordinate for ${loc.name}: ${loc.lat},${loc.lon}`);
        allSane = false;
      }
    }
    console.log();
  }

  if (!allSane) {
    console.error("FAIL: sanity checks did not all pass.");
    process.exit(1);
  }
  console.log("OK: fractions in [0,1] and coordinates look like real NYC locations.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
