# TODOS

## Deep Wave (WebGL engine + /deep-wave route)

### Picker hover selection
**Priority:** P3
`lib/scenes/picker/scene.ts` no longer registers its can groups as raycast
targets (design review item D — registering cost a real per-frame raycast
for zero payoff while selection flows entirely through DOM buttons +
`invoke("select", [i])`). Wire `onPointer` + re-register the flavor cans as
raycast targets when hover/click-driven selection is actually implemented.

### Entrance choreography
**Priority:** P2
Loader-gated entrance reveals and scroll-linked per-section GL alpha fades
(oryzo-style choreography). Deliberately deferred from the review fix pass —
feature-shaped, touches Stage/scenes/provider, needs its own tests.

### Visual taste iteration
**Priority:** P3
Mostly resolved by /design-review on feat/motion-polish (2026-08-03): GL echo
headline is now a deliberate backdrop watermark behind the hero can, splat
lounge haze/scale/label-mix retuned so the can-on-table diorama reads, and
can materials brightened (metalness-without-envmap fix). Remaining: picker
"Raspberry Yuzu" pill still shows a side can through its transparent pill
background at 1440px (cosmetic), and the splat can's front face could still
be lighter. Pure art-direction iteration via screenshot loops.

### Shared label-texture cache
**Priority:** P3
`createLabelTexture` is called independently by hero-can, exploded, and picker
(x5), so the page holds seven RGBA label textures — six at the 1024x2048 default
plus the exploded section's reduced one. Hero and exploded both draw the same
mint label, so before v0.2.1.0 those two were byte-identical; the exploded one
is now 512x1024 (v0.2.1.0 review, item H5), which shrinks the duplicate rather
than removing it. A real
fix is a flavor-keyed cache with refcounted disposal; deferred because texture
lifetime across context-loss re-init needs its own design and tests.

### Stage calls update() before onProgress()
**Priority:** P3
`lib/engine/gl/stage.ts` delivers the frame's `update(dt)` before
`onProgress(p)`, so any scene that stores progress in `onProgress` and consumes
it in `update` trails scroll by one frame. hero-can is the only such scene today
and works around it by seeding `viewProgress` from live scroll in `init()`
(v0.2.1.0 review, item H6). Swapping the call order would fix it globally but
every other scene depends on the current ordering — needs a Stage-level test
sweep before changing.

### TESTING.md test-layer list is stale
**Priority:** P4
The Deep Wave section still says "42 files" and doesn't list
`test/scenes/hero-can-headline.test.ts` or `test/scenes/picker-nameplate.test.ts`
(added v0.2.1.0). Not updated in that release because the file was being edited
concurrently by unrelated work on the same worktree.

### Hot-path allocation pass
**Priority:** P3
Per-frame object churn in Stage/render.worker/host/EngineProvider tick
(ViewContext, frame-state, pointer/scroll snapshots). Contained wins exist
but touch both RenderHost implementations at once.

### Upward hash-anchor from document end
**Priority:** P3
Repro: scroll pinned to the exact document bottom (scrollY == limit), then
`location.hash = '#hero'` — the upward smooth animation is interrupted near
its start and the page stays at the bottom. Downward anchors, `scrollBy`,
keyboard scrolling, and wheel all work after the idle-write fix. Suspects:
Next.js hashchange scroll handling racing the engine's divergence adoption,
or a Chromium quirk animating from exactly document-end. No UI anchor links
exist today, so user impact is nil.

### Reduced-motion live toggle
**Priority:** P3
prefers-reduced-motion changes mid-session are only picked up on reload;
forward matchMedia changes via SET_REDUCED_MOTION to the render host.

## Testing

### Playwright E2E suite for browser-only flows
**Priority:** P2
Ten flows are untestable in jsdom and rely on manual QA today: mouse-parallax
feel, scroll drift, IntersectionObserver reveals, marquee animation and its
reduced-motion pause, flavor background-color lerp, can `textLength` no-clip,
CTA hover/tap scale. Add a small Playwright suite (`bunx playwright`) covering
them against `bun run dev`.

## Performance

### LazyMotion migration
**Priority:** P3
All sections import the full `motion` component (~45KB gz). Wrap the page in
`<LazyMotion features={domAnimation} strict>` and switch to `m.*` to roughly
halve the animation runtime payload.

### FlavorShowcase background paint cost
**Priority:** P3
`animate={{ backgroundColor }}` repaints the full viewport during each 600ms
flavor transition. If low-end devices stutter, crossfade two absolutely
positioned background layers via opacity instead.

## Infrastructure

### Security headers
**Priority:** P3
No CSP / X-Content-Type-Options / Referrer-Policy are set. Add a `headers()`
entry in `next.config.ts` or configure at the host when a deploy target is
chosen.

### Dependabot for pinned GitHub Actions
**Priority:** P3
CI actions are SHA-pinned; add a `github-actions` Dependabot config so the
pins get PR-refreshed instead of going stale.

### Self-host fonts
**Priority:** P3
`next/font/google` fetches Anton + Space Grotesk at build time (CI cache
mitigates). Switching to `next/font/local` removes the network dependency
entirely.

## Design

### Real product photography
**Priority:** P4
The SVG cans are stylized stand-ins. If this concept graduates, swap in real
product renders/photography for the hero and showcase.

## Completed
