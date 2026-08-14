import { describe, expect, it } from "vitest";
import { flavors } from "@/lib/flavors";
import { originChapters } from "@/lib/visuals/origin-timeline";
import {
  activeCanIndex,
  activeHandoffFlavor,
  carouselPhase,
  createShelfHandoff,
  defaultHandoffGeometry,
  handoffCanPaintOrder,
  handoffCanTransform,
  handoffCanTransforms,
  handoffCrossfade,
  handoffLayerOpacities,
  handoffLayerScale,
  handoffPaintOrder,
  handoffProgress,
  HANDOFF_CROSSFADE,
  type HandoffCanTransform,
  type ShelfHandoffModel,
} from "@/lib/visuals/shelf-to-showcase";

const TAU = Math.PI * 2;

/**
 * Walks the whole gesture the way a visitor scrolls it: the film's tail first,
 * then the showcase's entrance, with the two legs meeting at the seam. Both
 * legs are sampled at the same step so the samples either side of the boundary
 * are directly comparable.
 */
function scrollSweep(model: ShelfHandoffModel, step: number): number[] {
  const samples: number[] = [];

  for (let t = 0; t <= 1 + 1e-9; t += step) {
    const filmProgress = model.filmTailStart + Math.min(t, 1) * (1 - model.filmTailStart);
    samples.push(handoffProgress(model, { filmProgress, showcaseProgress: 0 }));
  }
  for (let t = 0; t <= 1 + 1e-9; t += step) {
    samples.push(handoffProgress(model, { filmProgress: 1, showcaseProgress: Math.min(t, 1) }));
  }

  return samples;
}

/** Largest frame-to-frame movement of any can across a sweep. */
function maxTravelPerStep(model: ShelfHandoffModel, samples: number[]): number {
  let worst = 0;
  let previous: HandoffCanTransform[] | null = null;

  for (const h of samples) {
    const frame = handoffCanTransforms(model, h);
    if (previous) {
      for (let i = 0; i < frame.length; i += 1) {
        const delta = Math.hypot(
          frame[i].x - previous[i].x,
          frame[i].y - previous[i].y,
          frame[i].z - previous[i].z,
        );
        worst = Math.max(worst, delta);
      }
    }
    previous = frame;
  }

  return worst;
}

describe("lib/visuals/shelf-to-showcase", () => {
  describe("model construction", () => {
    it("takes its cans and its film entry point from the shared sources", () => {
      const model = createShelfHandoff();
      const lastChapter = originChapters[originChapters.length - 1];

      expect(model.canCount).toBe(flavors.length);
      expect(model.cans.map((can) => can.id)).toEqual(flavors.map((flavor) => flavor.id));
      // Derived from the origin timeline, not pasted: retuning chapter weights
      // moves the handoff's opening with them.
      expect(model.filmTailStart).toBe(lastChapter.band.peak);
      expect(model.filmTailStart).toBeGreaterThan(originChapters[5].band.peak);
      expect(model.filmTailStart).toBeLessThan(1);
    });

    it("derives the seam from the two leg weights", () => {
      expect(createShelfHandoff().seam).toBeCloseTo(1 / 2, 12);
      expect(
        createShelfHandoff({ filmTailWeight: 2, showcaseLeadWeight: 1 }).seam,
      ).toBeCloseTo(2 / 3, 12);
      expect(
        createShelfHandoff({ filmTailWeight: 1, showcaseLeadWeight: 3 }).seam,
      ).toBeCloseTo(1 / 4, 12);
    });

    it("opens the crossfade window AT the seam and closes it inside the showcase's leg", () => {
      for (const weights of [
        { filmTailWeight: 1, showcaseLeadWeight: 1 },
        { filmTailWeight: 9, showcaseLeadWeight: 1 },
        { filmTailWeight: 1, showcaseLeadWeight: 9 },
      ]) {
        const model = createShelfHandoff(weights);

        // The film's leg saturates exactly at the seam, so a window that
        // straddled it would leave the film's own terminal frame — a full
        // viewport of sticky stage with nothing behind it — permanently at
        // half opacity. The whole window therefore lives on the showcase's
        // leg, which is the only stretch where both layers are really
        // on screen together.
        expect(model.fadeStart).toBe(model.seam);
        expect(model.fadeEnd).toBeGreaterThan(model.seam);
        expect(model.fadeEnd).toBeLessThan(1);
      }

      // The window is a share of the showcase's leg, never an absolute span.
      const lopsided = createShelfHandoff({ filmTailWeight: 3, showcaseLeadWeight: 1 });
      expect(lopsided.fadeEnd - lopsided.seam).toBeCloseTo(
        (1 - lopsided.seam) * HANDOFF_CROSSFADE,
        12,
      );
    });

    it("leaves the film's terminal frame a fully opaque, un-morphed shelf", () => {
      const model = createShelfHandoff();
      // The most the film's own scroll can ever produce: its progress is
      // saturated and the showcase has not started entering.
      const terminal = handoffProgress(model, { filmProgress: 1, showcaseProgress: 0 });
      expect(terminal).toBe(model.seam);

      expect(handoffLayerOpacities(model, terminal).film).toBe(1);
      expect(carouselPhase(model, terminal)).toBe(0);

      // ...and geometrically it is the shelf, not something half-way to a ring.
      const shelf = handoffCanTransforms(model, 0);
      const frame = handoffCanTransforms(model, terminal);
      for (let i = 0; i < frame.length; i += 1) {
        expect(frame[i].x).toBeCloseTo(shelf[i].x, 12);
        expect(frame[i].y).toBeCloseTo(shelf[i].y, 12);
        expect(frame[i].scale).toBeCloseTo(shelf[i].scale, 12);
        expect(frame[i].opacity).toBeCloseTo(1, 12);
      }
      // The showcase's first flavor is at the front, not a third of the way
      // through the sweep.
      expect(activeCanIndex(model, terminal)).toBe(0);
    });

    it("accepts injected cans instead of the default flavor list", () => {
      const model = createShelfHandoff({
        cans: [flavors[2], flavors[0]],
      });

      expect(model.canCount).toBe(2);
      expect(handoffCanTransforms(model, 0).map((can) => can.flavorId)).toEqual([
        flavors[2].id,
        flavors[0].id,
      ]);
    });

    it("rejects nonsense inputs with a RangeError", () => {
      expect(() => createShelfHandoff({ cans: [flavors[0]] })).toThrow(RangeError);
      expect(() => createShelfHandoff({ filmTailWeight: 0 })).toThrow(RangeError);
      expect(() => createShelfHandoff({ showcaseLeadWeight: -1 })).toThrow(RangeError);
      expect(() => createShelfHandoff({ showcaseLeadWeight: Number.NaN })).toThrow(RangeError);
      expect(() => createShelfHandoff({ filmTailStart: 1 })).toThrow(RangeError);
      expect(() => createShelfHandoff({ filmTailStart: -0.1 })).toThrow(RangeError);
      expect(() => createShelfHandoff({ filmTailStart: Number.POSITIVE_INFINITY })).toThrow(
        RangeError,
      );
      expect(() => createShelfHandoff({ geometry: { shelfSpacing: 0 } })).toThrow(RangeError);
      expect(() => createShelfHandoff({ geometry: { carouselRadius: -10 } })).toThrow(RangeError);
      expect(() => createShelfHandoff({ geometry: { activeScale: 0 } })).toThrow(RangeError);
      expect(() => createShelfHandoff({ geometry: { shelfY: Number.NaN } })).toThrow(RangeError);
      expect(() => createShelfHandoff({ geometry: { backOpacity: 1.4 } })).toThrow(RangeError);

      const model = createShelfHandoff();
      expect(() => handoffProgress(model, { filmProgress: Number.NaN, showcaseProgress: 0 })).toThrow(
        RangeError,
      );
      expect(() =>
        handoffProgress(model, { filmProgress: 0, showcaseProgress: Number.NaN }),
      ).toThrow(RangeError);
      expect(() => handoffCanTransform(model, Number.NaN, 0)).toThrow(RangeError);
      expect(() => handoffCanTransform(model, 0.5, model.canCount)).toThrow(RangeError);
      expect(() => handoffCanTransform(model, 0.5, -1)).toThrow(RangeError);
      expect(() => handoffCanTransform(model, 0.5, 1.5)).toThrow(RangeError);
      expect(() => activeCanIndex(model, Number.NaN)).toThrow(RangeError);
    });
  });

  describe("the single handoff value", () => {
    it("anchors 0, the seam and 1 to the two scroll sources", () => {
      const model = createShelfHandoff();

      expect(handoffProgress(model, { filmProgress: 0, showcaseProgress: 0 })).toBe(0);
      expect(
        handoffProgress(model, { filmProgress: model.filmTailStart, showcaseProgress: 0 }),
      ).toBe(0);
      // The film ending and the showcase not yet moving is exactly the seam,
      // approached from either side.
      expect(handoffProgress(model, { filmProgress: 1, showcaseProgress: 0 })).toBeCloseTo(
        model.seam,
        12,
      );
      expect(handoffProgress(model, { filmProgress: 1, showcaseProgress: 1 })).toBe(1);
    });

    it("clamps rather than escaping 0..1 when a scroll source overshoots", () => {
      const model = createShelfHandoff();

      expect(handoffProgress(model, { filmProgress: -3, showcaseProgress: 0 })).toBe(0);
      expect(handoffProgress(model, { filmProgress: 4, showcaseProgress: 9 })).toBe(1);
    });

    it("never moves backwards as either source advances", () => {
      const model = createShelfHandoff({ filmTailWeight: 2, showcaseLeadWeight: 3 });
      const samples = scrollSweep(model, 0.005);

      for (let i = 1; i < samples.length; i += 1) {
        expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
      }
      expect(samples.at(0)).toBe(0);
      expect(samples.at(-1)).toBe(1);

      // Monotone in each argument on its own, too — the showcase leg can start
      // before the film's tail has finished without the value ever dipping.
      let previous = -1;
      for (let s = 0; s <= 1; s += 0.01) {
        const value = handoffProgress(model, { filmProgress: 0.95, showcaseProgress: s });
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    });

    it("crosses the seam without a gap", () => {
      const model = createShelfHandoff();
      const step = 1e-4;
      const lastFilmSample = handoffProgress(model, {
        filmProgress: 1 - step,
        showcaseProgress: 0,
      });
      const firstShowcaseSample = handoffProgress(model, {
        filmProgress: 1,
        showcaseProgress: step,
      });

      expect(model.seam - lastFilmSample).toBeLessThan(1e-3);
      expect(firstShowcaseSample - model.seam).toBeLessThan(1e-3);
    });
  });

  describe("per-can transforms", () => {
    it("starts on the film's shelf row and ends on the showcase's ring", () => {
      const model = createShelfHandoff();
      const start = handoffCanTransforms(model, 0);
      const end = handoffCanTransforms(model, 1);
      const { geometry } = model;

      // Shelf: evenly spaced, centred, all at one depth and one scale.
      for (let i = 1; i < start.length; i += 1) {
        expect(start[i].x - start[i - 1].x).toBeCloseTo(geometry.shelfSpacing, 12);
      }
      expect(start.reduce((sum, can) => sum + can.x, 0)).toBeCloseTo(0, 12);
      for (const can of start) {
        expect(can.y).toBe(geometry.shelfY);
        expect(can.z).toBe(geometry.shelfZ);
        expect(can.scale).toBe(geometry.shelfScale);
        expect(can.opacity).toBe(1);
      }

      // Ring: every can the same distance from the carousel's axis.
      for (const can of end) {
        expect(Math.hypot(can.x, can.z)).toBeCloseTo(geometry.carouselRadius, 9);
        expect(can.y).toBeCloseTo(geometry.carouselY, 12);
      }
    });

    it("emphasises the front can over the ones behind it", () => {
      const model = createShelfHandoff();
      const frame = handoffCanTransforms(model, 1);
      const front = frame.find((can) => can.active)!;
      const back = [...frame].sort((a, b) => a.z - b.z)[0];

      expect(front.z).toBeGreaterThan(back.z);
      expect(front.scale).toBeGreaterThan(back.scale);
      expect(front.opacity).toBeGreaterThan(back.opacity);
      // Relationships, not pinned numbers: the front can reaches the model's
      // active scale and full opacity, while the furthest one sits down in the
      // bottom quarter of the depth range (with an odd can count no can lands
      // exactly on the ring's far point, so it never hits the floor exactly).
      expect(front.scale).toBeCloseTo(model.geometry.activeScale, 9);
      expect(front.opacity).toBeCloseTo(1, 9);
      expect(back.opacity).toBeGreaterThan(model.geometry.backOpacity);
      expect(back.opacity).toBeLessThan(model.geometry.backOpacity + (1 - model.geometry.backOpacity) * 0.25);
      expect(back.scale).toBeGreaterThan(model.geometry.restingScale);
      expect(back.scale).toBeLessThan(
        model.geometry.restingScale + (model.geometry.activeScale - model.geometry.restingScale) * 0.25,
      );
    });

    it("stays finite and in range across the entire gesture", () => {
      const model = createShelfHandoff();

      for (const h of scrollSweep(model, 0.002)) {
        for (const can of handoffCanTransforms(model, h)) {
          expect(Number.isFinite(can.x)).toBe(true);
          expect(Number.isFinite(can.y)).toBe(true);
          expect(Number.isFinite(can.z)).toBe(true);
          expect(can.scale).toBeGreaterThan(0);
          expect(can.opacity).toBeGreaterThanOrEqual(0);
          expect(can.opacity).toBeLessThanOrEqual(1);
        }
      }
    });

    it("moves continuously, including at the section boundary", () => {
      const model = createShelfHandoff();
      const coarse = maxTravelPerStep(model, scrollSweep(model, 0.004));
      const fine = maxTravelPerStep(model, scrollSweep(model, 0.002));

      // A jump at the seam would survive refinement; continuous motion halves
      // with the step. This is the real continuity proof — no magic epsilon.
      expect(fine).toBeLessThan(coarse * 0.75);

      // And in absolute terms the worst single-frame move stays a small
      // fraction of the arrangement's own size.
      const span =
        model.geometry.shelfSpacing * (model.canCount - 1) + model.geometry.carouselRadius * 2;
      expect(coarse).toBeLessThan(span * 0.05);

      // Specifically across the boundary: the last film-leg frame and the
      // first showcase-leg frame are the same picture.
      const step = 1e-4;
      const before = handoffCanTransforms(
        model,
        handoffProgress(model, { filmProgress: 1 - step, showcaseProgress: 0 }),
      );
      const after = handoffCanTransforms(
        model,
        handoffProgress(model, { filmProgress: 1, showcaseProgress: step }),
      );
      for (let i = 0; i < before.length; i += 1) {
        expect(Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y, after[i].z - before[i].z)).toBeLessThan(
          span * 0.01,
        );
        expect(Math.abs(after[i].opacity - before[i].opacity)).toBeLessThan(0.01);
        expect(Math.abs(after[i].scale - before[i].scale)).toBeLessThan(0.01);
      }
    });
  });

  describe("the active flavor index", () => {
    it("advances exactly once per can and wraps back to the first flavor", () => {
      const model = createShelfHandoff();
      const visited: number[] = [];

      for (let h = 0; h <= 1 + 1e-9; h += 0.0005) {
        const index = activeCanIndex(model, Math.min(h, 1));
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(model.canCount);
        if (visited.at(-1) !== index) visited.push(index);
      }

      // Every can takes the front once, in flavor order, and the handoff ends
      // on the flavor the showcase renders first.
      expect(visited).toEqual([...flavors.map((_, i) => i), 0]);
      expect(activeCanIndex(model, 0)).toBe(0);
      expect(activeCanIndex(model, 1)).toBe(0);
      expect(activeHandoffFlavor(model, 1)).toBe(flavors[0]);
      // The entire sweep happens on the carousel's leg. Nothing rotates while
      // the film still owns the row, so the flavor the showcase inherits at
      // the boundary is the first one — not `round(seam * canCount)`.
      expect(activeHandoffFlavor(model, model.seam).id).toBe(flavors[0].id);
      for (const h of [0, 0.1, model.seam * 0.5, model.seam]) {
        expect(activeCanIndex(model, h)).toBe(0);
      }
    });

    it("sweeps the whole flavor list across the showcase's entrance, starting at the first", () => {
      // The regression this pins: the showcase reads `activeCanIndex` off a
      // handoff that already sits at the seam the moment the section enters
      // the viewport, so an index taken from the raw handoff jumped straight
      // to can 3 and fired two flavor swaps before the visitor had scrolled.
      const model = createShelfHandoff();
      const seen: number[] = [];

      for (let lead = 0; lead <= 1 + 1e-9; lead += 0.001) {
        const h = handoffProgress(model, {
          filmProgress: 1,
          showcaseProgress: Math.min(lead, 1),
        });
        const index = activeCanIndex(model, h);
        if (seen.at(-1) !== index) seen.push(index);
      }

      expect(seen).toEqual([...flavors.map((_, i) => i), 0]);
      expect(seen.at(0)).toBe(0);
    });

    it("marks exactly one can active at every point of the gesture", () => {
      const model = createShelfHandoff();

      for (const h of scrollSweep(model, 0.002)) {
        expect(handoffCanTransforms(model, h).filter((can) => can.active)).toHaveLength(1);
      }
    });

    it("gives each can an equal share of the front for any can count", () => {
      const model = createShelfHandoff({ cans: flavors.slice(0, 3) });
      const windows = new Map<number, number>();
      const step = 0.0005;

      // Measured over the CAROUSEL's leg — the stretch where the ring turns.
      // The film's leg is a static shelf by construction, so folding it in
      // would just report can 0 holding the front for half the gesture.
      for (let phase = 0; phase < 1; phase += step) {
        const h = model.seam + (1 - model.seam) * phase;
        const index = activeCanIndex(model, h);
        windows.set(index, (windows.get(index) ?? 0) + step);
      }

      expect(windows.size).toBe(3);
      const shares = [...windows.values()];
      for (const share of shares) {
        expect(share).toBeCloseTo(1 / 3, 2);
      }
    });
  });

  describe("layer crossfade", () => {
    it("hands one layer to the other across the fade window", () => {
      const model = createShelfHandoff();

      expect(handoffLayerOpacities(model, 0)).toEqual({ film: 1, showcase: 0 });
      expect(handoffLayerOpacities(model, model.fadeStart)).toEqual({ film: 1, showcase: 0 });
      expect(handoffLayerOpacities(model, 1)).toEqual({ film: 0, showcase: 1 });

      const middle = handoffLayerOpacities(model, (model.fadeStart + model.fadeEnd) / 2);
      expect(middle.film).toBeGreaterThan(0);
      expect(middle.film).toBeLessThan(1);
      // The seam itself is NOT mid-fade: it is the film's last full frame.
      expect(handoffLayerOpacities(model, model.seam)).toEqual({ film: 1, showcase: 0 });
      // The two layers always sum to full coverage, so the boundary never
      // shows a hole between the sections.
      for (const h of [0, 0.2, model.fadeStart, model.seam, model.fadeEnd, 0.9, 1]) {
        const { film, showcase } = handoffLayerOpacities(model, h);
        expect(film + showcase).toBeCloseTo(1, 12);
      }
    });

    it("crossfades monotonically", () => {
      const model = createShelfHandoff();
      let previous = -1;

      for (let h = 0; h <= 1 + 1e-9; h += 0.002) {
        const fade = handoffCrossfade(model, Math.min(h, 1));
        expect(fade).toBeGreaterThanOrEqual(previous);
        previous = fade;
      }
      expect(previous).toBeCloseTo(1, 12);
    });
  });

  describe("reduced motion", () => {
    it("holds the whole arrangement exactly as authored while the layers still swap", () => {
      const reduced = createShelfHandoff({ reducedMotion: true });
      const start = handoffCanTransforms(reduced, 0);

      for (const h of [0.25, reduced.seam, 0.75, 1]) {
        expect(carouselPhase(reduced, h)).toBe(0);
        const frame = handoffCanTransforms(reduced, h);
        for (let i = 0; i < frame.length; i += 1) {
          expect(frame[i].x).toBe(start[i].x);
          expect(frame[i].y).toBe(start[i].y);
          expect(frame[i].z).toBe(start[i].z);
          expect(frame[i].scale).toBe(start[i].scale);
          // Nothing recedes either: a can dimming as the visitor scrolls is
          // still motion, and the shelf row is a still picture here.
          expect(frame[i].opacity).toBe(1);
        }
      }

      // It IS the shelf — same numbers the geometry declares, not a frozen
      // point somewhere along the morph.
      for (const can of start) {
        expect(can.y).toBe(reduced.geometry.shelfY);
        expect(can.z).toBe(reduced.geometry.shelfZ);
        expect(can.scale).toBe(reduced.geometry.shelfScale);
      }

      // The one thing that still moves is the layer crossfade, which is a
      // readout of scroll position rather than an animation.
      expect(handoffLayerOpacities(reduced, 0)).toEqual({ film: 1, showcase: 0 });
      expect(handoffLayerOpacities(reduced, 1)).toEqual({ film: 0, showcase: 1 });
    });

    it("keeps the same clock as the animated variant, minus the travel", () => {
      const motionModel = createShelfHandoff();
      const reduced = createShelfHandoff({ reducedMotion: true });
      const scroll = { filmProgress: 1, showcaseProgress: 0.4 };

      expect(handoffProgress(reduced, scroll)).toBe(handoffProgress(motionModel, scroll));
      expect(reduced.seam).toBe(motionModel.seam);
      expect(reduced.fadeStart).toBe(motionModel.fadeStart);
      expect(reduced.fadeEnd).toBe(motionModel.fadeEnd);
      expect(handoffLayerOpacities(reduced, 0.8)).toEqual(
        handoffLayerOpacities(motionModel, 0.8),
      );
      // The one difference: no spin, so the front can never changes.
      expect(carouselPhase(motionModel, 0.8)).toBeGreaterThan(0);
      expect(carouselPhase(reduced, 0.8)).toBe(0);
      expect(activeCanIndex(reduced, 0.6)).toBe(activeCanIndex(reduced, 0));
    });

    it("still reports a scale and a paint order, so a static row is not clipped or mis-stacked", () => {
      const reduced = createShelfHandoff({ reducedMotion: true });
      expect(handoffLayerScale(reduced, 375)).toBeLessThan(1);
      // Every can is at one depth, so paint order is a stable permutation
      // rather than a crash or a NaN.
      const order = handoffPaintOrder(handoffCanTransforms(reduced, 1));
      expect([...order].sort((a, b) => a - b)).toEqual(
        reduced.cans.map((_, index) => index),
      );
    });

    it("defaults to the animated variant when the flag is omitted", () => {
      expect(createShelfHandoff().reducedMotion).toBe(false);
      expect(createShelfHandoff({ reducedMotion: false }).reducedMotion).toBe(false);
      expect(createShelfHandoff({ reducedMotion: true }).reducedMotion).toBe(true);
      expect(handoffCanTransform(createShelfHandoff(), 1, 0).z).not.toBe(
        defaultHandoffGeometry.shelfZ,
      );
    });
  });

  describe("responsive layer scale", () => {
    it("shrinks the arrangement until its widest moment fits the viewport", () => {
      const model = createShelfHandoff();
      const { geometry } = model;
      // The shelf is the widest arrangement at the defaults; the ring's
      // diameter is the other candidate. Both flanks carry half a can.
      const required =
        2 *
        (Math.max((geometry.shelfSpacing * (model.canCount - 1)) / 2, geometry.carouselRadius) +
          geometry.canHalfWidth);

      const phone = handoffLayerScale(model, 375);
      expect(phone).toBeCloseTo(375 / required, 12);
      expect(phone).toBeLessThan(1);

      // Scaled, the outermost can's outer edge lands inside the viewport —
      // which is the whole point: unscaled it is ~250px past a 375px screen's
      // half-width and gets cropped by the stage's overflow-hidden.
      for (const h of [0, model.seam, 1]) {
        for (const can of handoffCanTransforms(model, h)) {
          const edge = Math.abs(can.x) * phone + geometry.canHalfWidth * can.scale * phone;
          expect(edge).toBeLessThanOrEqual(375 / 2 + 1e-9);
        }
      }
    });

    it("never enlarges past the authored size, and never returns a useless scale", () => {
      const model = createShelfHandoff();

      expect(handoffLayerScale(model, 2000)).toBe(1);
      expect(handoffLayerScale(model, 520)).toBe(1);
      // Degenerate viewports (SSR, a collapsed container) hold the authored
      // size rather than collapsing the row to nothing.
      expect(handoffLayerScale(model, 0)).toBe(1);
      expect(handoffLayerScale(model, -100)).toBe(1);
      expect(() => handoffLayerScale(model, Number.NaN)).toThrow(RangeError);
    });

    it("tracks a retuned geometry rather than a hardcoded design width", () => {
      const wide = createShelfHandoff({ geometry: { shelfSpacing: 210 } });
      const narrow = createShelfHandoff({ geometry: { shelfSpacing: 40 } });

      expect(handoffLayerScale(wide, 375)).toBeLessThan(handoffLayerScale(narrow, 375));
    });
  });

  describe("paint order", () => {
    it("stacks the ring by depth, not by flavor order", () => {
      const model = createShelfHandoff();
      // A quarter turn in: the cans are spread across the ring's depth, and
      // their flavor order and their depth order genuinely disagree.
      const handoff = model.seam + (1 - model.seam) * 0.25;
      const frame = handoffCanTransforms(model, handoff);
      const order = handoffPaintOrder(frame);

      expect(order).not.toEqual(frame.map((can) => can.index));

      for (let a = 0; a < frame.length; a += 1) {
        for (let b = 0; b < frame.length; b += 1) {
          if (frame[a].z === frame[b].z) continue;
          // Nearer the viewer (larger z) always paints later.
          expect(frame[a].z > frame[b].z).toBe(order[a] > order[b]);
        }
      }

      // The front can is the one on top.
      const front = frame.findIndex((can) => can.active);
      expect(order[front]).toBe(frame.length - 1);
    });

    it("is a permutation of 0..n-1 at every point of the gesture", () => {
      const model = createShelfHandoff();
      const expected = model.cans.map((_, index) => index);

      for (const h of scrollSweep(model, 0.01)) {
        const order = handoffPaintOrder(handoffCanTransforms(model, h));
        expect([...order].sort((a, b) => a - b)).toEqual(expected);
      }
    });

    it("agrees with the per-can helper the DOM layer actually calls", () => {
      const model = createShelfHandoff();
      const handoff = model.seam + (1 - model.seam) * 0.6;
      const whole = handoffPaintOrder(handoffCanTransforms(model, handoff));

      for (let index = 0; index < model.canCount; index += 1) {
        expect(handoffCanPaintOrder(model, handoff, index)).toBe(whole[index]);
      }
    });
  });
});
