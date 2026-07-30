import { describe, expect, it } from "vitest";
import { flavors, brand } from "@/lib/flavors";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

describe("lib/flavors", () => {
  it("exposes exactly 5 flavors", () => {
    expect(flavors).toHaveLength(5);
  });

  it("has unique ids across all flavors", () => {
    const ids = flavors.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every flavor a non-empty name and tagline", () => {
    for (const flavor of flavors) {
      expect(flavor.name.trim().length).toBeGreaterThan(0);
      expect(flavor.tagline.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every flavor 7-character hex colors for bg/can/accent/ink", () => {
    for (const flavor of flavors) {
      expect(flavor.bg).toMatch(HEX_RE);
      expect(flavor.can).toMatch(HEX_RE);
      expect(flavor.accent).toMatch(HEX_RE);
      expect(flavor.ink).toMatch(HEX_RE);
      expect(flavor.bg).toHaveLength(7);
      expect(flavor.can).toHaveLength(7);
      expect(flavor.accent).toHaveLength(7);
      expect(flavor.ink).toHaveLength(7);
    }
  });

  it("includes 'mint' and 'raspberry' ids (Hero relies on non-null lookups for these)", () => {
    const ids = flavors.map((f) => f.id);
    expect(ids).toContain("mint");
    expect(ids).toContain("raspberry");
  });

  it("defines the brand palette with 7-character hex colors", () => {
    expect(brand.cream).toMatch(HEX_RE);
    expect(brand.forest).toMatch(HEX_RE);
    expect(brand.forestDeep).toMatch(HEX_RE);
  });
});
