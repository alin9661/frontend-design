// lib/scenes/hero-can/label-texture.ts
//
// CanvasTexture for the can's label band (CAN CONTRACT). Draws the same
// visual language as components/svg/Can.tsx's label art (leaf glyph,
// MATE/ÍNA wordmark, flavor name, "ZERO SUGAR · ENERGY BREW" accent band)
// with Canvas2D instead of SVG.
//
// Per the CAN CONTRACT, this MUST use `new OffscreenCanvas(w,h)` when
// available (worker-safe — gl/'s layering law forbids `document`, but
// text/label modules are the documented exception per design doc §4C) and
// fall back to a `document`-created canvas only when OffscreenCanvas is
// unavailable (main-thread MainThreadHost path, or a test environment).

import * as THREE from "three";
import type { Flavor } from "@/lib/flavors";

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 2048;

export interface LabelTextureOptions {
  width?: number;
  height?: number;
}

type Canvas2DTarget = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas(width: number, height: number): Canvas2DTarget {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawLeafGlyph(ctx2d: Ctx2D, cx: number, topFrac: number, scale: number, flavor: Flavor): void {
  ctx2d.save();
  ctx2d.translate(cx, topFrac);
  ctx2d.scale(scale, scale);
  ctx2d.fillStyle = flavor.accent;
  ctx2d.beginPath();
  ctx2d.moveTo(0, -46);
  ctx2d.bezierCurveTo(24, -46, 42, -24, 42, 6);
  ctx2d.bezierCurveTo(42, 34, 22, 52, 0, 60);
  ctx2d.bezierCurveTo(-22, 52, -42, 34, -42, 6);
  ctx2d.bezierCurveTo(-42, -24, -24, -46, 0, -46);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.strokeStyle = flavor.can;
  ctx2d.lineWidth = 3.5;
  ctx2d.beginPath();
  ctx2d.moveTo(0, -40);
  ctx2d.lineTo(0, 56);
  ctx2d.stroke();
  ctx2d.restore();
}

function draw(ctx2d: Ctx2D, w: number, h: number, flavor: Flavor): void {
  // background: the can body's own color, so any label-cylinder edge that
  // ever peeks past the printed art blends into the shell instead of
  // showing a seam.
  ctx2d.fillStyle = flavor.can;
  ctx2d.fillRect(0, 0, w, h);

  // soft horizontal sheen, mirrors Can.tsx's body highlight gradient
  // (dark-light-dark bands wrapping around the can).
  const sheen = ctx2d.createLinearGradient(0, 0, w, 0);
  sheen.addColorStop(0, "rgba(0,0,0,0.12)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0)");
  sheen.addColorStop(0.75, "rgba(255,255,255,0.28)");
  sheen.addColorStop(1, "rgba(0,0,0,0.14)");
  ctx2d.fillStyle = sheen;
  ctx2d.fillRect(0, 0, w, h);

  const cx = w / 2;

  drawLeafGlyph(ctx2d, cx, h * 0.14, w / 400, flavor);

  ctx2d.textAlign = "center";
  ctx2d.textBaseline = "alphabetic";

  // wordmark — Anton (next/font, main-thread only) isn't reachable from a
  // worker's OffscreenCanvas 2D context, so this uses a bold system
  // fallback instead; visually close enough for a background label texture
  // that's mostly read at a glance behind the DOM headline.
  const wordmarkSize = w * 0.17;
  ctx2d.fillStyle = flavor.accent;
  ctx2d.font = `700 ${wordmarkSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx2d.fillText("MATE", cx, h * 0.31);
  ctx2d.fillText("ÍNA", cx, h * 0.31 + wordmarkSize * 1.05);

  // flavor name
  const nameSize = w * 0.075;
  ctx2d.font = `700 ${nameSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx2d.fillText(flavor.name.toUpperCase(), cx, h * 0.62);

  // accent band, "ZERO SUGAR · ENERGY BREW"
  const bandTop = h * 0.86;
  const bandHeight = h * 0.06;
  ctx2d.fillStyle = flavor.accent;
  ctx2d.globalAlpha = 0.92;
  ctx2d.fillRect(0, bandTop, w, bandHeight);
  ctx2d.globalAlpha = 1;
  ctx2d.fillStyle = flavor.can;
  ctx2d.font = `700 ${w * 0.026}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx2d.textBaseline = "middle";
  ctx2d.fillText("ZERO SUGAR · ENERGY BREW", cx, bandTop + bandHeight / 2 + 1);
}

/** MUST use `new OffscreenCanvas(w,h)` when available else `document`
 * canvas; brand marks + flavor name + accent bands from lib/flavors.ts. */
export function createLabelTexture(flavor: Flavor, opts: LabelTextureOptions = {}): THREE.Texture {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const canvas = createCanvas(width, height);
  const ctx2d = canvas.getContext("2d") as Ctx2D | null;

  if (ctx2d) {
    draw(ctx2d, width, height, flavor);
  }
  // else: no 2d context available (e.g. an unmocked jsdom test environment,
  // or a stub OffscreenCanvas that doesn't implement getContext) — return a
  // texture over the blank canvas rather than throwing. buildCan()'s label
  // mesh still renders (flat flavor.can-colored label) instead of the
  // whole scene's init() crashing.

  // THREE.CanvasTexture<TCanvas>'s TS generic defaults to HTMLCanvasElement;
  // OffscreenCanvas satisfies the same runtime contract three.js actually
  // relies on (the canvas is handed straight to texImage2D), so this is a
  // type-only cast, not a runtime lie.
  const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
