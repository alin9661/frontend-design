// lib/engine/react/create-engine.ts
//
// Constructs one instance of every engine primitive EngineProvider needs —
// Ticker, VirtualScroll, RectTracker, PointerTracker, RenderHost — per §4
// react/EngineProvider.tsx ("constructs Ticker/VirtualScroll/RectTracker/
// pointer + createRenderHost() ONLY in useEffect"). Contains no GL logic
// itself, just wiring.
//
// Factored out of EngineProvider.tsx's effect body into its own module
// specifically so it's a single, easy mock target: EngineProvider.test.tsx
// does `vi.mock("@/lib/engine/react/create-engine", ...)` to exercise the
// provider's mount/unmount/StrictMode lifecycle against a fully controlled
// fake engine, without needing real WebGL/Worker support in jsdom.

import { Ticker } from "@/lib/engine/core/ticker";
import { VirtualScroll } from "@/lib/engine/core/scroll";
import { RectTracker } from "@/lib/engine/core/rect-tracker";
import { PointerTracker } from "@/lib/engine/core/pointer";
import { createRenderHost } from "@/lib/engine/worker/host";
import type { RenderHost } from "@/lib/engine/types";

export interface EngineDeps {
  ticker: Ticker;
  scroll: VirtualScroll;
  rectTracker: RectTracker;
  pointer: PointerTracker;
  host: RenderHost;
}

export function createEngineDeps(reducedMotion: boolean): EngineDeps {
  const ticker = new Ticker();
  const scroll = new VirtualScroll(ticker, { reducedMotion });
  const rectTracker = new RectTracker();
  const pointer = new PointerTracker(ticker);
  const host = createRenderHost();
  return { ticker, scroll, rectTracker, pointer, host };
}
