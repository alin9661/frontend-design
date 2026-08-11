import { createRef } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { motionValue, type MotionValue } from "framer-motion";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChapterScrubber, { originChapterId } from "@/components/origin/ChapterScrubber";
import OriginStory from "@/components/OriginStory";
import { originChapters } from "@/lib/visuals/origin-timeline";
import { setReducedMotion } from "./setup";

describe("components/origin/ChapterScrubber", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("renders named chapter links, their document targets, and one current chapter", () => {
    const { container } = render(<ScrubberFixture />);
    const navigation = screen.getByRole("navigation", { name: "Origin film chapters" });
    const links = within(navigation).getAllByRole("link");

    expect(links).toHaveLength(8);
    originChapters.forEach((chapter) => {
      const link = within(navigation).getByRole("link", { name: new RegExp(`${chapter.number}.*${chapter.title}`, "i") });
      expect(link).toHaveAttribute("href", `#${originChapterId(chapter.number)}`);
      expect(container.querySelector(link.getAttribute("href")!)).toBeInTheDocument();
    });
    expect(within(navigation).getAllByRole("link", { current: "step" })).toHaveLength(1);
    expect(within(navigation).getByRole("link", { name: /skip the film/i })).toHaveAttribute("href", "#flavors");
    expect(container.querySelector("#flavors")).toBeInTheDocument();
  });

  it("follows the film's progress so aria-current tracks the visible chapter", () => {
    const progress = motionValue(0);
    render(<ScrubberFixture progress={progress} />);

    expect(screen.getByRole("link", { current: "step" })).toHaveAccessibleName(/01.*root to leaf/i);

    act(() => progress.set(0.5));

    const current = screen.getAllByRole("link", { current: "step" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/04.*filled & sealed/i);
  });

  it("smoothly scrolls an animated film to a chapter peak", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { container } = render(<ScrubberFixture />);
    measurableFilm(container);

    fireEvent.click(screen.getByRole("link", { name: /03.*made into mate/i }));

    // Derived, so a reweighting retunes it rather than breaking it — but it
    // still pins the arithmetic (section top + travel × the chapter's PEAK),
    // so aiming at band.in or band.hold instead would fail.
    expect(scrollTo).toHaveBeenCalledWith({
      top: 200 + 7000 * originChapters[2].band.peak,
      behavior: "smooth",
    });
    // A plain sanity floor on the derivation itself: chapter 03 of seven has
    // to land in the film's first half and well clear of its top.
    const { top } = scrollTo.mock.calls.at(-1)![0] as ScrollToOptions;
    expect(top).toBeGreaterThan(200);
    expect(top).toBeLessThan(200 + 7000 * 0.5);
    expect(screen.getByRole("link", { name: /03.*made into mate/i })).toHaveAttribute("aria-current", "step");
  });

  it("uses an instant chapter jump when reduced motion is preferred", () => {
    setReducedMotion(true);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { container } = render(<ScrubberFixture />);
    measurableFilm(container);

    fireEvent.click(screen.getByRole("link", { name: /03.*made into mate/i }));

    expect(scrollTo).toHaveBeenCalledWith({
      top: 200 + 7000 * originChapters[2].band.peak,
      behavior: "auto",
    });
  });

  it.each([
    { label: "smoothly", reduced: false, behavior: "smooth" },
    { label: "instantly", reduced: true, behavior: "auto" },
  ])("centres the active chip in the strip $label without scrolling the page", ({ reduced, behavior }) => {
    setReducedMotion(reduced);
    const listScrollTo = vi.fn();
    // vi.spyOn returns the spy an earlier test already installed, history and
    // all, so this assertion has to start from a clean call log.
    const pageScrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    pageScrollTo.mockClear();
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      value: listScrollTo,
      writable: true,
    });

    try {
      const progress = motionValue(0);
      render(<ScrubberFixture progress={progress} />);
      listScrollTo.mockClear();

      act(() => progress.set(0.5));

      expect(listScrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior }));
      expect(pageScrollTo).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
    }
  });

  it("keeps the skip control quiet on a first visit and prominent on a return visit", () => {
    const first = render(<ScrubberFixture />);

    expect(first.container.querySelector("nav")).not.toHaveAttribute("data-returning");
    expect(screen.getByRole("link", { name: "Skip the film" })).toBeInTheDocument();
    first.unmount();

    const second = render(<ScrubberFixture />);

    expect(second.container.querySelector("nav")).toHaveAttribute("data-returning", "true");
    expect(
      screen.getByRole("link", { name: /skip the film .* already watched it this session/i }),
    ).toHaveAttribute("href", "#flavors");
  });

  it("survives a sessionStorage that throws, as private browsing modes do", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    expect(() => render(<ScrubberFixture />)).not.toThrow();
    expect(screen.getAllByRole("link", { name: /skip the film/i })).toHaveLength(1);

    getItem.mockRestore();
  });

  it("keeps the jump-list available in the reduced-motion static story", () => {
    setReducedMotion(true);
    render(<OriginStory />);

    const navigation = screen.getByRole("navigation", { name: "Origin film chapters" });
    expect(navigation).toHaveAttribute("data-layout", "document");
    expect(within(navigation).getAllByRole("link")).toHaveLength(8);
    expect(document.getElementById("origin-chapter-01")?.tagName).toBe("ARTICLE");
    originChapters.forEach((chapter) => {
      expect(document.getElementById(originChapterId(chapter.number))).toBeInTheDocument();
    });
  });
});

/** jsdom reports zero-sized layout, so the film's geometry is stubbed explicitly. */
function measurableFilm(container: HTMLElement) {
  const section = container.querySelector("[data-film]")!;
  Object.defineProperty(section, "scrollHeight", { configurable: true, value: 8000 });
  vi.spyOn(section, "getBoundingClientRect").mockReturnValue({
    bottom: 0, height: 0, left: 0, right: 0, top: 200, width: 0, x: 0, y: 200, toJSON: () => ({}),
  });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
}

function ScrubberFixture({ progress }: { progress?: MotionValue<number> } = {}) {
  const sectionRef = createRef<HTMLElement>();

  return (
    <section ref={sectionRef} data-film>
      <ChapterScrubber progress={progress ?? motionValue(0)} sectionRef={sectionRef} />
      {originChapters.map((chapter) => <div key={chapter.number} id={originChapterId(chapter.number)} />)}
      <div id="flavors" />
    </section>
  );
}
