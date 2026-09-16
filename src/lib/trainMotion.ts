/**
 * Train sprite motion model (M14).
 *
 * The MTA feed gives a noisy new guess of where each train is every refresh.
 * Real trains never move backwards along their route, so a sprite's position
 * is never *set* by the feed after it first appears — the feed only changes
 * its speed: behind the estimate → speed up (capped); ahead → hold and let
 * reality catch up. Position is one number: metres along the train's path.
 */

export type LL = { lat: number; lon: number };
export type Waypoint = LL & { t: number }; // t = absolute ms (server clock)

const M_PER_DEG_LAT = 111320;
const FALLBACK_SPEED = 12; // m/s ≈ 27 mph, typical between stops
const MAX_SPEED = 32; // m/s — hard cap so catch-up never looks like teleporting
const CATCH_UP_SECONDS = 6; // close a gap over about this long
const HOLD_TOLERANCE_M = 4; // ahead by more than this → stop and wait
const SPEED_SMOOTHING = 0.8; // s — how quickly speed changes ease in
const REROUTE_OFF_M = 300; // drawn position this far off the new path → new trip shape

export function metersBetween(a: LL, b: LL): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * M_PER_DEG_LAT, (b.lon - a.lon) * M_PER_DEG_LAT * k);
}

/** A timed polyline: the train's remaining path with the feed's ETAs. */
export class Track {
  readonly wp: Waypoint[];
  readonly cum: number[]; // cumulative metres at each waypoint
  readonly length: number;

  constructor(wp: Waypoint[]) {
    this.wp = wp.length ? wp : [{ lat: 0, lon: 0, t: 0 }];
    this.cum = [0];
    for (let i = 1; i < this.wp.length; i++) {
      this.cum.push(this.cum[i - 1] + metersBetween(this.wp[i - 1], this.wp[i]));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  get last(): Waypoint {
    return this.wp[this.wp.length - 1];
  }

  /** Lat/lon at `s` metres along the path. */
  pointAt(s: number): LL {
    const wp = this.wp;
    if (wp.length === 1 || s <= 0) return { lat: wp[0].lat, lon: wp[0].lon };
    if (s >= this.length) return { lat: this.last.lat, lon: this.last.lon };
    let i = 0;
    while (i < wp.length - 2 && s > this.cum[i + 1]) i++;
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const f = (s - this.cum[i]) / seg;
    return {
      lat: wp[i].lat + (wp[i + 1].lat - wp[i].lat) * f,
      lon: wp[i].lon + (wp[i + 1].lon - wp[i].lon) * f,
    };
  }

  /** Where the feed's timetable says the train is at time `t` (metres). */
  sAtTime(t: number): number {
    const wp = this.wp;
    if (wp.length === 1 || t <= wp[0].t) return 0;
    for (let i = 0; i < wp.length - 1; i++) {
      if (t <= wp[i + 1].t) {
        const span = wp[i + 1].t - wp[i].t;
        if (span <= 0) return this.cum[i + 1];
        const f = (t - wp[i].t) / span;
        return this.cum[i] + (this.cum[i + 1] - this.cum[i]) * f;
      }
    }
    return this.length;
  }

  /** Timetable speed (m/s) of the segment containing `s`. */
  speedAt(s: number): number {
    const wp = this.wp;
    if (wp.length === 1) return 0;
    let i = 0;
    while (i < wp.length - 2 && s >= this.cum[i + 1]) i++;
    const dist = this.cum[i + 1] - this.cum[i];
    const secs = (wp[i + 1].t - wp[i].t) / 1000;
    if (!(dist > 0) || !(secs > 0)) return FALLBACK_SPEED;
    return Math.min(MAX_SPEED, dist / secs);
  }

  /** Nearest point on the path to `p`: distance along it, and how far off it is. */
  project(p: LL): { s: number; off: number } {
    const wp = this.wp;
    if (wp.length === 1) return { s: 0, off: metersBetween(p, wp[0]) };
    let best = { s: 0, off: Infinity };
    for (let i = 0; i < wp.length - 1; i++) {
      const a = wp[i], b = wp[i + 1];
      const k = Math.cos((a.lat * Math.PI) / 180);
      const ax = 0, ay = 0;
      const bx = (b.lon - a.lon) * k, by = b.lat - a.lat;
      const px = (p.lon - a.lon) * k, py = p.lat - a.lat;
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const f = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
      const q = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
      const off = metersBetween(p, q);
      if (off < best.off) best = { s: this.cum[i] + (this.cum[i + 1] - this.cum[i]) * f, off };
    }
    return best;
  }
}

export class TrainMotion {
  track: Track;
  s: number; // metres along track — only ever increases
  v = 0; // m/s

  constructor(track: Track, now: number) {
    this.track = track;
    // First sighting: trust the feed's estimate (may be a little off; fine).
    this.s = track.sAtTime(now);
  }

  get position(): LL {
    return this.track.pointAt(this.s);
  }

  /**
   * Feed refresh. Keep the drawn position, adopt the new path, and never move
   * backwards. Returns "reroute" if the new path doesn't pass near where the
   * sprite is (trip reassigned) — the caller should fade it out and respawn.
   */
  update(track: Track, now: number): "ok" | "reroute" {
    const pos = this.position;
    const { s, off } = track.project(pos);
    if (s <= 0 && off > HOLD_TOLERANCE_M) {
      // We're behind the new path's start (it advanced past a stop we hadn't
      // animated to yet). Bridge from where we are to the new start.
      const bridged = new Track([{ ...pos, t: now }, ...track.wp]);
      this.track = bridged;
      this.s = 0;
      return "ok";
    }
    if (off > REROUTE_OFF_M) return "reroute";
    this.track = track;
    this.s = s;
    return "ok";
  }

  /** Advance by `dt` seconds toward the feed's estimate at `now`. */
  step(now: number, dt: number): LL {
    const target = this.track.sAtTime(now);
    const nominal = this.track.speedAt(this.s);
    const gap = target - this.s;
    // Timetable speed plus a proportional nudge to close the gap. Because the
    // target itself moves at the timetable speed, this settles with ~zero gap
    // instead of stop-and-go. Only when we're clearly ahead do we hold.
    let want: number;
    if (gap < -HOLD_TOLERANCE_M) want = 0;
    else want = Math.max(0, Math.min(MAX_SPEED, nominal + gap / CATCH_UP_SECONDS));
    const k = 1 - Math.exp(-dt / SPEED_SMOOTHING);
    this.v += (want - this.v) * k;
    this.s = Math.min(this.track.length, this.s + this.v * dt);
    return this.position;
  }

  /** Compass heading of travel in degrees (0 = north, clockwise), or null if unknown. */
  heading(): number | null {
    const L = this.track.length;
    if (L < 1) return null;
    // A 20 m window around the sprite, kept inside the path.
    const lo = Math.max(0, Math.min(this.s - 10, L - 20));
    const a = this.track.pointAt(lo);
    const b = this.track.pointAt(Math.min(L, lo + 20));
    const k = Math.cos((a.lat * Math.PI) / 180);
    const dx = (b.lon - a.lon) * k, dy = b.lat - a.lat;
    if (Math.hypot(dx, dy) < 1e-7) return null;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  }

  /** True once the sprite has reached the end of its path. */
  get atEnd(): boolean {
    return this.s >= this.track.length - 0.5;
  }
}
