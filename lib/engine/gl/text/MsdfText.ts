// lib/engine/gl/text/MsdfText.ts
//
// GlText: instanced glyph quads + a ShaderMaterial that branches on
// FontHandle.mode (design doc §4C) — `median(r,g,b)` for a real MSDF atlas,
// single-channel `r` for the runtime tiny-sdf atlas (sdf-atlas.ts). Both
// paths share the same fwidth-based screen-space AA and
// color/opacity/glow uniforms (glow pushes emitted color above 1.0 so
// post.ts's bloom threshold picks it up).
//
// Coordinate convention (internal — scene authors only see `object3d`,
// `width`, `height`): `object3d` itself lives in the view's ordinary THREE
// space (x-right/y-UP, per gl/view.ts's 1-unit=1px-at-z=0 camera), so a
// scene positions it exactly like any other Object3D. INTERNALLY, each
// glyph's instance transform converts layout.ts's x-right/y-DOWN,
// top-left-origin quad rect into that y-up local frame via
// `translate(x, -y-h) * scale(w,h,1)` (see createUnitQuadGeometry) — `-y-h`
// (the glyph's layout-space BOTTOM edge, negated) rather than `-y` because
// the unit quad itself now runs (0,0)-(1,1) in local y-up space, so the
// translation has to land the quad's local-y=0 corner at the glyph's
// screen-bottom, not its screen-top.
//
// One InstancedMesh per glyph string; `setText` rebuilds the mesh (glyph
// count changes) but keeps the same Object3D + Material for the instance's
// lifetime so a scene can parent `object3d` once and mutate text freely.

import * as THREE from "three";
import type { FontHandle } from "./font";
import { layout, type TextAlign } from "./layout";

export interface GlTextOptions {
  text: string;
  fontSize: number;
  color?: number;
  align?: TextAlign;
  maxWidth?: number;
  letterSpacing?: number;
  glow?: number;
  /** Uniform alpha multiplier (0..1, default 1) — lets callers render text
   * as a backdrop watermark instead of a full-strength headline. */
  opacity?: number;
}

function median(): string {
  return `
float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}
`;
}

function buildFragmentShader(mode: "msdf" | "sdf"): string {
  return /* glsl */ `
uniform sampler2D uTexture;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGlow;
varying vec2 vUv;
${mode === "msdf" ? median() : ""}
void main() {
  vec4 s = texture2D(uTexture, vUv);
#ifdef USE_MSDF
  float sigDist = median(s.r, s.g, s.b) - 0.5;
#else
  float sigDist = s.r - 0.5;
#endif
  float w = max(fwidth(sigDist), 1e-4);
  float alpha = smoothstep(-w, w, sigDist);
  if (alpha < 0.01) discard;
  vec3 color = uColor * (1.0 + uGlow * 1.5);
  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;
}

const VERTEX_SHADER = /* glsl */ `
attribute vec4 aUvRect; // u0, v0, u1, v1
varying vec2 vUv;

void main() {
  vUv = mix(aUvRect.xy, aUvRect.zw, uv);
#ifdef USE_INSTANCING
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
#endif
  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Unit quad: local (0,0)-(1,1), y-UP, so an instance transform of
 * `translate(x, -y-h) * scale(w,h,1)` lands exactly on a layout.ts glyph
 * rect (layout space is x-right/y-DOWN from a top-left origin; the view's
 * THREE-space is y-up — see MsdfText.ts's file header). `uv` is the plain
 * IDENTITY of `position.xy` — no flip here. The `flipY` correction this
 * needs (see `rebuild()`'s `uvRects` comment for the actual fix + the
 * confirmed `/deep-wave` design-review bug it addresses) belongs on the
 * per-glyph `v0`/`v1` values instead, not the geometry: `flipY` reverses
 * the ENTIRE atlas image's row order at GPU-upload time, so "flip the
 * quad" can only ever re-flip WHICH corner samples which v — it can't fix
 * that a `v` fraction computed from an ordinary top-down pixel offset
 * (`glyph.y / scaleH`) now addresses the wrong row of the (row-reversed)
 * uploaded texture altogether. Confirmed empirically against a live WebGL
 * context (2x2 test texture, `UNPACK_FLIP_Y_WEBGL: true`): `v=0` samples
 * the source image's BOTTOM row, `v=1` samples its TOP row.
 */
function createUnitQuadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

const DEFAULT_COLOR = 0xffffff;

/**
 * GlText — the design doc's public text primitive (§4C). Despite the
 * filename (kept as MsdfText.ts per the design doc's module list), this
 * class handles both `mode: "msdf"` and `mode: "sdf"` FontHandles
 * identically aside from the fragment shader's distance-sample expression.
 */
export class GlText {
  readonly object3d: THREE.Object3D;
  width = 0;
  height = 0;

  private font: FontHandle;
  private opts: Required<Omit<GlTextOptions, "maxWidth">> & { maxWidth?: number };
  private material: THREE.ShaderMaterial;
  private mesh: THREE.InstancedMesh | null = null;

  constructor(font: FontHandle, opts: GlTextOptions) {
    this.font = font;
    this.opts = {
      text: opts.text,
      fontSize: opts.fontSize,
      color: opts.color ?? DEFAULT_COLOR,
      align: opts.align ?? "left",
      maxWidth: opts.maxWidth,
      letterSpacing: opts.letterSpacing ?? 0,
      glow: opts.glow ?? 0,
      opacity: opts.opacity ?? 1,
    };

    this.object3d = new THREE.Group();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: font.texture },
        uColor: { value: new THREE.Color(this.opts.color) },
        uOpacity: { value: this.opts.opacity },
        uGlow: { value: this.opts.glow },
      },
      defines: font.mode === "msdf" ? { USE_MSDF: 1 } : {},
      vertexShader: VERTEX_SHADER,
      fragmentShader: buildFragmentShader(font.mode),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // No `extensions: { derivatives: true }` — this three version targets
      // WebGL2 only, where dFdx/dFdy/fwidth are core (no extension pragma
      // needed), and ShaderMaterial's `extensions` type no longer has a
      // `derivatives` field (only `clipCullDistance`/`multiDraw`).
    });

    this.rebuild();
  }

  setText(text: string): void {
    this.opts.text = text;
    this.rebuild();
  }

  setColor(color: number): void {
    this.opts.color = color;
    (this.material.uniforms.uColor!.value as THREE.Color).set(color);
  }

  setOpacity(opacity: number): void {
    this.opts.opacity = opacity;
    this.material.uniforms.uOpacity!.value = opacity;
  }

  dispose(): void {
    this.disposeMesh();
    this.material.dispose();
    this.object3d.parent?.remove(this.object3d);
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.object3d.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  private rebuild(): void {
    this.disposeMesh();

    const result = layout(this.opts.text, this.font.metrics, {
      fontSize: this.opts.fontSize,
      letterSpacing: this.opts.letterSpacing,
      maxWidth: this.opts.maxWidth,
      align: this.opts.align,
      uppercase: true, // the charset (bmfont + runtime sdf atlas alike) is uppercase-only — see hand-off notes.
    });

    this.width = result.width;
    this.height = result.height;

    const geometry = createUnitQuadGeometry();
    const count = Math.max(result.glyphCount, 1);

    const uvRects = new Float32Array(count * 4);
    const matrices: THREE.Matrix4[] = [];

    // `layout()`'s `align: "center"` only centers each line WITHIN the
    // block's own [0, width] bounding box — the box itself stays anchored
    // with its left edge at local x=0. Left uncorrected, that makes
    // `object3d`'s origin (where a scene positions this text) the LEFT edge
    // of a "centered" block instead of its center, so e.g. the hero headline
    // rendered shifted a full half-block-width off to the right of where
    // the scene actually placed it (confirmed via `/deep-wave` design
    // review screenshots). Re-anchor here so `align: "center"` really means
    // "object3d.position is the block's horizontal center".
    const anchorOffsetX = this.opts.align === "center" ? this.width / 2 : 0;

    for (let i = 0; i < result.glyphCount; i++) {
      const base = i * 8;
      const x = result.quads[base]! - anchorOffsetX;
      const y = result.quads[base + 1]!;
      const w = result.quads[base + 2]!;
      const h = result.quads[base + 3]!;
      const u0 = result.quads[base + 4]!;
      const v0 = result.quads[base + 5]!;
      const u1 = result.quads[base + 6]!;
      const v1 = result.quads[base + 7]!;

      // layout.ts's v0/v1 are ordinary top-down image-row fractions (v0 =
      // top of the glyph's atlas cell, v1 = bottom — see layout.ts's file
      // header). The font texture's default `flipY: true` (set by every
      // loader in gl/text/index.ts) uploads the atlas row-reversed, so
      // `texture2D`'s `v=0` actually samples the SOURCE image's BOTTOM row
      // and `v=1` samples its TOP (confirmed empirically against a live
      // WebGL context — see createUnitQuadGeometry's doc comment). `1 -
      // v1`/`1 - v0` converts each row fraction into the v that actually
      // lands on that row post-upload, while preserving v0<v1 ordering (so
      // the geometry's un-flipped identity UV, top-of-quad -> `aUvRect.zw`,
      // still lands on top-of-cell). Without this, every glyph rendered
      // vertically flipped within its own cell — a confirmed
      // `/deep-wave` design-review bug (mirrored headline text in every
      // scene using GL text).
      uvRects[i * 4] = u0;
      uvRects[i * 4 + 1] = 1 - v1;
      uvRects[i * 4 + 2] = u1;
      uvRects[i * 4 + 3] = 1 - v0;

      matrices.push(new THREE.Matrix4().makeTranslation(x, -y - h, 0).scale(new THREE.Vector3(w, h, 1)));
    }

    geometry.setAttribute("aUvRect", new THREE.InstancedBufferAttribute(uvRects, 4));

    const mesh = new THREE.InstancedMesh(geometry, this.material, count);
    mesh.count = result.glyphCount;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;

    this.mesh = mesh;
    this.object3d.add(mesh);
  }
}
