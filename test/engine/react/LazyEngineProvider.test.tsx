// The landing page's engine boundary. `/` has a byte budget
// (scripts/check-bundle.ts) that three.js blows through on its own, so the
// contract here is not "the engine eventually appears" — it is that NOTHING
// engine-shaped is reachable from the server pass or the first client render.
// Both branches of the mounted flag are asserted for that reason: the
// pre-mount branch is the one the bundle guarantee rests on.

import { act, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Stands in for the real provider so this file tests the BOUNDARY, not the
// engine: a real EngineProvider would spawn a worker and try for a GL
// context. `lazy(() => import("./EngineProvider"))` resolves through this.
vi.mock("@/lib/engine/react/EngineProvider", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="engine-provider">{children}</div>
  ),
}));

import LazyEngineProvider from "@/lib/engine/react/LazyEngineProvider";
import { setReducedMotion } from "../../setup";

describe("@/lib/engine/react/LazyEngineProvider", () => {
  it("renders the 2D origin film and no engine on the server pass", () => {
    const html = renderToStaticMarkup(
      <LazyEngineProvider>
        <p>engine child</p>
      </LazyEngineProvider>
    );

    // The section itself is server-rendered — the split must not cost the
    // landing page its above-the-fold content.
    expect(html).toContain("data-origin-film-fallback");
    // ...but the provider (and so the engine import) is not reached, and its
    // children are not rendered by the fallback path.
    expect(html).not.toContain("engine-provider");
    expect(html).not.toContain("engine child");
  });

  it("mounts the provider and its children after the first client commit", async () => {
    render(
      <LazyEngineProvider>
        <p>engine child</p>
      </LazyEngineProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("engine-provider")).toBeInTheDocument();
    });
    expect(screen.getByText("engine child")).toBeInTheDocument();
  });

  it("never mounts the engine for a reduced-motion visitor, who has no GL view to draw", async () => {
    // `/`'s only GL view lives in OriginStory's ANIMATED layout; under reduced
    // motion the component renders StaticStory, which calls useView zero
    // times. Mounting anyway downloaded the whole three.js + postprocessing
    // graph, took a WebGL context and spawned a worker to render nothing —
    // and nothing could catch it, since async chunks are not First Load JS.
    setReducedMotion(true);
    render(
      <LazyEngineProvider>
        <p>engine child</p>
      </LazyEngineProvider>,
    );

    // Give the mount effect and the lazy import every chance to land.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("engine-provider")).not.toBeInTheDocument();
    expect(screen.queryByText("engine child")).not.toBeInTheDocument();
    // ...and the visitor still gets the complete, readable 2D film.
    expect(document.querySelector("[data-layout='static']")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /ENERGY HAS ROOTS/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector("[data-riso-grain-static]")).toBeInTheDocument();
    });
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
  });
});
