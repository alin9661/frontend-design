import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// framer-motion's useReducedMotion() (and any `(prefers-reduced-motion)`
// media query) reads window.matchMedia. jsdom implements matchMedia itself,
// so the old `if (!window.matchMedia)` guard never ran and every test was
// silently pinned to the browser's real "no preference" default. This is an
// unconditional, configurable mock: call `setReducedMotion(true)` in a test
// to simulate a reduced-motion environment, and it's reset to `false` after
// every test.
//
// framer-motion lazily initializes its reduced-motion singleton exactly once
// per module instance and subscribes to the media query's "change" event —
// it does NOT re-read matchMedia on every render. So `setReducedMotion` must
// notify existing listeners (not just flip a flag) for already-mounted
// singletons to observe the update on the next render.
type ChangeListener = () => void;

let matches = false;
const changeListeners = new Set<ChangeListener>();

window.matchMedia = function matchMedia(query: string): MediaQueryList {
  const mql = {
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: (cb: ChangeListener) => changeListeners.add(cb),
    removeListener: (cb: ChangeListener) => changeListeners.delete(cb),
    addEventListener: (event: string, cb: ChangeListener) => {
      if (event === "change") changeListeners.add(cb);
    },
    removeEventListener: (event: string, cb: ChangeListener) => {
      if (event === "change") changeListeners.delete(cb);
    },
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  return mql;
};

export function setReducedMotion(value: boolean): void {
  matches = value;
  changeListeners.forEach((cb) => cb());
}

afterEach(() => {
  setReducedMotion(false);
});

// framer-motion's whileInView relies on IntersectionObserver, which jsdom
// doesn't implement.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

window.IntersectionObserver = MockIntersectionObserver;
global.IntersectionObserver = MockIntersectionObserver;
