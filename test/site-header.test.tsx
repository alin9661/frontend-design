import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useContext, useEffect } from "react";
import SiteHeader, { originFilmProgress } from "@/components/SiteHeader";
import Home from "@/app/page";
import { flavors } from "@/lib/flavors";
import {
  AutoSectionInk,
  AutoSectionInkContext,
  FlavorSectionInk,
  SectionInkProvider,
  pickInk,
  useSectionInk,
} from "@/lib/section-ink";
import { originBackgroundTrack } from "@/lib/visuals/origin-timeline";

/**
 * SoundToggle owns the soundscape's lifecycle, so the only way to observe the
 * header's half of the wiring is to stand in for it. By default this passes
 * straight through to the real component; a test that wants the handle seam
 * sets `soundToggleDouble.current` first.
 */
const { soundToggleDouble } = vi.hoisted(() => ({
  soundToggleDouble: { current: null as null | ((props: never) => unknown) },
}));

vi.mock("@/components/SoundToggle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/SoundToggle")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    default: (props: Record<string, unknown>) =>
      createElement((soundToggleDouble.current ?? actual.default) as never, props),
  };
});

afterEach(() => {
  soundToggleDouble.current = null;
  document.querySelectorAll("[data-origin-film]").forEach((el) => el.remove());
});

/**
 * jsdom reports every rect as zero, so a region is never "under the header".
 * Pinning the prototype makes the registration path observable.
 */
function pinRectsUnderHeader() {
  return vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue({
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
}

function InkPublisher({ color }: { color: string }) {
  useSectionInk(color);
  return null;
}

function InkReader() {
  return <output>{useSectionInk()}</output>;
}

describe("components/SiteHeader", () => {
  it("renders the wordmark and primary navigation destinations", () => {
    render(
      <SectionInkProvider>
        <SiteHeader />
      </SectionInkProvider>,
    );

    expect(screen.getByRole("link", { name: "Mateína" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Flavors" })).toHaveAttribute("href", "#flavors");
    expect(screen.getByRole("link", { name: "Benefits" })).toHaveAttribute("href", "#benefits");
    expect(screen.getByRole("link", { name: "Refer" })).toHaveAttribute("href", "/refer");
  });

  it("provides a skip link whose target exists in the rendered page", () => {
    render(
      <SectionInkProvider>
        <SiteHeader />
        <Home />
      </SectionInkProvider>,
    );

    const skipLink = screen.getByRole("link", { name: "Skip to content" });
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).toBeInTheDocument();
  });

  it("jumps header anchors immediately without changing global smooth-scroll behavior", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 20 });

    render(
      <SectionInkProvider>
        <SiteHeader />
        <main id="main-content" />
        <section id="flavors" />
      </SectionInkProvider>,
    );
    const target = document.getElementById("flavors")!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      bottom: 1000,
      height: 600,
      left: 0,
      right: 360,
      toJSON: () => ({}),
      top: 200,
      width: 360,
      x: 0,
      y: 200,
    });

    fireEvent.click(screen.getByRole("link", { name: "Flavors" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 156, left: 0, behavior: "auto" });
    expect(document.documentElement.style.scrollBehavior).toBe("");
    scrollTo.mockRestore();
  });
});

describe("lib/section-ink", () => {
  it("publishes forest ink for a light background and cream ink for a dark background", () => {
    const { rerender } = render(
      <SectionInkProvider>
        <InkPublisher color="#1D423C" />
        <InkReader />
      </SectionInkProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("#1D423C");

    rerender(
      <SectionInkProvider>
        <InkPublisher color="#F9F9EE" />
        <InkReader />
      </SectionInkProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("#F9F9EE");
  });

  it("picks forest ink on light backgrounds and cream ink on dark ones", () => {
    // The origin film animates from forest-deep to cream across its scroll.
    expect(pickInk("#142E29")).toBe("#F9F9EE");
    expect(pickInk("rgb(20, 46, 41)")).toBe("#F9F9EE");
    expect(pickInk("#F9F9EE")).toBe("#1D423C");
    expect(pickInk("rgb(242, 201, 76)")).toBe("#1D423C"); // lemon showcase
  });

  it("ignores unresolved or transparent backgrounds so the ink is left alone", () => {
    expect(pickInk("rgba(0, 0, 0, 0)")).toBeNull();
    expect(pickInk("")).toBeNull();
  });

  // AutoSectionInk used to sample its child's computed background on every
  // scroll frame. That never worked on the real page: OriginStory's <section>
  // root paints nothing (the a11y-transparent-section-roots criterion pins
  // that), so the sampler read "rgba(0, 0, 0, 0)" → pickInk → null → the ink
  // never moved off cream, leaving the header invisible over the film's cream
  // final chapter. The old test passed only because it fed a synthetic
  // <section style={{ backgroundColor }}> the component never renders. The
  // film now pushes ink through AutoSectionInkContext instead.
  it("relays the ink the origin film publishes, and ignores repeats", () => {
    const rects = pinRectsUnderHeader();
    const publishes: Array<(color: string) => void> = [];

    function FilmDouble() {
      publishes.push(useContext(AutoSectionInkContext));
      return null;
    }

    render(
      <SectionInkProvider>
        <AutoSectionInk>
          <FilmDouble />
        </AutoSectionInk>
        <InkReader />
      </SectionInkProvider>,
    );

    // Before any publish the header already agrees with the film's opening
    // background — that agreement is what lets the film skip an initial push.
    expect(screen.getByRole("status")).toHaveTextContent(
      pickInk(originBackgroundTrack.output[0])!,
    );

    // The film ends on cream — cream ink there would be invisible.
    act(() => publishes.at(-1)!(pickInk(originBackgroundTrack.output.at(-1)!)!));
    expect(screen.getByRole("status")).toHaveTextContent("#1D423C");

    const rendersBefore = publishes.length;
    act(() => publishes.at(-1)!("#1D423C"));
    expect(screen.getByRole("status")).toHaveTextContent("#1D423C");
    // Republishing the colour it already holds must not re-render the tree:
    // the film calls this on every scroll frame of a 1500svh section.
    expect(publishes.length).toBe(rendersBefore);

    rects.mockRestore();
  });

  it("keeps every origin-film background stop mapped to a readable ink", () => {
    // A background stop that pickInk cannot parse would silently leave the
    // header on whatever ink it happened to be holding.
    for (const background of originBackgroundTrack.output) {
      expect(pickInk(background)).toMatch(/^#(F9F9EE|1D423C)$/);
    }
    // The film opens dark and closes cream, so the ink has to invert.
    expect(pickInk(originBackgroundTrack.output[0])).toBe("#F9F9EE");
    expect(pickInk(originBackgroundTrack.output.at(-1)!)).toBe("#1D423C");
  });

  it("publishes the active flavor's ink from lib/flavors when the carousel advances", async () => {
    const rects = pinRectsUnderHeader();
    // Lemon (#F2C94C) needs forest ink; Mint (#24765F) needs cream.
    const lightBackgroundFlavor = flavors.find((flavor) => flavor.ink === "#1D423C")!;
    const darkBackgroundFlavor = flavors.find((flavor) => flavor.ink === "#F9F9EE")!;

    render(
      <SectionInkProvider>
        <FlavorSectionInk>
          <button type="button" aria-label={lightBackgroundFlavor.name} aria-pressed="true" />
          <button type="button" aria-label={darkBackgroundFlavor.name} aria-pressed="false" />
        </FlavorSectionInk>
        <InkReader />
      </SectionInkProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(lightBackgroundFlavor.ink);

    await act(async () => {
      screen
        .getByRole("button", { name: lightBackgroundFlavor.name })
        .setAttribute("aria-pressed", "false");
      screen
        .getByRole("button", { name: darkBackgroundFlavor.name })
        .setAttribute("aria-pressed", "true");
      await Promise.resolve();
    });

    expect(screen.getByRole("status")).toHaveTextContent(darkBackgroundFlavor.ink);
    rects.mockRestore();
  });
});

describe("components/SiteHeader — ambient soundscape switch (C2)", () => {
  const VIEWPORT = 800;

  function setViewportHeight(height: number) {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  }

  /** Puts an origin film on the page with a controllable scroll position. */
  function mountFilm(height: number) {
    const film = document.createElement("div");
    film.setAttribute("data-origin-film", "");
    document.body.appendChild(film);

    const position = { top: 0 };
    vi.spyOn(film, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          bottom: position.top + height,
          height,
          left: 0,
          right: 360,
          toJSON: () => ({}),
          top: position.top,
          width: 360,
          x: 0,
          y: position.top,
        }) as DOMRect,
    );

    return {
      /** Scrolls the film so `progress` of it has passed the viewport top. */
      scrollTo(progress: number) {
        position.top = -(height - window.innerHeight) * progress;
        act(() => {
          window.dispatchEvent(new Event("scroll"));
        });
      },
    };
  }

  /** Stands in for SoundToggle, exposing the handle seam the header uses. */
  function installToggleDouble(handle: { setProgress: (value: number) => void }) {
    soundToggleDouble.current = (({
      onSoundscapeChange,
    }: {
      onSoundscapeChange?: (soundscape: unknown) => void;
    }) => {
      useEffect(() => {
        onSoundscapeChange?.(handle);
      }, [onSoundscapeChange]);

      return (
        <button type="button" onClick={() => onSoundscapeChange?.(null)}>
          stop sound
        </button>
      );
    }) as never;
  }

  it("mounts the switch off by default, outside the header bar and last in the tab order", () => {
    render(
      <SectionInkProvider>
        <SiteHeader />
      </SectionInkProvider>,
    );

    const toggle = screen.getByRole("button", { name: "Ambient sound" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // After every piece of the header's wayfinding, so a keyboard visitor
    // reaches navigation first.
    const refer = screen.getByRole("link", { name: "Refer" });
    expect(refer.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ...and not inside the 64px bar, whose row is already full at 375px.
    expect(screen.getByRole("banner").contains(toggle)).toBe(false);
  });

  it("still paints the header itself in the published section ink", () => {
    render(
      <SectionInkProvider>
        <SiteHeader />
        <InkPublisher color="#1D423C" />
      </SectionInkProvider>,
    );

    expect(screen.getByRole("banner")).toHaveStyle({ color: "rgb(29, 66, 60)" });
  });

  it("never reaches the audio graph from the header's static import tree", () => {
    // The synth plus the origin timeline it reads must stay off "/"'s
    // first-load JS; SoundToggle pulls them in with `await import()` inside
    // the enable path only. A static edge here would undo that for every
    // visitor who never turns sound on.
    const source = readFileSync(join(process.cwd(), "components", "SiteHeader.tsx"), "utf8");
    expect(source).not.toMatch(/^import[^\n]*["']@\/lib\/audio/m);
    expect(source).toMatch(/SoundToggle/);
  });

  describe("originFilmProgress", () => {
    it("maps the film's rect onto 0..1 the way the film's own scroll does", () => {
      setViewportHeight(VIEWPORT);
      const film = mountFilm(8000);

      expect(originFilmProgress()).toBe(0);
      film.scrollTo(0.5);
      expect(originFilmProgress()).toBeCloseTo(0.5, 10);
      film.scrollTo(1);
      expect(originFilmProgress()).toBeCloseTo(1, 10);
    });

    it("clamps past both ends rather than reporting a chapter that does not exist", () => {
      setViewportHeight(VIEWPORT);
      const film = mountFilm(8000);

      film.scrollTo(-3);
      expect(originFilmProgress()).toBe(0);
      film.scrollTo(4);
      expect(originFilmProgress()).toBe(1);
    });

    it("reports the opening bed when there is no film to read", () => {
      setViewportHeight(VIEWPORT);
      // Every route except "/" — and a film shorter than the viewport, which
      // has no scroll range to divide by.
      expect(originFilmProgress()).toBe(0);
      mountFilm(VIEWPORT - 1);
      expect(originFilmProgress()).toBe(0);
    });
  });

  it("pushes the film's position into the live soundscape without re-rendering the header", () => {
    setViewportHeight(VIEWPORT);
    const setProgress = vi.fn();
    installToggleDouble({ setProgress });
    const film = mountFilm(8000);

    render(
      <SectionInkProvider>
        <SiteHeader />
      </SectionInkProvider>,
    );

    // Handed the current position the moment the soundscape starts, so the
    // audio does not open on chapter 01 halfway down the film.
    expect(setProgress).toHaveBeenLastCalledWith(0);

    film.scrollTo(0.75);
    expect(setProgress).toHaveBeenLastCalledWith(0.75);

    film.scrollTo(1);
    expect(setProgress).toHaveBeenLastCalledWith(1);
  });

  it("stops pushing progress once the toggle hands the soundscape back", () => {
    setViewportHeight(VIEWPORT);
    const setProgress = vi.fn();
    installToggleDouble({ setProgress });
    const film = mountFilm(8000);

    render(
      <SectionInkProvider>
        <SiteHeader />
      </SectionInkProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "stop sound" }));
    setProgress.mockClear();

    film.scrollTo(0.5);
    expect(setProgress).not.toHaveBeenCalled();
  });
});
