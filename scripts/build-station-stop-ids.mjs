// One-off/rerunnable builder: derives, per station, every GTFS parent stop_id
// that belongs to the same physical station complex, so arrivals for lines
// that don't share stations.json's primary id still get matched.
//
// Source of truth for complex grouping: MTA's official Stations.csv
// (Station ID, Complex ID, GTFS Stop ID). Cross-checked against the live
// GTFS-realtime feeds so we only keep stop_ids that are actually being
// referenced by current service.
//
// Usage: node scripts/build-station-stop-ids.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pkg from "gtfs-realtime-bindings";
const { transit_realtime } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const STATIONS_CSV_URL = "http://web.mta.info/developers/data/nyct/subway/Stations.csv";

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
const FEED_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/";

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split("\n");
  const headers = headerLine.split(",");
  return lines
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",");
      const row = {};
      headers.forEach((h, i) => (row[h] = cells[i]));
      return row;
    });
}

async function fetchLiveParentStopIds() {
  const parentIds = new Set();
  await Promise.all(
    FEED_PATHS.map(async (p) => {
      const res = await fetch(FEED_BASE + p);
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      const feed = transit_realtime.FeedMessage.decode(buf);
      for (const entity of feed.entity) {
        if (!entity.tripUpdate) continue;
        for (const stu of entity.tripUpdate.stopTimeUpdate) {
          if (!stu.stopId) continue;
          parentIds.add(stu.stopId.slice(0, -1)); // strip N/S direction suffix
        }
      }
    })
  );
  return parentIds;
}

async function main() {
  const stations = JSON.parse(readFileSync(path.join(ROOT, "src/data/stations.json"), "utf8"));

  console.log("Fetching official station/complex mapping...");
  const csvText = await (await fetch(STATIONS_CSV_URL)).text();
  const rows = parseCsv(csvText);

  const complexByStopId = new Map();
  const stopIdsByComplex = new Map();
  for (const row of rows) {
    const stopId = row["GTFS Stop ID"];
    const complexId = row["Complex ID"];
    if (!stopId || !complexId) continue;
    complexByStopId.set(stopId, complexId);
    if (!stopIdsByComplex.has(complexId)) stopIdsByComplex.set(complexId, []);
    stopIdsByComplex.get(complexId).push(stopId);
  }

  console.log("Fetching live GTFS-realtime feeds to verify stop_ids are actually in service...");
  const liveParentIds = await fetchLiveParentStopIds();
  console.log(`Live feeds reference ${liveParentIds.size} distinct parent stop_ids.`);

  const mapping = {};
  const notFoundInCsv = [];
  const droppedNotLive = [];

  for (const station of stations) {
    const complexId = complexByStopId.get(station.id);
    if (!complexId) {
      notFoundInCsv.push(station.id);
      continue;
    }
    const siblings = stopIdsByComplex.get(complexId) ?? [station.id];
    const verified = siblings.filter((id) => {
      const ok = liveParentIds.has(id);
      if (!ok) droppedNotLive.push(`${station.id} (${station.name}): sibling ${id} not seen live`);
      return ok;
    });
    // Always keep the station's own id even if it happened not to appear in
    // this particular poll (feed sampling can miss a quiet stop_id briefly).
    const ids = Array.from(new Set([station.id, ...verified])).sort();
    if (ids.length > 1) {
      mapping[station.id] = ids;
    }
  }

  const outPath = path.join(ROOT, "src/data/station-stop-ids.json");
  writeFileSync(outPath, JSON.stringify(mapping, null, 2) + "\n");

  console.log(`\nWrote ${Object.keys(mapping).length} multi-stop_id stations to ${path.relative(ROOT, outPath)}`);
  if (notFoundInCsv.length) {
    console.log(`\n${notFoundInCsv.length} stations.json ids not found in Stations.csv (left as single-id):`);
    console.log(notFoundInCsv.join(", "));
  }
  if (droppedNotLive.length) {
    console.log(`\n${droppedNotLive.length} CSV siblings dropped (not observed in this live feed poll):`);
    console.log(droppedNotLive.slice(0, 30).join("\n"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
