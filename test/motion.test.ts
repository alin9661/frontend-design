// test/motion.test.ts
//
// lib/motion.ts's shared tokens. F2 fix: every assertion here used to
// restate the literal value under test (`expect(EASE_OUT).toEqual([0.22, 1,
// 0.36, 1])`) — a pure change-detector that fails the whole suite the moment
// anyone retunes a curve/duration for a real design reason, while never
// checking the thing the module actually exists to guarantee: that
// components consume these shared tokens instead of re-declaring their own
// raw curves. Kept only the real invariants (shape/kind/range checks that
// survive a retune) and added a source-level guard for the part that
// matters.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAN_SPRING,
  CTA_SPRING,
  EASE_OUT,
  REVEAL,
  REVEAL_SLOW,
  SWAP,
  SWAP_FAST,
} from "@/lib/motion";

const TWEEN_TOKENS = { REVEAL, REVEAL_SLOW, SWAP, SWAP_FAST } as const;
const SPRING_TOKENS = { CTA_SPRING, CAN_SPRING } as const;

describe("lib/motion — real invariants (survive a retune, unlike a change-detector)", () => {
  it("EASE_OUT is a 4-number cubic-bezier tuple", () => {
    expect(EASE_OUT).toHaveLength(4);
    for (const n of EASE_OUT) expect(Number.isFinite(n)).toBe(true);
  });

  it("every tween token (REVEAL, REVEAL_SLOW, SWAP, SWAP_FAST) references EASE_OUT itself, not a copy", () => {
    for (const [name, token] of Object.entries(TWEEN_TOKENS)) {
      expect(token.ease, `${name}.ease`).toBe(EASE_OUT);
    }
  });

  it("every tween token's duration is a finite positive number", () => {
    for (const [name, token] of Object.entries(TWEEN_TOKENS)) {
      expect(Number.isFinite(token.duration), `${name}.duration finite`).toBe(true);
      expect(token.duration, `${name}.duration > 0`).toBeGreaterThan(0);
    }
  });

  it("REVEAL/SWAP/SWAP_FAST (the normal-scale entrance/swap tokens) sit inside the 50-700ms entrance-motion guidance", () => {
    // REVEAL_SLOW is deliberately excluded — it's the documented exception
    // for oversized/wordmark-scale reveals (see its doc comment in
    // lib/motion.ts), not a normal-scale entrance.
    for (const [name, token] of Object.entries({ REVEAL, SWAP, SWAP_FAST })) {
      expect(token.duration, `${name}.duration >= 0.05`).toBeGreaterThanOrEqual(0.05);
      expect(token.duration, `${name}.duration <= 0.7`).toBeLessThanOrEqual(0.7);
    }
  });

  it("REVEAL_SLOW is slower than REVEAL, and SWAP_FAST is faster than SWAP (the '_SLOW'/'_FAST' names mean something)", () => {
    expect(REVEAL_SLOW.duration).toBeGreaterThan(REVEAL.duration);
    expect(SWAP_FAST.duration).toBeLessThan(SWAP.duration);
  });

  it("REVEAL and SWAP durations are distinct (entrances vs. swaps read differently)", () => {
    expect(REVEAL.duration).not.toBe(SWAP.duration);
  });

  it("CTA_SPRING and CAN_SPRING are springs, not tweens (no duration/ease fields, finite positive stiffness/damping)", () => {
    for (const [name, token] of Object.entries(SPRING_TOKENS)) {
      expect(token.type, name).toBe("spring");
      expect(token, name).not.toHaveProperty("duration");
      expect(token, name).not.toHaveProperty("ease");
      expect(Number.isFinite(token.stiffness), `${name}.stiffness`).toBe(true);
      expect(token.stiffness, `${name}.stiffness > 0`).toBeGreaterThan(0);
      expect(Number.isFinite(token.damping), `${name}.damping`).toBe(true);
      expect(token.damping, `${name}.damping > 0`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-level guard: no landing component re-declares a raw curve instead
// of importing the shared token.
// ---------------------------------------------------------------------------

const COMPONENTS_DIR = join(import.meta.dirname, "../components");

/** Every top-level landing component plus components/deep-wave/*, the two
 * directories this motion-vocabulary unification actually covers — NOT
 * components/refer/ (an unrelated concept/route sharing this repo, per its
 * own README/CLAUDE.md conventions) or components/svg/ (pure icon markup,
 * no motion). */
function landingComponentFiles(): string[] {
  const top = readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => join(COMPONENTS_DIR, e.name));
  const deepWaveDir = join(COMPONENTS_DIR, "deep-wave");
  const deepWave = readdirSync(deepWaveDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => join(deepWaveDir, e.name));
  return [...top, ...deepWave];
}

// The exact EASE_OUT curve, allowing for incidental whitespace differences
// (`[0.22, 1, 0.36, 1]` vs `[0.22,1,0.36,1]`).
const RAW_EASE_OUT_TUPLE = /\[\s*0\.22\s*,\s*1\s*,\s*0\.36\s*,\s*1\s*\]/;
// framer's bare easing-name string form, e.g. `ease: "easeOut"`.
const BARE_EASE_STRING = /ease:\s*["']easeOut["']/;

describe("lib/motion — source-level guard: no landing component re-declares a raw curve", () => {
  const files = landingComponentFiles();

  it("finds at least one landing component to scan (the guard isn't accidentally scanning nothing)", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith("Hero.tsx"))).toBe(true);
  });

  it("no landing component under components/*.tsx or components/deep-wave/*.tsx contains an inline EASE_OUT-shaped tuple or a bare 'easeOut' string", () => {
    // Real, failing-if-violated check: re-introduce either pattern into any
    // scanned file (e.g. revert D3/D4's fix) and this test fails, naming the
    // offending file(s) — unlike the old suite, which couldn't have caught
    // that class of regression at all.
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (RAW_EASE_OUT_TUPLE.test(src) || BARE_EASE_STRING.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
