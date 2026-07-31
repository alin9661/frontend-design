// lib/engine/core/reduced-motion.ts
//
// matchMedia wrapper for `(prefers-reduced-motion: reduce)` (design doc §4,
// core/reduced-motion.ts). Two surfaces:
//   - `prefersReducedMotion()` — a one-shot read, used by scroll.ts to pick
//     its default `ScrollOptions.reducedMotion` when the caller doesn't
//     pass one explicitly.
//   - `ReducedMotion` — a live-updating wrapper for consumers that need to
//     react to the user flipping the OS setting mid-session (e.g. the react
//     bindings, gl/'s per-frame `reducedMotion` flag).
// `matchMedia` is injectable on both so tests never depend on jsdom's real
// implementation (or lack thereof, outside jsdom).

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type MatchMediaFn = (query: string) => MediaQueryList;

function defaultMatchMedia(): MatchMediaFn | undefined {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia.bind(window)
    : undefined;
}

/** One-shot read of the current reduced-motion preference. Returns `false`
 * (motion allowed) when no matchMedia implementation is available, e.g. in
 * a worker or a non-browser test environment. */
export function prefersReducedMotion(matchMediaFn?: MatchMediaFn): boolean {
  const fn = matchMediaFn ?? defaultMatchMedia();
  if (!fn) return false;
  return fn(REDUCED_MOTION_QUERY).matches;
}

export interface ReducedMotionOptions {
  /** Injectable for tests; defaults to `window.matchMedia`. */
  matchMedia?: MatchMediaFn;
}

/** Live-updating reduced-motion wrapper: reads the current value at
 * construction and notifies subscribers on every subsequent OS-level
 * change, for as long as the environment provides a matchMedia change
 * event (modern `addEventListener`, or the legacy `addListener` some older
 * MediaQueryList polyfills still use). */
export class ReducedMotion {
  private mql: MediaQueryList | null = null;
  private _value: boolean;
  private listeners = new Set<(value: boolean) => void>();

  private readonly handleChange = (e: { matches: boolean }): void => {
    this._value = e.matches;
    for (const cb of [...this.listeners]) cb(this._value);
  };

  constructor(opts: ReducedMotionOptions = {}) {
    const matchMediaFn = opts.matchMedia ?? defaultMatchMedia();

    if (matchMediaFn) {
      this.mql = matchMediaFn(REDUCED_MOTION_QUERY);
      this._value = this.mql.matches;
      if (typeof this.mql.addEventListener === "function") {
        this.mql.addEventListener("change", this.handleChange as unknown as EventListener);
      } else if (typeof this.mql.addListener === "function") {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy fallback
        this.mql.addListener(this.handleChange as (e: MediaQueryListEvent) => void);
      }
    } else {
      this._value = false;
    }
  }

  /** Current reduced-motion preference. */
  get value(): boolean {
    return this._value;
  }

  /** Subscribes to changes. Returns an unsubscribe function. */
  onChange(cb: (value: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Detaches the underlying matchMedia listener and clears subscribers. */
  destroy(): void {
    if (this.mql) {
      if (typeof this.mql.removeEventListener === "function") {
        this.mql.removeEventListener("change", this.handleChange as unknown as EventListener);
      } else if (typeof this.mql.removeListener === "function") {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy fallback
        this.mql.removeListener(this.handleChange as (e: MediaQueryListEvent) => void);
      }
    }
    this.listeners.clear();
  }
}
