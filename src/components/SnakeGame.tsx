"use client";

import { useEffect, useRef, useState } from "react";

// Subway line colors + labels — the "trains" you eat.
const TRAINS = [
  { c: "#EE352E", t: "1" },
  { c: "#00933C", t: "4" },
  { c: "#B933AD", t: "7" },
  { c: "#0039A6", t: "A" },
  { c: "#FF6319", t: "F" },
  { c: "#FCCC0A", t: "N" },
  { c: "#6CBE45", t: "G" },
];

type Pt = { x: number; y: number };

declare global {
  interface Window {
    __vrSnake?: { score: number; len: number; alive: boolean };
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function SnakeGame({ onClose }: { onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const restartRef = useRef<() => void>(() => {});
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CELL = 18;
    let cols = 0, rows = 0;
    let snake: Pt[] = [];
    let dir: Pt = { x: 1, y: 0 };
    let pendingDir: Pt = { x: 1, y: 0 };
    let food: Pt = { x: 0, y: 0 };
    let foodIdx = 0;
    let alive = true;
    let localScore = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    function sizeBoard() {
      cols = Math.max(8, Math.floor(wrap!.clientWidth / CELL));
      rows = Math.max(8, Math.floor(wrap!.clientHeight / CELL));
      canvas!.width = cols * CELL;
      canvas!.height = rows * CELL;
    }

    function placeFood() {
      const taken = new Set(snake.map((s) => s.x + "," + s.y));
      let p: Pt;
      do {
        p = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
      } while (taken.has(p.x + "," + p.y));
      food = p;
      foodIdx = Math.floor(Math.random() * TRAINS.length);
    }

    function draw() {
      if (!ctx) return;
      ctx.fillStyle = "#0c0f14";
      ctx.fillRect(0, 0, canvas!.width, canvas!.height);
      // faint street grid
      ctx.strokeStyle = "#182230";
      ctx.lineWidth = 1;
      for (let x = 0; x <= cols; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, rows * CELL);
        ctx.stroke();
      }
      for (let y = 0; y <= rows; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(cols * CELL, y * CELL + 0.5);
        ctx.stroke();
      }
      // food = subway bullet
      const train = TRAINS[foodIdx];
      const fx = food.x * CELL + CELL / 2;
      const fy = food.y * CELL + CELL / 2;
      ctx.fillStyle = train.c;
      ctx.beginPath();
      ctx.arc(fx, fy, CELL * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = train.c === "#FCCC0A" ? "#000" : "#fff";
      ctx.font = `bold ${Math.floor(CELL * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(train.t, fx, fy + 1);
      // snake
      snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? "#34d399" : "#10b981";
        roundRect(ctx, s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2, 4);
        ctx.fill();
      });
    }

    function startTimer() {
      if (timer) clearInterval(timer);
      const interval = Math.max(70, 130 - localScore * 3);
      timer = setInterval(tick, interval);
    }

    function die() {
      alive = false;
      window.__vrSnake = { score: localScore, len: snake.length, alive: false };
      if (timer) clearInterval(timer);
      setOver(true);
      setBest((b) => Math.max(b, localScore));
    }

    function tick() {
      if (!alive) return;
      if (pendingDir.x !== -dir.x || pendingDir.y !== -dir.y) dir = pendingDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) return die();
      if (snake.some((s) => s.x === head.x && s.y === head.y)) return die();
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        localScore++;
        setScore(localScore);
        placeFood();
        startTimer(); // speeds up as you grow
      } else {
        snake.pop();
      }
      window.__vrSnake = { score: localScore, len: snake.length, alive };
      draw();
    }

    function reset() {
      sizeBoard();
      const cx = Math.floor(cols / 2);
      const cy = Math.floor(rows / 2);
      snake = [
        { x: cx, y: cy },
        { x: cx - 1, y: cy },
        { x: cx - 2, y: cy },
      ];
      dir = { x: 1, y: 0 };
      pendingDir = { x: 1, y: 0 };
      alive = true;
      localScore = 0;
      setScore(0);
      setOver(false);
      placeFood();
      window.__vrSnake = { score: 0, len: snake.length, alive: true };
      draw();
      startTimer();
    }

    restartRef.current = reset;

    function onKey(e: KeyboardEvent) {
      const k = e.key;
      if (k === "ArrowUp" || k === "w") pendingDir = { x: 0, y: -1 };
      else if (k === "ArrowDown" || k === "s") pendingDir = { x: 0, y: 1 };
      else if (k === "ArrowLeft" || k === "a") pendingDir = { x: -1, y: 0 };
      else if (k === "ArrowRight" || k === "d") pendingDir = { x: 1, y: 0 };
      else return;
      e.preventDefault();
    }

    let tsx = 0, tsy = 0;
    function onTouchStart(e: TouchEvent) {
      tsx = e.touches[0].clientX;
      tsy = e.touches[0].clientY;
    }
    function onTouchEnd(e: TouchEvent) {
      const dx = e.changedTouches[0].clientX - tsx;
      const dy = e.changedTouches[0].clientY - tsy;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      if (Math.abs(dx) > Math.abs(dy)) pendingDir = { x: dx > 0 ? 1 : -1, y: 0 };
      else pendingDir = { x: 0, y: dy > 0 ? 1 : -1 };
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault(); // stop page scroll while playing
    }

    window.addEventListener("keydown", onKey);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });

    reset();

    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchmove", onTouchMove);
      delete window.__vrSnake;
    };
  }, []);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-lg font-bold leading-tight">Subway Snake 🐍</h2>
          <p className="text-xs text-neutral-400">Eat the trains · arrow keys or swipe</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-300">Score {score}</span>
          <button
            onClick={onClose}
            className="rounded-full bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700"
          >
            Close
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="touch-none rounded-lg"
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
        {over && (
          <div
            data-vr-snake-over
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/80"
          >
            <p className="text-2xl font-black">Game over</p>
            <p className="text-neutral-300">
              Score {score}
              {best > score ? ` · Best ${best}` : ""}
            </p>
            <button
              onClick={() => restartRef.current()}
              className="rounded-full bg-emerald-500 px-5 py-2 font-bold text-black"
            >
              Play again
            </button>
            <button onClick={onClose} className="text-sm text-neutral-400 hover:text-neutral-200">
              Back to map
            </button>
          </div>
        )}
      </div>

      <p className="px-4 py-3 text-center text-xs text-neutral-500">
        Waiting for your train? Rack up a score.
      </p>
    </div>
  );
}
