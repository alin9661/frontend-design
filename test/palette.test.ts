import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brandPalette, glColor, glPalette, palette, scenePalette } from "@/lib/palette";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const globalsCss = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

/** `forestDeep` -> `forest-deep`, matching the Tailwind token naming. */
function tokenName(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function colorToken(css: string, name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6});`));
  if (!match) {
    throw new Error(`Missing --color-${name} in app/globals.css`);
  }
  return match[1];
}

describe("lib/palette", () => {
  it("converts a full hex color to the Three.js numeric format", () => {
    expect(glColor("#1D423C")).toBe(0x1d423c);
  });

  it.each(["1D423C", "#FFF"])("rejects malformed hex input: %s", (hex) => {
    expect(() => glColor(hex)).toThrow("glColor expects #RRGGBB");
  });

  it("derives each WebGL palette entry from its hex counterpart", () => {
    for (const [name, hex] of Object.entries(palette)) {
      expect(glPalette[name as keyof typeof glPalette]).toBe(glColor(hex));
    }
  });

  it("uses six-digit hex strings for every palette color", () => {
    for (const hex of Object.values(palette)) {
      expect(hex).toMatch(HEX_RE);
    }
  });

  it("keeps the Tailwind brand tokens aligned with the canonical brand palette", () => {
    expect(colorToken(globalsCss, "cream")).toBe(brandPalette.cream);
    expect(colorToken(globalsCss, "forest")).toBe(brandPalette.forest);
    expect(colorToken(globalsCss, "forest-deep")).toBe(brandPalette.forestDeep);
  });

  // The scene colors are the half of the palette that used to exist nowhere but
  // inline hex, so they are the half most likely to drift back out of sync.
  it.each(Object.entries(scenePalette))(
    "declares --color-%s in app/globals.css with the canonical value",
    (key, hex) => {
      expect(colorToken(globalsCss, tokenName(key))).toBe(hex);
    },
  );

  // The @theme block opens with a comment restating the canonical values. A
  // stale comment is how the four-way duplication justified itself last time,
  // so the comment is held to the same standard as the declarations.
  it.each(Object.entries({ ...brandPalette, ...scenePalette }))(
    "restates %s in the app/globals.css header comment",
    (_key, hex) => {
      const header = globalsCss.slice(0, globalsCss.indexOf("--color-cream"));
      expect(header).toContain("lib/palette.ts");
      expect(header).toContain(hex);
    },
  );
});
