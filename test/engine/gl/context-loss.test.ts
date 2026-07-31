// test/engine/gl/context-loss.test.ts
//
// gl/context-loss.ts's ContextLossHandler: wires webglcontextlost/restored,
// calls preventDefault() on loss (required for the browser to ever fire
// "restored"), and cleans up listeners on dispose(). Tested against a real
// jsdom-backed EventTarget (a plain <canvas>) plus the class's own
// simulateLost/simulateRestored escape hatch for deterministic assertions.

import { describe, expect, it, vi } from "vitest";
import { ContextLossHandler } from "@/lib/engine/gl/context-loss";

describe("ContextLossHandler", () => {
  it("calls onLost and preventDefault when webglcontextlost fires", () => {
    const target = document.createElement("canvas");
    const onLost = vi.fn();
    new ContextLossHandler(target, { onLost });

    const event = new Event("webglcontextlost", { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    target.dispatchEvent(event);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("calls onRestored when webglcontextrestored fires", () => {
    const target = document.createElement("canvas");
    const onRestored = vi.fn();
    new ContextLossHandler(target, { onRestored });

    target.dispatchEvent(new Event("webglcontextrestored"));

    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("dispose() removes both listeners — subsequent events are no-ops", () => {
    const target = document.createElement("canvas");
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const handler = new ContextLossHandler(target, { onLost, onRestored });

    handler.dispose();
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    target.dispatchEvent(new Event("webglcontextrestored"));

    expect(onLost).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("simulateLost/simulateRestored drive the same handlers without a real DOM event", () => {
    const target = document.createElement("canvas");
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const handler = new ContextLossHandler(target, { onLost, onRestored });

    handler.simulateLost();
    handler.simulateRestored();

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("works with callbacks omitted (no-op, does not throw)", () => {
    const target = document.createElement("canvas");
    const handler = new ContextLossHandler(target);
    expect(() => handler.simulateLost()).not.toThrow();
    expect(() => handler.simulateRestored()).not.toThrow();
  });
});
