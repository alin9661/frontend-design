import { describe, expect, it } from "vitest";
import { CTA_SPRING, EASE_OUT, REVEAL, SWAP } from "@/lib/motion";

describe("lib/motion", () => {
  it("defines EASE_OUT as an easeOutQuint-like cubic-bezier tuple", () => {
    expect(EASE_OUT).toEqual([0.22, 1, 0.36, 1]);
  });

  it("defines REVEAL as a 0.6s transition using EASE_OUT", () => {
    expect(REVEAL).toEqual({ duration: 0.6, ease: EASE_OUT });
  });

  it("defines SWAP as a 0.5s transition using EASE_OUT", () => {
    expect(SWAP).toEqual({ duration: 0.5, ease: EASE_OUT });
  });

  it("defines CTA_SPRING as a spring with stiffness 400 and damping 25", () => {
    expect(CTA_SPRING).toEqual({ type: "spring", stiffness: 400, damping: 25 });
  });

  it("keeps REVEAL and SWAP durations distinct (entrances vs. swaps read differently)", () => {
    expect(REVEAL.duration).not.toBe(SWAP.duration);
  });
});
