/**
 * The shelf-to-showcase handoff clock.
 *
 * The origin film ends on a shelf of cans; the FlavorShowcase section below
 * picks that same arrangement up and rotates it into its carousel. Two
 * independent scroll sources drive that — the film's own 0..1 progress and the
 * showcase's 0..1 entrance progress — but the move has to read as ONE
 * continuous gesture across the section boundary. This module folds both
 * sources into a single 0..1 `handoff` value and derives every per-can
 * transform (position, scale, opacity, which can is the showcase's active
 * flavor) from it, so neither section needs to know the other's scroll math.
 *
 * Everything here is generated from weights and the flavor list, in the spirit
 * of `generateOriginTimeline`: there are no hand-written stop arrays to
 * desynchronise, and the film-side entry point defaults to the LAST origin
 * chapter's peak read straight out of `origin-timeline`, so retuning chapter
 * weights moves this handoff with them.
 *
 * The one non-obvious decision: the two legs are WEIGHT-SUMMED
 * (`seam * filmLeg + (1 - seam) * showcaseLeg`) rather than switched on a
 * branch or combined with `Math.max`. A branch needs a correct predicate at
 * the exact frame the sections swap and shows a visible jump whenever that
 * predicate is wrong; `Math.max` can never return less than `seam`, because
 * the showcase leg already reads `seam` at showcase progress 0. The weighted
 * sum is total, monotonic in each argument on its own, and arrives at `seam`
 * from both directions — so the boundary is not a special case at all.
 */

import { flavors, type Flavor } from "@/lib/flavors";
import { originChapters } from "@/lib/visuals/origin-timeline";

const TAU = Math.PI * 2;

/**
 * Width of the layer crossfade, as a fraction of the showcase's leg.
 *
 * The window opens exactly AT the seam and closes inside the showcase's leg —
 * it deliberately does not straddle the boundary. A straddled window puts the
 * film's own terminal frame at the crossfade's midpoint, and that frame is not
 * a transitional one: the film's stage is `sticky` for the whole section, so
 * at film progress 1 it still fills the viewport with nothing scrolling in
 * behind it. Fading it to 0.5 there shows the payoff shot of a fifteen-
 * viewport film at half transparency over the page background. The showcase's
 * leg is where the two layers genuinely overlap, because that is when the
 * film's stage is travelling out of view, so that is where the fade belongs.
 *
 * Expressed as a fraction of the leg (never an absolute progress) so the
 * window can never invert or collapse whatever the seam is retuned to.
 */
export const HANDOFF_CROSSFADE = 0.35;

/** Where the film's shelf sits and where the showcase's carousel wants it. */
export interface HandoffGeometry {
  /** Gap between adjacent cans while they are still lined up on the shelf. */
  shelfSpacing: number;
  shelfY: number;
  shelfZ: number;
  /** Radius of the carousel ring the shelf rotates into. */
  carouselRadius: number;
  carouselY: number;
  /** Scale of a can on the shelf, at the front of the ring, and at its back. */
  shelfScale: number;
  activeScale: number;
  restingScale: number;
  /** Opacity of the can furthest from the viewer in the carousel. */
  backOpacity: number;
  /**
   * Half the rendered width of one can, in the same CSS pixels as every other
   * number here. Only `handoffLayerScale` reads it — it is what turns "the
   * arrangement is 420px wide" into "the arrangement plus its outermost can is
   * 492px wide", which is the figure that actually has to fit on screen.
   */
  canHalfWidth: number;
}

/**
 * Defaults mirror the origin film's shelf row (`lib/scenes/origin-film`) so an
 * unconfigured handoff starts exactly where the film left the cans.
 */
export const defaultHandoffGeometry: HandoffGeometry = {
  shelfSpacing: 105,
  shelfY: -150,
  shelfZ: 55,
  carouselRadius: 190,
  carouselY: -110,
  shelfScale: 1,
  activeScale: 1.18,
  restingScale: 0.72,
  backOpacity: 0.32,
  // A `h-40` can: components/svg/Can.tsx is a 200x480 viewBox, so 160px tall
  // renders ~67px wide. Rounded up to 36 so the fit is never optimistic.
  canHalfWidth: 36,
};

export interface HandoffOptions {
  /** The cans being handed over. Defaults to the five flavors. */
  cans?: readonly Flavor[];
  /**
   * Film progress at which the handoff opens. Defaults to the peak of the
   * film's last chapter, read from the origin timeline.
   */
  filmTailStart?: number;
  /** Relative share of the move owned by the film side of the boundary. */
  filmTailWeight?: number;
  /** Relative share owned by the showcase side. */
  showcaseLeadWeight?: number;
  geometry?: Partial<HandoffGeometry>;
  /** Cross-fade only, no travel. */
  reducedMotion?: boolean;
}

export interface ShelfHandoffModel {
  cans: readonly Flavor[];
  canCount: number;
  /** Film progress where the tail — and so the handoff — begins. */
  filmTailStart: number;
  /** Handoff value at the section boundary, derived from the two weights. */
  seam: number;
  /** Crossfade window, straddling the seam. */
  fadeStart: number;
  fadeEnd: number;
  reducedMotion: boolean;
  geometry: HandoffGeometry;
}

export interface HandoffScroll {
  /** 0..1 across the whole origin film. */
  filmProgress: number;
  /** 0..1 across the showcase section's entrance. */
  showcaseProgress: number;
}

export interface HandoffCanTransform {
  index: number;
  flavorId: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
  /** True for the single can currently front-and-centre. */
  active: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (start: number, end: number, value: number) => {
  const progress = clamp01((value - start) / Math.max(end - start, Number.EPSILON));
  return progress * progress * (3 - 2 * progress);
};

const mix = (from: number, to: number, t: number) => from + (to - from) * t;

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${value}`);
  }
  return value;
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number, received ${value}`);
  }
  return value;
}

/** The film's last chapter is the shelf beat the handoff has to grow out of. */
function defaultFilmTailStart(): number {
  return originChapters[originChapters.length - 1].band.peak;
}

/**
 * Builds the handoff model. Pure and dependency-injected: pass your own cans,
 * weights, or geometry and nothing else in the app changes.
 */
export function createShelfHandoff(options: HandoffOptions = {}): ShelfHandoffModel {
  const cans = options.cans ?? flavors;

  if (cans.length < 2) {
    throw new RangeError(`Shelf handoff needs at least 2 cans, received ${cans.length}`);
  }

  const filmTailStart = requireFinite(
    options.filmTailStart ?? defaultFilmTailStart(),
    "filmTailStart",
  );

  if (filmTailStart < 0 || filmTailStart >= 1) {
    throw new RangeError(`filmTailStart must sit in [0, 1), received ${filmTailStart}`);
  }

  const filmTailWeight = requirePositive(options.filmTailWeight ?? 1, "filmTailWeight");
  const showcaseLeadWeight = requirePositive(
    options.showcaseLeadWeight ?? 1,
    "showcaseLeadWeight",
  );

  const geometry: HandoffGeometry = { ...defaultHandoffGeometry, ...options.geometry };

  requirePositive(geometry.shelfSpacing, "geometry.shelfSpacing");
  requirePositive(geometry.carouselRadius, "geometry.carouselRadius");
  requirePositive(geometry.shelfScale, "geometry.shelfScale");
  requirePositive(geometry.activeScale, "geometry.activeScale");
  requirePositive(geometry.restingScale, "geometry.restingScale");
  requireFinite(geometry.shelfY, "geometry.shelfY");
  requireFinite(geometry.shelfZ, "geometry.shelfZ");
  requireFinite(geometry.carouselY, "geometry.carouselY");

  if (
    !Number.isFinite(geometry.backOpacity) ||
    geometry.backOpacity < 0 ||
    geometry.backOpacity > 1
  ) {
    throw new RangeError(
      `geometry.backOpacity must sit in [0, 1], received ${geometry.backOpacity}`,
    );
  }

  const seam = filmTailWeight / (filmTailWeight + showcaseLeadWeight);
  // The window opens at the seam and closes a fixed FRACTION of the showcase's
  // leg later, so `seam == fadeStart < fadeEnd < 1` holds for any weighting —
  // an absolute-width window would run off the end for a lopsided seam. See
  // HANDOFF_CROSSFADE for why it does not straddle the boundary.
  const fadeStart = seam;
  const fadeEnd = seam + (1 - seam) * HANDOFF_CROSSFADE;
  const reducedMotion = options.reducedMotion === true;

  return {
    cans,
    canCount: cans.length,
    filmTailStart,
    seam,
    fadeStart,
    fadeEnd,
    reducedMotion,
    geometry,
  };
}

/**
 * How far the CAROUSEL has come, 0..1 — i.e. the showcase's own leg, rescaled.
 *
 * This is the clock the ring runs on, and it is deliberately not the raw
 * handoff. The film's leg can never push the handoff past `seam` (its own
 * source saturates at film progress 1 with the showcase still at 0), so a ring
 * driven off the handoff directly would be frozen at `seam`-worth of rotation
 * and formation for the entire film — half-morphed, neither shelf nor
 * carousel, on the film's terminal frame. Splitting the clock gives each leg
 * the arrangement it is actually meant to show: the film's leg is a SHELF for
 * all of it, and the ring forms and turns across the showcase's.
 *
 * Reduced motion pins it at 0: the arrangement then never travels at all,
 * which is the whole of this module's reduced-motion contract — one pin rather
 * than a duplicated geometry branch that no caller could reach.
 */
export function carouselPhase(model: ShelfHandoffModel, handoff: number): number {
  requireFinite(handoff, "handoff");
  if (model.reducedMotion) return 0;
  return clamp01((clamp01(handoff) - model.seam) / (1 - model.seam));
}

/**
 * Uniform scale for the whole handoff layer so its widest moment still fits in
 * `viewportWidth`, clamped to 1 (this only ever shrinks — the arrangement is
 * authored at its intended size).
 *
 * Every other number in this module is an absolute CSS pixel offset from the
 * stage's centre, which is what lets the film and the showcase agree on one
 * coordinate space without either measuring the other. The cost is that the
 * arrangement has a fixed width: at the defaults the shelf spans 420px and the
 * ring 380px, both plus a can's half-width on each flank, so on a 375px phone
 * the outermost cans of the "five cans on a shelf" payoff are clipped away
 * entirely by the stage's `overflow-hidden`. Scaling the layer keeps the
 * composition intact instead of cropping it.
 */
export function handoffLayerScale(model: ShelfHandoffModel, viewportWidth: number): number {
  requireFinite(viewportWidth, "viewportWidth");
  if (viewportWidth <= 0) return 1;

  const { geometry } = model;
  const widestHalfSpan = Math.max(
    Math.abs(shelfX(model, 0)),
    Math.abs(shelfX(model, model.canCount - 1)),
    geometry.carouselRadius,
  );
  const required = 2 * (widestHalfSpan + geometry.canHalfWidth);
  return Math.min(1, viewportWidth / required);
}

/**
 * Folds both scroll sources into the single continuous 0..1 handoff value.
 * Monotonic in each argument, so a scroll that only ever moves forward can
 * only ever move this forward.
 */
export function handoffProgress(model: ShelfHandoffModel, scroll: HandoffScroll): number {
  requireFinite(scroll.filmProgress, "filmProgress");
  requireFinite(scroll.showcaseProgress, "showcaseProgress");

  const tail = clamp01(
    (clamp01(scroll.filmProgress) - model.filmTailStart) / (1 - model.filmTailStart),
  );
  const lead = clamp01(scroll.showcaseProgress);

  return clamp01(model.seam * tail + (1 - model.seam) * lead);
}

/** Crossfade progress, 0 before the boundary window and 1 after it. */
export function handoffCrossfade(model: ShelfHandoffModel, handoff: number): number {
  return smoothstep(model.fadeStart, model.fadeEnd, clamp01(requireFinite(handoff, "handoff")));
}

/** Opacity of each side's whole layer, so the cut itself never flashes. */
export function handoffLayerOpacities(
  model: ShelfHandoffModel,
  handoff: number,
): { film: number; showcase: number } {
  const fade = handoffCrossfade(model, handoff);
  return { film: 1 - fade, showcase: fade };
}

/** Continuous front-of-carousel position, in can indices. */
function frontIndexReal(model: ShelfHandoffModel, handoff: number): number {
  return carouselPhase(model, handoff) * model.canCount;
}

/**
 * The can that is front-and-centre, i.e. the flavor the showcase should treat
 * as active. Advances exactly once per can across the CAROUSEL's leg (see
 * `carouselPhase`) and wraps back to the first flavor at handoff 1.
 *
 * Reading the raw handoff here instead is what used to make the showcase jump
 * three flavors the instant it entered the viewport: `Math.round` of a
 * half-consumed sweep lands on can 3, not can 0, so the section's own entrance
 * animation fired two full flavor swaps before settling.
 */
export function activeCanIndex(model: ShelfHandoffModel, handoff: number): number {
  requireFinite(handoff, "handoff");
  const front = Math.round(frontIndexReal(model, handoff));
  return ((front % model.canCount) + model.canCount) % model.canCount;
}

/** The flavor behind `activeCanIndex`, for callers that want the whole record. */
export function activeHandoffFlavor(model: ShelfHandoffModel, handoff: number): Flavor {
  return model.cans[activeCanIndex(model, handoff)];
}

function shelfX(model: ShelfHandoffModel, index: number): number {
  return (index - (model.canCount - 1) / 2) * model.geometry.shelfSpacing;
}

/** One can's transform at a given handoff value. Pure, total, continuous. */
export function handoffCanTransform(
  model: ShelfHandoffModel,
  handoff: number,
  index: number,
): HandoffCanTransform {
  if (!Number.isInteger(index) || index < 0 || index >= model.canCount) {
    throw new RangeError(`Unknown handoff can index: ${index}`);
  }

  const h = clamp01(requireFinite(handoff, "handoff"));
  const { geometry } = model;
  const active = activeCanIndex(model, h) === index;
  const baseX = shelfX(model, index);

  // The ring's own clock, not the raw handoff — see `carouselPhase`. Under
  // reduced motion it is pinned at 0, so everything below collapses to the
  // shelf row exactly as authored: no travel, no spin, no depth fade.
  const phase = carouselPhase(model, h);
  // Angle 0 is the front of the ring; subtracting the phase spins the ring
  // forward so can `phase * canCount` faces the viewer.
  const angle = TAU * (index / model.canCount - phase);
  const depth = (Math.cos(angle) + 1) / 2;
  const formation = smoothstep(0, 1, phase);
  const ringScale = mix(geometry.restingScale, geometry.activeScale, depth);
  const ringOpacity = mix(geometry.backOpacity, 1, depth);

  return {
    index,
    flavorId: model.cans[index].id,
    x: mix(baseX, Math.sin(angle) * geometry.carouselRadius, formation),
    y: mix(geometry.shelfY, geometry.carouselY, formation),
    z: mix(geometry.shelfZ, Math.cos(angle) * geometry.carouselRadius, formation),
    scale: mix(geometry.shelfScale, ringScale, formation),
    opacity: mix(1, ringOpacity, formation),
    active,
  };
}

/**
 * Paint order for a set of transforms: the integer `zIndex` each can must
 * carry so a DOM carousel stacks by DEPTH rather than by flavor order.
 *
 * The transforms already carry a `z`, but a CSS translate cannot use it — a
 * flat layer with no `perspective` paints strictly in document order, so
 * without this the cans on the far side of the ring sit ON TOP of the ones in
 * front of them whenever their flavor index happens to be higher, and the ring
 * reads as five cutouts sliding through each other. Returned as a whole frame
 * rather than per-can so the mapping is a pure function of the arrangement and
 * cannot disagree between cans.
 */
export function handoffPaintOrder(transforms: readonly HandoffCanTransform[]): number[] {
  const byDepth = [...transforms].sort((a, b) => a.z - b.z);
  const rank = new Map(byDepth.map((can, order) => [can.index, order]));
  return transforms.map((can) => rank.get(can.index)!);
}

/** `handoffPaintOrder` for one can, for callers that render cans independently. */
export function handoffCanPaintOrder(
  model: ShelfHandoffModel,
  handoff: number,
  index: number,
): number {
  const transforms = handoffCanTransforms(model, handoff);
  return handoffPaintOrder(transforms)[index];
}

/** Every can's transform, in flavor order. */
export function handoffCanTransforms(
  model: ShelfHandoffModel,
  handoff: number,
): HandoffCanTransform[] {
  return model.cans.map((_, index) => handoffCanTransform(model, handoff, index));
}
