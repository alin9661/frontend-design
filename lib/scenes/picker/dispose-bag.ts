// lib/scenes/picker/dispose-bag.ts
//
// Tiny disposal-bookkeeping helper: scene.ts's `dispose()` (SceneModule
// contract, ../../engine/types.ts — "MUST free every geometry/material/
// texture/target") registers one closure per resource as it builds them
// (five cans' `buildCan().dispose`, five label textures, the bg quad's
// geometry/material, the flavor GlText) and calls `disposeAll()` once. Kept
// as its own dependency-free module so the bookkeeping itself — call every
// registered disposer exactly once, then forget them (idempotent, and safe
// against SceneModule's re-runnable-init requirement re-populating it) — is
// unit-testable without needing the real three/hero-can/gl-text imports
// scene.ts pulls in.

export class DisposeBag {
  private disposers: Array<() => void> = [];

  add(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  /** Calls every registered disposer once, in registration order, then clears the bag. */
  disposeAll(): void {
    const pending = this.disposers;
    this.disposers = [];
    for (const dispose of pending) dispose();
  }

  get size(): number {
    return this.disposers.length;
  }
}
