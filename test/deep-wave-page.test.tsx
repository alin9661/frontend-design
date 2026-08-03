import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flavors } from "@/lib/flavors";

// This route's EngineProvider constructs the real engine (Ticker,
// VirtualScroll, RectTracker, PointerTracker, RenderHost) in an effect —
// real RenderHost.init() drives a real THREE.WebGLRenderer, which jsdom
// can't back with an actual WebGL context. Rather than depend on however
// that happens to fail in jsdom today, this suite mocks engine construction
// the same way test/engine/react/EngineProvider.test.tsx does, so the
// loading -> ready transition below is explicit and deterministic instead
// of incidental.
const { createEngineDepsMock } = vi.hoisted(() => ({ createEngineDepsMock: vi.fn() }));
vi.mock("@/lib/engine/react/create-engine", () => ({
  createEngineDeps: () => createEngineDepsMock(),
}));

import { createFakeEngineDeps } from "./engine/react/test-utils/fake-engine";
createEngineDepsMock.mockImplementation(() => createFakeEngineDeps());

// Imported after the mock so DeepWavePage's EngineProvider picks it up.
const { default: DeepWavePage } = await import("@/app/deep-wave/page");

function latestFakeDeps() {
  const result = createEngineDepsMock.mock.results.at(-1);
  if (!result || result.type !== "return") throw new Error("createEngineDeps was not called");
  return result.value as ReturnType<typeof createFakeEngineDeps>;
}

describe("app/deep-wave/page", () => {
  it("renders all 6 section headings", () => {
    render(<DeepWavePage />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(/SMOOTH LIFT\./);
    expect(h1).toHaveTextContent(/ZERO CRASH\./);

    expect(screen.getByRole("heading", { name: "Anatomy of a Lift." })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your Energy, Rendered." })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "It Knows You're There." })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "So Real It's Statistically Questionable.",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose Your Lift." })).toBeInTheDocument();
  });

  it("renders a semantic section landmark per scene id", () => {
    const { container } = render(<DeepWavePage />);
    for (const id of ["hero", "anatomy", "energy", "attention", "lounge", "picker"]) {
      expect(container.querySelector(`section#${id}`)).not.toBeNull();
    }
  });

  it("BUG B3 regression: no section carries an opaque bg-* class directly — each has a dedicated -z-10 background layer instead", () => {
    // The shared GL <canvas> (fixed, z-0, rendered before every section) is
    // a sibling of these sections. A `<section className="relative bg-*">`
    // has no z-index of its own, so CSS's painting order puts the WHOLE
    // section — including a background painted directly on it — in the same
    // stacking group as the canvas, ordered strictly by DOM position (later
    // wins). An opaque `bg-cream`/`bg-forest` class directly on the section
    // fully occluded the canvas: DRAW CALLS were non-zero but nothing was
    // ever visible. Each section now keeps its background in a separate
    // `-z-10` div that escapes to the page's root stacking context (painted
    // well before the canvas), while the section's own (now-transparent)
    // box still paints after the canvas so its content stays visible.
    const { container } = render(<DeepWavePage />);

    for (const id of ["hero", "anatomy", "energy", "attention", "lounge", "picker"]) {
      const section = container.querySelector(`section#${id}`);
      expect(section).not.toBeNull();
      expect(section!.className).not.toMatch(/(?:^|\s)bg-(?:cream|forest)(?:\s|$)/);

      const bgLayer = section!.querySelector('[aria-hidden="true"].bg-cream, [aria-hidden="true"].bg-forest');
      expect(bgLayer, `section#${id} is missing its -z-10 background layer`).not.toBeNull();
      expect(bgLayer!.className).toMatch(/-z-10/);
    }
  });

  it("shows a loading overlay while the engine boots, and dismisses it once ready — never removing the content underneath", async () => {
    render(<DeepWavePage />);

    // status starts "loading" as soon as EngineProvider's mount effect runs.
    expect(screen.getByRole("status")).toHaveTextContent(/Brewing your lift/);
    // The overlay covers, but never replaces, the real (GL-less-operable)
    // content — headings are still in the DOM the whole time (§6 a11y).
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();

    const deps = latestFakeDeps();
    act(() => {
      deps.host.__emit({ type: "ASSETS_DONE" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders a real DOM button per flavor, and selecting one updates the tagline panel", async () => {
    const user = userEvent.setup();
    render(<DeepWavePage />);

    // defaults to the first flavor in lib/flavors.ts
    const first = flavors[0]!;
    expect(screen.getByText(first.tagline)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: first.name, pressed: true })
    ).toBeInTheDocument();

    const raspberry = flavors.find((f) => f.id === "raspberry")!;
    await user.click(screen.getByRole("button", { name: raspberry.name, pressed: false }));

    expect(screen.getByText(raspberry.tagline)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: raspberry.name, pressed: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: first.name, pressed: false })
    ).toBeInTheDocument();
  });
});
