# Changelog

All notable changes to this project are documented in this file.
Versions follow the 4-digit `MAJOR.MINOR.PATCH.MICRO` format.

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
