// test/engine/core/events.test.ts
//
// lib/engine/core/events.ts — tiny typed emitter used internally by
// scroll.ts (and available to any other core module).

import { describe, expect, it, vi } from "vitest";
import { Emitter } from "@/lib/engine/core/events";

interface Events {
  scroll: { y: number };
  ping: undefined;
}

describe("Emitter", () => {
  it("calls every subscribed listener with the emitted payload", () => {
    const emitter = new Emitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on("scroll", a);
    emitter.on("scroll", b);

    emitter.emit("scroll", { y: 42 });

    expect(a).toHaveBeenCalledWith({ y: 42 });
    expect(b).toHaveBeenCalledWith({ y: 42 });
  });

  it("on() returns an unsubscribe function that stops future calls", () => {
    const emitter = new Emitter<Events>();
    const cb = vi.fn();
    const unsubscribe = emitter.on("scroll", cb);

    emitter.emit("scroll", { y: 1 });
    unsubscribe();
    emitter.emit("scroll", { y: 2 });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ y: 1 });
  });

  it("off() removes only the specified listener", () => {
    const emitter = new Emitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on("scroll", a);
    emitter.on("scroll", b);

    emitter.off("scroll", a);
    emitter.emit("scroll", { y: 1 });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("off() on a never-subscribed listener is a safe no-op", () => {
    const emitter = new Emitter<Events>();
    expect(() => emitter.off("scroll", vi.fn())).not.toThrow();
  });

  it("emitting an event with no listeners does not throw", () => {
    const emitter = new Emitter<Events>();
    expect(() => emitter.emit("ping", undefined)).not.toThrow();
  });

  it("clear() removes listeners across every event", () => {
    const emitter = new Emitter<Events>();
    const scrollCb = vi.fn();
    const pingCb = vi.fn();
    emitter.on("scroll", scrollCb);
    emitter.on("ping", pingCb);

    emitter.clear();
    emitter.emit("scroll", { y: 1 });
    emitter.emit("ping", undefined);

    expect(scrollCb).not.toHaveBeenCalled();
    expect(pingCb).not.toHaveBeenCalled();
  });

  it("a listener unsubscribing itself mid-emit does not disrupt the current dispatch pass", () => {
    const emitter = new Emitter<Events>();
    const calls: string[] = [];
    let unsubscribeA: () => void;
    const a = vi.fn(() => {
      calls.push("a");
      unsubscribeA();
    });
    const b = vi.fn(() => calls.push("b"));
    unsubscribeA = emitter.on("scroll", a);
    emitter.on("scroll", b);

    emitter.emit("scroll", { y: 1 });
    expect(calls).toEqual(["a", "b"]);

    emitter.emit("scroll", { y: 2 });
    expect(a).toHaveBeenCalledTimes(1); // unsubscribed after the first emit
    expect(b).toHaveBeenCalledTimes(2);
  });
});
