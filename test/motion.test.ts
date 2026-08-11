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
import { createElement, useContext } from "react";
import { render } from "@testing-library/react";
import { m, motion, MotionConfigContext } from "framer-motion";
import { describe, expect, it, vi } from "vitest";
import Providers from "@/app/providers";
import {
  CAN_SPRING,
  CTA_SPRING,
  ORIGIN_SCROLL_SPRING,
  EASE_OUT,
  REVEAL,
  REVEAL_SLOW,
  SWAP,
  SWAP_FAST,
} from "@/lib/motion";

const TWEEN_TOKENS = { REVEAL, REVEAL_SLOW, SWAP, SWAP_FAST } as const;
const SPRING_TOKENS = { CTA_SPRING, CAN_SPRING, ORIGIN_SCROLL_SPRING } as const;

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

  it("shared springs have finite positive stiffness/damping and no duration/ease fields", () => {
    for (const [name, token] of Object.entries(SPRING_TOKENS)) {
      if ("type" in token) expect(token.type, name).toBe("spring");
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
const APP_DIR = join(import.meta.dirname, "../app");
const LIB_DIR = join(import.meta.dirname, "../lib");

/** Every top-level landing component plus components/deep-wave/* and
 * components/origin/*, the directories this motion-vocabulary unification
 * actually covers — NOT components/refer/ (an unrelated concept/route sharing
 * this repo, per its own README/CLAUDE.md conventions) or components/svg/
 * (pure icon markup, no motion).
 *
 * Nested dirs are listed explicitly rather than walked, so that adding a new
 * subdirectory is a deliberate decision about whether it speaks the landing
 * page's motion vocabulary — but a file added to an already-covered directory
 * is picked up automatically. */
const SCANNED_SUBDIRS = ["deep-wave", "origin"];

function tsxFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => join(dir, e.name));
}

/** Every .tsx under `dir`, at any depth. Used by the LazyMotion guards,
 * which — unlike the easing-vocabulary guard above — must cover EVERY file
 * that can render JSX, not a curated list: a `motion.*` element anywhere in
 * the tree ships the full renderer and throws under `strict`, so a guard
 * that skips app/, lib/ or components/svg/ would miss the regression it
 * exists to catch. */
function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFilesUnder(path);
    return e.isFile() && e.name.endsWith(".tsx") ? [path] : [];
  });
}

function landingComponentFiles(): string[] {
  return [
    ...tsxFilesIn(COMPONENTS_DIR),
    ...SCANNED_SUBDIRS.flatMap((sub) => tsxFilesIn(join(COMPONENTS_DIR, sub))),
  ];
}

function everyRenderingSourceFile(): string[] {
  return [
    ...tsxFilesUnder(COMPONENTS_DIR),
    ...tsxFilesUnder(APP_DIR),
    ...tsxFilesUnder(LIB_DIR),
  ];
}

/** Strips `//` and block comments so the prop scans below can't be tripped
 * by prose ("...can't read DOM layout — it's worker-safe"). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// The exact EASE_OUT curve, allowing for incidental whitespace differences
// (`[0.22, 1, 0.36, 1]` vs `[0.22,1,0.36,1]`).
const RAW_EASE_OUT_TUPLE = /\[\s*0\.22\s*,\s*1\s*,\s*0\.36\s*,\s*1\s*\]/;
// framer's bare easing-name string form, e.g. `ease: "easeOut"`.
const BARE_EASE_STRING = /ease:\s*["']easeOut["']/;
// `[^}]` already spans newlines, so the multi-line import form is covered
// without the `s` flag (which the project's TS target rejects).
const FULL_MOTION_IMPORT = /import\s*\{[^}]*\bmotion\b[^}]*\}\s*from\s*["']framer-motion["']/;
const FULL_MOTION_ELEMENT = /<\/?\s*motion\./;
// Props that only work under the LARGER `domMax` feature bundle. Under
// `domAnimation` they don't throw — they SILENTLY DO NOTHING, which is the
// one genuinely dangerous failure mode this migration introduces. If a
// future concept (C4's drag-to-inspect can) needs one of these, the fix is
// to switch app/providers.tsx to `domMax` and pay the bytes deliberately,
// not to wonder why the drag doesn't work.
const DOM_MAX_ONLY_PROP =
  /(?:^|\s)(?:drag|dragConstraints|dragElastic|dragMomentum|dragSnapToOrigin|dragPropagation|whileDrag|layout|layoutId|layoutRoot|layoutScroll|layoutDependency)(?:\s*=|\s*\/?>|\s|$)/m;
const REORDER_COMPONENT = /<\/?\s*Reorder\./;
// Tailwind's own easing utilities. `ease-out` resolves to
// `cubic-bezier(0, 0, 0.2, 1)`, a visibly different shape from EASE_OUT's
// `cubic-bezier(0.22, 1, 0.36, 1)` — so a `transition-* duration-200 ease-out`
// className is exactly the same drift as an inline `ease: "easeOut"`, just
// expressed where the tuple/string scans above cannot see it. The fix is
// `EASE_OUT_CSS` (or PROGRESS_TRANSITION_CSS) in a `style.transition`, which
// is what components/origin/ChapterScrubber.tsx already does.
//
// `ease-linear` is deliberately allowed: a linear ramp is a distinct
// intention, not a botched copy of the shared curve.
const TAILWIND_EASING_CLASS = /(?:^|\s|`|"|')(ease-(?:in|out|in-out))(?:\s|`|"|')/;

describe("lib/motion — source-level guard: no landing component re-declares a raw curve", () => {
  const files = landingComponentFiles();

  it("finds at least one landing component to scan (the guard isn't accidentally scanning nothing)", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith("OriginStory.tsx"))).toBe(true);
    // components/origin/ was added after this guard was written; assert it is
    // scanned so the directory can't silently fall outside the vocabulary.
    expect(files.some((f) => f.endsWith(join("origin", "ChapterScrubber.tsx")))).toBe(true);
  });

  it("no scanned landing component contains an inline EASE_OUT-shaped tuple or a bare 'easeOut' string", () => {
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

  it("no scanned landing component reaches for a Tailwind easing utility instead of the shared curve", () => {
    // The className form of the same regression the scan above catches: a
    // `transition-transform duration-200 ease-out` button animates on
    // Tailwind's curve, not the page's, and the tuple/string scans can never
    // see it. lib/motion.ts exports EASE_OUT_CSS for exactly this case.
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      const match = src.match(TAILWIND_EASING_CLASS);
      if (match) offenders.push(`${file} (${match[1]})`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("app/providers — strict LazyMotion bundle contract (behaviour, not source shape)", () => {
  it("throws on a full `motion.*` element rendered inside the provider tree (strict really is on)", () => {
    // This is the whole safety argument for `strict`: it converts a silent
    // payload regression (one `motion.*` import pulling the full renderer
    // back into the bundle) into a loud crash. Drop `strict` from
    // app/providers.tsx and this test fails.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        render(createElement(Providers, null, createElement(motion.div, { id: "full" }))),
      ).toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("renders `m.*` elements with their features loaded inside the provider tree", () => {
    const { container } = render(
      createElement(
        Providers,
        null,
        createElement(m.div, { id: "lite", initial: { opacity: 0 }, style: { x: 12 } }),
      ),
    );

    const el = container.querySelector("#lite") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.opacity).toBe("0");
    expect(el.style.transform).toContain("translateX(12px)");
  });

  it("still hands MotionConfig's reducedMotion=\"user\" down through the LazyMotion wrapper", () => {
    // The migration must not change reduced-motion behaviour: LazyMotion is
    // wrapped AROUND MotionConfig, so the config has to survive to consumers.
    let seen: unknown;
    function Probe() {
      seen = useContext(MotionConfigContext).reducedMotion;
      return null;
    }

    render(createElement(Providers, null, createElement(Probe)));

    expect(seen).toBe("user");
  });
});

describe("app/providers — the domAnimation bundle actually covers what the app uses", () => {
  const files = everyRenderingSourceFile();

  it("scans every .tsx under components/, app/ and lib/ (the guard isn't scanning nothing)", () => {
    expect(files.length).toBeGreaterThan(0);
    // Spot-check one file per scanned root, including the directories the
    // narrower easing guard deliberately skips.
    expect(files.some((f) => f.endsWith(join("components", "OriginStory.tsx")))).toBe(true);
    expect(files.some((f) => f.endsWith(join("components", "refer", "ReferralOntology.tsx")))).toBe(true);
    expect(files.some((f) => f.endsWith(join("app", "providers.tsx")))).toBe(true);
    expect(files.some((f) => f.endsWith(join("lib", "section-ink.tsx")))).toBe(true);
  });

  it("no rendering source file uses a full `motion.*` element or import", () => {
    const offenders = files.filter((file) => {
      const src = readFileSync(file, "utf8");
      return FULL_MOTION_IMPORT.test(src) || FULL_MOTION_ELEMENT.test(src);
    });

    expect(offenders).toEqual([]);
  });

  it("no rendering source file uses a drag/layout prop, which domAnimation would silently ignore", () => {
    const offenders = files.filter((file) => {
      const src = stripComments(readFileSync(file, "utf8"));
      return DOM_MAX_ONLY_PROP.test(src) || REORDER_COMPONENT.test(src);
    });

    expect(offenders).toEqual([]);
  });
});
