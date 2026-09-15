// Fetches + decodes the LIVE MTA GTFS-realtime feeds (no API key, no Next.js
// server involved) and prints upcoming arrivals for a couple of busy
// stations, to sanity-check that stations.json ids (and any multi-stop_id
// complexes in station-stop-ids.json) actually match what the feeds serve.
//
// Usage: node scripts/test-arrivals.mjs

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

const TEST_STATION_IDS = ["127", "635"]; // Times Sq-42 St, 14 St-Union Sq

async function fetchAllEvents() {
  const start = Date.now();
  const perFeed = await Promise.all(
    FEED_PATHS.map(async (p) => {
      const feedStart = Date.now();
      const res = await fetch(FEED_BASE + p);
      if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
      const buffer = new Uint8Array(await res.arrayBuffer());
      const feed = transit_realtime.FeedMessage.decode(buffer);
      const events = [];
      for (const entity of feed.entity) {
        const tu = entity.tripUpdate;
        if (!tu?.stopTimeUpdate || !tu.trip?.routeId || !tu.trip?.tripId) continue;
        for (const stu of tu.stopTimeUpdate) {
          if (!stu.stopId) continue;
          const time = stu.arrival?.time ?? stu.departure?.time;
          if (time == null) continue;
          events.push({
            routeId: tu.trip.routeId,
            tripId: tu.trip.tripId,
            stopId: stu.stopId,
            time: typeof time === "number" ? time : Number(time),
          });
        }
      }
      return { path: p, ms: Date.now() - feedStart, count: events.length, events };
    })
  );
  const totalMs = Date.now() - start;
  return { totalMs, perFeed, events: perFeed.flatMap((f) => f.events) };
}

function arrivalsForStation(stationId, allEvents) {
  const station = STATIONS.find((s) => s.id === stationId);
  if (!station) throw new Error(`Unknown test station id ${stationId}`);

  const parentIds = STATION_STOP_IDS[stationId] ?? [stationId];
  const targetStopIds = new Set(parentIds.flatMap((id) => [`${id}N`, `${id}S`]));

  const nowSeconds = Date.now() / 1000;
  const seen = new Set();
  const arrivals = [];

  for (const event of allEvents) {
    if (!targetStopIds.has(event.stopId)) continue;
    if (event.time <= nowSeconds) continue;
    const key = `${event.tripId}:${event.stopId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    arrivals.push({
      route: event.routeId,
      direction: event.stopId.endsWith("N") ? "N" : "S",
      minutes: Math.round((event.time - nowSeconds) / 60),
      arrivalTimeIso: new Date(event.time * 1000).toISOString(),
    });
  }

  arrivals.sort((a, b) => a.minutes - b.minutes);
  return { station, parentIds, arrivals: arrivals.slice(0, 8) };
}

async function main() {
  console.log("Fetching + decoding all 8 live NYCT GTFS-realtime feeds...\n");
  const { totalMs, perFeed, events } = await fetchAllEvents();

  for (const f of perFeed) {
    console.log(`  ${f.path.padEnd(20)} ${String(f.ms).padStart(5)}ms  ${f.count} stop-time updates`);
  }
  console.log(`\nTotal fetch+decode latency (parallel): ${totalMs}ms, ${events.length} events total\n`);

  let allSane = true;

  for (const stationId of TEST_STATION_IDS) {
    const { station, parentIds, arrivals } = arrivalsForStation(stationId, events);
    console.log(`--- ${station.name} (id ${station.id}, GTFS stop_id(s): ${parentIds.join(", ")}) ---`);
    if (arrivals.length === 0) {
      console.log("  No upcoming arrivals found!");
      allSane = false;
    }
    for (const a of arrivals) {
      console.log(`  ${a.route.padEnd(3)} ${a.direction}  in ${String(a.minutes).padStart(2)} min  (${a.arrivalTimeIso})`);
    }
    console.log();
  }

  if (!allSane) {
    console.error("FAIL: at least one test station had no live arrivals.");
    process.exit(1);
  }
  console.log("OK: live arrivals printed for all test stations.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
