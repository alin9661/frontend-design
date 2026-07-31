// lib/engine/index.ts
//
// Public barrel for the Deep Wave engine (main-thread API). types.ts holds
// every cross-module contract — frozen after M0. Later modules are
// re-exported here as they land so consumers only ever need one import
// path: `@/lib/engine`.

export * from "./types";

// added in M1
export * from "./core/ticker";
export * from "./core/math";
export * from "./core/scroll";
export * from "./core/normalize-wheel";
export * from "./core/rect-tracker";
export * from "./core/pointer";
export * from "./core/reduced-motion";
export * from "./gl/timeline";
export * from "./gl/renderer";
export * from "./gl/view";
export * from "./gl/stage";
// gl/assets.ts's concrete `AssetManager` class shares its name with the
// `AssetManager` interface types.ts already exports above (frozen contract —
// see design doc §4). `export *` would make that name ambiguous, so the
// class is re-exported under an alias here; import the interface as
// `AssetManager` and the implementation as `GlAssetManager`, both from this
// same barrel.
export { AssetManager as GlAssetManager } from "./gl/assets";
export * from "./gl/post";
export * from "./gl/raycast";
export * from "./gl/gpgpu";
export * from "./gl/context-loss";
export * as noiseShaders from "./gl/shaders/noise";
export * as shaderChunks from "./gl/shaders/chunks";
// export { createRenderHost } from "./worker/host";
// export * from "./react/EngineProvider";
// export * from "./react/useView";
// export * from "./react/useScrollProgress";
