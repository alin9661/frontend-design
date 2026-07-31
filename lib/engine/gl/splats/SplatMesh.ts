// lib/engine/gl/splats/SplatMesh.ts
//
// Renders a SplatData cloud as instanced, camera-facing quads with a
// per-fragment Gaussian falloff (design doc §4B). One quad per splat, drawn
// via InstancedBufferGeometry; every splat's position/scale/color/quat lives
// in a DataTexture (not a per-instance attribute — at ~100k splats that's
// four ~316x316 textures instead of four ~1.2MB attribute buffers, and more
// importantly keeps per-instance *draw order* (the thing that actually
// changes every frame) as the ONE small attribute that needs re-uploading:
// `splatIndex`, reassigned each frame by the depth sort.
//
// Math note on the vertex shader: rather than threading the viewport's pixel
// dimensions through the frozen `update(camera): void` signature (it isn't
// there — see the workstream return notes for why that's a real contract
// gap and how this sidesteps it), the whole 3D-covariance -> screen-space
// projection is done in clip/NDC space using only `camera.projectionMatrix`
// and `modelViewMatrix` (both already resolution-independent). The quad's
// local coordinate is defined as "fractions of that splat's own principal
// sigmas" (so it's isotropic by construction in that space), which lets the
// fragment shader evaluate a plain radially-symmetric Gaussian instead of
// needing a full conic-matrix evaluation per pixel.
//
// The pure covariance/projection/eigen helpers below mirror the GLSL exactly
// (see the inline math notes in each) so they can be unit-tested against
// hand-computed matrices without a WebGL context — vitest/jsdom has none.

import * as THREE from "three";
import type { SplatData } from "../../types";
// BUG B2 fix: import the pure sort function from sort-core.ts, NOT from
// sort.worker.ts. sort.worker.ts installs a worker-bootstrap side effect
// (`self.onmessage = ...`) at module scope, guarded only by `typeof
// WorkerGlobalScope !== "undefined"` — true not just in its own dedicated
// worker, but ALSO inside worker/render.worker.ts's OffscreenCanvas worker,
// which lazy-loads this module (via splat-lounge/scene.ts) as part of its
// own bundle. Importing sort.worker.ts here used to silently overwrite
// render.worker.ts's own `onmessage`, breaking the whole render loop and
// flooding the console with "SORT received before INIT" on every
// subsequent FRAME_STATE (see sort.worker.ts's header for the full story).
import { sortIndices } from "./sort-core";

// ---------------------------------------------------------------------------
// Pure covariance math (mirrors the vertex shader's `quatToMat3`/covariance/
// projection math exactly — see the GLSL block below for the shader side).
// All matrices here are flat 9-number ROW-MAJOR arrays: [r00,r01,r02, r10,
// r11,r12, r20,r21,r22]. This is purely a TS-side representation choice for
// readability in tests; it carries the identical linear map as the GLSL
// (column-major) matrices below, just written out differently.
// ---------------------------------------------------------------------------

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as number[];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3 + 0]! * b[0 * 3 + j]! + a[i * 3 + 1]! * b[1 * 3 + j]! + a[i * 3 + 2]! * b[2 * 3 + j]!;
    }
  }
  return r as unknown as Mat3;
}

function mat3Transpose(a: Mat3): Mat3 {
  return [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!];
}

/** Quaternion (x,y,z,w, Hamilton convention, as normalized by THREE.Quaternion) -> row-major 3x3 rotation matrix. */
export function quatToRotationMatrix(x: number, y: number, z: number, w: number): Mat3 {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** World-space 3D covariance Σ = R·diag(sx²,sy²,sz²)·Rᵀ for a splat's quat+scale. */
export function covariance3D(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  sx: number,
  sy: number,
  sz: number
): Mat3 {
  const R = quatToRotationMatrix(qx, qy, qz, qw);
  const D: Mat3 = [sx * sx, 0, 0, 0, sy * sy, 0, 0, 0, sz * sz];
  return mat3Mul(mat3Mul(R, D), mat3Transpose(R));
}

/** Extracts the row-major 3x3 rotation (upper-left) submatrix from a THREE.Matrix4's column-major `.elements`. */
export function mat4RotationToRowMajor3(elements: ArrayLike<number>): Mat3 {
  const e = elements;
  return [e[0]!, e[4]!, e[8]!, e[1]!, e[5]!, e[9]!, e[2]!, e[6]!, e[10]!];
}

export interface Cov2D {
  a: number; // variance along screen/NDC x
  b: number; // covariance xy
  c: number; // variance along screen/NDC y
}

/**
 * Projects a world-space 3D covariance into screen/NDC-space 2D covariance,
 * via Σ' = J·(W·Σ·Wᵀ)·Jᵀ (Zwicker et al.'s EWA splatting Jacobian
 * approximation), where `viewRotation` is the view matrix's rotation-only
 * part (translation doesn't affect a covariance) and `J` uses the
 * projection matrix's own (resolution-independent) x/y scale factors
 * (`projectionMatrix.elements[0]` and `[5]`) rather than physical pixel
 * focal length.
 */
export function projectCovariance2D(
  cov3D: Mat3,
  viewRotation: Mat3,
  viewPos: { x: number; y: number; z: number },
  focalX: number,
  focalY: number
): Cov2D {
  const covView = mat3Mul(mat3Mul(viewRotation, cov3D), mat3Transpose(viewRotation));

  const vz = viewPos.z;
  const invNegZ = 1 / Math.max(-vz, 1e-4);
  const zz = Math.max(vz * vz, 1e-8);

  const J: Mat3 = [
    focalX * invNegZ, 0, (focalX * viewPos.x) / zz,
    0, focalY * invNegZ, (focalY * viewPos.y) / zz,
    0, 0, 0,
  ];

  const covNdc = mat3Mul(mat3Mul(J, covView), mat3Transpose(J));
  return { a: covNdc[0]!, b: covNdc[1]!, c: covNdc[4]! };
}

export interface EigenResult2D {
  lambda1: number; // larger eigenvalue
  lambda2: number; // smaller eigenvalue (clamped >= 0)
  axis1: readonly [number, number]; // unit eigenvector for lambda1
  axis2: readonly [number, number]; // perpendicular unit eigenvector for lambda2
}

/** Closed-form eigendecomposition of a symmetric 2x2 [[a,b],[b,c]] matrix. */
export function eigenDecompose2x2(cov: Cov2D): EigenResult2D {
  const { a, b, c } = cov;
  const mid = 0.5 * (a + c);
  const det = a * c - b * b;
  const radius = Math.sqrt(Math.max(mid * mid - det, 0));
  const lambda1 = mid + radius;
  const lambda2 = Math.max(mid - radius, 0);

  let axis1: [number, number];
  if (Math.abs(b) > 1e-9) {
    const len = Math.hypot(b, lambda1 - a) || 1;
    axis1 = [b / len, (lambda1 - a) / len];
  } else {
    axis1 = a >= c ? [1, 0] : [0, 1];
  }
  const axis2: [number, number] = [-axis1[1], axis1[0]];

  return { lambda1, lambda2, axis1, axis2 };
}

// ---------------------------------------------------------------------------
// GLSL — mirrors every formula above exactly (see comments tying each block
// back to its TS counterpart). GLSL ES 100 (no `transpose()`/`inverse()`
// builtins, hence the hand-rolled `transposeMat3`), matching every other
// shader in gl/ (none opt into GLSL3) and this project's WebGL1-compatible
// baseline.
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute float splatIndex;

uniform sampler2D uPosTex;
uniform sampler2D uScaleTex;
uniform sampler2D uColorTex;
uniform sampler2D uQuatTex;
uniform float uTexSize;
uniform float uSigmaClip;
uniform float uMaxNdcRadius;

varying vec2 vQuadCoord;
varying vec4 vColor;

mat3 transposeMat3(mat3 m) {
  return mat3(
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2]
  );
}

// Mirrors quatToRotationMatrix() above exactly (column-major GLSL construction
// of the same row-major rotation matrix).
mat3 quatToMat3(vec4 q) {
  float x = q.x; float y = q.y; float z = q.z; float w = q.w;
  return mat3(
    1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + w * z), 2.0 * (x * z - w * y),
    2.0 * (x * y - w * z), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + w * x),
    2.0 * (x * z + w * y), 2.0 * (y * z - w * x), 1.0 - 2.0 * (x * x + y * y)
  );
}

void main() {
  float tx = mod(splatIndex, uTexSize);
  float ty = floor(splatIndex / uTexSize);
  vec2 uv = (vec2(tx, ty) + 0.5) / uTexSize;

  vec3 localPos = texture2D(uPosTex, uv).xyz;
  vec3 scale = texture2D(uScaleTex, uv).xyz;
  vec4 colorRaw = texture2D(uColorTex, uv);
  vec4 quatRaw = texture2D(uQuatTex, uv);
  vec4 q = normalize(quatRaw * 2.0 - 1.0);

  // covariance3D(): Σ = R * diag(sx^2,sy^2,sz^2) * R^T
  mat3 R = quatToMat3(q);
  mat3 S2 = mat3(
    scale.x * scale.x, 0.0, 0.0,
    0.0, scale.y * scale.y, 0.0,
    0.0, 0.0, scale.z * scale.z
  );
  mat3 cov3D = R * S2 * transposeMat3(R);

  vec4 viewPos4 = modelViewMatrix * vec4(localPos, 1.0);

  // projectCovariance2D(): Σ' = J * (W * Σ * W^T) * J^T
  mat3 viewRot = mat3(modelViewMatrix);
  mat3 covView = viewRot * cov3D * transposeMat3(viewRot);

  float vz = viewPos4.z;
  float invNegZ = 1.0 / max(-vz, 1e-4);
  float fx = projectionMatrix[0][0];
  float fy = projectionMatrix[1][1];
  float zz = max(vz * vz, 1e-8);

  mat3 J = mat3(
    fx * invNegZ, 0.0, 0.0,
    0.0, fy * invNegZ, 0.0,
    fx * viewPos4.x / zz, fy * viewPos4.y / zz, 0.0
  );

  mat3 covNdc = J * covView * transposeMat3(J);
  float a = covNdc[0][0];
  float b = covNdc[1][0];
  float c = covNdc[1][1];

  // eigenDecompose2x2()
  float mid = 0.5 * (a + c);
  float det = a * c - b * b;
  float radius = sqrt(max(mid * mid - det, 0.0));
  float lambda1 = mid + radius;
  float lambda2 = max(mid - radius, 0.0);

  vec2 axis1 = (abs(b) > 1e-9)
    ? normalize(vec2(b, lambda1 - a))
    : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 axis2 = vec2(-axis1.y, axis1.x);

  float r1 = min(uSigmaClip * sqrt(max(lambda1, 0.0)), uMaxNdcRadius);
  float r2 = min(uSigmaClip * sqrt(max(lambda2, 0.0)), uMaxNdcRadius);

  vec4 clipPos = projectionMatrix * viewPos4;
  vec2 corner = position.xy; // base quad corner, one of (+-1, +-1)
  vec2 offsetNdc = corner.x * r1 * axis1 + corner.y * r2 * axis2;
  clipPos.xy += offsetNdc * clipPos.w; // scale by w: offset applied post-divide

  gl_Position = clipPos;
  vQuadCoord = corner;
  vColor = colorRaw;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vQuadCoord;
varying vec4 vColor;

void main() {
  // corner is defined in "fractions of this splat's own sigma" (see vertex
  // shader), so a plain radially-symmetric falloff here is already the
  // correct anisotropic Gaussian in world/screen space.
  float r2 = dot(vQuadCoord, vQuadCoord);
  if (r2 > 1.0) discard;

  float falloff = exp(-4.5 * r2); // ~0.011 at the 3-sigma quad edge
  float alpha = vColor.a * falloff;
  gl_FragColor = vec4(vColor.rgb * alpha, alpha); // premultiplied
}
`;

// ---------------------------------------------------------------------------
// SplatMesh
// ---------------------------------------------------------------------------

const RESORT_POS_THRESHOLD = 4; // world units (css px, per the engine's 1-unit=1px convention)
const RESORT_DIR_DOT_THRESHOLD = 0.9998; // ~cos(1.1deg) — dot below this triggers a re-sort

export interface SplatMeshStats {
  count: number;
  sortMs: number;
}

export class SplatMesh {
  readonly object3d: THREE.Object3D;
  stats: SplatMeshStats;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly splatIndexAttribute: THREE.InstancedBufferAttribute;
  private readonly textures: THREE.DataTexture[];
  private readonly positions: Float32Array;
  private readonly count: number;

  private worker: Worker | null = null;
  private pendingRequestId: number | null = null;
  private requestCounter = 0;
  private sortedIndices: Uint32Array | null = null;

  private hasSorted = false;
  private readonly lastCameraPos = new THREE.Vector3();
  private readonly lastCameraDir = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();

  constructor(data: SplatData) {
    this.count = data.count;
    this.positions = data.positions;
    this.stats = { count: data.count, sortMs: 0 };

    const texSize = Math.max(1, Math.ceil(Math.sqrt(Math.max(data.count, 1))));
    const texelCount = texSize * texSize;

    const posData = new Float32Array(texelCount * 4);
    const scaleData = new Float32Array(texelCount * 4);
    const colorData = new Uint8Array(texelCount * 4);
    const quatData = new Uint8Array(texelCount * 4);

    for (let i = 0; i < data.count; i++) {
      posData[i * 4 + 0] = data.positions[i * 3 + 0]!;
      posData[i * 4 + 1] = data.positions[i * 3 + 1]!;
      posData[i * 4 + 2] = data.positions[i * 3 + 2]!;
      scaleData[i * 4 + 0] = data.scales[i * 3 + 0]!;
      scaleData[i * 4 + 1] = data.scales[i * 3 + 1]!;
      scaleData[i * 4 + 2] = data.scales[i * 3 + 2]!;
      colorData[i * 4 + 0] = data.colors[i * 4 + 0]!;
      colorData[i * 4 + 1] = data.colors[i * 4 + 1]!;
      colorData[i * 4 + 2] = data.colors[i * 4 + 2]!;
      colorData[i * 4 + 3] = data.colors[i * 4 + 3]!;
      quatData[i * 4 + 0] = data.quats[i * 4 + 0]!;
      quatData[i * 4 + 1] = data.quats[i * 4 + 1]!;
      quatData[i * 4 + 2] = data.quats[i * 4 + 2]!;
      quatData[i * 4 + 3] = data.quats[i * 4 + 3]!;
    }

    const posTex = new THREE.DataTexture(posData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    const scaleTex = new THREE.DataTexture(scaleData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    const colorTex = new THREE.DataTexture(colorData, texSize, texSize, THREE.RGBAFormat, THREE.UnsignedByteType);
    const quatTex = new THREE.DataTexture(quatData, texSize, texSize, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.textures = [posTex, scaleTex, colorTex, quatTex];
    for (const tex of this.textures) {
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
    }

    const quadPositions = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
    const quadIndices = new Uint16Array([0, 1, 2, 2, 1, 3]);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(quadPositions, 3));
    geometry.setIndex(new THREE.BufferAttribute(quadIndices, 1));

    const splatIndexArray = new Float32Array(data.count);
    for (let i = 0; i < data.count; i++) splatIndexArray[i] = i;
    const splatIndexAttribute = new THREE.InstancedBufferAttribute(splatIndexArray, 1);
    geometry.setAttribute("splatIndex", splatIndexAttribute);
    geometry.instanceCount = data.count;
    this.geometry = geometry;
    this.splatIndexAttribute = splatIndexAttribute;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: posTex },
        uScaleTex: { value: scaleTex },
        uColorTex: { value: colorTex },
        uQuatTex: { value: quatTex },
        uTexSize: { value: texSize },
        uSigmaClip: { value: 3.0 },
        uMaxNdcRadius: { value: 0.75 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // no cheap bounding info for a synthesized point cloud; correctness > culling here
    this.object3d = this.mesh;

    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.initSortWorker();
  }

  private initSortWorker(): void {
    if (typeof Worker === "undefined") return; // SSR / test / no-worker-support fallback: update() uses sortIndices() synchronously
    try {
      const worker = new Worker(new URL("./sort.worker.ts", import.meta.url));
      worker.onmessage = this.handleWorkerMessage;
      this.worker = worker;
      // Send a COPY of positions — `this.positions` must stay valid for the
      // lifetime of this SplatMesh (it's also the fallback path's input).
      const positionsForWorker = this.positions.slice();
      worker.postMessage({ type: "INIT", positions: positionsForWorker }, [positionsForWorker.buffer]);
    } catch {
      this.worker = null; // construction can throw in sandboxed/test environments — degrade to the sync fallback
    }
  }

  private handleWorkerMessage(ev: MessageEvent): void {
    const msg = ev.data as { type: string; requestId: number; indices: Uint32Array; sortMs: number };
    if (msg.type !== "SORTED" || msg.requestId !== this.pendingRequestId) return;
    this.pendingRequestId = null;
    this.stats.sortMs = msg.sortMs;
    this.applySortedIndices(msg.indices);
  }

  private applySortedIndices(indices: Uint32Array): void {
    const arr = this.splatIndexAttribute.array as Float32Array;
    for (let i = 0; i < indices.length; i++) arr[i] = indices[i]!;
    this.splatIndexAttribute.needsUpdate = true;
    this.sortedIndices = indices; // retained for the next ping-pong round-trip
  }

  /**
   * Re-sorts draw order by camera-relative depth when the camera has moved
   * enough to matter (design doc: "re-sort only when camera direction·
   * position delta > threshold"), via the dedicated sort worker when
   * available, else synchronously through the same `sortIndices` the worker
   * itself calls.
   */
  update(camera: THREE.Camera): void {
    if (this.count === 0) return;

    camera.updateMatrixWorld(true);
    camera.getWorldDirection(this.scratchDir);

    const posDelta = this.hasSorted ? camera.position.distanceTo(this.lastCameraPos) : Infinity;
    const dirDot = this.hasSorted ? this.scratchDir.dot(this.lastCameraDir) : -Infinity;
    const needsResort = !this.hasSorted || posDelta > RESORT_POS_THRESHOLD || dirDot < RESORT_DIR_DOT_THRESHOLD;

    if (!needsResort || this.pendingRequestId !== null) return;

    this.lastCameraPos.copy(camera.position);
    this.lastCameraDir.copy(this.scratchDir);
    this.hasSorted = true;

    const viewMatrix = camera.matrixWorldInverse;

    if (this.worker) {
      const requestId = ++this.requestCounter;
      this.pendingRequestId = requestId;
      const viewMatrixElements = new Float32Array(viewMatrix.elements);
      const previousIndices = this.sortedIndices;
      this.sortedIndices = null; // about to be transferred away (neutered) if present
      this.worker.postMessage(
        { type: "SORT", requestId, viewMatrixElements, previousIndices: previousIndices ?? undefined },
        previousIndices ? [previousIndices.buffer] : []
      );
    } else {
      const start = typeof performance !== "undefined" ? performance.now() : Date.now();
      const result = sortIndices(this.positions, viewMatrix, this.sortedIndices ?? undefined);
      this.stats.sortMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
      this.applySortedIndices(result);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pendingRequestId = null;

    this.mesh.parent?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    for (const tex of this.textures) tex.dispose();
  }
}
