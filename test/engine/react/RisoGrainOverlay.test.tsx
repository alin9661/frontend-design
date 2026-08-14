// test/engine/react/RisoGrainOverlay.test.tsx
//
// The DOM half of C6. `risoGrainMode`'s `"fallback"` verdict documents that
// "the DOM layer should apply RISO_GRAIN_FALLBACK instead so the aesthetic
// degrades rather than vanishing" — for a while there was no such layer, so
// six unit tests exercised a descriptor that no pixel ever consumed and a
// low-tier visitor got no grain by either path. These tests assert the
// rendered element, not the descriptor.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RisoGrainOverlay from "@/lib/engine/react/RisoGrainOverlay";
import { RISO_GRAIN_FALLBACK, risoGrainMode } from "@/lib/engine/gl/shaders/riso-policy";
import type { QualityTier } from "@/lib/engine/types";

function overlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-riso-grain-fallback]");
}

describe("@/lib/engine/react/RisoGrainOverlay", () => {
  it("paints the print texture on the tier where the GPU pass declines", () => {
    // The low tier is exactly where `shouldEnableRisoGrain` is false, so this
    // overlay is the only thing that can carry the aesthetic there.
    expect(risoGrainMode({ quality: "low", reducedMotion: false, route: "/" })).toBe("fallback");

    const { container } = render(
      <RisoGrainOverlay quality="low" reducedMotion={false} route="/" />,
    );
    const el = overlay(container);

    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-hidden", "true");
    // The descriptor's own values, not a second copy of them.
    expect(el!.style.backgroundImage).toContain(RISO_GRAIN_FALLBACK.dataUri);
    expect(el!.style.backgroundRepeat).toBe("repeat");
    expect(el!.style.mixBlendMode).toBe("multiply");
    expect(el!.style.backgroundSize).toBe(
      `${RISO_GRAIN_FALLBACK.tileSize}px ${RISO_GRAIN_FALLBACK.tileSize}px`,
    );
    expect(Number(el!.style.opacity)).toBeGreaterThan(0);
    // Decorative and inert: it covers the whole viewport, so a single stray
    // pointer event here would swallow every click on the page.
    expect(el!.className).toContain("pointer-events-none");
    expect(el!.className).toContain("fixed");
  });

  it("still paints on the low tier under reduced motion — the texture is static either way", () => {
    const { container } = render(
      <RisoGrainOverlay quality="low" reducedMotion={true} route="/" />,
    );
    expect(overlay(container)).toBeInTheDocument();
    // The SVG carries no <animate>, so there is nothing to suppress.
    expect(RISO_GRAIN_FALLBACK.svg).not.toContain("<animate");
  });

  it.each(["medium", "high"] satisfies QualityTier[])(
    "paints nothing on the %s tier, where the GPU pass owns the grain",
    (quality) => {
      // Two copies of the same texture — one composited by the shader, one by
      // CSS — would double the coverage.
      const { container } = render(
        <RisoGrainOverlay quality={quality} reducedMotion={false} route="/" />,
      );
      expect(overlay(container)).not.toBeInTheDocument();
    },
  );

  it("paints nothing off the art-directed route, even on the low tier", () => {
    const { container } = render(
      <RisoGrainOverlay quality="low" reducedMotion={false} route="/deep-wave" />,
    );
    expect(overlay(container)).not.toBeInTheDocument();
  });

  it("paints nothing before a tier is known, or when the caller cannot name its route", () => {
    // `undefined` route is NOT the empty string: the policy normalises `""` to
    // `"/"` and would claim the landing page for a caller that never said so.
    expect(
      overlay(render(<RisoGrainOverlay quality={null} reducedMotion={false} route="/" />).container),
    ).not.toBeInTheDocument();
    expect(
      overlay(
        render(<RisoGrainOverlay quality="low" reducedMotion={false} route={undefined} />).container,
      ),
    ).not.toBeInTheDocument();
  });
});
