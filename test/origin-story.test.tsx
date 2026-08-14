import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@/lib/engine/react/engine-context";

const { createEngineDepsMock } = vi.hoisted(() => ({ createEngineDepsMock: vi.fn() }));
vi.mock("@/lib/engine/react/create-engine", () => ({
  createEngineDeps: () => createEngineDepsMock(),
}));

// jsdom reports every rect as zero, so framer's real useScroll pins
// scrollYProgress at 0 forever and nothing downstream of it is observable.
// This hands the film a scroll position the test can drive. It rests at 0,
// which is exactly what the unmocked hook produces here, so every other case
// in this file behaves identically. The MotionValue itself is the shared film
// clock: DOM tracks and the engine's sticky range must sample the same value.
const { filmScroll } = vi.hoisted(() => ({
  filmScroll: { current: null as null | { set: (value: number) => void } },
}));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const scrollYProgress = actual.motionValue(0);
  filmScroll.current = scrollYProgress;

  return {
    ...actual,
    useScroll: () => ({
      scrollYProgress,
      scrollY: actual.motionValue(0),
      scrollX: actual.motionValue(0),
      scrollXProgress: actual.motionValue(0),
    }),
  };
});

import Home from "@/app/page";
import Providers from "@/app/providers";
import OriginStory from "@/components/OriginStory";
import {
  EngineContext,
  type EngineContextValue,
} from "@/lib/engine/react/engine-context";
import { flavorById, flavors } from "@/lib/flavors";
import { SWAP } from "@/lib/motion";
import { AutoSectionInk, SectionInkProvider, useSectionInk } from "@/lib/section-ink";
import {
  DRAG_INSPECT_DEFAULTS,
  DRAG_INSPECT_TOUCH_ACTION,
  DRAG_INSPECT_TOUCH_ACTION_IDLE,
} from "@/lib/visuals/drag-inspect";
import {
  createShelfHandoff,
  handoffCanTransform,
  handoffLayerOpacities,
  handoffLayerScale,
  handoffProgress,
} from "@/lib/visuals/shelf-to-showcase";
import { isActive, originBackgroundTrack, originChapters } from "@/lib/visuals/origin-timeline";
import { createFakeEngineDeps } from "./engine/react/test-utils/fake-engine";
import { setReducedMotion } from "./setup";

/** The viewId this file's engine double hands back from registerView. Named
 * because the VIEW_READY assertions are only meaningful if they name the SAME
 * id the origin film was actually registered under. */
const ORIGIN_FILM_VIEW_ID = 41;

/** Read off the token rather than hardcoded, so a SWAP retune can't silently
 * shorten the window these tests wait through. */
const SWAP_MS = SWAP.duration * 1000;

/** Let framer motion actually run frames. A synchronous assertion right after
 * a state change reads the pre-animation style and so passes for both the
 * right and the wrong behaviour — see the ASSETS_DONE case below. */
async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Deliver a WorkerToMain message and let React commit it. An un-act()-wrapped
 * __emit leaves the setState queued until the *next* act boundary, so the
 * component has not re-rendered yet and every subsequent style read is stale —
 * which silently turns the assertions below into no-ops. */
async function emit(
  deps: ReturnType<typeof createFakeEngineDeps>,
  message: Parameters<ReturnType<typeof createFakeEngineDeps>["host"]["__emit"]>[0],
): Promise<void> {
  await act(async () => {
    deps.host.__emit(message);
  });
}

function makeEngine(status: EngineStatus, readyViewIds: ReadonlySet<number> = new Set()): EngineContextValue {
  return {
    status,
    progress: status === "ready" ? 100 : 0,
    hostMode: "main",
    quality: "high",
    stats: null,
    registerView: vi.fn(() => ORIGIN_FILM_VIEW_ID),
    unregisterView: vi.fn(),
    invoke: vi.fn(),
    isViewReady: (viewId) => readyViewIds.has(viewId),
    onScrollProgress: vi.fn(() => vi.fn()),
  };
}

function renderOrigin(status: EngineStatus = "loading", readyViewIds: ReadonlySet<number> = new Set()) {
  const engine = makeEngine(status, readyViewIds);
  const rendered = render(
    <Providers>
      <EngineContext.Provider value={engine}>
        <OriginStory />
      </EngineContext.Provider>
    </Providers>,
  );

  return { ...rendered, engine };
}

describe("@/components/OriginStory", () => {
  it("registers the sticky stage as the origin-film view and exposes only the active chapter", () => {
    const { container, engine, unmount } = renderOrigin();

    expect(screen.getByRole("heading", { level: 1, name: /ENERGY HAS ROOTS/i })).toBeInTheDocument();
    expect(screen.getByText("MATEÍNA")).toHaveClass("font-display");
    expect(screen.getByText("yerba mate energy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meet the drink" })).toHaveAttribute("href", "#flavors");
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "ROOT TO LEAF" })).toBeInTheDocument();
    expect(screen.getByText(/living plant, growing toward the canopy in Misiones/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("link", { name: "SHOP THE FLAVORS" })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: "WHY YERBA MATE? ↓" })).toHaveLength(0);
    expect(container.firstElementChild).toHaveAttribute("data-layout", "sticky");
    expect(container.firstElementChild).toHaveClass("h-[650svh]", "md:h-[800svh]");
    // The bespoke <canvas> is gone for good: every pixel of GL now comes from
    // EngineProvider's single shared canvas, which is a sibling of this
    // section, never a child of it.
    expect(container.querySelector("canvas")).toBeNull();

    const stage = container.querySelector<HTMLElement>("[data-origin-film-view]");
    expect(stage).toBeInTheDocument();
    // `sticky: true` is what stops the engine from culling the film after one
    // viewport and from starting it at progress 0.5 — see the sticky-rect
    // cases in test/engine/react/EngineProvider.test.tsx. A plain
    // registerView(stage, "origin-film") is a silently broken film.
    // `post: true` alongside `sticky: true`. Both are load-bearing and both
    // are silent when missing: without `post` the shared composer is never
    // built for any frame of the page, so bloom, SMAA and the riso grain pass
    // (C6) render on no pixel at all.
    expect(engine.registerView).toHaveBeenCalledWith(stage, "origin-film", {
      sticky: true,
      post: true,
    });

    unmount();
    expect(engine.unregisterView).toHaveBeenCalledWith(ORIGIN_FILM_VIEW_ID);
  });

  it("caps the living line with an empty can silhouette that is drawn undistorted", () => {
    const { container } = renderOrigin();
    const terminus = container.querySelector<SVGSVGElement>("svg[data-can-terminus]");

    expect(terminus).toBeInTheDocument();
    expect(terminus).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(container.querySelector('svg[preserveAspectRatio="none"] path[stroke-linejoin]')).toBeNull();

    const fill = terminus!.querySelector<SVGPathElement>("path[fill='#F3B45E']");
    expect(fill).toBeInTheDocument();
    expect(fill).toHaveAttribute("opacity", "0");
  });

  it.each(["boot", "loading", "fallback"] satisfies EngineStatus[])(
    "keeps the complete 2D film visible while the engine status is %s",
    (status) => {
      const { container } = renderOrigin(status);

      expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });
      expect(container.querySelector("svg[data-origin-living-line]")).toBeInTheDocument();
      expect(container.querySelector("svg[data-can-terminus]")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "ROOT TO LEAF" })).toBeInTheDocument();
    },
  );

  it("keeps beat art visible when the engine is ready but this view is not, then fades it after VIEW_READY", async () => {
    const readyViewIds = new Set<number>();
    const { container, engine, rerender } = renderOrigin("ready", readyViewIds);

    expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });

    readyViewIds.add(ORIGIN_FILM_VIEW_ID);
    rerender(
      <Providers>
        <EngineContext.Provider value={{ ...engine }}>
          <OriginStory />
        </EngineContext.Provider>
      </Providers>,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "0" });
    });
    expect(container.querySelector("svg[data-origin-living-line]")).toBeInTheDocument();
    expect(container.querySelector("svg[data-can-terminus]")).toBeInTheDocument();
  });

  it.each(["boot", "loading", "fallback"] satisfies EngineStatus[])(
    "keeps beat art visible while status is %s even if that view already signalled VIEW_READY",
    async (status) => {
      // The other side of the `status === "ready" && isViewReady(id)` guard.
      // "fallback" is the one that bites: RenderHost.init() rejected, so
      // nothing will ever paint GL — but a VIEW_READY from a previous,
      // pre-teardown engine instance must not strip the 2D film off the page.
      const { container } = renderOrigin(status, new Set([ORIGIN_FILM_VIEW_ID]));
      await settle(SWAP_MS * 1.5);

      expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });
    },
  );

  it("keeps beat art visible when a sibling view is ready but the origin film's own view is not", async () => {
    // isViewReady must be asked about THIS view's id, not "is any view ready".
    const { container } = renderOrigin("ready", new Set([ORIGIN_FILM_VIEW_ID - 1, ORIGIN_FILM_VIEW_ID + 1]));
    await settle(SWAP_MS * 1.5);

    expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });
  });

  it("renders a non-sticky, fully readable sequence for reduced motion", () => {
    setReducedMotion(true);
    const { container, engine } = renderOrigin();

    expect(container.firstElementChild).toHaveAttribute("data-layout", "static");
    expect(container.querySelector("[data-origin-film-view]")).not.toBeInTheDocument();
    expect(engine.registerView).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: /ENERGY HAS ROOTS/i })).toBeInTheDocument();
    expect(screen.getByText("MATEÍNA")).toHaveClass("font-display");
    expect(screen.getByText("yerba mate energy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meet the drink" })).toHaveAttribute("href", "#flavors");
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
    expect(screen.getAllByText(/07 \/ 07/)).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: `${mintName()} can` }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "SHOP THE FLAVORS" })).toHaveAttribute("href", "#flavors");
    expect(screen.getByRole("link", { name: "WHY YERBA MATE? ↓" })).toHaveAttribute("href", "#benefits");
  });

  it("tracks the most visible static chapter and clears sticky navigation on anchor jumps", () => {
    let callback: IntersectionObserverCallback = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    const NativeObserver = globalThis.IntersectionObserver;

    class ControlledObserver {
      constructor(next: IntersectionObserverCallback) {
        callback = next;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
      takeRecords = () => [];
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    globalThis.IntersectionObserver = ControlledObserver as unknown as typeof IntersectionObserver;

    try {
      setReducedMotion(true);
      const { container, unmount } = renderOrigin();
      const chapters = Array.from(container.querySelectorAll<HTMLElement>("article[id^='origin-chapter-']"));
      const links = screen.getAllByRole("link", { name: /^0[1-7]/ });

      expect(observe).toHaveBeenCalledTimes(7);
      expect(chapters[0]).toHaveClass("scroll-mt-32", "md:scroll-mt-40");

      act(() => {
        callback(
          [
            { target: chapters[0]!, isIntersecting: true, intersectionRatio: 0.2 },
            { target: chapters[3]!, isIntersecting: true, intersectionRatio: 0.8 },
          ] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        );
      });

      expect(links[0]).not.toHaveAttribute("aria-current");
      expect(links[3]).toHaveAttribute("aria-current", "step");

      unmount();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      globalThis.IntersectionObserver = NativeObserver;
    }
  });

  it("keeps its complete 2D fallback when rendered without engine context", () => {
    const { container } = render(
      <Providers>
        <OriginStory />
      </Providers>,
    );

    expect(container.querySelector("[data-origin-film-fallback]")).toBeInTheDocument();
    expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });
    expect(container.querySelector("svg[data-origin-living-line]")).toBeInTheDocument();
  });

  it("lands animated chapter links one pixel inside their progress interval", () => {
    const { container } = renderOrigin();
    const section = container.querySelector<HTMLElement>("[data-origin-film]")!;
    const sectionTop = 500;
    const scrollHeight = 8000;
    const scrollableDistance = scrollHeight - window.innerHeight;
    Object.defineProperty(section, "scrollHeight", { configurable: true, value: scrollHeight });
    vi.spyOn(section, "getBoundingClientRect").mockReturnValue({
      top: sectionTop,
    } as DOMRect);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    screen.getByRole("link", { name: /^04FILLED & SEALED/ }).click();

    const call = scrollTo.mock.calls.at(-1)?.[0] as ScrollToOptions;
    const progress = (Number(call.top) - sectionTop) / scrollableDistance;
    expect(Number(call.top)).toBeCloseTo(
      sectionTop + scrollableDistance * originChapters[3]!.band.peak + 1,
      9,
    );
    expect(isActive(3, progress)).toBe(true);
    expect(isActive(2, progress)).toBe(false);
  });
});

describe("@/components/OriginStory — header ink", () => {
  // jsdom reports every rect as zero, so SectionInkRegion never counts itself
  // "under the header" and would swallow every publish.
  let rects: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 900,
      height: 900,
      left: 0,
      right: 360,
      toJSON: () => ({}),
      top: 0,
      width: 360,
      x: 0,
      y: 0,
    } as DOMRect);
  });

  afterEach(async () => {
    await scrubTo(0);
    rects.mockRestore();
  });

  function InkReader() {
    return <output data-testid="ink">{useSectionInk()}</output>;
  }

  /**
   * Moves the film to a scroll position and lets the change actually land.
   * A derived motion value does NOT notify synchronously on set(): framer
   * recomputes it in its own frame loop, so a synchronous assertion here
   * reads the pre-scrub ink and passes whatever the component publishes —
   * including nothing at all.
   */
  async function scrubTo(progress: number) {
    await act(async () => {
      filmScroll.current!.set(progress);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
  }

  function renderFilmUnderHeader() {
    render(
      <Providers>
        <SectionInkProvider>
          <AutoSectionInk>
            <OriginStory />
          </AutoSectionInk>
          <InkReader />
        </SectionInkProvider>
      </Providers>,
    );
  }

  it("inverts the header ink once the film's background reaches its cream stop", async () => {
    renderFilmUnderHeader();

    // Opening on the film's dark forest background: cream ink.
    expect(screen.getByTestId("ink")).toHaveTextContent("#F9F9EE");

    // Chapter 07's peak is where the background track reaches cream. Cream ink
    // on cream is an invisible header — this is the case the old computed-style
    // sampler silently never caught, because the film's <section> root paints
    // nothing for it to sample.
    await scrubTo(originBackgroundTrack.input.at(-1)!);
    expect(screen.getByTestId("ink")).toHaveTextContent("#1D423C");

    // ...and back again when the film is scrubbed backwards.
    await scrubTo(originBackgroundTrack.input[0]);
    expect(screen.getByTestId("ink")).toHaveTextContent("#F9F9EE");
  });

  it("keeps the header readable over the amber mid-film stop", async () => {
    renderFilmUnderHeader();

    // The amber stop (#9A5A2D) sits at chapter 04's peak. Publishing the copy's
    // own blended inkColor here would hand the header a mid-tone at roughly
    // 1.7:1 against it; the background-derived ink stays cream.
    await scrubTo(originBackgroundTrack.input[2]);
    expect(screen.getByTestId("ink")).toHaveTextContent("#F9F9EE");
  });
});

/**
 * Moves the film and lets framer actually apply the frame. A derived motion
 * value does not write the DOM on `set()` — it recomputes in framer's own
 * frame loop — so a synchronous read here sees the previous scroll position
 * and passes for both the right and the wrong behaviour.
 */
async function scrubFilm(progress: number): Promise<void> {
  await act(async () => {
    filmScroll.current!.set(progress);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

/** Reads back what framer actually wrote for one handoff can. */
function readHandoffCan(container: HTMLElement, flavorId: string) {
  const el = container.querySelector<HTMLElement>(`[data-handoff-can="${flavorId}"]`);
  if (!el) throw new Error(`No handoff can rendered for ${flavorId}`);

  // framer omits an identity component from the transform string, so an
  // absent `scale(...)` means scale 1 — reading it as NaN would make every
  // comparison against a parked (un-scaled) row vacuously "not equal".
  const read = (fn: string, identity: number) => {
    const match = new RegExp(`${fn}\\(([-0-9.e+]+)`).exec(el.style.transform);
    return match ? Number(match[1]) : identity;
  };

  return {
    x: read("translateX", 0),
    y: read("translateY", 0),
    scale: read("scale", 1),
    opacity: Number(el.style.opacity),
    zIndex: el.style.zIndex,
  };
}

describe("@/components/OriginStory — shelf-to-showcase handoff (C11)", () => {
  // The film's own leg of the handoff. Built with the same defaults the
  // component builds, so this is the module's arithmetic, not a second copy.
  const model = createShelfHandoff({ reducedMotion: false });
  const filmHandoff = (filmProgress: number) =>
    handoffProgress(model, { filmProgress, showcaseProgress: 0 });

  afterEach(async () => {
    await scrubFilm(0);
  });

  it("renders one decorative can per flavor, in flavor order", () => {
    const { container } = renderOrigin();
    const layer = container.querySelector<HTMLElement>("[data-shelf-handoff]");

    expect(layer).toBeInTheDocument();
    // The five cans are named and pickable in the showcase this row hands
    // over to; announcing them twice would just be noise.
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(
      Array.from(container.querySelectorAll("[data-handoff-can]")).map((el) =>
        el.getAttribute("data-handoff-can"),
      ),
    ).toEqual(flavors.map((flavor) => flavor.id));
  });

  it("keeps the shelf row off stage until the film's last chapter, then hands it over mid-fade", async () => {
    const { container } = renderOrigin();
    const layerOpacity = () =>
      Number(container.querySelector<HTMLElement>("[data-shelf-handoff]")!.style.opacity);

    // Chapter 07's band ramp is what brings the row on: before it opens there
    // is nothing to hand over, so the layer must not be painting cans over the
    // middle of the film.
    await scrubFilm(originChapters[6].band.in);
    expect(layerOpacity()).toBe(0);

    // ...it is fully on stage once the tail opens...
    await scrubFilm(originChapters[6].band.peak);
    expect(layerOpacity()).toBe(1);

    // ...and the film's LAST frame still owns the row outright. This is the
    // regression: with the crossfade window straddling the seam, the film's
    // own scroll could only ever reach the fade's midpoint, so the payoff
    // shot of a fifteen-viewport film sat permanently at 0.5 opacity with
    // nothing behind it — the showcase that the other half belongs to is
    // still a full viewport below at that moment.
    await scrubFilm(1);
    const expected = handoffLayerOpacities(model, filmHandoff(1)).film;
    expect(expected).toBe(1);
    expect(layerOpacity()).toBeCloseTo(1, 6);
  });

  it("positions every can from the shared model rather than its own stop arrays", async () => {
    const { container } = renderOrigin();

    await scrubFilm(1);
    const handoff = filmHandoff(1);

    for (const [index, flavor] of flavors.entries()) {
      const expected = handoffCanTransform(model, handoff, index);
      const actual = readHandoffCan(container, flavor.id);

      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
      expect(actual.scale).toBeCloseTo(expected.scale, 6);
      expect(actual.opacity).toBeCloseTo(expected.opacity, 6);
    }
  });

  it("keeps the row a SHELF for the whole film, and hands the ring to the showcase", async () => {
    const { container } = renderOrigin();

    await scrubFilm(originChapters[6].band.peak);
    const parked = flavors.map((flavor) => readHandoffCan(container, flavor.id));

    await scrubFilm(1);
    const terminal = flavors.map((flavor) => readHandoffCan(container, flavor.id));

    // The regression: the ring used to be driven off the raw handoff, which
    // the film's own scroll saturates at the seam — so the film's final frame
    // showed the row frozen exactly half-way through the shelf-to-carousel
    // morph, neither a shelf nor a carousel. The morph belongs entirely to
    // the showcase's leg, so across the whole film the row does not move.
    const shelfSpacing = model.geometry.shelfSpacing;
    for (let i = 0; i < terminal.length; i += 1) {
      expect(terminal[i].x).toBeCloseTo(parked[i].x, 6);
      expect(terminal[i].y).toBeCloseTo(parked[i].y, 6);
      expect(terminal[i].scale).toBeCloseTo(parked[i].scale, 6);
      expect(terminal[i].y).toBeCloseTo(model.geometry.shelfY, 6);
    }
    // ...and it really is the evenly-spaced shelf line, not a coincidence of
    // two frozen frames agreeing with each other.
    for (let i = 1; i < terminal.length; i += 1) {
      expect(terminal[i].x - terminal[i - 1].x).toBeCloseTo(shelfSpacing, 6);
    }

    // The ring is still real — it just belongs to the other section's leg,
    // which this component does not drive.
    const ring = handoffCanTransform(model, 1, 0);
    expect(ring.y).toBeCloseTo(model.geometry.carouselY, 6);
    expect(Math.abs(ring.x - handoffCanTransform(model, model.seam, 0).x)).toBeGreaterThan(1);
  });

  it("stacks the cans by depth so the ring never paints back-to-front", async () => {
    const { container } = renderOrigin();
    await scrubFilm(1);

    // On the shelf every can is at one depth, so the order is a stable
    // permutation rather than absent — an unset z-index is what let the far
    // side of the ring paint over the near side purely by flavor order.
    const order = flavors.map((flavor) => readHandoffCan(container, flavor.id).zIndex);
    expect(order.every((value) => value !== "")).toBe(true);
    expect([...order].map(Number).sort((a, b) => a - b)).toEqual(
      flavors.map((_, index) => index),
    );
  });

  it("scales the whole row down rather than letting a narrow viewport crop it", async () => {
    // 375px: the shelf spans 420px plus a can on each flank, so unscaled the
    // outermost cans sit entirely outside the stage's overflow-hidden box and
    // "five cans on a shelf" renders as three.
    const { container } = renderOrigin();
    await act(async () => {
      window.innerWidth = 375;
      window.dispatchEvent(new Event("resize"));
    });

    const fit = container.querySelector<HTMLElement>("[data-shelf-handoff-fit]");
    expect(fit).toBeInTheDocument();
    const applied = Number(/scale\(([-0-9.e+]+)\)/.exec(fit!.style.transform)?.[1] ?? NaN);
    expect(applied).toBeCloseTo(handoffLayerScale(model, 375), 9);
    expect(applied).toBeLessThan(1);

    // ...and it goes back to the authored size on a desktop viewport.
    await act(async () => {
      window.innerWidth = 1440;
      window.dispatchEvent(new Event("resize"));
    });
    expect(Number(/scale\(([-0-9.e+]+)\)/.exec(fit!.style.transform)?.[1] ?? NaN)).toBe(1);
  });

  it("withdraws the DOM shelf row the moment GL can draw its own", async () => {
    // The GL film renders a shelf of cans at the SAME model coordinates, but
    // through a perspective camera — so the two rows land on completely
    // different screen pixels and the film's payoff frame becomes a double
    // image, one row ghosted. LivingScene's beat art is gated on exactly this
    // signal for exactly this reason; the row was not, and had to be.
    const readyViewIds = new Set<number>();
    const { container, engine, rerender } = renderOrigin("ready", readyViewIds);
    await scrubFilm(1);

    expect(container.querySelector("[data-shelf-handoff]")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-handoff-can]")).toHaveLength(flavors.length);

    readyViewIds.add(ORIGIN_FILM_VIEW_ID);
    rerender(
      <Providers>
        <EngineContext.Provider value={{ ...engine }}>
          <OriginStory />
        </EngineContext.Provider>
      </Providers>,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-shelf-handoff]")).not.toBeInTheDocument();
    });
    expect(container.querySelectorAll("[data-handoff-can]")).toHaveLength(0);
  });

  it("has no handoff row at all in the reduced-motion layout", () => {
    setReducedMotion(true);
    const { container } = renderOrigin();

    expect(container.querySelector("[data-shelf-handoff]")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-handoff-can]")).toHaveLength(0);
  });
});

describe("@/components/OriginStory — drag-to-inspect gesture policy (C4)", () => {
  /** Comfortably past the module's axis-lock threshold. */
  const PAST_THRESHOLD = DRAG_INSPECT_DEFAULTS.axisLockThreshold * 4;
  /** Chapter 04 "CAN" — the only beat the inspector is allowed to arbitrate. */
  const CAN_BEAT = originChapters[3].band.peak;

  afterEach(async () => {
    await scrubFilm(0);
  });

  function dispatchPointer(
    target: EventTarget,
    type: string,
    clientX: number,
    clientY: number,
  ): MouseEvent {
    // jsdom's PointerEvent exists but a MouseEvent carrying a pointer type
    // name is what both React's synthetic system and a raw window listener
    // actually read here, and it keeps `cancelable` explicit — a
    // non-cancelable event makes preventDefault() a silent no-op and would
    // make this whole suite pass vacuously.
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  /** Runs one gesture and reports whether the page's scroll was taken. */
  async function drag(
    container: HTMLElement,
    filmProgress: number,
    dx: number,
    dy: number,
  ): Promise<boolean> {
    await scrubFilm(filmProgress);
    const stage = container.querySelector<HTMLElement>("[data-drag-inspect]")!;
    dispatchPointer(stage, "pointerdown", 200, 300);
    const move = dispatchPointer(window, "pointermove", 200 + dx, 300 + dy);
    dispatchPointer(window, "pointerup", 200 + dx, 300 + dy);
    return move.defaultPrevented;
  }

  it("declares the drag policy only while the can beat is on screen, never touch-action: none", async () => {
    const { container } = renderOrigin();
    const stage = container.querySelector<HTMLElement>("[data-drag-inspect]");
    const surface = container.querySelector<HTMLElement>("[data-drag-inspect-surface]");

    expect(stage).toBe(container.querySelector("[data-origin-film-view]"));
    expect(surface).toBeInTheDocument();

    // Outside chapter 04 the film asks for nothing: `pan-y` costs the visitor
    // the platform's own horizontal gestures (iOS's interactive back swipe,
    // for one) for an inspection the arbiter would refuse anyway.
    await scrubFilm(0);
    expect(surface!.style.touchAction).toBe(DRAG_INSPECT_TOUCH_ACTION_IDLE);

    await scrubFilm(CAN_BEAT);
    expect(surface!.style.touchAction).toBe(DRAG_INSPECT_TOUCH_ACTION);
    // The whole point: the browser keeps vertical panning natively on a
    // 650svh page. `none` would make the film a scroll trap.
    expect(surface!.style.touchAction).not.toBe("none");
    // ...and pinch-to-zoom survives, which a bare `pan-y` would revoke for
    // every pixel of the section (WCAG 1.4.4).
    expect(surface!.style.touchAction.split(/\s+/)).toContain("pinch-zoom");
  });

  it("never puts touch-action on an ancestor of the chapter scrubber", async () => {
    const { container } = renderOrigin();
    await scrubFilm(CAN_BEAT);

    const scrubber = container.querySelector<HTMLElement>("[aria-label='Origin film chapters']");
    expect(scrubber).toBeInTheDocument();

    // `touch-action` is intersected down the ancestor chain and a descendant
    // cannot opt back out, so ANY restricting ancestor kills the scrubber's
    // horizontally-scrolling chip strip — the film's only in-page navigation
    // on a phone.
    for (
      let node: HTMLElement | null = scrubber;
      node !== null;
      node = node.parentElement
    ) {
      const value = node.style.touchAction;
      expect(value === "" || value === "auto").toBe(true);
    }
  });

  it("takes a horizontal gesture inside the can beat", async () => {
    const { container } = renderOrigin();
    expect(await drag(container, CAN_BEAT, PAST_THRESHOLD, 2)).toBe(true);
  });

  it("hands a vertical gesture straight back to the scroller", async () => {
    const { container } = renderOrigin();
    expect(await drag(container, CAN_BEAT, 2, PAST_THRESHOLD)).toBe(false);
  });

  it("consumes nothing while the gesture is still under the axis-lock threshold", async () => {
    const { container } = renderOrigin();
    const under = DRAG_INSPECT_DEFAULTS.axisLockThreshold - 1;
    expect(await drag(container, CAN_BEAT, under, 0)).toBe(false);
  });

  it("ignores even a horizontal gesture outside the can beat", async () => {
    const { container } = renderOrigin();
    // Chapter 01: there is no can on stage to inspect, so the page keeps
    // every gesture.
    expect(await drag(container, originChapters[0].band.peak, PAST_THRESHOLD, 2)).toBe(false);
  });

  it("cancels a gesture that scrolls out of the can beat instead of flinging the can", async () => {
    const { container } = renderOrigin();
    const stage = container.querySelector<HTMLElement>("[data-drag-inspect]")!;

    await scrubFilm(CAN_BEAT);
    dispatchPointer(stage, "pointerdown", 200, 300);
    expect(dispatchPointer(window, "pointermove", 200 + PAST_THRESHOLD, 300).defaultPrevented).toBe(
      true,
    );

    // Leaving the chapter mid-drag releases the gesture; continuing to move
    // the finger must not keep stealing the scroll.
    await scrubFilm(originChapters[5].band.peak);
    expect(
      dispatchPointer(window, "pointermove", 200 + PAST_THRESHOLD * 2, 300).defaultPrevented,
    ).toBe(false);
  });

  it("keeps the same policy on the no-engine fallback stage", async () => {
    const { container } = render(
      <Providers>
        <OriginStory />
      </Providers>,
    );
    const stage = container.querySelector<HTMLElement>("[data-drag-inspect]");

    expect(stage).toBe(container.querySelector("[data-origin-film-fallback]"));
    expect(await drag(container, CAN_BEAT, PAST_THRESHOLD, 2)).toBe(true);
    expect(
      container.querySelector<HTMLElement>("[data-drag-inspect-surface]")!.style.touchAction,
    ).toBe(DRAG_INSPECT_TOUCH_ACTION);
  });

  it("has no gesture host at all in the reduced-motion layout", () => {
    setReducedMotion(true);
    const { container } = renderOrigin();

    expect(container.querySelector("[data-drag-inspect]")).not.toBeInTheDocument();
  });
});

describe("@/app/page", () => {
  beforeEach(() => {
    createEngineDepsMock.mockImplementation(() => createFakeEngineDeps());
    document.body.style.overflow = "";
  });

  afterEach(() => {
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

  it("paints the landing page immediately without a boot overlay or body-overflow lock", async () => {
    createEngineDepsMock.mockImplementationOnce(() =>
      createFakeEngineDeps({ initResolves: false }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <Providers>
        <Home />
      </Providers>,
    );

    expect(container.querySelector("#main-content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /ENERGY HAS ROOTS/i })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });

    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });
  });

  it("hands the beat art over to GL on a successful boot, still without an overlay or a scroll lock", async () => {
    let deps: ReturnType<typeof createFakeEngineDeps> | null = null;
    createEngineDepsMock.mockImplementationOnce(() => {
      deps = createFakeEngineDeps();
      return deps;
    });

    const { container } = render(
      <Providers>
        <Home />
      </Providers>,
    );

    // The engine registers the origin film's sticky stage as a real view —
    // the wiring, not just the markup, has to survive on "/".
    await waitFor(() => expect(deps!.host.addView).toHaveBeenCalled());
    const [, sceneId] = deps!.host.addView.mock.calls[0];
    expect(sceneId).toBe("origin-film");

    expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });

    // THE BUG this test pins: ASSETS_DONE is the engine's global "ready", and
    // it lands in the same tick as READY — before VIEW_ADD has even been
    // posted, let alone before the origin-film chunk has downloaded and its
    // SceneModule.init() has run. Handing the beat art over here opens a
    // 300ms-to-2s hole of bare background gradient.
    //
    // Both halves of this are load-bearing. The emit must be act()-wrapped or
    // React never commits the status change, and then a *broken* build reads
    // opacity "1" here too; and the read must come a full SWAP later, because
    // framer motion has not ticked a frame at the instant of the commit.
    await emit(deps!, { type: "ASSETS_DONE" });
    await settle(SWAP_MS * 1.5);
    expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "1" });

    const [viewId] = deps!.host.addView.mock.calls[0];
    await emit(deps!, { type: "VIEW_READY", viewId });

    await waitFor(() => {
      expect(container.querySelector("[data-origin-beat-art]")).toHaveStyle({ opacity: "0" });
    });
    // The narrative spine outlives the handover, and a booted engine still
    // never gates the page behind an overlay or a body-overflow lock.
    expect(container.querySelector("svg[data-origin-living-line]")).toBeInTheDocument();
    expect(container.querySelector("svg[data-can-terminus]")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});

function mintName() {
  return flavorById("mint").name;
}
