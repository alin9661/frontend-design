// test/engine/react/test-utils/fake-engine.ts
//
// A fully-controlled fake `EngineDeps` (see lib/engine/react/create-engine.ts)
// for testing EngineProvider's lifecycle without a real WebGL/Worker
// environment. Every teardown method increments a shared counter so tests
// can assert "every create is matched by exactly one destroy" — including
// across React StrictMode's mount→cleanup→mount dev-mode double-invoke.
//
// Usage: `vi.mock("@/lib/engine/react/create-engine", () => ({
//   createEngineDeps: vi.fn(() => createFakeEngineDeps()),
// }));` — see EngineProvider.test.tsx.

import { vi } from "vitest";
import type { PointerState, ScrollState, WorkerToMain } from "@/lib/engine/types";

export interface FakeCounts {
  created: number;
  tickerStop: number;
  scrollDestroy: number;
  pointerDestroy: number;
  hostDestroy: number;
}

let counts: FakeCounts = { created: 0, tickerStop: 0, scrollDestroy: 0, pointerDestroy: 0, hostDestroy: 0 };

export function resetFakeEngineCounts(): void {
  counts = { created: 0, tickerStop: 0, scrollDestroy: 0, pointerDestroy: 0, hostDestroy: 0 };
}

export function getFakeEngineCounts(): FakeCounts {
  return counts;
}

export function makeTrackedRect(
  overrides: Partial<{ top: number; left: number; width: number; height: number; progressValue: number }> = {}
) {
  const top = overrides.top ?? 0;
  const left = overrides.left ?? 0;
  const width = overrides.width ?? 300;
  const height = overrides.height ?? 300;
  const progressValue = overrides.progressValue ?? 0;
  return {
    top,
    left,
    width,
    height,
    inView: vi.fn(() => true),
    viewportY: vi.fn(() => 0),
    progress: vi.fn(() => progressValue),
  };
}

export interface FakeHostOptions {
  /** If false, `init()` rejects (simulates no usable WebGL at all). */
  initResolves?: boolean;
}

export function createFakeEngineDeps(opts: FakeHostOptions = {}) {
  counts.created += 1;

  const messageHandlers = new Set<(m: WorkerToMain) => void>();
  const scrollState: ScrollState = { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 };
  const pointerState: PointerState = { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false };

  const ticker = {
    add: vi.fn(() => vi.fn()),
    start: vi.fn(),
    stop: vi.fn(() => {
      counts.tickerStop += 1;
    }),
    tick: vi.fn(),
    get running() {
      return false;
    },
  };

  const scroll = {
    state: scrollState,
    on: vi.fn(() => vi.fn()),
    scrollTo: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(() => {
      counts.scrollDestroy += 1;
    }),
  };

  const rectTracker = {
    track: vi.fn(() => makeTrackedRect()),
    untrack: vi.fn(),
    refresh: vi.fn(),
  };

  const pointer = {
    state: pointerState,
    destroy: vi.fn(() => {
      counts.pointerDestroy += 1;
    }),
  };

  const host = {
    mode: "main" as const,
    init: vi.fn(() =>
      opts.initResolves === false ? Promise.reject(new Error("no webgl")) : Promise.resolve()
    ),
    frame: vi.fn(),
    addView: vi.fn(),
    removeView: vi.fn(),
    invoke: vi.fn(),
    onMessage: vi.fn((cb: (m: WorkerToMain) => void) => {
      messageHandlers.add(cb);
      return () => {
        messageHandlers.delete(cb);
      };
    }),
    resize: vi.fn(),
    destroy: vi.fn(() => {
      counts.hostDestroy += 1;
    }),
    // test-only escape hatch, not part of the RenderHost contract
    __emit: (msg: WorkerToMain) => {
      for (const cb of messageHandlers) cb(msg);
    },
  };

  return { ticker, scroll, rectTracker, pointer, host };
}
