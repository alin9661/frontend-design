// lib/engine/gl/gpgpu.ts
//
// Ping-pong float-FBO helper for GPU compute (curl-noise particle
// position/velocity sim — design doc §4 gl/gpgpu.ts, used by
// lib/scenes/particles). Deliberately does NOT use the `RendererLike` seam
// from types.ts: that seam only covers what Stage's scissored multi-view
// render loop calls (setSize/setScissor/setViewport/render/dispose).
// Render-to-texture needs `setRenderTarget`, which is real-WebGLRenderer-only
// — so this file defines its own minimal `GpgpuRenderer` seam, easy to mock
// in tests without spinning up a WebGL context.

import * as THREE from "three";

export interface GpgpuRenderer {
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
}

export interface GpgpuOptions {
  width: number;
  height: number;
  /** Fullscreen-quad material; must read the previous state from a `uTexture` uniform. */
  simulationMaterial: THREE.ShaderMaterial;
  type?: THREE.TextureDataType;
}

/**
 * Ping-pong pair of float render targets driven by a fullscreen-quad
 * simulation material. `compute()` renders the sim material (reading the
 * "read" target's texture) into the "write" target, then swaps — the
 * classic GPGPU ping-pong pattern.
 */
export class Gpgpu {
  readonly width: number;
  readonly height: number;

  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private mesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.ShaderMaterial;

  constructor(opts: GpgpuOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.material = opts.simulationMaterial;

    const rtOptions: THREE.RenderTargetOptions = {
      type: opts.type ?? THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(opts.width, opts.height, rtOptions),
      new THREE.WebGLRenderTarget(opts.width, opts.height, rtOptions),
    ];

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);
  }

  /** The target holding the current (already-computed) state. */
  get read(): THREE.WebGLRenderTarget {
    return this.targets[this.current]!;
  }

  /** The target `compute()` will render the next state into. */
  get write(): THREE.WebGLRenderTarget {
    return this.targets[1 - this.current]!;
  }

  /** Runs one simulation step: read -> simulate -> write, then swaps ping/pong. */
  compute(renderer: GpgpuRenderer): void {
    const uniforms = this.material.uniforms as Record<string, THREE.IUniform> | undefined;
    if (uniforms && "uTexture" in uniforms) {
      uniforms.uTexture!.value = this.read.texture;
    }

    renderer.setRenderTarget(this.write);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);

    this.current = 1 - this.current;
  }

  dispose(): void {
    this.targets[0].dispose();
    this.targets[1].dispose();
    this.geometry.dispose();
  }
}
