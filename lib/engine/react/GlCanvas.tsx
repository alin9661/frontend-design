// lib/engine/react/GlCanvas.tsx
//
// The engine's WebGL surface slot (design doc §4 react/EngineProvider.tsx
// + §6 a11y: "canvas aria-hidden; all content readable/operable GL-less").
// Each EngineProvider effect setup mints a fresh canvas in this stable slot:
// transferControlToOffscreen() is irreversible, so StrictMode's development
// setup→cleanup→setup replay must not hand the second WorkerHost the first
// setup's transferred canvas. The minted canvas is fixed, full-viewport, and
// painted behind all DOM content (z-0) — every
// section already renders complete, readable, keyboard/SR-operable content
// with zero GL, so this canvas is purely decorative from an a11y standpoint.
// `pointer-events-none` so it never intercepts clicks meant for real DOM
// controls layered above it (e.g. the flavor-picker buttons); pointer state
// for GL raycasting comes from window-level listeners in core/pointer.ts,
// never from canvas DOM events.
//
// No GL logic here — EngineProvider asks the slot for a new raw
// `HTMLCanvasElement` and hands it to `RenderHost.init()`.

"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

const CANVAS_CLASS_NAME = "pointer-events-none fixed inset-0 z-0 block h-full w-full";

export interface GlCanvasHandle {
  /** Replace the current surface and return a canvas that has never been transferred. */
  mint(): HTMLCanvasElement;
}

const GlCanvas = forwardRef<GlCanvasHandle>(function GlCanvas(_props, ref) {
  const slotRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      mint() {
        const slot = slotRef.current;
        if (!slot) throw new Error("GlCanvas: surface slot is not attached");

        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        canvas.className = CANVAS_CLASS_NAME;
        // replaceChildren (not appendChild): the previously minted canvas may
        // have been transferred to a now-terminated worker, so it is dead
        // pixels — detach it in the same beat the replacement arrives.
        slot.replaceChildren(canvas);
        return canvas;
      },
    }),
    []
  );

  // `display: contents` — the slot is a handle, not a box. The old component
  // rendered the fixed canvas directly with no wrapper, so the wrapper must
  // contribute exactly zero layout (no block box in a flex/grid parent, no
  // extra gap) to keep that behaviour identical. aria-hidden because the
  // whole GL surface is decorative (design doc §6).
  return <div ref={slotRef} aria-hidden="true" data-gl-canvas-slot="" style={{ display: "contents" }} />;
});

export default GlCanvas;
