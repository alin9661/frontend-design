// lib/scenes/hero-can/can-geometry.ts
//
// Pure procedural can geometry + assembly (design doc §5 "Hero", CAN
// CONTRACT). Profile points are derived directly from
// components/svg/Can.tsx's `viewBox="0 0 200 480"` (body rect x18 y18 w164
// h444 rx26 -> outer radius 82; top disc rx60 cy30; bottom foot disc rx72
// cy462) so the 3D can reads as the same silhouette as the flat SVG mark
// used everywhere else on the site. No document/window/react imports —
// worker-safe per gl/'s layering law, which lib/scenes/ follows too.
//
// Per the design doc's per-view camera convention ("1 world unit = 1 CSS px
// at z=0"), default radius/height are the SVG's own pixel-scale numbers
// (82 / 480) rather than a normalized 0..1 unit — that makes the default can
// render at roughly the same on-screen size as the flat SVG mark.

import * as THREE from "three";
import type { Flavor } from "@/lib/flavors";

/** Matches components/svg/Can.tsx's `viewBox="0 0 200 480"`. */
const SVG_TOTAL_HEIGHT = 480;
/** Half of the SVG body rect's width (164/2) — the can's widest radius. */
const SVG_BODY_OUTER_R = 82;

const DEFAULT_RADIUS = SVG_BODY_OUTER_R;
const DEFAULT_HEIGHT = SVG_TOTAL_HEIGHT;
const DEFAULT_SEGMENTS = 48;

/**
 * Lathe profile, top to bottom, as `[svgY, svgRadius]` pairs read straight
 * off Can.tsx's geometry (top opening/rim/shoulder around y18-48, straight
 * body 60-420, foot taper 440-472). This is not a bezier-exact trace of the
 * SVG's rounded-rect corners (a lathe can't represent those, and doesn't
 * need to — only the outer silhouette matters for a 3D read) but every
 * radius/height value below is taken directly from the SVG source.
 */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [18, 60], // top opening (matches lid radius)
  [22, 66], // rim bead flare
  [34, 72], // rim shoulder (topRimOuter rx=72 cy=34)
  [48, 82], // shoulder settles into body radius
  [60, 82], // body straight run starts
  [420, 82], // body straight run ends
  [440, 82], // bottom rim rect top (still full radius)
  [452, 76], // taper into foot
  [462, 72], // foot widest (bottomDisc rx=72 cy=462)
  [472, 0], // closed bottom apex
];

/** svgY at the top opening — where `lid` and `tab` sit. */
const TOP_OPENING_SVG_Y = 18;
/** svgY at the label band's top/bottom (leaf glyph through the accent band, Can.tsx y96-y418, widened slightly for margin). */
const LABEL_TOP_SVG_Y = 70;
const LABEL_BOTTOM_SVG_Y = 418;
/** Pull-tab source dimensions, Can.tsx's `<g transform="translate(100 30)">` ellipse (rx16 ry9, stroke 4). */
const TAB_OUTER_RX = 16;
const TAB_OUTER_RY = 9;
const TAB_STROKE = 4;
const TAB_DEPTH_SVG = 3;

export interface CanPartsOptions {
  radius?: number;
  height?: number;
  segments?: number;
}

export interface CanParts {
  shell: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
  tab: THREE.BufferGeometry;
  labelCylinder: THREE.BufferGeometry;
}

interface Scale {
  sx: number; // svg-radius-units -> world
  sy: number; // svg-y-units -> world
}

interface Resolved {
  radius: number;
  height: number;
  segments: number;
  scale: Scale;
}

function resolveScale(opts: CanPartsOptions = {}): Resolved {
  const radius = opts.radius ?? DEFAULT_RADIUS;
  const height = opts.height ?? (SVG_TOTAL_HEIGHT / SVG_BODY_OUTER_R) * radius;
  const segments = Math.max(3, Math.round(opts.segments ?? DEFAULT_SEGMENTS));
  return {
    radius,
    height,
    segments,
    scale: { sx: radius / SVG_BODY_OUTER_R, sy: height / SVG_TOTAL_HEIGHT },
  };
}

/** svgY (0 at the SVG's top) -> world Y, centered so the can's vertical midpoint sits near y=0. */
function worldY(svgY: number, scale: Scale): number {
  return (SVG_TOTAL_HEIGHT / 2 - svgY) * scale.sy;
}

export interface CanLayout {
  radius: number;
  height: number;
  topOpeningY: number;
  topOpeningRadius: number;
  labelTopY: number;
  labelBottomY: number;
  bodyRadius: number;
}

/**
 * Layout helper — not part of the frozen CAN CONTRACT's two required
 * exports, but exported so `buildCan` (below) and scene.ts can position
 * `lid`/`tab`/`labelCylinder`/accents against `shell` without re-deriving
 * these magic numbers.
 */
export function getCanLayout(opts: CanPartsOptions = {}): CanLayout {
  const { radius, height, scale } = resolveScale(opts);
  return {
    radius,
    height,
    topOpeningY: worldY(TOP_OPENING_SVG_Y, scale),
    topOpeningRadius: PROFILE[0][1] * scale.sx,
    labelTopY: worldY(LABEL_TOP_SVG_Y, scale),
    labelBottomY: worldY(LABEL_BOTTOM_SVG_Y, scale),
    bodyRadius: SVG_BODY_OUTER_R * scale.sx,
  };
}

function createShellGeometry(scale: Scale, segments: number): THREE.BufferGeometry {
  const points = PROFILE.map(([y, r]) => new THREE.Vector2(Math.max(r * scale.sx, 0), worldY(y, scale)));
  return new THREE.LatheGeometry(points, segments);
}

function createLidGeometry(scale: Scale, segments: number): THREE.BufferGeometry {
  const topRadius = PROFILE[0][1] * scale.sx;
  const geo = new THREE.CircleGeometry(topRadius, segments);
  geo.rotateX(-Math.PI / 2); // lie flat, normal +Y
  return geo;
}

function createTabGeometry(scale: Scale, segments: number): THREE.BufferGeometry {
  const outerRx = TAB_OUTER_RX * scale.sx;
  const outerRy = TAB_OUTER_RY * scale.sx;
  const innerRx = Math.max(outerRx - TAB_STROKE * scale.sx, outerRx * 0.2);
  const innerRy = Math.max(outerRy - TAB_STROKE * scale.sx, outerRy * 0.2);

  // A flattened ring (ellipse outline with an ellipse hole), matching
  // Can.tsx's stroked pull-tab ellipse.
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, outerRx, outerRy, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, innerRx, innerRy, 0, Math.PI * 2, true, 0);
  shape.holes.push(hole);

  const depth = TAB_DEPTH_SVG * scale.sx;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: Math.max(8, Math.round(segments / 2)),
  });
  geo.rotateX(-Math.PI / 2); // extrude runs along +Z -> lie flat, thickness along +Y
  geo.translate(0, depth / 2, 0);
  return geo;
}

function createLabelCylinderGeometry(scale: Scale, segments: number): THREE.BufferGeometry {
  const bodyRadius = SVG_BODY_OUTER_R * scale.sx;
  const wrapRadius = bodyRadius * 1.002; // sits just proud of the shell to avoid z-fighting
  const top = worldY(LABEL_TOP_SVG_Y, scale);
  const bottom = worldY(LABEL_BOTTOM_SVG_Y, scale);
  const bandHeight = top - bottom;
  const geo = new THREE.CylinderGeometry(wrapRadius, wrapRadius, bandHeight, segments, 1, true);
  geo.translate(0, (top + bottom) / 2, 0);
  return geo;
}

/** Pure geometry, proportions from components/svg/Can.tsx's 200x480 viewBox. */
export function createCanParts(opts: CanPartsOptions = {}): CanParts {
  const { segments, scale } = resolveScale(opts);
  return {
    shell: createShellGeometry(scale, segments),
    lid: createLidGeometry(scale, segments),
    tab: createTabGeometry(scale, segments),
    labelCylinder: createLabelCylinderGeometry(scale, segments),
  };
}

export interface BuildCanOptions {
  labelTexture?: THREE.Texture;
}

export interface BuiltCan {
  group: THREE.Group;
  parts: {
    shell: THREE.Mesh;
    lid: THREE.Mesh;
    tab: THREE.Mesh;
    label: THREE.Mesh;
  };
  dispose(): void;
}

/** Assembles createCanParts()'s geometry into a positioned, materialed,
 * disposable can for the given flavor. `opts.labelTexture` is caller-owned
 * (typically `createLabelTexture()`'s result) — `dispose()` frees every
 * geometry/material this function created, but never a texture it didn't
 * create itself. */
export function buildCan(flavor: Flavor, opts: BuildCanOptions = {}): BuiltCan {
  const parts = createCanParts();
  const layout = getCanLayout();

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: flavor.can,
    metalness: 0.35,
    roughness: 0.32,
  });
  const lidMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8d8d2,
    metalness: 0.75,
    roughness: 0.25,
  });
  const tabMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a9a94,
    metalness: 0.85,
    roughness: 0.3,
  });
  const labelMaterial = opts.labelTexture
    ? new THREE.MeshStandardMaterial({ map: opts.labelTexture, roughness: 0.42, metalness: 0.08 })
    : new THREE.MeshStandardMaterial({ color: flavor.accent, roughness: 0.42, metalness: 0.08 });

  const shell = new THREE.Mesh(parts.shell, shellMaterial);

  const lid = new THREE.Mesh(parts.lid, lidMaterial);
  lid.position.y = layout.topOpeningY;

  const tab = new THREE.Mesh(parts.tab, tabMaterial);
  tab.position.y = layout.topOpeningY;

  const label = new THREE.Mesh(parts.labelCylinder, labelMaterial);

  const group = new THREE.Group();
  group.name = `can-${flavor.id}`;
  group.add(shell, lid, tab, label);

  function dispose(): void {
    parts.shell.dispose();
    parts.lid.dispose();
    parts.tab.dispose();
    parts.labelCylinder.dispose();
    shellMaterial.dispose();
    lidMaterial.dispose();
    tabMaterial.dispose();
    labelMaterial.dispose();
    group.remove(shell, lid, tab, label);
    // opts.labelTexture is caller-owned — intentionally NOT disposed here.
  }

  return { group, parts: { shell, lid, tab, label }, dispose };
}
