// lib/engine/gl/assets.ts
//
// Weighted, named-job asset loader feeding a single 0..1 progress value (see
// types.ts `AssetManager`, design doc §4). Jobs run concurrently; progress is
// weighted by each job's declared `weight` and only advances on job
// completion (jobs report no partial progress of their own). A rejected job
// propagates the failure out of `start()` (Promise.all semantics) so a
// caller (react/EngineProvider) can surface a load-failure state.

import type { AssetManager as AssetManagerContract } from "../types";

interface Job {
  id: string;
  weight: number;
  job: () => Promise<unknown>;
}

export class AssetManager implements AssetManagerContract {
  private jobs: Job[] = [];
  private results = new Map<string, unknown>();
  private totalWeight = 0;
  private doneWeight = 0;
  private listeners = new Set<(p: number, id: string) => void>();
  private started = false;

  add<T>(id: string, weight: number, job: () => Promise<T>): void {
    if (this.started) {
      throw new Error(`AssetManager.add: cannot add "${id}" after start()`);
    }
    if (this.jobs.some((j) => j.id === id)) {
      throw new Error(`AssetManager.add: duplicate asset id "${id}"`);
    }
    this.jobs.push({ id, weight, job: job as () => Promise<unknown> });
    this.totalWeight += weight;
  }

  get<T>(id: string): T {
    if (!this.results.has(id)) {
      throw new Error(`AssetManager.get: asset "${id}" is not loaded yet`);
    }
    return this.results.get(id) as T;
  }

  async start(): Promise<void> {
    this.started = true;

    if (this.jobs.length === 0) {
      this.emit(1, "");
      return;
    }

    await Promise.all(
      this.jobs.map(async (j) => {
        const value = await j.job();
        this.results.set(j.id, value);
        this.doneWeight += j.weight;
        const p = this.totalWeight === 0 ? 1 : this.doneWeight / this.totalWeight;
        this.emit(p, j.id);
      })
    );
  }

  onProgress(cb: (p: number, id: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(p: number, id: string): void {
    for (const cb of this.listeners) cb(p, id);
  }
}
