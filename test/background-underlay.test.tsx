import { cleanup, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import Providers from "@/app/providers";
import Benefits from "@/components/Benefits";
import FlavorShowcase from "@/components/FlavorShowcase";
import Footer from "@/components/Footer";
import OriginStory from "@/components/OriginStory";
import SocialProof from "@/components/SocialProof";
import { setReducedMotion } from "./setup";

// The shared WebGL canvas (lib/engine/react/GlCanvas.tsx) is a single
// `fixed inset-0 z-0` element behind all DOM. Any section that paints an
// opaque background on its OWN root element covers the whole canvas. jsdom
// does not composite, so a fully-occluded canvas still passes every other
// test in the suite — this file is the only thing that catches it.
//
// Add a sixth section here as one line.
const sections: Array<[name: string, Component: ComponentType]> = [
  ["OriginStory", OriginStory],
  ["FlavorShowcase", FlavorShowcase],
  ["Benefits", Benefits],
  ["SocialProof", SocialProof],
  ["Footer", Footer],
];

async function expectBackgroundUnderlay(root: HTMLElement, subject: string) {
  const occludes = `${subject}'s root paints its own background, which fully occludes the shared fixed z-0 GL canvas. Move it to an absolutely-positioned -z-10 underlay child.`;

  // 1. The section root itself must be transparent.
  const opaqueBackgroundClasses = Array.from(root.classList).filter(
    (className) => className.startsWith("bg-") && className !== "bg-transparent",
  );
  expect(opaqueBackgroundClasses, occludes).toEqual([]);
  expect(root.style.backgroundColor, occludes).toBe("");

  // 2. A DIRECT child underlay carries it instead. Direct child + inset-0
  //    matters: an underlay nested inside e.g. OriginStory's sticky viewport
  //    would only cover one screen of a 1200svh section.
  const underlay = Array.from(
    root.querySelectorAll<HTMLElement>(':scope > [aria-hidden="true"]'),
  ).find((element) => element.classList.contains("-z-10"));

  expect(
    underlay,
    `${subject} has no aria-hidden -z-10 underlay as a direct child of its root, so its background either occludes the shared z-0 GL canvas or does not cover the full section.`,
  ).toBeInTheDocument();

  const classes = Array.from(underlay!.classList);
  expect(classes, `${subject}'s underlay must be absolutely positioned`).toContain("absolute");
  expect(classes, `${subject}'s underlay must span the full section`).toContain("inset-0");

  // 3. The underlay actually paints — otherwise "no background anywhere"
  //    would silently pass and the section would render transparent. The two
  //    animated sections resolve their colour through framer-motion on the
  //    next frame rather than on the first synchronous render, hence waitFor.
  await waitFor(() => {
    const paints =
      Array.from(underlay!.classList).some((className) => className.startsWith("bg-")) ||
      underlay!.style.backgroundColor !== "";
    expect(
      paints,
      `${subject}'s underlay carries no background at all — the color was dropped, not moved.`,
    ).toBe(true);
  });
}

describe("components/{OriginStory,FlavorShowcase,Benefits,SocialProof,Footer} background underlays", () => {
  it.each(sections)("keeps the %s root transparent and paints through an underlay", async (name, Component) => {
    const { container } = render(
      <Providers>
        <Component />
      </Providers>,
    );

    await expectBackgroundUnderlay(container.firstElementChild as HTMLElement, name);
  });

  it("keeps OriginStory's reduced-motion document layout on an underlay too", async () => {
    cleanup();
    setReducedMotion(true);
    const { container } = render(
      <Providers>
        <OriginStory />
      </Providers>,
    );
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveAttribute("data-layout", "static");
    await expectBackgroundUnderlay(root, "OriginStory reduced-motion layout");
  });
});
