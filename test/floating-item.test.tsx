import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FloatingItem, { bobTimingFor } from "@/components/FloatingItem";
import { setReducedMotion } from "./setup";

// A2/A3 regression coverage (the original P1 fix shipped without a test for
// this hash -> timing math): a spread of x/y inputs, some sharing the same
// value on one axis so the hash actually has to combine both.
const SAMPLE_POSITIONS: Array<[string, string]> = [
  ["10%", "20%"],
  ["42%", "17%"],
  ["0%", "0%"],
  ["100%", "100%"],
  ["10%", "80%"],
  ["80%", "10%"],
  ["33%", "33%"],
  ["-5%", "5%"],
];

describe("bobTimingFor — pure hash -> idle-bob timing", () => {
  it("A3 regression: delay is always >= 0 and < 1.2s across a spread of inputs", () => {
    // Pre-fix, delay was `(hash % 300) / 100`, i.e. up to 3s — this
    // assertion (< 1.2) would FAIL against that code for any input whose
    // delay landed between 1.2 and 3.
    for (const [x, y] of SAMPLE_POSITIONS) {
      const { delay } = bobTimingFor(x, y);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(1.2);
    }
  });

  it("A2 regression: duration lands in the restored ~10-18s full-cycle range", () => {
    // Pre-fix (this branch, before the A2 fix), duration was
    // `BOB_BASE_S + (hash % 400) / 100` — i.e. 5-9s — and with the
    // rest-passing keyframes + default "loop" repeat, that whole value IS
    // the full round-trip time (twice as fast as the original mirror-based
    // pace). This assertion would FAIL against that code: a duration of,
    // say, 6s is well outside [10, 18).
    for (const [x, y] of SAMPLE_POSITIONS) {
      const { duration } = bobTimingFor(x, y);
      expect(duration).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThan(18);
    }
  });

  it("desyncs: different inputs produce different timings", () => {
    const timings = SAMPLE_POSITIONS.map(([x, y]) => bobTimingFor(x, y));
    const durations = new Set(timings.map((t) => t.duration));
    const delays = new Set(timings.map((t) => t.delay));
    // Not every one of 8 samples need be pairwise-unique, but a hash that
    // actually scatters inputs shouldn't collapse them all to one value.
    expect(durations.size).toBeGreaterThan(1);
    expect(delays.size).toBeGreaterThan(1);
  });

  it("is deterministic for the same x/y pair", () => {
    expect(bobTimingFor("10%", "20%")).toEqual(bobTimingFor("10%", "20%"));
  });
});

describe("components/FloatingItem", () => {
  it("renders its children", () => {
    render(
      <FloatingItem x="10%" y="20%">
        <span>floating child</span>
      </FloatingItem>
    );
    expect(screen.getByText("floating child")).toBeInTheDocument();
  });

  it("marks the outer wrapper aria-hidden and pointer-events none", () => {
    const { container } = render(
      <FloatingItem x="10%" y="20%">
        <span>floating child</span>
      </FloatingItem>
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveAttribute("aria-hidden", "true");
    expect(outer).toHaveStyle({ pointerEvents: "none" });
  });

  it("positions the outer wrapper at the given x/y", () => {
    const { container } = render(
      <FloatingItem x="42%" y="17%">
        <span>floating child</span>
      </FloatingItem>
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveStyle({ position: "absolute", left: "42%", top: "17%" });
  });

  it("zeroes out the parallax offset and disables the idle bob under reduced motion", () => {
    setReducedMotion(true);
    const { container } = render(
      <FloatingItem x="10%" y="20%" depth={1}>
        <span>floating child</span>
      </FloatingItem>
    );
    const outer = container.firstElementChild as HTMLElement;
    // x/y are hard-pinned to 0 under reduced motion, which framer-motion
    // renders as no transform at all rather than translate(0px, 0px).
    expect(outer).toHaveStyle({ transform: "none" });

    // The inner wrapper only gets an animate-driven inline style when the
    // idle bob animation is active; under reduced motion `animate` is
    // undefined, so no style attribute is rendered at all.
    const inner = outer.firstElementChild as HTMLElement;
    expect(inner).not.toHaveAttribute("style");
  });
});
