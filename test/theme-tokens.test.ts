import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard against color utility classes that reference a token nobody defined.
 *
 * Tailwind v4 fails SILENTLY here: `text-mint` compiles to nothing at all if
 * `--color-mint` is not in the `@theme` block. There is no build warning, no
 * type error, and no test failure — the element just inherits its parent color
 * and the design quietly loses an accent. This shipped in the Benefits rewrite
 * (`text-mint`, `text-lemon`, `text-raspberry`, `bg-raspberry`), where the
 * "Now/Later" duration rule rendered as an invisible hairline, and it was only
 * caught by looking at the page in a real browser.
 *
 * The trap is specific: flavor colors (mint, lemon, raspberry, peach, mango)
 * are product DATA in `lib/flavors.ts`, applied inline as `style={{ color }}`.
 * They read like theme tokens and are named like theme tokens, so writing
 * `text-mint` is the natural mistake. Duplicating them into `@theme` would be
 * the wrong fix — it would recreate the multi-source color duplication that
 * `lib/palette.ts` exists to prevent.
 */

const COMPONENTS_DIR = join(process.cwd(), "components");
const GLOBALS_CSS = join(process.cwd(), "app", "globals.css");

/** Prefixes that can carry a color token. */
const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "decoration",
  "from",
  "to",
  "via",
  "outline",
  "accent",
  "caret",
  "shadow",
  "divide",
  "placeholder",
];

/**
 * Bare words that follow a color prefix but are NOT colors — Tailwind's own
 * sizing/layout/behavior scales, plus the universal keyword colors that need no
 * theme token. Anything left over after this filter is claiming to be a color.
 */
const NOT_A_COLOR = new Set([
  // universal keywords
  "current", "transparent", "inherit", "white", "black", "none", "auto",
  // text-* sizing and alignment
  "xs", "sm", "base", "lg", "xl", "left", "right", "center", "justify", "start",
  "end", "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip",
  // border-*/divide-* sides and styles
  "t", "r", "b", "l", "x", "y", "s", "e", "solid", "dashed", "dotted", "double",
  "hidden", "collapse", "separate",
  // decoration-*
  "underline", "overline", "line", "through", "wavy",
  // ring-*/outline-*/shadow-* scale words
  "offset", "inset", "reverse",
  // bg-* behaviors
  "cover", "contain", "fixed", "local", "scroll", "repeat", "top", "bottom",
  "opacity", "blend", "origin", "position", "size",
]);

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** The `--color-<name>` tokens actually declared in the `@theme` block. */
function definedColorTokens(): Set<string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const names = [...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  return new Set(names);
}

/**
 * Only the contents of `className` values. Scanning raw file text produces
 * false positives from prose and comments — "caffeine-to-calm" in body copy
 * matches the `to-` gradient prefix, and a comment naming `text-mint` as the
 * thing to avoid flags itself.
 */
function classNameValues(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/**
 * Bare color-ish words used with a color prefix, e.g. `text-mint` yields
 * "mint". Skips numeric scales (`red-500`), opacity suffixes (`cream/70`),
 * and partial words left by a trailing scale value (`border-l-2`).
 */
function colorWordsIn(source: string): string[] {
  // `ring-offset-forest` is a color slot in its own right, so consume the
  // `offset` segment as part of the prefix rather than as the token name.
  const pattern = new RegExp(
    `\\b(?:${COLOR_PREFIXES.join("|")})-(?:offset-)?([a-z][a-z-]*)\\b`,
    "g",
  );
  return classNameValues(source).flatMap((value) =>
    [...value.matchAll(pattern)]
      .map((m) => m[1])
      // A trailing hyphen means a numeric scale followed (`border-l-2`), so
      // what we captured is a side/size fragment, not a color name.
      .filter((word) => !word.endsWith("-") && !NOT_A_COLOR.has(word)),
  );
}

describe("Tailwind @theme color tokens", () => {
  const tokens = definedColorTokens();

  it("declares the tokens the landing page relies on", () => {
    for (const required of ["cream", "forest", "forest-deep", "amber"]) {
      expect(tokens.has(required)).toBe(true);
    }
  });

  it("every color utility class in components/ resolves to a declared @theme token", () => {
    const offenders: string[] = [];

    for (const file of tsxFilesUnder(COMPONENTS_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const word of colorWordsIn(source)) {
        // Multi-word tokens like `forest-deep` are declared whole; a prefix
        // match on `forest` alone must not excuse `forest-deeper`.
        if (!tokens.has(word)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")}: ${word}`);
        }
      }
    }

    expect(
      offenders,
      `These color utilities reference tokens that are not declared in app/globals.css, so Tailwind emits nothing for them. Flavor colors (mint/lemon/raspberry/peach/mango) are product data in lib/flavors.ts — apply them inline via style={{ color: flavor.can }} rather than adding @theme tokens.`,
    ).toEqual([]);
  });

  it("catches an undeclared color the way the Benefits regression did", () => {
    // Regression pin: this is exactly the shape that shipped invisible.
    expect(colorWordsIn(`<p className="text-mint" />`)).toEqual(["mint"]);
    expect(tokens.has("mint")).toBe(false);
    // ...while a real token is accepted.
    expect(colorWordsIn(`<p className="text-cream" />`)).toEqual(["cream"]);
    expect(tokens.has("cream")).toBe(true);
    // Scale fragments and ring offsets must not read as color names.
    expect(colorWordsIn(`<p className="border-l-2 ring-offset-forest" />`)).toEqual([
      "forest",
    ]);
    // Prose outside a className is never scanned.
    expect(colorWordsIn(`<p>the caffeine-to-calm curve</p>`)).toEqual([]);
  });
});
