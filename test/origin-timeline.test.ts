import { renderHook } from "@testing-library/react";
import { motionValue, useTransform } from "framer-motion";
import { describe, expect, it } from "vitest";
import {
  bandOpacity,
  bandOutputs,
  bandStops,
  generateOriginTimeline,
  isActive,
  originBackgroundTrack,
  ORIGIN_FADE_OVERLAP,
  originChapterWeights,
  originChapters,
  originCopyYTrack,
  originFoliageYTrack,
  originInkTrack,
  originIntroOpacityTrack,
  originIntroYTrack,
  originLineLengthTrack,
  originLineOpacityTrack,
  originPoseForProgress,
} from "@/lib/visuals/origin-timeline";

describe("lib/visuals/origin-timeline", () => {
  it("generates chapter bands from the weighted clock", () => {
    // Worked out from the weights rather than pasted from the output: the
    // three chapters before CAN carry weight 1 of a total 7.4, so CAN opens at
    // 3/7.4 and closes at 4.2/7.4, each edge softened by the shared overlap.
    // Pasting the raw floats back in would pin this file to the exact order
    // the implementation happens to do its arithmetic in, and would say
    // nothing about why those numbers are the right ones.
    const total = 7.4;
    const [enter, peak, hold, exit] = bandStops(3);

    expect(enter).toBeCloseTo(3 / total - ORIGIN_FADE_OVERLAP, 12);
    expect(peak).toBeCloseTo(3 / total + ORIGIN_FADE_OVERLAP, 12);
    expect(hold).toBeCloseTo(4.2 / total - ORIGIN_FADE_OVERLAP, 12);
    expect(exit).toBeCloseTo(4.2 / total + ORIGIN_FADE_OVERLAP, 12);
    // CAN is the film's centrepiece and must sit in its middle third.
    expect(peak).toBeGreaterThan(1 / 3);
    expect(peak).toBeLessThan(2 / 3);

    expect(originChapters).toHaveLength(7);
    expect(originChapterWeights).toHaveLength(7);
    expect(originChapterWeights[3]).toBeGreaterThan(originChapterWeights[2]);
    expect(originChapterWeights[6]).toBeGreaterThan(originChapterWeights[5]);
    expect(originChapterWeights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(total, 12);
  });

  it("opens the first chapter at 0 and holds the last one through 1", () => {
    // The clamps at both ends: chapter 01 has no room to fade in before the
    // film starts, and chapter 07 must not fade out before it ends.
    expect(bandStops(0)[0]).toBe(0);
    expect(bandStops(6).slice(2)).toEqual([1, 1]);
  });

  it("rejects missing or non-positive chapter weights", () => {
    expect(() => generateOriginTimeline([1, 1])).toThrow(RangeError);
    expect(() => generateOriginTimeline([1, 1, 1, 1, 1, 1, 0])).toThrow(RangeError);
  });

  it("keeps adjacent chapters overlapped with balanced spans and visible plateaus", () => {
    const spans = originChapters.map(({ band }) => band.out - band.in);
    const plateaus = originChapters.map(({ band }) => band.hold - band.peak);

    expect(Math.max(...spans) / Math.min(...spans)).toBeLessThanOrEqual(1.6);
    expect(Math.min(...plateaus)).toBeGreaterThanOrEqual(0.08);
    expect(
      originChapters.slice(0, -1).every((chapter, index) =>
        chapter.band.out > originChapters[index + 1].band.in,
      ),
    ).toBe(true);
    expect(originChapters[4].band.hold - originChapters[4].band.peak).toBeGreaterThanOrEqual(0.08);
  });

  it("never leaves the film blank once the chapters have started", () => {
    // Pairwise overlap is necessary but not sufficient — what the viewer must
    // never hit is a scroll position where every chapter has faded out at
    // once. Sampled, because that is the actual property, not the arithmetic.
    //
    // Measured from chapter 01's peak: before that the chapters really are all
    // at zero, and it is the intro overlay that holds the screen (asserted
    // just below). This is where the old hand-entered bands could rot — a
    // retune that shortened one band left a gap nothing was watching for.
    const start = originChapters[0].band.peak;
    let darkest = Infinity;
    let darkestAt = -1;

    for (let sample = 0; sample <= 1000; sample += 1) {
      const progress = start + ((1 - start) * sample) / 1000;
      const brightest = Math.max(
        ...originChapters.map((_, index) => bandOpacity(index, progress)),
      );
      if (brightest < darkest) {
        darkest = brightest;
        darkestAt = progress;
      }
    }

    expect(darkest, `dimmest crossfade sits at progress ${darkestAt}`).toBeGreaterThan(0.5);
  });

  it("hands the screen from the intro to chapter 01 without a blank frame", () => {
    // The intro must still be fully opaque at the exact moment chapter 01
    // reaches full opacity, or the film opens on an empty background.
    const { peak } = originChapters[0].band;
    const [introIn, introHold, introOut] = originIntroOpacityTrack.input;

    expect(originIntroOpacityTrack.output).toEqual([1, 1, 0]);
    expect(introIn).toBe(0);
    expect(introHold).toBe(peak);
    expect(bandOpacity(0, peak)).toBe(1);
    // The intro then fades across chapter 01's own plateau, never after it.
    expect(introOut).toBeGreaterThan(introHold);
    expect(introOut).toBeLessThanOrEqual(originChapters[0].band.hold);
  });

  it("anchors every visual track to generated chapter landmarks", () => {
    const reweighted = generateOriginTimeline([1, 1, 1.5, 1.2, 1, 1, 1.2]);
    const [first, , make, can, , stock, grab] = reweighted.bands;

    expect(reweighted.background.input).toEqual([
      first.in,
      make.peak,
      can.peak,
      stock.peak,
      grab.peak,
    ]);
    expect(reweighted.ink.input).toEqual([first.in, grab.in]);
    expect(reweighted.introOpacity.input).toEqual([first.in, first.peak, first.hold]);
    expect(reweighted.introY.input).toEqual([first.in, first.hold]);
    expect(reweighted.lineLength.input).toEqual([first.in, grab.peak]);
    expect(reweighted.lineOpacity.input).toEqual([
      first.in,
      first.peak,
      grab.peak,
      grab.hold,
    ]);
    // Every beat-anchored track must MOVE when the weights move. This is the
    // assertion that would have caught the original defect: six literal stop
    // arrays that stayed put while the bands underneath them were retuned.
    expect(reweighted.background.input).not.toEqual(originBackgroundTrack.input);
    expect(reweighted.ink.input).not.toEqual(originInkTrack.input);
    expect(reweighted.introOpacity.input).not.toEqual(originIntroOpacityTrack.input);
    expect(reweighted.introY.input).not.toEqual(originIntroYTrack.input);
    expect(reweighted.lineLength.input).not.toEqual(originLineLengthTrack.input);
    expect(reweighted.lineOpacity.input).not.toEqual(originLineOpacityTrack.input);
  });

  it("keeps the two ambient parallax tracks spanning the whole film", () => {
    // foliageY and copyY are drift, not beats. Anchoring them to a landmark
    // would freeze them for the scroll outside that landmark's range — on a
    // 800svh film, with deliberate breathing room at each end. Their independence
    // from the weights is deliberate, so it is asserted rather than assumed.
    const reweighted = generateOriginTimeline([1, 1, 1.5, 1.2, 1, 1, 1.2]);

    expect(originFoliageYTrack.input).toEqual([0, 1]);
    expect(originCopyYTrack.input).toEqual([0, 1]);
    expect(reweighted.foliageY.input).toEqual(originFoliageYTrack.input);
    expect(reweighted.copyY.input).toEqual(originCopyYTrack.input);
    // They are still real motion, not a constant.
    expect(originFoliageYTrack.output[0]).not.toBe(originFoliageYTrack.output[1]);
    expect(originCopyYTrack.output[0]).not.toBe(originCopyYTrack.output[1]);
  });

  it("holds the final chapter at the end of the scroll film", () => {
    expect(bandOpacity(6, 0.999)).toBe(1);
    expect(bandOpacity(6, 1)).toBe(1);
  });

  it("still fades a middle chapter at its own edges", () => {
    // Named landmarks, not pasted floats: what this pins is the shape of the
    // ramp (dark at both edges, full at the plateau), which has to survive a
    // reweighting — the numbers themselves are covered above.
    const { in: enter, peak, hold, out } = originChapters[3].band;

    expect(bandOpacity(3, enter)).toBe(0);
    expect(bandOpacity(3, peak)).toBe(1);
    expect(bandOpacity(3, hold)).toBe(1);
    expect(bandOpacity(3, out)).toBe(0);
    // Halfway up the fade-in really is halfway, not a step.
    expect(bandOpacity(3, (enter + peak) / 2)).toBeCloseTo(0.5, 6);
  });

  it("selects one accessible chapter at a time, beginning with the intro chapter", () => {
    expect(isActive(0, 0)).toBe(true);
    expect(originChapters.filter((_, index) => isActive(index, 0.7))).toHaveLength(1);
    expect(isActive(6, 1)).toBe(true);
  });

  it("derives the 3D pose from the same chapter clock", () => {
    expect(originPoseForProgress(originChapters[3].band.hold).fill).toBe(1);
    expect(originPoseForProgress(1).finalHold).toBe(1);
  });

  // Inherited from the deleted test/origin-3d.test.ts: the GL rig used to
  // clamp its own scroll input, and now feeds this function a view progress
  // it does not sanitise, so the clamp has to live (and be proven) here.
  it("clamps out-of-range progress to the first and last frame of the film", () => {
    expect(originPoseForProgress(-5)).toEqual(originPoseForProgress(0));
    expect(originPoseForProgress(5)).toEqual(originPoseForProgress(1));
    expect(originPoseForProgress(-5).plantGrowth).toBe(originPoseForProgress(0).plantGrowth);
    expect(originPoseForProgress(5).finalHold).toBe(1);
  });

  it("packs the carton before it departs, and clears both when the chapter ends", () => {
    const shipBand = originChapters[4].band;
    const packing = originPoseForProgress(shipBand.peak);
    const departing = originPoseForProgress(shipBand.hold);
    const gone = originPoseForProgress(shipBand.out);

    expect(packing.pack).toBe(1);
    expect(packing.ship).toBe(0);
    expect(departing.ship).toBe(1);
    expect(gone.pack).toBe(0);
    expect(gone.ship).toBe(0);
  });

  it("ends the terminal chapter's transform on a hold so framer cannot snap it to 0", () => {
    expect(bandOutputs(6)).toEqual([0, 1, 1, 1]);
    expect(bandOutputs(3)).toEqual([0, 1, 1, 0]);
  });

  it("keeps the payoff chapter opaque through a real useTransform at p === 1", () => {
    // Regression: with the naive [0, 1, 1, 0] output framer picks the
    // zero-width final segment and returns 0 at exactly p === 1, blanking the
    // payoff headline and the SHOP THE FLAVORS CTA at the bottom of the film.
    expect(renderedOpacity(6, 1)).toBe(1);
    expect(renderedOpacity(6, 0.999)).toBe(1);
    expect(renderedOpacity(6, originChapters[6].band.in)).toBe(0);
  });

  it("still fades a middle chapter through a real useTransform", () => {
    const band = originChapters[3].band;

    expect(renderedOpacity(3, band.in)).toBe(0);
    expect(renderedOpacity(3, band.peak)).toBe(1);
    expect(renderedOpacity(3, band.out)).toBe(0);
  });
});

/** The opacity framer itself produces for a chapter, not our arithmetic model. */
function renderedOpacity(index: number, progress: number): number {
  const source = motionValue(progress);
  const { result } = renderHook(() =>
    useTransform(source, bandStops(index), bandOutputs(index)),
  );

  return result.current.get();
}
