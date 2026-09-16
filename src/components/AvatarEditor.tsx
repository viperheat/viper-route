"use client";

import { useEffect, useRef, useState } from "react";
import {
  AVATAR_PALETTE,
  AVATAR_PRESETS,
  AVATAR_SIZE,
  EMPTY_AVATAR,
  avatarIsEmpty,
  avatarSVG,
  type Avatar,
} from "@/lib/avatar";

/**
 * Pixel editor for the "you are here" avatar: a 16×16 grid inside a circle
 * mask, a small palette, starter sprites, and a live map-size preview.
 * Draw with a finger or mouse (drag paints). Saved on-device by the parent.
 */
export default function AvatarEditor({
  initial,
  onSave,
  onReset,
  onClose,
}: {
  initial: Avatar | null;
  onSave: (a: Avatar) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Avatar>(initial ?? AVATAR_PRESETS[0].rows);
  const [color, setColor] = useState<string>(AVATAR_PALETTE[0].ch);
  const [tool, setTool] = useState<"paint" | "erase">("paint");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);

  const N = AVATAR_SIZE;
  const CELL = 18; // CSS px per pixel in the editor
  const SIZE = N * CELL;

  // Redraw the editor grid whenever the sprite changes.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const hex = Object.fromEntries(AVATAR_PALETTE.map((p) => [p.ch, p.hex]));
    const r = N / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // Is this cell (centre) inside the circle mask?
        const inside = Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r;
        const ch = rows[y][x];
        ctx.fillStyle = hex[ch] ?? (inside ? "#171b22" : "#0c0f14");
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        if (!inside && hex[ch]) {
          // Painted but clipped on the map — show it faded.
          ctx.fillStyle = "rgba(12,15,20,0.6)";
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL + 0.5, 0); ctx.lineTo(i * CELL + 0.5, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL + 0.5); ctx.lineTo(SIZE, i * CELL + 0.5); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(52,211,153,0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2); ctx.stroke();
  }, [rows, N, SIZE]);

  function paintAt(clientX: number, clientY: number) {
    const c = canvasRef.current;
    if (!c) return;
    const b = c.getBoundingClientRect();
    const x = Math.floor(((clientX - b.left) / b.width) * N);
    const y = Math.floor(((clientY - b.top) / b.height) * N);
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const ch = tool === "erase" ? "." : color;
    setRows((cur) => {
      if (cur[y][x] === ch) return cur;
      const next = cur.slice();
      next[y] = cur[y].slice(0, x) + ch + cur[y].slice(x + 1);
      return next;
    });
  }

  const preview = avatarSVG(rows, 44);

  return (
    <div
      data-vr-avatar-editor
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-neutral-900 p-4 text-neutral-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold leading-tight">Your avatar</h2>
            <p className="text-xs text-neutral-400">This is you on the map. Draw inside the circle.</p>
          </div>
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <span className="vr-user-ring absolute inset-2 rounded-full" />
            <span
              data-vr-avatar-preview
              className="relative"
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          </div>
        </div>

        <canvas
          ref={canvasRef}
          data-vr-avatar-canvas
          style={{ width: SIZE, height: SIZE, maxWidth: "100%" }}
          className="mx-auto block touch-none rounded-lg"
          onPointerDown={(e) => {
            painting.current = true;
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            paintAt(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => painting.current && paintAt(e.clientX, e.clientY)}
          onPointerUp={() => (painting.current = false)}
          onPointerCancel={() => (painting.current = false)}
        />

        {/* Palette */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {AVATAR_PALETTE.map((p) => (
            <button
              key={p.ch}
              title={p.name}
              aria-label={p.name}
              aria-pressed={tool === "paint" && color === p.ch}
              onClick={() => { setColor(p.ch); setTool("paint"); }}
              className={`h-7 w-7 rounded-full border-2 ${
                tool === "paint" && color === p.ch ? "border-white" : "border-transparent"
              }`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
          <button
            title="Eraser"
            aria-label="Eraser"
            aria-pressed={tool === "erase"}
            onClick={() => setTool("erase")}
            className={`h-7 rounded-full border-2 bg-neutral-800 px-2 text-xs ${
              tool === "erase" ? "border-white" : "border-transparent"
            }`}
          >
            erase
          </button>
        </div>

        {/* Presets + clear */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-neutral-500">Start from:</span>
          {AVATAR_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => setRows(p.rows)}
              className="rounded-full bg-neutral-800 px-3 py-1 hover:bg-neutral-700"
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={() => setRows(EMPTY_AVATAR)}
            className="rounded-full bg-neutral-800 px-3 py-1 hover:bg-neutral-700"
          >
            Blank
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onReset}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            Use the plain dot
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
            Cancel
          </button>
          <button
            data-vr-avatar-save
            disabled={avatarIsEmpty(rows)}
            onClick={() => onSave(rows)}
            className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-black disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
