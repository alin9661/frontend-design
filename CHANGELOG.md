# Changelog

All notable changes to this project are documented in this file.
Versions follow the 4-digit `MAJOR.MINOR.PATCH.MICRO` format.

## [0.2.0.0] - 2026-07-31

### Added
- Deep Wave (`/deep-wave`): a second playground experiment — an oryzo.ai-style
  satirical product page for the Mateína can, driven by a new internal
  creative-WebGL engine. Scroll feels damped and cinematic while keyboard,
  anchors, and screen readers keep native behavior.
- Internal engine library (`lib/engine`): hybrid virtual scroll, DOM↔GL rect
  sync, a single scissor-culled canvas hosting six independent scenes,
  bloom/SMAA post-processing, GPGPU helpers, and a pure keyframe timeline.
- Rendering moves off the main thread when the browser allows it
  (OffscreenCanvas worker) with an identical main-thread fallback — and a
  readable no-WebGL fallback page when a GPU context can't be created.
- Custom Gaussian-splat renderer: `.splat`/`.ply` parsers, a procedural splat
  synthesizer (the demo's ~130k-splat can-on-table scene ships as code, not
  assets), a dedicated depth-sort worker, and covariance-projected rendering.
- WebGL typography via a runtime-generated SDF atlas — crisp GL headlines
  with glow, no font tooling required at build time.
- Six interactive scenes: composed hero can, timeline-scrubbed exploded view,
  curl-noise GPU particles, a spring-physics pointer field, the splat lounge,
  and a keyboard-operable flavor-can carousel.
- 529 new tests and CI bundle-size assertions guarding the landing page's
  unchanged footprint.

### Fixed
- Engine scroll writes no longer cancel native smooth scrolling (keyboard
  paging, `scrollBy`, anchor jumps now complete while wheel damping is
  active).

## [0.1.0.0] - 2026-07-30

### Added
- Mateína landing page: a full-viewport hero with a floating parallax scene
  (leaves, citrus, berries, and two flavor cans across three depth tiers) that
  responds to mouse movement and scroll.
- Flavor showcase that recolors the entire section per flavor across all five
  Energy Brews, with an auto-rotating carousel you can pause or take over —
  picking a flavor by hand stops the rotation for good.
- Benefits, social proof (marquee + testimonial), and footer sections with
  scroll-triggered reveals and an oversized cropped wordmark.
- Hand-drawn SVG art: flavor-tinted cans, leaves, citrus slices, and berries —
  fully self-contained, no external images.
- Sharing metadata: Open Graph/Twitter cards, a generated social image, and a
  site icon, so shared links unfurl properly.
- Test suite (Vitest + Testing Library, 40 tests) covering flavor data
  contracts, component accessibility, and the carousel's timer behavior, plus
  a hardened GitHub Actions pipeline (least-privilege token, SHA-pinned
  actions, concurrency cancellation, build caching).

### Changed
- Motion respects `prefers-reduced-motion` end to end (including smooth
  scrolling and server-rendered markup, so reduced-motion visitors get no
  hydration flash).

### Fixed
- Backdrop flavor name now renders at its intended subtle opacity.
- Screen readers hear each flavor change once (manual picks only) instead of
  an announcement every four seconds; marquee text is announced once.
- Deep parallax items no longer drift off-layout on long scrolls; same-depth
  items no longer bob in lockstep.
