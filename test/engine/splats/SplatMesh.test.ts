// test/engine/splats/SplatMesh.test.ts
//
// gl/splats/SplatMesh.ts — the pure covariance/projection/eigen math
// (design doc: "covariance math vs hand-computed matrices") plus
// construction/DataTexture-packing/dispose bookkeeping for the class itself.
// No real WebGL context is exercised (jsdom has none) — every THREE object
// touched here (BufferGeometry, DataTexture, ShaderMaterial, Mesh) is
// constructible and inspectable without one; `typeof Worker === "undefined"`
// in vitest/jsdom, so SplatMesh.update() always exercises its synchronous
// `sortIndices` fallback path here, never the dedicated-worker path.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SplatData } from "@/lib/engine/types";
import {
  covariance3D,
  eigenDecompose2x2,
  mat4RotationToRowMajor3,
  projectCovariance2D,
  quatToRotationMatrix,
  SplatMesh,
} from "@/lib/engine/gl/splats/SplatMesh";

describe("quatToRotationMatrix — hand-computed matrices", () => {
  it("identity quaternion -> identity matrix", () => {
    expect(quatToRotationMatrix(0, 0, 0, 1)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("90deg rotation about Z -> [[0,-1,0],[1,0,0],[0,0,1]]", () => {
    const s = Math.SQRT1_2; // sin(45deg) = cos(45deg)
    const R = quatToRotationMatrix(0, 0, s, s);
    const expected = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    R.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));
  });
});

describe("covariance3D — Σ = R diag(sx²,sy²,sz²) Rᵀ", () => {
  it("identity rotation, unit scale -> identity covariance", () => {
    const cov = covariance3D(0, 0, 0, 1, 1, 1, 1);
    expect(cov).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("identity rotation, anisotropic scale -> diagonal of squared scales", () => {
    const cov = covariance3D(0, 0, 0, 1, 2, 1, 3);
    expect(cov).toEqual([4, 0, 0, 0, 1, 0, 0, 0, 9]);
  });

  it("90deg Z rotation swaps x/y variance (hand-derived: scale (2,1,1) -> diag(1,4,1))", () => {
    const s = Math.SQRT1_2;
    const cov = covariance3D(0, 0, s, s, 2, 1, 1);
    const expected = [1, 0, 0, 0, 4, 0, 0, 0, 1];
    cov.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));
  });
});

describe("mat4RotationToRowMajor3", () => {
  it("extracts the identity rotation from an identity THREE.Matrix4", () => {
    const m = new THREE.Matrix4();
    expect(mat4RotationToRowMajor3(m.elements)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("matches quatToRotationMatrix for the same rotation, ignoring translation", () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q).setPosition(10, -20, 30);
    const fromMatrix = mat4RotationToRowMajor3(m.elements);
    const fromQuat = quatToRotationMatrix(q.x, q.y, q.z, q.w);
    fromMatrix.forEach((v, i) => expect(v).toBeCloseTo(fromQuat[i]!, 5));
  });
});

describe("projectCovariance2D — hand-computed case (identity view rotation)", () => {
  it("diag(4,9,1) at viewPos (0,0,-10), focal=1 -> a=0.04, b=0, c=0.09", () => {
    const identity3: [number, number, number, number, number, number, number, number, number] = [
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ];
    const cov3D: typeof identity3 = [4, 0, 0, 0, 9, 0, 0, 0, 1];
    const result = projectCovariance2D(cov3D, identity3, { x: 0, y: 0, z: -10 }, 1, 1);
    expect(result.a).toBeCloseTo(0.04, 6);
    expect(result.b).toBeCloseTo(0, 6);
    expect(result.c).toBeCloseTo(0.09, 6);
  });
});

describe("eigenDecompose2x2", () => {
  it("diagonal matrix -> eigenvalues are the diagonal entries, axis-aligned eigenvectors", () => {
    const result = eigenDecompose2x2({ a: 0.04, b: 0, c: 0.09 });
    expect(result.lambda1).toBeCloseTo(0.09, 6);
    expect(result.lambda2).toBeCloseTo(0.04, 6);
    expect(result.axis1[0]).toBeCloseTo(0, 6);
    expect(Math.abs(result.axis1[1])).toBeCloseTo(1, 6);
  });

  it("satisfies the eigenvector equation (A v = lambda v) for a non-diagonal matrix", () => {
    const cov = { a: 3, b: 1, c: 2 };
    const { lambda1, lambda2, axis1, axis2 } = eigenDecompose2x2(cov);

    const apply = (v: readonly [number, number]) => [
      cov.a * v[0] + cov.b * v[1],
      cov.b * v[0] + cov.c * v[1],
    ];

    const av1 = apply(axis1);
    expect(av1[0]).toBeCloseTo(lambda1 * axis1[0], 6);
    expect(av1[1]).toBeCloseTo(lambda1 * axis1[1], 6);

    const av2 = apply(axis2);
    expect(av2[0]).toBeCloseTo(lambda2 * axis2[0], 6);
    expect(av2[1]).toBeCloseTo(lambda2 * axis2[1], 6);

    // axes are orthogonal and unit length
    expect(axis1[0] * axis2[0] + axis1[1] * axis2[1]).toBeCloseTo(0, 6);
    expect(Math.hypot(...axis1)).toBeCloseTo(1, 6);
  });

  it("clamps a numerically-negative small eigenvalue to zero", () => {
    const result = eigenDecompose2x2({ a: 0.1, b: 0.09999999, c: 0.1 });
    expect(result.lambda2).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// SplatMesh construction / packing / update / dispose
// ---------------------------------------------------------------------------

function makeTestData(count: number): SplatData {
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const quats = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = i;
    positions[i * 3 + 1] = i * 2;
    positions[i * 3 + 2] = -i * 3 - 1;
    scales[i * 3 + 0] = 1;
    scales[i * 3 + 1] = 1;
    scales[i * 3 + 2] = 1;
    colors[i * 4 + 0] = 100;
    colors[i * 4 + 1] = 150;
    colors[i * 4 + 2] = 200;
    colors[i * 4 + 3] = 255;
    quats[i * 4 + 0] = 128;
    quats[i * 4 + 1] = 128;
    quats[i * 4 + 2] = 128;
    quats[i * 4 + 3] = 255;
  }
  return { count, positions, scales, colors, quats };
}

describe("SplatMesh — construction, stats, dispose", () => {
  it("exposes object3d as a THREE.Mesh with the right instance count", () => {
    const splat = new SplatMesh(makeTestData(4));
    expect(splat.object3d).toBeInstanceOf(THREE.Mesh);
    const mesh = splat.object3d as THREE.Mesh;
    const geometry = mesh.geometry as THREE.InstancedBufferGeometry;
    expect(geometry.instanceCount).toBe(4);
    expect(geometry.getAttribute("splatIndex").count).toBe(4);
    splat.dispose();
  });

  it("initializes stats to {count, sortMs: 0}", () => {
    const splat = new SplatMesh(makeTestData(10));
    expect(splat.stats).toEqual({ count: 10, sortMs: 0 });
    splat.dispose();
  });

  it("seeds the splatIndex attribute with identity order (0..count-1) before any sort", () => {
    const splat = new SplatMesh(makeTestData(5));
    const geometry = (splat.object3d as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    const attr = geometry.getAttribute("splatIndex");
    expect(Array.from(attr.array as Float32Array)).toEqual([0, 1, 2, 3, 4]);
    splat.dispose();
  });

  it("update(camera) re-sorts the splatIndex attribute by depth and records sortMs", () => {
    const splat = new SplatMesh(makeTestData(5));
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    splat.update(camera);

    const geometry = (splat.object3d as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    const attr = geometry.getAttribute("splatIndex").array as Float32Array;
    // Positions z = [-1,-4,-7,-10,-13] (i*-3-1) -> farthest (idx4) first.
    expect(Array.from(attr)).toEqual([4, 3, 2, 1, 0]);
    expect(splat.stats.sortMs).toBeGreaterThanOrEqual(0);
    splat.dispose();
  });

  it("does not re-sort again on a call with a negligible camera delta", () => {
    const splat = new SplatMesh(makeTestData(5));
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    splat.update(camera);
    const geometry = (splat.object3d as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    const attr = geometry.getAttribute("splatIndex") as THREE.BufferAttribute;
    const before = Array.from(attr.array as Float32Array);
    const versionBefore = attr.version;

    splat.update(camera); // camera unchanged -> below the re-sort threshold
    expect(attr.version).toBe(versionBefore); // needsUpdate never re-set -> version didn't bump
    expect(Array.from(attr.array as Float32Array)).toEqual(before);
    splat.dispose();
  });

  it("does nothing for a zero-splat SplatData (no crash)", () => {
    const splat = new SplatMesh(makeTestData(0));
    const camera = new THREE.PerspectiveCamera();
    expect(() => splat.update(camera)).not.toThrow();
    expect(splat.stats.count).toBe(0);
    splat.dispose();
  });

  it("dispose() detaches object3d from its scene parent", () => {
    const splat = new SplatMesh(makeTestData(3));
    const scene = new THREE.Scene();
    scene.add(splat.object3d);
    expect(scene.children).toContain(splat.object3d);

    splat.dispose();
    expect(scene.children).not.toContain(splat.object3d);
  });

  it("dispose() is safe to call twice", () => {
    const splat = new SplatMesh(makeTestData(3));
    splat.dispose();
    expect(() => splat.dispose()).not.toThrow();
  });
});
