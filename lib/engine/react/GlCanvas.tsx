// lib/engine/react/GlCanvas.tsx
//
// The engine's single WebGL surface (design doc §4 react/EngineProvider.tsx
// + §6 a11y: "canvas aria-hidden; all content readable/operable GL-less").
// Fixed, full-viewport, and painted behind all DOM content (z-0) — every
// section already renders complete, readable, keyboard/SR-operable content
// with zero GL, so this canvas is purely decorative from an a11y standpoint.
// `pointer-events-none` so it never intercepts clicks meant for real DOM
// controls layered above it (e.g. the flavor-picker buttons); pointer state
// for GL raycasting comes from window-level listeners in core/pointer.ts,
// never from canvas DOM events.
//
// No GL logic here — EngineProvider owns the ref and hands the raw
// `HTMLCanvasElement` to `RenderHost.init()`.

"use client";

import { forwardRef } from "react";

const GlCanvas = forwardRef<HTMLCanvasElement>(function GlCanvas(_props, ref) {
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 block h-full w-full"
    />
  );
});

export default GlCanvas;
