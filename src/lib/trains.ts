import {
  STATIONS,
  STATION_STOP_IDS,
  findStation,
  parentStopIdsFor,
  UnknownStationError,
} from "@/lib/arrivals";
import {
  getAllDecodedFeeds,
  VehicleStopStatus,
  type TripData,
  type VehiclePositionData,
} from "@/lib/gtfsFeeds";

const MAX_TRAINS = 6;

// No static GTFS on this network (shapes.txt/stop_times.txt are blocked), and
// MTA's VehiclePosition never carries a lat/lon `position` (checked live).
// So a segment's travel time is estimated from OTHER currently-running trips
// on the same route that are currently predicting a time for that exact
// from -> to stop pair (their own TripUpdate gives us "how long this hop
// currently takes"). If literally nobody else is mid-hop on that pair right
// now, fall back to a flat average NYC subway inter-station time.
const FALLBACK_SEGMENT_SECONDS = 90;

export interface StopLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface PathStop extends StopLocation {
  etaSeconds: number;
}

export interface TrainPosition {
  tripId: string;
  route: string;
  direction: "N" | "S";
  fromStop: StopLocation;
  toStop: StopLocation;
  /** 0 = at fromStop/just left it, 1 = arriving at toStop. */
  fraction: number;
  etaToStationSeconds: number;
  path: PathStop[];
  /** The stop after the station (for Race the Train); absent if it terminates here. */
  nextStop?: PathStop;
}

export interface StationTrains {
  station: { id: string; name: string };
  updatedAt: string;
  trains: TrainPosition[];
}

/**
 * Maps every GTFS parent stop_id we know about (with the N/S suffix
 * stripped) to a display location. Includes every stations.json row, plus
 * every sibling id in station-stop-ids.json — a sibling has no row of its
 * own, so it's shown at its complex's primary station's coordinates (e.g.
 * R16, the N/Q/R/W platform at Times Sq, renders at the same point as 127).
 */
function buildStopLocationIndex(): Map<string, StopLocation> {
  const index = new Map<string, StopLocation>();
  for (const s of STATIONS) {
    index.set(s.id, { id: s.id, name: s.name, lat: s.lat, lon: s.lon });
  }
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

function parentIdOf(feedStopId: string): string {
  return feedStopId.slice(0, -1);
}

function directionOf(feedStopId: string): "N" | "S" {
  return feedStopId.endsWith("N") ? "N" : "S";
}

function resolveStop(feedStopId: string): StopLocation | undefined {
  return STOP_LOCATIONS.get(parentIdOf(feedStopId));
}

/**
 * For every route, the most commonly observed predecessor of each stop_id,
 * inferred purely from live TripUpdates: whenever two stop_ids appear back
 * to back in some trip's remaining-stop list, that's one vote that the
 * first immediately precedes the second for that route+direction. Building
 * this from the whole current snapshot (many overlapping trips) reconstructs
 * the route's real stop order without needing static GTFS.
 */
function buildPredecessorIndex(trips: TripData[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();

  for (const trip of trips) {
    const stops = trip.stopTimeUpdates;
    for (let i = 0; i < stops.length - 1; i++) {
      const key = `${trip.routeId}:${stops[i + 1].stopId}`;
      const predecessor = stops[i].stopId;
      let counts = votes.get(key);
      if (!counts) {
        counts = new Map();
        votes.set(key, counts);
      }
      counts.set(predecessor, (counts.get(predecessor) ?? 0) + 1);
    }
  }

  const winner = new Map<string, string>();
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

/**
 * Estimates how long the routeId hop fromStopId -> toStopId currently takes,
 * by looking at other trips on the same route whose own TripUpdate predicts
 * both stops back to back, and taking the median of (arrival[to] -
 * arrival[from]) across those trips.
 */
function estimateSegmentSeconds(
  trips: TripData[],
  routeId: string,
  fromStopId: string,
  toStopId: string
): number {
  const samples: number[] = [];
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

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** The first upcoming (time > now) stop_time_update matching one of targetStopIds. */
function findTargetMatch(
  trip: TripData,
  targetStopIds: Set<string>,
  nowSeconds: number
): { index: number; stopId: string; time: number } | undefined {
  for (let i = 0; i < trip.stopTimeUpdates.length; i++) {
    const stu = trip.stopTimeUpdates[i];
    if (stu.time > nowSeconds && targetStopIds.has(stu.stopId)) {
      return { index: i, stopId: stu.stopId, time: stu.time };
    }
  }
  return undefined;
}

function buildPath(trip: TripData, fromIndex: number, throughIndex: number, nowSeconds: number): PathStop[] {
  const path: PathStop[] = [];
  for (let i = fromIndex; i <= throughIndex; i++) {
    const stu = trip.stopTimeUpdates[i];
    const loc = resolveStop(stu.stopId);
    if (!loc) continue; // stop outside our curated station set; skip rather than emit bad coords
    path.push({ ...loc, etaSeconds: Math.round(stu.time - nowSeconds) });
  }
  return path;
}

export async function getStationTrains(stationId: string, pinTrip?: string): Promise<StationTrains> {
  const station = findStation(stationId);
  if (!station) {
    throw new UnknownStationError(stationId);
  }

  const targetStopIds = new Set<string>();
  for (const parentId of parentStopIdsFor(stationId)) {
    targetStopIds.add(`${parentId}N`);
    targetStopIds.add(`${parentId}S`);
  }

  const { trips, vehicles } = await getAllDecodedFeeds();
  const vehicleByTripId = new Map<string, VehiclePositionData>();
  for (const v of vehicles) vehicleByTripId.set(v.tripId, v);

  const predecessorIndex = buildPredecessorIndex(trips);
  const nowSeconds = Date.now() / 1000;

  const trains: TrainPosition[] = [];

  for (const trip of trips) {
    const match = findTargetMatch(trip, targetStopIds, nowSeconds);
    if (!match) continue;

    const vehicle = vehicleByTripId.get(trip.tripId);
    if (!vehicle || trip.stopTimeUpdates.length === 0) continue; // no position data to animate from

    const first = trip.stopTimeUpdates[0];
    let toStopId: string;
    let fromStopId: string | undefined;
    let fraction: number;
    let pathStartIndex: number;

    if (vehicle.currentStatus === VehicleStopStatus.STOPPED_AT) {
      // Feed keeps the current platform as a stale (past-time) index 0 entry
      // until the train departs, so `first` IS where it's sitting right now.
      toStopId = first.stopId;
      fromStopId = first.stopId;
      fraction = 0;
      pathStartIndex = 1;
    } else {
      // INCOMING_AT / IN_TRANSIT_TO: index 0 is always the stop being
      // approached (confirmed live: equals vehicle.stopId in both cases).
      toStopId = first.stopId;
      fromStopId = predecessorIndex.get(`${trip.routeId}:${toStopId}`);
      pathStartIndex = 0;

      if (!fromStopId) {
        // Terminus departure with no other trip currently voting on a
        // predecessor for this stop; nothing to interpolate from.
        fromStopId = toStopId;
        fraction = vehicle.currentStatus === VehicleStopStatus.INCOMING_AT ? 1 : 0;
      } else {
        const segmentSeconds = estimateSegmentSeconds(trips, trip.routeId, fromStopId, toStopId);
        fraction = clamp01(1 - (first.time - nowSeconds) / segmentSeconds);
      }
    }

    const fromLoc = resolveStop(fromStopId);
    const toLoc = resolveStop(toStopId);
    if (!fromLoc || !toLoc) continue; // outside our curated station set

    const path = buildPath(trip, pathStartIndex, match.index, nowSeconds);

    // One stop past the station, if the trip continues.
    let nextStop: PathStop | undefined;
    const after = trip.stopTimeUpdates[match.index + 1];
    if (after) {
      const loc = resolveStop(after.stopId);
      if (loc) nextStop = { ...loc, etaSeconds: Math.round(after.time - nowSeconds) };
    }

    trains.push({
      tripId: trip.tripId,
      route: trip.routeId,
      direction: directionOf(match.stopId),
      fromStop: fromLoc,
      toStop: toLoc,
      fraction,
      etaToStationSeconds: Math.round(match.time - nowSeconds),
      path,
      nextStop,
    });
  }

  trains.sort((a, b) => a.etaToStationSeconds - b.etaToStationSeconds);
  const top = trains.slice(0, MAX_TRAINS);
  if (pinTrip && !top.some((t) => t.tripId === pinTrip)) {
    const pinned = trains.find((t) => t.tripId === pinTrip);
    if (pinned) top.push(pinned);
  }

  return {
    station: { id: station.id, name: station.name },
    updatedAt: new Date().toISOString(),
    trains: top,
  };
}
