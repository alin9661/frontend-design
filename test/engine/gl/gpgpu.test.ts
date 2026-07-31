// test/engine/gl/gpgpu.test.ts
//
// gl/gpgpu.ts's ping-pong FBO helper, tested against a GpgpuRenderer mock
// (2 methods: setRenderTarget/render) — WebGLRenderTarget/Scene/Camera/
// Material are all plain data structures in three, constructible without a
// real WebGL context, so the ping-pong bookkeeping is fully testable here.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Gpgpu, type GpgpuRenderer } from "@/lib/engine/gl/gpgpu";

function mockGpgpuRenderer(): GpgpuRenderer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setRenderTarget: (target) => calls.push(target ? "setRenderTarget(target)" : "setRenderTarget(null)"),
    render: () => calls.push("render"),
  };
}

function makeSimMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTexture: { value: null } },
    vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
    fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
  });
}

describe("Gpgpu", () => {
  it("allocates two distinct render targets of the requested size", () => {
    const gpgpu = new Gpgpu({ width: 64, height: 64, simulationMaterial: makeSimMaterial() });
    expect(gpgpu.read).not.toBe(gpgpu.write);
    expect(gpgpu.read.width).toBe(64);
    expect(gpgpu.write.height).toBe(64);
  });

  it("compute() renders into the write target, then swaps read/write", () => {
    const gpgpu = new Gpgpu({ width: 8, height: 8, simulationMaterial: makeSimMaterial() });
    const renderer = mockGpgpuRenderer();

    const initialRead = gpgpu.read;
    const initialWrite = gpgpu.write;

    gpgpu.compute(renderer);

    expect(renderer.calls).toEqual(["setRenderTarget(target)", "render", "setRenderTarget(null)"]);
    // Ping-pong swap: what was "write" is now "read", and vice versa.
    expect(gpgpu.read).toBe(initialWrite);
    expect(gpgpu.write).toBe(initialRead);
  });

  it("feeds the previous read target's texture into the simulation material's uTexture uniform", () => {
    const material = makeSimMaterial();
    const gpgpu = new Gpgpu({ width: 8, height: 8, simulationMaterial: material });
    const renderer = mockGpgpuRenderer();
    const expectedTexture = gpgpu.read.texture;

    gpgpu.compute(renderer);

    expect(material.uniforms.uTexture!.value).toBe(expectedTexture);
  });

  it("alternates read/write correctly across multiple compute() calls", () => {
    const gpgpu = new Gpgpu({ width: 8, height: 8, simulationMaterial: makeSimMaterial() });
    const renderer = mockGpgpuRenderer();
    const targetA = gpgpu.read;
    const targetB = gpgpu.write;

    gpgpu.compute(renderer); // read=B, write=A
    expect(gpgpu.read).toBe(targetB);
    expect(gpgpu.write).toBe(targetA);

    gpgpu.compute(renderer); // read=A, write=B
    expect(gpgpu.read).toBe(targetA);
    expect(gpgpu.write).toBe(targetB);
  });

  it("dispose() frees both render targets and the fullscreen quad geometry", () => {
    const gpgpu = new Gpgpu({ width: 8, height: 8, simulationMaterial: makeSimMaterial() });
    const readDisposeSpy = vi.spyOn(gpgpu.read, "dispose");
    const writeDisposeSpy = vi.spyOn(gpgpu.write, "dispose");

    gpgpu.dispose();

    expect(readDisposeSpy).toHaveBeenCalled();
    expect(writeDisposeSpy).toHaveBeenCalled();
  });
});
