"use client";

import { useEffect, useRef, useState } from "react";
import grid from "@/data/snake-grid.json";

/**
 * Subway Snake — played on Manhattan's real street grid.
 *
 * The board is the block of streets between 14th–24th St and 9th Ave–Park Ave
 * South. Intersections come from OpenStreetMap (src/data/snake-grid.json).
 * The snake moves along streets and can only turn north/south at an avenue,
 * exactly like walking the grid. Everything is drawn on a canvas laid over the
 * live map, projected through MapLibre each frame, so it stays glued to the
 * streets. The map is rotated to Manhattan's grid bearing (29°) so avenues
 * run straight up and streets run straight across.
 */

// Subway line colors + labels — the "trains" you eat.
const TRAINS = [
  { c: "#EE352E", t: "1" },
  { c: "#00933C", t: "4" },
  { c: "#B933AD", t: "7" },
  { c: "#0039A6", t: "A" },
  { c: "#FF6319", t: "F" },
  { c: "#FCCC0A", t: "N", dark: true },
  { c: "#6CBE45", t: "G" },
  { c: "#A7A9AC", t: "L" },
];

const GRID_BEARING = 29; // Manhattan avenues run N29°E
const NODES = grid.nodes as [number, number][][]; // [row][col] = [lon, lat]
const STEPS = grid.steps as number[]; // sub-steps per block between avenues
const ROWS = NODES.length; // 11 streets, 14th → 24th
// Column index (u) of each avenue along a street: 0,3,6,9,13,17
const AVE_U: number[] = STEPS.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1] + s], [0]);
const COLS_U = AVE_U[AVE_U.length - 1] + 1; // 18 lattice points per street
const isAvenue = (u: number) => AVE_U.includes(u);

type Cell = { r: number; u: number };
type Dir = { dr: number; du: number };
// Screen directions → grid moves. Landscape: avenues run up the screen
// (bearing 29°). Portrait: the map is turned a further 90° so the long side
// of the board runs up the screen — then "up" is east along the street.
const LANDSCAPE_DIRS: Record<string, Dir> = {
  up: { dr: 1, du: 0 }, // north = higher street number
  down: { dr: -1, du: 0 },
  left: { dr: 0, du: -1 },
  right: { dr: 0, du: 1 },
};
const PORTRAIT_DIRS: Record<string, Dir> = {
  up: { dr: 0, du: 1 }, // east along the street
  down: { dr: 0, du: -1 },
  left: { dr: 1, du: 0 }, // north up the avenue
  right: { dr: -1, du: 0 },
};

// Lon/lat of a lattice cell: interpolate along the street between avenues.
function cellLngLat(c: Cell): [number, number] {
  const row = NODES[c.r];
  let i = 0;
  while (i < AVE_U.length - 2 && c.u > AVE_U[i + 1]) i++;
  const a = row[i], b = row[i + 1];
  const f = (c.u - AVE_U[i]) / (AVE_U[i + 1] - AVE_U[i]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

declare global {
  interface Window {
    __vrSnake?: { score: number; len: number; alive: boolean; head: Cell };
  }
}

type MLMap = import("maplibre-gl").Map;

export default function SnakeGame({ map, onClose }: { map: MLMap; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const restartRef = useRef<() => void>(() => {});
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ---- Camera: remember where the user was, fly to the board, lock the map
    const prev = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      padding: map.getPadding(),
    };
    const handlers = [
      map.dragPan, map.scrollZoom, map.boxZoom, map.dragRotate,
      map.keyboard, map.doubleClickZoom, map.touchZoomRotate,
    ];
    handlers.forEach((h) => h.disable());

    const portrait = canvas.clientHeight > canvas.clientWidth;
    const DIRS = portrait ? PORTRAIT_DIRS : LANDSCAPE_DIRS;
    const bearing = portrait ? GRID_BEARING + 90 : GRID_BEARING;

    function fitBoard() {
      // Board extents in the rotated (grid-aligned) frame, in metres.
      const sw = NODES[0][0], ne = NODES[ROWS - 1][NODES[0].length - 1];
      const nw = NODES[ROWS - 1][0], se = NODES[0][NODES[0].length - 1];
      const M_PER_DEG_LAT = 111320;
      const M_PER_DEG_LON = 111320 * Math.cos((40.74 * Math.PI) / 180);
      const dist = (a: [number, number], b: [number, number]) =>
        Math.hypot((b[0] - a[0]) * M_PER_DEG_LON, (b[1] - a[1]) * M_PER_DEG_LAT);
      const alongStreets = Math.max(dist(sw, se), dist(nw, ne));
      const alongAvenues = Math.max(dist(sw, nw), dist(se, ne));
      // On screen: landscape puts streets across, portrait puts them up-down.
      const widthM = portrait ? alongAvenues : alongStreets;
      const heightM = portrait ? alongStreets : alongAvenues;
      const w = canvas!.clientWidth, h = canvas!.clientHeight;
      const padX = 36, padTop = 64, padBottom = 48;
      // MapLibre zoom levels are for 512px tiles: m/px = 78271.5·cos(lat)/2^zoom.
      const mPerPxZ0 = 78271.517 * Math.cos((40.74 * Math.PI) / 180);
      const zx = Math.log2((mPerPxZ0 * (w - padX * 2)) / widthM);
      const zy = Math.log2((mPerPxZ0 * (h - padTop - padBottom)) / heightM);
      const zoom = Math.min(zx, zy, 17);
      const center: [number, number] = [
        (sw[0] + ne[0] + nw[0] + se[0]) / 4,
        (sw[1] + ne[1] + nw[1] + se[1]) / 4,
      ];
      map.easeTo({
        center, zoom, bearing, pitch: 0,
        padding: { top: padTop, bottom: padBottom, left: padX, right: padX },
        duration: 900,
      });
    }

    // ---- Game state
    let snake: Cell[] = [];
    let dir: Dir = { dr: 0, du: 1 };
    let wantDir: Dir | null = null;
    let food: Cell = { r: 0, u: 0 };
    let prevTail: Cell | null = null; // cell the tail just left (for smooth motion)
    let foodIdx = 0;
    let alive = true;
    let started = false;
    let localScore = 0;
    let tickMs = 230;
    let lastTick = 0;
    let raf = 0;
    let bestScore = 0;
    try { bestScore = Number(localStorage.getItem("vr.snake.best") || 0); } catch { /* ignore */ }
    setBest(bestScore);

    const same = (a: Cell, b: Cell) => a.r === b.r && a.u === b.u;
    const onSnake = (c: Cell) => snake.some((s) => same(s, c));

    function spawnFood() {
      for (let tries = 0; tries < 500; tries++) {
        const c = { r: Math.floor(Math.random() * ROWS), u: Math.floor(Math.random() * COLS_U) };
        if (!onSnake(c)) { food = c; break; }
      }
      foodIdx = Math.floor(Math.random() * TRAINS.length);
    }

    function reset() {
      // Start heading east along 18th St from 8th Ave.
      snake = [{ r: 4, u: 3 }, { r: 4, u: 2 }, { r: 4, u: 1 }];
      dir = { dr: 0, du: 1 }; // east along 18th
      wantDir = null;
      alive = true;
      started = false;
      prevTail = null;
      localScore = 0;
      tickMs = 230;
      lastTick = performance.now();
      spawnFood();
      setScore(0);
      setOver(false);
      setWaiting(true);
      publish();
    }

    function publish() {
      window.__vrSnake = { score: localScore, len: snake.length, alive, head: snake[0] };
    }

    function die() {
      alive = false;
      if (localScore > bestScore) {
        bestScore = localScore;
        try { localStorage.setItem("vr.snake.best", String(bestScore)); } catch { /* ignore */ }
        setBest(bestScore);
      }
      setOver(true);
      publish();
    }

    function step() {
      const head = snake[0];
      // Turn north/south only at an avenue; east/west anywhere. A queued turn
      // waits until it's legal (like waiting for the next corner).
      if (wantDir) {
        const reverse = wantDir.dr === -dir.dr && wantDir.du === -dir.du;
        const vertical = wantDir.dr !== 0;
        if (!reverse && (!vertical || isAvenue(head.u))) {
          dir = wantDir;
          wantDir = null;
        } else if (reverse) {
          wantDir = null;
        }
      }
      const next: Cell = { r: head.r + dir.dr, u: head.u + dir.du };
      if (next.r < 0 || next.r >= ROWS || next.u < 0 || next.u >= COLS_U) return die();
      if (dir.dr !== 0 && !isAvenue(next.u)) return die(); // can't happen, guard anyway
      const eating = same(next, food);
      // The tail moves out of the way this tick unless we're growing.
      const body = eating ? snake : snake.slice(0, -1);
      if (body.some((s) => same(s, next))) return die();
      snake.unshift(next);
      if (eating) {
        prevTail = null;
        localScore += 10;
        tickMs = Math.max(110, tickMs - 6);
        setScore(localScore);
        spawnFood();
      } else {
        prevTail = snake.pop() ?? null;
      }
      publish();
    }

    // ---- Drawing
    function px(c: Cell): [number, number] {
      const p = map.project(cellLngLat(c));
      return [p.x, p.y];
    }

    function draw(now: number) {
      const w = canvas!.clientWidth, h = canvas!.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas!.width !== Math.round(w * dpr) || canvas!.height !== Math.round(h * dpr)) {
        canvas!.width = Math.round(w * dpr);
        canvas!.height = Math.round(h * dpr);
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);

      // Board edge: a faint dashed outline along 14th, Park, 24th and 9th.
      const ring: Cell[] = [
        { r: 0, u: 0 }, { r: 0, u: COLS_U - 1 }, { r: ROWS - 1, u: COLS_U - 1 }, { r: ROWS - 1, u: 0 },
      ];
      ctx!.beginPath();
      ring.forEach((c, i) => { const [x, y] = px(c); if (i === 0) ctx!.moveTo(x, y); else ctx!.lineTo(x, y); });
      ctx!.closePath();
      ctx!.setLineDash([6, 6]);
      ctx!.strokeStyle = "rgba(52,211,153,0.35)";
      ctx!.lineWidth = 1.5;
      ctx!.stroke();
      ctx!.setLineDash([]);

      // Step size in px (distance between neighbouring lattice points).
      const [ax, ay] = px({ r: 4, u: 0 }), [bx, by] = px({ r: 5, u: 0 });
      const unit = Math.max(6, Math.hypot(bx - ax, by - ay));
      const bodyR = Math.min(9, unit * 0.34);

      // Food: an MTA bullet, gently pulsing.
      const [fx, fy] = px(food);
      const t = TRAINS[foodIdx];
      const pulse = 1 + 0.08 * Math.sin(now / 180);
      const fr = Math.min(13, unit * 0.5) * pulse;
      ctx!.shadowColor = t.c; ctx!.shadowBlur = 12;
      ctx!.fillStyle = t.c;
      ctx!.beginPath(); ctx!.arc(fx, fy, fr, 0, Math.PI * 2); ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.fillStyle = t.dark ? "#000" : "#fff";
      ctx!.font = `700 ${Math.round(fr * 1.1)}px system-ui, sans-serif`;
      ctx!.textAlign = "center"; ctx!.textBaseline = "middle";
      ctx!.fillText(t.t, fx, fy + 0.5);

      // Snake: smooth between ticks so it glides down the street.
      const prog = started && alive ? Math.min(1, (now - lastTick) / tickMs) : 1;
      const pts: [number, number][] = snake.map((c, i) => {
        const cur = px(c);
        const prevCell = i < snake.length - 1 ? snake[i + 1] : prevTail;
        if (!prevCell || prog >= 1) return cur;
        const pv = px(prevCell);
        return [pv[0] + (cur[0] - pv[0]) * prog, pv[1] + (cur[1] - pv[1]) * prog];
      });
      ctx!.lineCap = "round"; ctx!.lineJoin = "round";
      ctx!.shadowColor = "#34d399"; ctx!.shadowBlur = 10;
      ctx!.strokeStyle = alive ? "#10b981" : "#525252";
      ctx!.lineWidth = bodyR * 2;
      ctx!.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y)));
      ctx!.stroke();
      ctx!.shadowBlur = 0;
      // Head + eyes
      const [hx, hy] = pts[0];
      ctx!.fillStyle = alive ? "#6ee7b7" : "#737373";
      ctx!.beginPath(); ctx!.arc(hx, hy, bodyR * 1.15, 0, Math.PI * 2); ctx!.fill();
      ctx!.fillStyle = "#052e16";
      const ex = dir.du !== 0 ? 0 : bodyR * 0.45, ey = dir.dr !== 0 ? 0 : bodyR * 0.45;
      ctx!.beginPath(); ctx!.arc(hx - ex, hy - ey, bodyR * 0.22, 0, Math.PI * 2); ctx!.fill();
      ctx!.beginPath(); ctx!.arc(hx + ex, hy + ey, bodyR * 0.22, 0, Math.PI * 2); ctx!.fill();
    }

    function loop(now: number) {
      if (started && alive && now - lastTick >= tickMs) {
        lastTick = now;
        step();
      }
      draw(now);
      raf = requestAnimationFrame(loop);
    }

    // ---- Input: arrows / WASD / swipe
    function setDir(d: Dir) {
      if (!alive) return;
      if (!started) { started = true; lastTick = performance.now(); setWaiting(false); }
      wantDir = d;
    }
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      const d =
        k === "arrowup" || k === "w" ? DIRS.up :
        k === "arrowdown" || k === "s" ? DIRS.down :
        k === "arrowleft" || k === "a" ? DIRS.left :
        k === "arrowright" || k === "d" ? DIRS.right : null;
      if (k === "escape") { onClose(); return; }
      if (k === "enter" && !alive) { reset(); return; }
      if (!d) return;
      e.preventDefault();
      setDir(d);
    }
    let touch: { x: number; y: number } | null = null;
    function onPointerDown(e: PointerEvent) { touch = { x: e.clientX, y: e.clientY }; }
    function onPointerUp(e: PointerEvent) {
      if (!touch) return;
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
      touch = null;
      if (Math.hypot(dx, dy) < 18) return;
      setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left) : (dy > 0 ? DIRS.down : DIRS.up));
    }

    window.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    restartRef.current = reset;

    fitBoard();
    reset();
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      delete window.__vrSnake;
      handlers.forEach((h) => h.enable());
      map.easeTo({ ...prev, duration: 700 });
    };
  }, [map, onClose]);

  return (
    <div data-vr-snake className="absolute inset-0 z-30 text-neutral-100">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 pr-14">
        <div className="rounded-xl bg-neutral-950/80 px-3 py-2 shadow-lg backdrop-blur">
          <p className="text-sm font-bold leading-tight">Subway Snake 🐍</p>
          <p className="text-[11px] text-neutral-400">14th–24th St · 9th–Park Ave</p>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="rounded-full bg-neutral-950/80 px-3 py-1.5 text-sm font-semibold text-emerald-300 shadow-lg backdrop-blur">
            {score}
            {best > 0 && <span className="text-neutral-500"> · best {best}</span>}
          </span>
          <button
            onClick={onClose}
            aria-label="Close snake"
            className="rounded-full bg-neutral-950/80 px-3 py-1.5 text-sm font-semibold shadow-lg backdrop-blur hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>
      </div>

      {waiting && !over && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center">
          <p className="rounded-full bg-neutral-950/80 px-4 py-2 text-sm text-neutral-200 shadow-lg backdrop-blur">
            Swipe or use arrow keys · turn at the avenues
          </p>
        </div>
      )}

      {over && (
        <div
          data-vr-snake-over
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/70"
        >
          <p className="text-2xl font-black">Game over</p>
          <p className="text-neutral-300">
            Score {score}
            {best > score ? ` · Best ${best}` : score > 0 && score >= best ? " · New best!" : ""}
          </p>
          <button
            onClick={() => restartRef.current()}
            className="rounded-full bg-emerald-500 px-5 py-2 font-bold text-black"
          >
            Play again
          </button>
          <button onClick={onClose} className="text-sm text-neutral-400 hover:text-neutral-200">
            Back to the map
          </button>
        </div>
      )}
    </div>
  );
}
