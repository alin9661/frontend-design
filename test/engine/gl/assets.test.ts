// test/engine/gl/assets.test.ts
//
// gl/assets.ts's AssetManager: weighted progress ordering (progress only
// advances on completion, weighted by each job's declared weight),
// get()/onProgress() semantics, and failure propagation out of start().

import { describe, expect, it, vi } from "vitest";
import { AssetManager } from "@/lib/engine/gl/assets";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("AssetManager — ordering + weighted progress", () => {
  it("reports 0..1 progress in job-completion order, weighted by declared weight", async () => {
    const manager = new AssetManager();
    const a = deferred<string>();
    const b = deferred<string>();
    const events: Array<{ p: number; id: string }> = [];
    manager.onProgress((p, id) => events.push({ p, id }));

    manager.add("a", 1, () => a.promise); // 1/4 of total weight
    manager.add("b", 3, () => b.promise); // 3/4 of total weight

    const started = manager.start();

    // "b" finishes first even though "a" was added first — completion order
    // drives progress order, not insertion order.
    b.resolve("B");
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([{ p: 0.75, id: "b" }]);

    a.resolve("A");
    await started;
    expect(events).toEqual([
      { p: 0.75, id: "b" },
      { p: 1, id: "a" },
    ]);
  });

  it("get() returns the resolved value after start() completes", async () => {
    const manager = new AssetManager();
    manager.add("font", 1, async () => ({ glyphs: 42 }));
    await manager.start();
    expect(manager.get<{ glyphs: number }>("font")).toEqual({ glyphs: 42 });
  });

  it("get() throws for an asset that hasn't loaded yet", () => {
    const manager = new AssetManager();
    manager.add("font", 1, async () => "value");
    expect(() => manager.get("font")).toThrow(/not loaded/);
  });

  it("get() throws for an unknown id", async () => {
    const manager = new AssetManager();
    await manager.start();
    expect(() => manager.get("nope")).toThrow();
  });

  it("resolves immediately with progress 1 when no jobs were added", async () => {
    const manager = new AssetManager();
    const cb = vi.fn();
    manager.onProgress(cb);
    await manager.start();
    expect(cb).toHaveBeenCalledWith(1, "");
  });

  it("onProgress's returned unsubscribe stops further callbacks", async () => {
    const manager = new AssetManager();
    const cb = vi.fn();
    const unsubscribe = manager.onProgress(cb);
    manager.add("a", 1, async () => "a");
    manager.add("b", 1, async () => "b");
    unsubscribe();
    await manager.start();
    expect(cb).not.toHaveBeenCalled();
  });

  it("add() after start() throws", async () => {
    const manager = new AssetManager();
    manager.add("a", 1, async () => "a");
    const started = manager.start();
    expect(() => manager.add("b", 1, async () => "b")).toThrow();
    await started;
  });

  it("add() with a duplicate id throws", () => {
    const manager = new AssetManager();
    manager.add("a", 1, async () => "a");
    expect(() => manager.add("a", 1, async () => "a2")).toThrow();
  });
});

describe("AssetManager — failure propagation", () => {
  it("start() rejects when any job rejects", async () => {
    const manager = new AssetManager();
    manager.add("good", 1, async () => "ok");
    manager.add("bad", 1, async () => {
      throw new Error("load failed");
    });

    await expect(manager.start()).rejects.toThrow("load failed");
  });

  it("a failed job's asset is never available via get()", async () => {
    const manager = new AssetManager();
    manager.add("bad", 1, async () => {
      throw new Error("nope");
    });
    await expect(manager.start()).rejects.toThrow();
    expect(() => manager.get("bad")).toThrow(/not loaded/);
  });
});
