# Deep Wave — Oryzo-Style Creative WebGL Engine (Full Stack)

> Design doc for the playground's second experiment: an internal,
> framework-agnostic creative-WebGL library (`lib/engine/`) plus a demo route
> (`/deep-wave`) that sells the Mateína can the way lusion.co's oryzo.ai sells
> a fictional cork coaster. **Scope is the FULL Lusion stack** — including
> OffscreenCanvas worker rendering, a custom Gaussian splat renderer, and MSDF
> WebGL text. This document is the shared contract for all implementation
> agents. The existing landing page at `/` must remain byte-for-byte
> untouched.

## 1. Teardown of the reference (oryzo.ai, verified by live recon)

- **Shell:** Astro static site; one ~1.1MB hoisted bundle; DM Mono + Literata.
- **Virtual scroll:** page never natively scrolls; ~50k px translated content;
  `normalizeWheel`; scroll-choreographed timelines.
- **3D:** Gaussian splats (SOG) rendered in a Web Worker with sort +
  OffscreenCanvas across 6 canvases; MSDF WebGL text (Inter atlas); curl-noise
  GPU particles; bloom; SDF effects; Basis/KTX2 textures.
- **Interactions:** physics hover-hand, flip-encrypt card, temperature gag,
  tier picker — each a bespoke GL mini-scene.
- **Libraries:** Three.js (vanilla), GSAP; everything else in-house.

**Our deltas:** hybrid scroll instead of full-virtual (a11y win); ONE
scissored canvas instead of 6; synthesized splat content instead of captured
SOG files; pure timeline sampler instead of GSAP (worker-safe).

## 2. Dependencies

| Package | Usage rules |
|---|---|
| `three` (runtime) | Named imports only. `RoomEnvironment` from examples allowed. No GLTF/DRACO/Basis loaders — all content procedural/synthesized. |
| `postprocessing` (runtime) | pmndrs vanilla lib (NOT @react-three/postprocessing). Import `EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect` only. |
| `msdf-bmfont-xml` (dev-only) | Build-time MSDF atlas generation. If its msdfgen binary fails on this machine, the fallback is runtime tiny-sdf atlas mode (see §4C). |

**No gsap** (unreliable in workers): `gl/timeline.ts` is our pure keyframe
sampler. **No lenis, no R3F/drei.** framer-motion (already installed) keeps
owning DOM UI on the main thread.

## 3. Engine layout and layering law

```
lib/engine/
  index.ts        # public barrel (main-thread API)
  types.ts        # ALL cross-module contracts — FROZEN after M0
  core/           # pure TS. May NOT import three, gl/, worker/, react/, or write DOM styles
    math.ts ticker.ts events.ts normalize-wheel.ts scroll.ts
    rect-tracker.ts pointer.ts reduced-motion.ts
  gl/             # may import core/ + three + postprocessing. NO react, NO DOM
    engine.ts renderer.ts stage.ts view.ts post.ts assets.ts
    raycast.ts gpgpu.ts context-loss.ts timeline.ts
    shaders/noise.ts shaders/chunks.ts
    splats/formats.ts splats/synthesize.ts splats/sort.worker.ts splats/SplatMesh.ts
    text/font.ts text/layout.ts text/MsdfText.ts
  worker/         # OffscreenCanvas hosting. May import core/ + gl/
    protocol.ts render.worker.ts host.ts scene-registry.ts
  react/          # "use client" lives ONLY here; thin bindings, no GL logic
    EngineProvider.tsx GlCanvas.tsx useEngine.ts useView.ts useScrollProgress.ts
```

**Layering law (CI-greppable):** `core/` imports nothing from
`gl|worker|react|three`; `gl/` never imports `worker|react` and NEVER touches
`document`/`window` (this is what makes it worker-safe — sizes/DPR/rects
arrive as data); `worker/` never imports `react`; React components contain no
GL logic. Scene modules live in `lib/scenes/` and follow gl/'s rules.

## 4. Module contracts (implement EXACTLY these signatures)

### core/ticker.ts
```ts
export type TickFn = (dt: number, elapsed: number) => void;
export const TickOrder = { INPUT: 0, SCROLL: 10, SCENE: 20, RENDER: 30 } as const;
export class Ticker {
  add(fn: TickFn, order?: number): () => void;  // returns unsubscribe
  start(): void; stop(): void;
  tick(dtMs: number): void;                     // manual advance — the test seam
  readonly running: boolean;
}
```
dt clamped to 64ms; pauses on `document.visibilitychange` (main thread only).

### core/math.ts
```ts
export const lerp: (a: number, b: number, t: number) => number;
export const damp: (a: number, b: number, lambda: number, dt: number) => number; // lerp(a,b,1-exp(-lambda*dt))
export const clamp: (v: number, min: number, max: number) => number;
export const mapRange: (v: number, inMin: number, inMax: number, outMin: number, outMax: number, clampOut?: boolean) => number;
export const easeOutExpo: (t: number) => number; // + easeInOutCubic, easeOutBack
```
`damp` is THE smoothing primitive (frame-rate independent).

### core/scroll.ts + core/normalize-wheel.ts — HYBRID scroll
Real document height. `window.scrollY` canonical. Only wheel intercepted
(non-passive, preventDefault), normalized, accumulated into `target`; per tick
`current = damp(current, target, lambda, dt)` then `window.scrollTo`.
Touch NEVER intercepted (native inertia; damped `animated` value trails for GL
parallax). Keyboard/anchors/find-in-page/SR untouched; external divergence
snaps state. Reduced motion: wheel listener not installed at all.
```ts
export interface ScrollState {
  target: number; current: number; velocity: number; // px, px, px/s
  progress: number; limit: number;
}
export interface ScrollOptions {
  lambda?: number;             // default 8
  wheelMultiplier?: number;
  el?: Window;                 // injectable for tests
  reducedMotion?: boolean;     // injectable; defaults to matchMedia
}
export class VirtualScroll {
  constructor(ticker: Ticker, opts?: ScrollOptions);
  readonly state: Readonly<ScrollState>;
  on(event: "scroll", cb: (s: ScrollState) => void): () => void;
  scrollTo(y: number, opts?: { immediate?: boolean }): void;
  resize(limit: number): void;
  destroy(): void;
  static step(state: ScrollState, dt: number, lambda: number): ScrollState; // pure
}
export function normalizeWheel(e: WheelEvent): { pixelX: number; pixelY: number };
```

### core/rect-tracker.ts
Measure once per resize (document-space rect = bcr + scrollY); per-frame
position is pure arithmetic — zero per-frame layout reads.
```ts
export interface TrackedRect {
  top: number; left: number; width: number; height: number; // document-space
  inView(scrollY: number, viewportH: number, margin?: number): boolean;
  viewportY(scrollY: number): number;
  progress(scrollY: number, viewportH: number): number; // 0 enter-bottom → 1 leave-top
}
export class RectTracker {
  constructor(opts?: { measure?: (el: Element) => DOMRect }); // injectable
  track(el: Element): TrackedRect;
  untrack(el: Element): void;
  refresh(scrollY: number): void; // on resize / fonts.ready
}
```
`TrackedRect` must serialize to a plain Float32Array-friendly record
(`RectData {top,left,width,height}`) for the worker protocol.

### core/pointer.ts
Normalized viewport + per-view NDC position; velocity via damp; plus a pure
exported spring integrator (semi-implicit Euler:
`springStep(pos, vel, target, stiffness, damping, dt)`).

### core/reduced-motion.ts
matchMedia + change listener; injectable initial value for tests.

### gl/timeline.ts — pure keyframe sampler (replaces gsap; worker-safe)
```ts
export type Ease = (t: number) => number;
export interface TrackKeyframe { t: number; v: number; ease?: Ease }   // t in 0..1
export class Timeline {
  add(target: Record<string, number>, prop: string, keys: TrackKeyframe[]): this;
  call(t: number, fn: (dir: 1 | -1) => void): this;   // fires when playhead crosses t
  sample(p: number): void;                             // sets all targets; idempotent
}
```
Fully unit-tested (sampling at fixed p values, crossing callbacks both
directions).

### gl/ — renderer/stage/view/post/assets/raycast/gpgpu/context-loss
- **renderer.ts** — wraps `WebGLRenderer` over `HTMLCanvasElement |
  OffscreenCanvas`; DPR ≤2 (1.5 low tier); explicit `setSize(w,h,dpr)` (no
  ResizeObserver here — sizes arrive as data); quality tier from
  hardwareConcurrency + DPR + first-frame probe; `RendererLike` seam in
  types.ts for tests.
- **stage.ts / view.ts** — ONE canvas, scissored viewport per view;
  off-screen views (via rect data + scroll) skipped entirely. Per-view camera:
  1 world unit = 1 CSS px at z=0 (`camera.position.z = viewportH/2 /
  tan(fov/2)`, fov 45).
```ts
export interface SceneModule {
  init(ctx: ViewContext): void | Promise<void>;   // MUST be re-runnable (context restore)
  update(dt: number, ctx: ViewContext): void;     // only called while inView
  onProgress?(p: number): void;                   // drives Timeline.sample
  onPointer?(hit: PointerHit | null): void;
  invoke?(method: string, args: unknown[]): void; // cross-thread scene RPC (picker select etc.)
  resize?(w: number, h: number): void;
  dispose(): void;                                // MUST free geometries/materials/targets
  getStats?(): { splats?: number; sortMs?: number } | void; // (additive, post-M0) — ?debug HUD STATS
}
export interface ViewContext {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  rect: RectData; scroll: Readonly<ScrollState>;
  pointer: PointerState; assets: AssetManager;
  size: { width: number; height: number; dpr: number };
  quality: QualityTier; // "high" | "medium" | "low"
  reducedMotion: boolean;
  registerInteractive?(objects: THREE.Object3D[]): void; // (additive, post-M0) — raycast target opt-in
}
export class Stage {
  addView(viewId: number, rect: RectData, module: SceneModule, opts?: { post?: boolean }): void;
  removeView(viewId: number): void;
  updateRect(viewId: number, rect: RectData): void;
  render(): void;
}
```
Three post-freeze additive contracts (all optional, so every pre-existing
hand-built `ViewContext`/`SceneModule` test fixture stays valid unchanged):
- **`ViewContext.registerInteractive`** (additive, post-M0) — a view opts its
  raycastable objects in; `Stage.raycastCandidates()` feeds the registered
  set into gl/raycast.ts's shared `runViewRaycasts()` once per frame. A view
  that never calls this is skipped entirely (no raycast work, no HIT
  messages). Each call REPLACES the full set (not additive) so a re-runnable
  `init()` never accumulates stale references from a previous instance.
- **`SceneModule.getStats`** (additive, post-M0) — scene-reported stats for
  the `?debug` HUD's STATS channel (§6); only splat-lounge implements it
  today. Both RenderHost implementations sum this across every registered
  view instead of hardcoding `splats`/`sortMs` to 0.
- **`InitFailedMessage`** (additive, post-M0; worker→main, §4A) — posted by
  render.worker.ts's INIT handler when constructing the renderer/Stage
  throws (e.g. WebGL2 context creation fails), so `WorkerHost.init()`'s
  `ready` promise rejects instead of hanging forever awaiting a READY that
  will never arrive.
- **assets.ts** — weighted named jobs feeding loading progress:
```ts
export class AssetManager {
  add<T>(id: string, weight: number, job: () => Promise<T>): void;
  get<T>(id: string): T;
  start(): Promise<void>;
  onProgress(cb: (p: number, id: string) => void): () => void;
}
```
- **post.ts** — one composer: RenderPass → EffectPass(Bloom mipmap half-res,
  SMAA); `setBloom(intensity, threshold)`; disabled on low tier + reduced
  motion.
- **raycast.ts** — throttled raycaster per view; enter/leave/down/up to
  `onPointer`; shared `uPointer`/`uPointerVelocity` uniform helpers.
- **gpgpu.ts** — ping-pong FBO helper (position/velocity float textures, sim
  material swap, `compute()` per frame).
- **context-loss.ts** — `webglcontextlost/restored`: stop ticking, notify
  host (worker posts CONTEXT_LOST), re-run every view's `init` on restore.
- **shaders/noise.ts** — GLSL exports: `simplex3d`, `simplex4d`, `curlNoise`,
  `fbm`; **chunks.ts**: GLSL easing, rotation, brand-color helpers.

### 4A. worker/ — OffscreenCanvas rendering (whole GL side in a Web Worker)
- **protocol.ts** — typed discriminated-union messages + pure pack/unpack:
  main→worker `INIT{canvas: OffscreenCanvas, dpr, quality, reducedMotion}`,
  `FRAME_STATE(Float32Array transferable)` [scrollCurrent, scrollVelocity,
  scrollProgress, pointerX, pointerY, pointerVX, pointerVY, pointerFlags
  (bit0=down, bit1=inside — additive, post-M0: see below), then per-view:
  viewId, top, left, width, height, progress], `RESIZE{w,h,dpr}`,
  `VIEW_ADD{viewId, sceneId, rect}`, `VIEW_REMOVE{viewId}`,
  `SCENE_INVOKE{viewId, method, args}`, `SET_REDUCED_MOTION{on}`, `DISPOSE`;
  worker→main `READY`, `ASSET_PROGRESS{p, id}`, `ASSETS_DONE`,
  `HIT{viewId, hit|null}`, `STATS{ms, drawCalls, splats, sortMs}`,
  `CONTEXT_LOST`, `CONTEXT_RESTORED`, `INIT_FAILED{error}` (additive,
  post-M0 — see below). Pack/unpack functions are pure and unit-tested
  round-trip.
  **`pointerFlags` (additive, post-M0):** both RenderHost implementations
  originally hardcoded `down: false, inside: true` on the receiving end
  instead of threading the real `PointerTracker` state through FRAME_STATE,
  which made pointer interactivity unreachable end-to-end (no real
  down-edge could ever reach a scene's `onPointer`, and a pointer that had
  actually left the viewport still read as "inside"). Packing both booleans
  into one bit-packed scalar (slot 7) rather than two more float slots keeps
  the transferable buffer small while fitting cleanly into the existing
  scalar-slot layout — see worker/protocol.ts's header comment for the exact
  bit layout.
- **scene-registry.ts** — sceneId → `() => Promise<SceneModule>` map (both
  sides import the same registry; functions can't cross postMessage). Scene
  ids: `"hero-can" | "exploded" | "particles" | "pointer-field" |
  "splat-lounge" | "picker" | "placeholder"`.
- **render.worker.ts** — worker entry: on INIT builds Renderer/Stage/Assets/
  post; own RAF loop; applies latest FRAME_STATE each frame (keep only
  newest); runs raycasts worker-side, posts HIT.
- **host.ts** — main-thread facade:
```ts
export interface RenderHost {
  readonly mode: "worker" | "main";
  init(canvas: HTMLCanvasElement, opts: HostInit): Promise<void>;
  frame(state: Float32Array): void;
  addView(viewId: number, sceneId: SceneId, rect: RectData): void;
  removeView(viewId: number): void;
  invoke(viewId: number, method: string, args: unknown[]): void;
  onMessage(cb: (m: WorkerToMain) => void): () => void;
  resize(w: number, h: number, dpr: number): void;
  destroy(): void;
}
export function createRenderHost(): RenderHost; // feature-detects OffscreenCanvas+WebGL2, silent fallback
```
  `WorkerHost` posts messages; `MainThreadHost` calls the same gl/ code
  directly (identical behavior — it is the fallback AND the test path).
  `?debug` HUD shows `worker: on|off`.

### 4B. gl/splats/ — custom Gaussian splat renderer
- **formats.ts** — parsers → `SplatData { count, positions: Float32Array(3n),
  scales: Float32Array(3n), colors: Uint8Array(4n), quats: Uint8Array(4n) }`:
  `.splat` (antimatter15 32-byte records: pos f32×3, scale f32×3, rgba u8×4,
  quat u8×4) and binary little-endian `.ply` (INRIA gaussian fields: SH DC →
  rgb via 0.5 + SH_C0*dc, opacity via sigmoid, scale via exp, rot normalized).
  SOG explicitly out of scope (webp payloads) — documented.
- **synthesize.ts** — `synthesizeFromGeometry(geo: BufferGeometry, opts:
  {count, scaleRange, colorFn, jitter}) → SplatData` (area-weighted surface
  sampling, normal-aligned anisotropic scales) + `synthesizeCanScene()`
  composing can + table + ambient puffs into ONE SplatData (the demo asset —
  zero downloads).
- **sort.worker.ts** — dedicated sort worker: 16-bit-quantized counting sort
  over view-space depth; transferable Uint32Array index ping-pong; re-sort
  only when camera direction·position delta > threshold; posts sortMs.
- **SplatMesh.ts** — InstancedBufferGeometry quad; splat attributes in
  DataTextures; vertex shader: 3D covariance from quat+scale → project →
  2×2 screen covariance → quad extents (3σ clamp); fragment: gaussian falloff
  × opacity, premultiplied alpha, depthWrite off; draws in sorted order via
  sorted-index instanced attribute. Public API:
  `class SplatMesh { constructor(data: SplatData); update(camera): void;
  readonly object3d: THREE.Object3D; stats: {count, sortMs}; dispose(): void }`
- Tests: parsers vs handcrafted fixture buffers; synthesize invariants
  (count/bounds/packing); sort vs Array.sort reference; covariance math vs
  known matrices.

### 4C. gl/text/ — MSDF WebGL text
- Build step: `scripts/gen-msdf.ts` (bun) runs `msdf-bmfont-xml` on
  `assets/fonts/Anton-Regular.ttf` (OFL, committed) → `public/msdf/anton.png`
  + `anton.json` (committed). **Fallback if the msdfgen toolchain fails on
  this machine:** `text/` also supports `mode: "sdf"` with a runtime
  tiny-sdf-style atlas generated in-browser (Canvas2D alpha → distance
  transform) as an AssetManager job; MsdfText's shader branches on mode
  (median(r,g,b) vs single-channel r). Ship whichever works; prefer MSDF.
- **font.ts** — bmfont json → glyph metrics map + kerning table.
- **layout.ts** — PURE layout: `layout(text, font, opts: {fontSize,
  letterSpacing, maxWidth, align, uppercase}) → { quads: Float32Array(16n)
  [x,y,w,h,u0,v0,u1,v1 per glyph… packed], width, height, lines }`.
  Unit-tested against known strings (advances, kerning pairs, line counts).
- **MsdfText.ts** — instanced glyph quads + ShaderMaterial (fwidth AA,
  color/opacity/outline/glow uniforms; glow feeds bloom). Sized in the
  1-unit=1px convention; positioned over TrackedRect of an invisible DOM
  headline (`.sr-visible-hidden` keeps SR/a11y complete).
- Used by: hero headline, particles title, picker flavor names.

### react/ bindings
- **EngineProvider.tsx** (`"use client"`): renders `<GlCanvas/>` (fixed,
  inset-0, `aria-hidden`, z-0 behind content) + children; constructs
  Ticker/VirtualScroll/RectTracker/PointerTracker + `createRenderHost()` ONLY
  in `useEffect` (identical SSR/CSR markup); per tick packs FRAME_STATE and
  calls `host.frame()`; cleanup = symmetric `destroy()` (StrictMode-safe).
  Context: `{ status: "boot" | "loading" | "ready" | "fallback", progress,
  hostMode, registerView, invoke }`.
- **useView.ts**: `useView(sceneId: SceneId): RefCallback<HTMLElement>` —
  tracks rect, assigns viewId, `host.addView` when ready, removes on unmount.
- **useScrollProgress.ts**: callback subscription (no per-frame state) +
  `useScrollProgressValue(throttleMs)` state variant.
- **MotionConfig coexistence**: engine never animates DOM style;
  framer-motion never touches scroll/canvas.

## 5. Demo route — `/deep-wave`

```
app/deep-wave/page.tsx        # server: metadata + <DeepWaveExperience/>
components/deep-wave/
  DeepWaveExperience.tsx      # "use client": EngineProvider + LoadingScreen + 6 sections
  LoadingScreen.tsx           # progress; framer-motion exit; scroll locked until ready
  DebugHud.tsx                # ?debug: ms, drawCalls, tier, worker on|off, splats, sortMs
  SectionHero.tsx SectionExploded.tsx SectionParticles.tsx
  SectionPointer.tsx SectionSplats.tsx SectionPicker.tsx
lib/scenes/
  hero-can/{scene.ts,can-geometry.ts,label-texture.ts}
  exploded/scene.ts
  particles/{scene.ts,shaders.ts}
  pointer-field/scene.ts
  splat-lounge/scene.ts
  picker/scene.ts
  placeholder/scene.ts        # M1 checkpoint: colored spinning cube
```

Every section = complete semantic DOM (readable with zero GL) +
`const ref = useView("scene-id")`. Copy voice: oryzo-style deadpan AI-product
satire for the Mateína can ("Powered by AI*  ·  *Argentine Ingenuity").

| # | Section | Scene requirements |
|---|---|---|
| 1 | Hero | Procedural can (LatheGeometry profile from `components/svg/Can.tsx` 200×480 proportions; label CanvasTexture from `lib/flavors.ts` mint palette; PMREM RoomEnvironment lid). MSDF headline "SMOOTH LIFT. ZERO CRASH." with bloom glow. Idle spin + damped pointer tilt; scroll pulls camera back. |
| 2 | Exploded | Can decomposes (lid/tab/shell/label/3 leaf planes) on ONE `Timeline`; `onProgress(p)` → `tl.sample(p)`; leader lines anchor to DOM copy rects. Scrubs both directions. |
| 3 | Particles | Curl-noise energy/steam via gpgpu ping-pong; counts 128²/256²/512² by tier; additive + bloom; scroll drives flow + forest→lemon ramp; MSDF section title. |
| 4 | Pointer field | ~300 InstancedMesh leaves/berries (colors from `decor`), spring integrators, pointer-velocity shove, raycast click impulse; touch = move impulses. |
| 5 | Splat lounge | `synthesizeCanScene()` splat set rendered by SplatMesh; scroll orbits camera (photoreal moment); HUD shows splat count + sortMs. Also accepts `?splat=<url>` to load an external `.splat`/`.ply`. |
| 6 | Picker | 5 flavor cans (reuse can-geometry + label-texture per flavor) on drag/arrow-key carousel; real DOM buttons; GL clear-region lerps to `flavor.bg`; MSDF flavor name; DOM panel (framer-motion) shows tagline. Selection flows via `invoke(viewId,"select",[i])`. |

## 6. Non-negotiable requirements

- **A11y:** canvas aria-hidden; all content readable/operable GL-less;
  keyboard fully works (hybrid scroll guarantees); reduced motion → native
  scroll, static frames (one render per progress change), bloom off,
  auto-anims off.
- **Perf:** 60fps target mid-tier; ≤2 views rendered mid-scroll; instancing;
  half-res bloom; quality tiers; `?debug` HUD.
- **Bundle:** engine/three load only on `/deep-wave` (route split + post-mount
  dynamic import); `/` first-load JS UNCHANGED.
- **Context loss:** centralized; idempotent `init`; page readable during loss.
- **Testing (CLAUDE.md rules):** all of `core/` (scroll step, normalizeWheel
  per deltaMode, damp/mapRange, rect math, spring, ticker via tick(),
  reduced-motion BOTH branches); Timeline sampling + crossing callbacks;
  protocol pack/unpack round-trip; splat parsers/synthesize/sort/covariance;
  text layout engine; AssetManager ordering/progress/failure; Stage lifecycle
  + culling vs RendererLike mock; dispose bookkeeping; StrictMode
  mount-unmount-mount. Never run `bun run dev` or watch mode in agents;
  verification is `bunx vitest run`, `bunx tsc --noEmit`, `bun run build`.

## 7. Build phasing

M0 contracts (blocking: deps, types.ts, protocol.ts, scene-registry ids,
route shell w/ 6 DOM sections + copy, MSDF atlas script + generated atlas or
documented fallback, contract tests) →
M1 four parallel workstreams (core/ · gl/ minus splats+text · worker/ ·
react/+components) → integration checkpoint (placeholder cube per section
through BOTH hosts, smooth scroll, loader resolves, clean unmount) →
M2 seven parallel workstreams (5 scenes + splats subsystem + text subsystem) →
M3 integration, visual tuning, reviews, QA (tests/build green, `/` unchanged,
browse QA desktop+375, console clean, keyboard walk, reduced-motion static,
worker on + forced-fallback both work, splat ordering correct, MSDF crisp at
3× zoom, ≥55fps).
