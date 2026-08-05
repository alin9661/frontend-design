# Changelog

All notable changes to this project are documented in this file.
Versions follow the 4-digit `MAJOR.MINOR.PATCH.MICRO` format.

## [0.2.1.0] - 2026-08-04

### Changed
- Motion across both pages now speaks one language. Entrances, flavor swaps,
  hover feedback, and scroll reveals share a single set of easing and duration
  tokens instead of four hand-tuned curves, so the site reads as one piece
  rather than a collection of separately-animated parts.
- Picking a flavor is now a single choreographed moment. The background, the
  giant flavor name, the can, and the description used to arrive on five
  different timings; they now move together, and the selection dot responds to
  a click in 200ms instead of 600ms.
- The `/deep-wave` scenes ease into their beats instead of tracking scroll
  literally. The can is assembled when its section arrives and fully apart
  before it leaves, the splat camera no longer changes direction abruptly
  mid-orbit, the flavor carousel accelerates and settles instead of lurching,
  and the loading bar slides rather than stepping.
- Decorative floating items pass through their resting position, so nothing
  jumps when the page loads.

### Fixed
- The hero can's scroll-driven camera pull works at all. It read the whole
  page's scroll instead of its own section's, then a first fix over-corrected
  and pinned it at maximum from the first frame; it now ramps across the
  hero's own span, so the can actually settles back as you scroll.
- GL headlines no longer double-render the words already on the page. The hero
  text sat inside the can and poked out around it, and the particles title
  landed on top of the DOM heading; GL type is now a deliberate backdrop and
  caption.
- Products render in their real colors. Every can carried metalness values that
  need an environment map to look right, and without one they silently
  discarded most of their color — the cans read olive-brown instead of mint,
  gold, and coral.
- The pointer field's 300 leaves and berries are visible again. They requested
  per-vertex colors from geometry that has none, which renders as black.
- The splat lounge reads as a can on a table. Its ambient haze stacked into
  near-solid dark shapes that swallowed the subject.
- The exploded-can diagram lifts off its background instead of reading as a
  silhouette.
- The hero can's tilt tracks the cursor without the previous lag.
- Reduced-motion users get a still loading bar; its transition was raw CSS and
  escaped the site-wide motion setting.
- Keyboard users get a visible focus ring on both primary buttons.

### Added
- Test coverage for the parts of the engine that only showed up on screen:
  watermark placement, nameplate placement, light rigs, the metalness budget,
  splat density, and the carousel's large-frame stability. 634 → 708 tests.

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
- 594 new tests and CI bundle-size assertions guarding the landing page's
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
