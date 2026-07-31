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
// `width`, `height`): local space is x-right/y-DOWN from a top-left origin,
// mirroring layout.ts's quad space and a TrackedRect's top/left, so
// `object3d.position` can be driven directly from a rect's document-space
// top-left once converted into the view's 1-unit=1px local frame.
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

/** Unit quad: local (0,0)-(1,-1) so an instance transform of translate(x,-y)*scale(w,h,1) lands exactly on a layout.ts glyph rect. UV (0,0) top-left / (1,1) bottom-right, matching layout.ts's y-down v0/v1. */
function createUnitQuadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, -1, 0, 0, -1, 0]);
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
    };

    this.object3d = new THREE.Group();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: font.texture },
        uColor: { value: new THREE.Color(this.opts.color) },
        uOpacity: { value: 1 },
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

    for (let i = 0; i < result.glyphCount; i++) {
      const base = i * 8;
      const x = result.quads[base]!;
      const y = result.quads[base + 1]!;
      const w = result.quads[base + 2]!;
      const h = result.quads[base + 3]!;
      const u0 = result.quads[base + 4]!;
      const v0 = result.quads[base + 5]!;
      const u1 = result.quads[base + 6]!;
      const v1 = result.quads[base + 7]!;

      uvRects[i * 4] = u0;
      uvRects[i * 4 + 1] = v0;
      uvRects[i * 4 + 2] = u1;
      uvRects[i * 4 + 3] = v1;

      matrices.push(new THREE.Matrix4().makeTranslation(x, -y, 0).scale(new THREE.Vector3(w, h, 1)));
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
