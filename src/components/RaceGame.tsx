"use client";

import { useEffect, useRef, useState } from "react";
import { Track, TrainMotion, metersBetween, type LL, type Waypoint } from "@/lib/trainMotion";

/**
 * Race the Train (M15).
 *
 * Pick a train that's about to arrive at your station. The race is you vs.
 * that train to the NEXT stop: your real GPS position against the train's
 * live position (forward-only physics, same model as the sprites). First to
 * the next station wins. Results are kept on-device (vr.races).
 */

type StopLoc = { id: string; name: string; lat: number; lon: number };
type ApiTrain = {
  tripId: string;
  route: string;
  fromStop: LL;
  toStop: LL;
  fraction: number;
  etaToStationSeconds: number;
  path: (LL & { etaSeconds: number })[];
  nextStop?: StopLoc & { etaSeconds: number };
};
type Candidate = { tripId: string; route: string; eta: number; next: StopLoc; etaNext: number };
type RaceResult = { at: string; route: string; from: string; to: string; won: boolean; marginS: number };

const FINISH_RADIUS_M = 40; // "you're there" when within this of the station point
const WALK_MPS = 1.4; // pace assumed until we've measured yours
const POLL_MS = 10000;

const ROUTE_COLORS: Record<string, string> = {
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E", "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD", A: "#0039A6", C: "#0039A6", E: "#0039A6", B: "#FF6319", D: "#FF6319", F: "#FF6319",
  M: "#FF6319", N: "#FCCC0A", Q: "#FCCC0A", R: "#FCCC0A", W: "#FCCC0A", G: "#6CBE45", J: "#996633",
  Z: "#996633", L: "#A7A9AC", S: "#808183", SI: "#0039A6",
};
const DARK_TEXT = new Set(["N", "Q", "R", "W"]);
const baseRoute = (r: string) => r.replace(/X$/, "");
const routeColor = (r: string) => ROUTE_COLORS[baseRoute(r)] ?? "#4b5563";

function fmt(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function loadRaces(): RaceResult[] {
  try {
    const r = JSON.parse(localStorage.getItem("vr.races") || "[]");
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}
function saveRace(r: RaceResult) {
  try {
    localStorage.setItem("vr.races", JSON.stringify([r, ...loadRaces()].slice(0, 50)));
  } catch {
    /* ignore */
  }
}

function Bullet({ route, size = 28 }: { route: string; size?: number }) {
  const label = baseRoute(route);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size, height: size, fontSize: size * 0.5,
        backgroundColor: routeColor(route), color: DARK_TEXT.has(label) ? "#000" : "#fff",
        boxShadow: `0 0 10px ${routeColor(route)}`,
      }}
    >
      {label}
    </span>
  );
}

type MLMap = import("maplibre-gl").Map;
type MLMarker = import("maplibre-gl").Marker;

export default function RaceGame({
  map,
  stationId,
  stationName,
  stationLoc,
  userMarker,
  onClose,
}: {
  map: MLMap;
  stationId: string;
  stationName: string;
  stationLoc: LL;
  userMarker: MLMarker | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"pick" | "race" | "done">("pick");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [pickErr, setPickErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [hud, setHud] = useState({
    trainLeft: 0, trainProg: 0, departed: false, trainArrived: false,
    youLeft: 0, youProg: 0, youEta: 0, gps: "waiting" as "waiting" | "ok" | "denied",
  });
  const [result, setResult] = useState<RaceResult | null>(null);
  const [history, setHistory] = useState<RaceResult[]>([]);

  useEffect(() => {
    async function load() {
      setHistory(loadRaces());
    }
    load();
  }, []);

  // ---- Pick phase: which trains are about to arrive and keep going?
  useEffect(() => {
    if (phase !== "pick") return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/trains?station=${encodeURIComponent(stationId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { trains?: ApiTrain[] };
        if (cancelled) return;
        const list: Candidate[] = (data.trains || [])
          .filter((t) => t.nextStop && t.etaToStationSeconds > 15)
          .map((t) => ({
            tripId: t.tripId, route: t.route, eta: t.etaToStationSeconds,
            next: t.nextStop!, etaNext: t.nextStop!.etaSeconds,
          }))
          .slice(0, 5);
        setCands(list);
      } catch {
        if (!cancelled) setPickErr("Couldn't load trains right now.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [phase, stationId]);

  // ---- Race phase
  // Map visuals (train sprite + finish flag) outlive the race effect so they
  // stay on the map behind the result card; cleared on "Race again"/unmount.
  const visualsRef = useRef<{ train: MLMarker; flag: MLMarker } | null>(null);
  function clearVisuals() {
    visualsRef.current?.train.remove();
    visualsRef.current?.flag.remove();
    visualsRef.current = null;
  }
  useEffect(() => clearVisuals, []);
  useEffect(() => {
    if (phase !== "race" || !chosen) return;
    const maplibregl = window.maplibregl;
    let cancelled = false;
    const finish: LL = { lat: chosen.next.lat, lon: chosen.next.lon };
    const startedAt = Date.now();

    // Train: forward-only motion along its live path to the next stop.
    let motion: TrainMotion | null = null;
    let clockOffset = 0;
    const serverNow = () => Date.now() - clockOffset;
    const trainEl = document.createElement("div");
    trainEl.className = "vr-race-train";
    trainEl.textContent = baseRoute(chosen.route);
    const color = routeColor(chosen.route);
    trainEl.style.cssText =
      "display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;" +
      `font:800 15px system-ui,sans-serif;background:${color};color:${DARK_TEXT.has(baseRoute(chosen.route)) ? "#000" : "#fff"};` +
      `border:2px solid #fff;box-shadow:0 0 16px ${color},0 0 4px rgba(0,0,0,.6);`;
    const trainMarker = new maplibregl.Marker({ element: trainEl });
    let trainShown = false;

    // Finish flag
    const flagEl = document.createElement("div");
    flagEl.className = "vr-race-flag";
    flagEl.textContent = "🏁";
    flagEl.style.cssText = "font-size:22px;filter:drop-shadow(0 0 6px #22d3ee);";
    const flag = new maplibregl.Marker({ element: flagEl, anchor: "bottom" })
      .setLngLat([finish.lon, finish.lat])
      .addTo(map);
    clearVisuals();
    visualsRef.current = { train: trainMarker, flag };

    async function pollTrain() {
      try {
        const res = await fetch(
          `/api/trains?station=${encodeURIComponent(chosen!.next.id)}&trip=${encodeURIComponent(chosen!.tripId)}`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { updatedAt?: string; trains?: ApiTrain[] };
        const t = (data.trains || []).find((x) => x.tripId === chosen!.tripId);
        if (!t) return; // keep extrapolating on the last timetable
        const serverMs = Date.parse(data.updatedAt ?? "") || Date.now();
        clockOffset = Date.now() - serverMs;
        const p0 = {
          lat: t.fromStop.lat + (t.toStop.lat - t.fromStop.lat) * (t.fraction ?? 0),
          lon: t.fromStop.lon + (t.toStop.lon - t.fromStop.lon) * (t.fraction ?? 0),
        };
        const wp: Waypoint[] = [
          { ...p0, t: serverMs },
          ...t.path.map((p) => ({ lat: p.lat, lon: p.lon, t: serverMs + p.etaSeconds * 1000 })),
        ];
        const track = new Track(wp);
        if (!motion) motion = new TrainMotion(track, serverNow());
        else if (motion.update(track, serverNow()) === "reroute") motion = new TrainMotion(track, serverNow());
        if (!trainShown) {
          const p = motion.position;
          trainMarker.setLngLat([p.lon, p.lat]).addTo(map);
          trainShown = true;
        }
      } catch {
        /* retry next poll */
      }
    }

    // You: real GPS.
    let you: LL | null = null;
    let youStartDist = 0;
    const recent: { t: number; p: LL }[] = [];
    let gps: "waiting" | "ok" | "denied" = "waiting";
    let watchId: number | null = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          you = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          gps = "ok";
          if (!youStartDist) youStartDist = Math.max(1, metersBetween(you, finish));
          recent.push({ t: Date.now(), p: you });
          while (recent.length && Date.now() - recent[0].t > 20000) recent.shift();
          userMarker?.setLngLat([you.lon, you.lat]);
        },
        () => {
          gps = "denied";
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );
    } else {
      gps = "denied";
    }

    // Camera: show the finish, the station and you.
    try {
      const b = new maplibregl.LngLatBounds([finish.lon, finish.lat], [finish.lon, finish.lat]);
      b.extend([stationLoc.lon, stationLoc.lat]);
      const u = userMarker?.getLngLat();
      if (u) b.extend([u.lng, u.lat]);
      map.fitBounds(b, { padding: { top: 90, bottom: 220, left: 50, right: 50 }, maxZoom: 16, duration: 900 });
    } catch {
      /* ignore */
    }

    let raf = 0;
    let lastFrame = performance.now();
    let lastHud = 0;
    let finished = false;

    function endRace(won: boolean, marginS: number) {
      if (finished) return;
      finished = true;
      const r: RaceResult = {
        at: new Date().toISOString(), route: chosen!.route, from: stationName, to: chosen!.next.name,
        won, marginS: Math.round(marginS),
      };
      saveRace(r);
      setHistory(loadRaces());
      setResult(r);
      setPhase("done");
    }

    function frame() {
      if (cancelled) return;
      const nowP = performance.now();
      const dt = Math.min(0.1, (nowP - lastFrame) / 1000);
      lastFrame = nowP;
      const now = serverNow();

      let trainLeft = chosen!.etaNext - (Date.now() - startedAt) / 1000;
      let trainProg = 0;
      let departed = false;
      let trainArrived = false;
      if (motion) {
        const p = motion.step(now, dt);
        trainMarker.setLngLat([p.lon, p.lat]);
        trainLeft = (motion.track.last.t - now) / 1000;
        const total = motion.track.length || 1;
        trainProg = Math.min(1, motion.s / total);
        // "Departed" once it's clearly closer to the finish than the station is.
        departed = metersBetween(p, finish) < metersBetween(stationLoc, finish) - 30;
        // Arrived when the sprite gets there, or the feed's ETA is clearly past.
        trainArrived = (motion.atEnd && now > motion.track.last.t) || now > motion.track.last.t + 8000;
      }

      let youLeft = 0, youProg = 0, youEta = 0;
      if (you) {
        youLeft = metersBetween(you, finish);
        youProg = Math.min(1, 1 - youLeft / youStartDist);
        let pace = WALK_MPS;
        if (recent.length >= 2) {
          const a = recent[0], b = recent[recent.length - 1];
          const secs = (b.t - a.t) / 1000;
          const d = metersBetween(a.p, b.p);
          if (secs > 5 && d > 5) pace = Math.max(0.3, d / secs);
        }
        youEta = youLeft / pace;
        if (youLeft <= FINISH_RADIUS_M && !trainArrived) endRace(true, trainLeft);
      }
      if (trainArrived && !finished) endRace(false, you ? youEta : chosen!.etaNext);

      if (nowP - lastHud > 250) {
        lastHud = nowP;
        setHud({ trainLeft, trainProg, departed, trainArrived, youLeft, youProg, youEta, gps });
      }
      raf = requestAnimationFrame(frame);
    }

    pollTrain();
    const poll = setInterval(pollTrain, POLL_MS);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      clearInterval(poll);
      cancelAnimationFrame(raf);
      if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
    };
  }, [phase, chosen, map, stationId, stationName, stationLoc, userMarker]);

  const wins = history.filter((h) => h.won).length;

  return (
    <div data-vr-race className="pointer-events-none absolute inset-0 z-30 text-vr-text">
      {/* Top HUD */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3 pr-14">
        <div className="pointer-events-auto rounded-xl bg-vr-panel/85 px-3 py-2 shadow-lg backdrop-blur">
          <p className="text-sm font-bold leading-tight">Race the Train 🏁</p>
          <p className="text-[11px] text-vr-muted">
            {history.length ? `${wins} win${wins === 1 ? "" : "s"} in ${history.length} race${history.length === 1 ? "" : "s"}` : "you vs. the next stop"}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close race"
          className="pointer-events-auto rounded-full bg-vr-panel/85 px-3 py-1.5 text-sm font-semibold shadow-lg backdrop-blur hover:bg-vr-panel-2"
        >
          ✕
        </button>
      </div>

      {/* Bottom card */}
      <div className="absolute inset-x-3 bottom-3 md:inset-x-6">
        <div className="vr-glow-edge pointer-events-auto mx-auto max-w-md rounded-2xl bg-vr-panel p-4 shadow-2xl">
          {phase === "pick" && (
            <>
              <h2 className="text-lg font-bold leading-tight">Pick your train</h2>
              <p className="mb-3 text-xs text-vr-muted">
                Arriving at {stationName}. You race it on foot to its next stop.
              </p>
              {pickErr && <p className="py-3 text-sm text-vr-muted">{pickErr}</p>}
              {!pickErr && cands === null && <p className="py-3 text-sm text-vr-muted">Looking for trains…</p>}
              {cands && cands.length === 0 && (
                <p className="py-3 text-sm text-vr-muted">No racers right now — trains need to be at least 15 s out and continue past here. Try again in a minute.</p>
              )}
              {cands && cands.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {cands.map((c) => (
                    <li key={c.tripId}>
                      <button
                        data-vr-race-pick
                        onClick={() => { setChosen(c); setPhase("race"); }}
                        className="flex w-full items-center gap-3 rounded-xl bg-vr-panel-2 px-3 py-2 text-left hover:bg-vr-panel-3"
                      >
                        <Bullet route={c.route} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">→ {c.next.name}</span>
                          <span className="block text-xs text-vr-muted">
                            here in <span className="font-mono">{fmt(c.eta)}</span> · there in <span className="font-mono">{fmt(c.etaNext)}</span>
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-emerald-300">Race</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {phase === "race" && chosen && (
            <>
              <div className="mb-3 flex items-center gap-3">
                <Bullet route={chosen.route} size={32} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-bold leading-tight">to {chosen.next.name}</h2>
                  <p className="text-xs text-vr-muted">
                    {hud.gps === "denied"
                      ? "Race needs your location — open this on your phone with location on"
                      : hud.gps === "waiting" ? "Finding you…" : hud.departed ? "It's moving — go!" : `Train at ${stationName} — run!`}
                  </p>
                </div>
              </div>
              <Row
                label="Train"
                value={hud.trainArrived ? "arrived" : fmt(hud.trainLeft)}
                prog={hud.trainProg}
                color={routeColor(chosen.route)}
                testId="train"
              />
              <Row
                label="You"
                value={hud.gps === "ok" ? `${Math.round(hud.youLeft)} m · ~${fmt(hud.youEta)}` : "—"}
                prog={hud.youProg}
                color="#22d3ee"
                testId="you"
              />
              <div className="mt-3 flex justify-end">
                <button onClick={onClose} className="text-xs text-vr-muted hover:text-vr-text">Give up</button>
              </div>
            </>
          )}

          {phase === "done" && result && (
            <div data-vr-race-result={result.won ? "won" : "lost"} className="text-center">
              <p className="text-2xl font-black">{result.won ? "You beat the train! 🏆" : "The train won 🚇"}</p>
              <p className="mt-1 text-sm text-vr-text-2">
                {result.won
                  ? `By about ${fmt(result.marginS)} to ${result.to}.`
                  : `It got to ${result.to} while you had ~${fmt(result.marginS)} to go.`}
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  onClick={() => { clearVisuals(); setResult(null); setChosen(null); setCands(null); setPhase("pick"); }}
                  className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-black"
                >
                  Race again
                </button>
                <button onClick={onClose} className="text-sm text-vr-muted hover:text-vr-text">Back to the map</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, prog, color, testId }: { label: string; value: string; prog: number; color: string; testId: string }) {
  return (
    <div className="mb-2" data-vr-race-row={testId}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold">{label}</span>
        <span className="font-mono tabular-nums text-vr-text-2">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-vr-panel-3">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.round(prog * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </div>
  );
}
