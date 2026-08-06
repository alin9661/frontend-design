import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useInView } from "framer-motion";
import Benefits from "@/components/Benefits";

// A4 regression coverage: `useInView` is mocked so the test can force both
// branches directly, since jsdom's real IntersectionObserver mock
// (test/setup.ts) never fires a callback — `initial: true` means the real
// hook would otherwise report "in view" forever in this environment.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useInView: vi.fn(() => true) };
});

afterEach(() => {
  vi.mocked(useInView).mockReturnValue(true);
});

describe("components/Benefits", () => {
  it("renders all three benefit card titles", () => {
    render(<Benefits />);
    expect(screen.getByText("ANTIOXIDANTS & NUTRIENTS")).toBeInTheDocument();
    expect(screen.getByText("MENTAL CLARITY & FOCUS")).toBeInTheDocument();
    expect(screen.getByText("SMOOTH, SUSTAINED LIFT")).toBeInTheDocument();
  });

  it("marks the decorative floating leaf wrappers aria-hidden", () => {
    const { container } = render(<Benefits />);
    const decorativeLeaves = container.querySelectorAll(
      '[aria-hidden="true"] svg'
    );
    expect(decorativeLeaves.length).toBe(3);
    for (const leaf of Array.from(decorativeLeaves)) {
      expect(leaf.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  describe("A4: decorative bob gating (useInView, mocked)", () => {
    // framer-motion doesn't write any inline style synchronously on mount —
    // it applies `animate` targets on a real timer/rAF loop — so these wait
    // a tick for it to actually tick before inspecting the DOM.
    it("in view: the three decorative leaf wrappers render with an active animate target", async () => {
      vi.mocked(useInView).mockReturnValue(true);
      const { container } = render(<Benefits />);
      const wrappers = Array.from(container.querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
      expect(wrappers.length).toBe(3);

      await new Promise((resolve) => setTimeout(resolve, 150));

      // `animate={{ y: [...], rotate: [...] }}` is a real, moving target, so
      // framer-motion drives it and writes a non-"none" transform once it's
      // ticked. The first leaf has no start delay (the other two — delay
      // 0.6s/1.2s — are still holding at their pre-delay pose this early),
      // so it's the reliable one to sample without waiting out the full
      // stagger.
      expect(wrappers[0]).toHaveAttribute("style");
      expect(wrappers[0].style.transform).not.toBe("none");
    });

    it("A4 regression: out of view, the leaves still render with an animate target that eases home to rest, not a frozen mid-air pose", async () => {
      // Pre-fix, the out-of-view branch was `animate={isInView ? {...} :
      // undefined}` — framer-motion never drives (or writes any inline
      // style for) an element whose `animate` prop is `undefined` (mirrors
      // FloatingItem's own reduced-motion case: "under reduced motion
      // `animate` is undefined, so no style attribute is rendered at all",
      // test/floating-item.test.tsx — verified directly against this same
      // framer-motion version: `animate={undefined}` never gets a `style`
      // attribute at all, while `animate={{y:0,rotate:0}}` settles to
      // `style="transform: none;"`). That's the bug: the bob would freeze
      // wherever it happened to be mid-air and pop back on re-entry instead
      // of easing to rest. This assertion (a `style` attribute IS present)
      // would FAIL against that pre-fix code, which renders no `style`
      // attribute at all when out of view.
      vi.mocked(useInView).mockReturnValue(false);
      const { container } = render(<Benefits />);
      const wrappers = Array.from(container.querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
      expect(wrappers.length).toBe(3);

      await new Promise((resolve) => setTimeout(resolve, 150));

      for (const wrapper of wrappers) {
        expect(wrapper).toHaveAttribute("style");
        expect(wrapper.style.transform).toBe("none");
      }
    });
  });
});
