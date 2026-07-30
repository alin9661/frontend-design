import "@testing-library/jest-dom/vitest";

// framer-motion's useReducedMotion() reads window.matchMedia; jsdom doesn't
// implement it, so provide a minimal mock (defaults to "no preference").
if (!window.matchMedia) {
  window.matchMedia = function matchMedia(query: string): MediaQueryList {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

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
