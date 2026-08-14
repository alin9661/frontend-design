/**
 * The single source of truth for every non-flavor color on the site.
 *
 * Before this module the same values lived in four places that were kept in
 * sync by comment: the `@theme` block in `app/globals.css`, `brand`/`decor` in
 * `lib/flavors.ts`, CSS hex strings inlined through `components/OriginStory.tsx`,
 * and `0x` literals inlined through the origin film's GL rig (now
 * `lib/scenes/origin-film/rig.ts`). Two independent
 * design reviews flagged the duplication as a violation of the "define CSS
 * variables for the color system" rule, and it is genuinely error-prone: three
 * of the origin story's four scene colors existed nowhere else in the codebase.
 *
 * Three.js wants a number, CSS wants a string, and Tailwind wants a custom
 * property, so each color is declared once as a hex string and the numeric form
 * is derived. `glColor()` is the only conversion, so the two representations
 * cannot drift.
 *
 * Flavor colors deliberately stay in `lib/flavors.ts` — they are product data
 * (five SKUs with their own contrast-tuned ink), not chrome.
 */

/** Brand core. Mirrored by `--color-cream` / `--color-forest` / `--color-forest-deep`. */
export const brandPalette = {
  cream: "#F9F9EE",
  forest: "#1D423C",
  forestDeep: "#142E29",
} as const;

/**
 * The origin film's scene palette.
 *
 * `amber` is the living line and every warm accent that rides it — basket,
 * drum, packing tape, rim light. `clay` and `ochre` are the manufacturing
 * chapter's earth tones. `leaf` is the yerba plant itself. `kiln` is the
 * background the film passes through at the manufacturing beat, and exists
 * only as a background stop.
 */
export const scenePalette = {
  amber: "#F3B45E",
  clay: "#C5673C",
  ochre: "#D58A3D",
  leaf: "#74A56F",
  kiln: "#9A5A2D",
} as const;

/**
 * Light colors for the 3D scene. Not brand colors — these are the warm key and
 * cool fill of a single lighting rig, and changing them changes exposure rather
 * than identity.
 */
export const lightPalette = {
  keyWarm: "#FFF2D5",
  skyWarm: "#FFF6DF",
} as const;

/** Every palette entry, flattened. Useful for tests that assert coverage. */
export const palette = {
  ...brandPalette,
  ...scenePalette,
  ...lightPalette,
} as const;

export type PaletteKey = keyof typeof palette;

/**
 * Convert a `#RRGGBB` string to the 0xRRGGBB number Three.js constructors take.
 *
 * Throws rather than returning NaN: a silently-black material is far harder to
 * notice in a WebGL scene than a build-time failure, and every call site here
 * is module-level so a throw surfaces immediately.
 */
export function glColor(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new Error(`glColor expects #RRGGBB, received: ${hex}`);
  }
  return Number.parseInt(hex.slice(1), 16);
}

/** The palette as Three.js color numbers, derived so it can never drift from the hex. */
export const glPalette = {
  cream: glColor(brandPalette.cream),
  forest: glColor(brandPalette.forest),
  forestDeep: glColor(brandPalette.forestDeep),
  amber: glColor(scenePalette.amber),
  clay: glColor(scenePalette.clay),
  ochre: glColor(scenePalette.ochre),
  leaf: glColor(scenePalette.leaf),
  kiln: glColor(scenePalette.kiln),
  keyWarm: glColor(lightPalette.keyWarm),
  skyWarm: glColor(lightPalette.skyWarm),
} as const;
