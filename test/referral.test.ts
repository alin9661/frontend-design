import { describe, expect, it } from "vitest";
import {
  buildReferralBlurb,
  referral,
  type ReferralConfig,
} from "@/lib/referral";

const base: ReferralConfig = {
  candidate: "Ada Lovelace",
  friend: "Charles",
  role: "Forward Deployed Engineer",
  company: "Palantir",
  contact: "ada@example.com",
};

describe("lib/referral", () => {
  it("names the candidate, the role, and how to reach them", () => {
    const blurb = buildReferralBlurb(base);
    expect(blurb).toContain("Ada Lovelace");
    expect(blurb).toContain("Forward Deployed Engineer");
    expect(blurb).toContain("ada@example.com");
  });

  it("includes a résumé line when a URL is configured", () => {
    const blurb = buildReferralBlurb({
      ...base,
      resumeUrl: "https://example.com/cv.pdf",
    });
    expect(blurb).toContain("Résumé: https://example.com/cv.pdf");
  });

  it("omits the résumé line entirely when no URL is configured", () => {
    // The other branch of the same conditional: a blurb that ends with a bare
    // "Résumé:" and no link would look broken in the friend's referral form.
    const blurb = buildReferralBlurb(base);
    expect(blurb).not.toMatch(/résumé/i);
  });

  it("stays pronoun-neutral so the template survives a different candidate", () => {
    const blurb = buildReferralBlurb(base);
    expect(blurb).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
  });

  it("ships a config the page can render without crashing", () => {
    // The shipped config is allowed to still hold the FILL_ME placeholder —
    // the page shows a setup notice for that — but the fields the blurb reads
    // must always be non-empty strings.
    expect(referral.candidate.length).toBeGreaterThan(0);
    expect(referral.role.length).toBeGreaterThan(0);
    expect(referral.contact).toMatch(/@/);
  });
});
