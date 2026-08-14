# Testing

100% test coverage is the key to great vibe coding — it's what lets you (and an AI
assistant) change this codebase fast, with confidence, without breaking what already
works.

## Framework

- [Vitest](https://vitest.dev/) — test runner, assertions, mocking
- [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro/) — renders components and queries them the way a user/screen reader would
- [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) — DOM matchers (`toBeInTheDocument`, `toHaveStyle`, etc.)
- [@testing-library/user-event](https://testing-library.com/docs/user-event/intro/) — realistic user interaction simulation (clicks, etc.)
- jsdom — the DOM environment tests run in

## How to run

```bash
bun run test
```

This runs `vitest run` (single pass, no watch mode). Never run bare `vitest` in this
repo — it defaults to watch mode, which hangs in CI and agent sessions.

## Test layers

- **`test/flavors.test.ts`** — data-layer tests for `lib/flavors.ts`. No rendering;
  plain assertions on the exported data (counts, uniqueness, color format).
- **`test/can.test.tsx`** — pure SVG component test for `components/svg/Can.tsx`.
  Verifies accessibility props (`role="img"`, `aria-label`) and visible label text.
- **`test/origin-story.test.tsx`** — `components/OriginStory.tsx`. Verifies the
  full plant-to-drink narrative, CTA targets, finished-can label, and both the
  sticky animated and stacked reduced-motion layouts.
- **`test/scenes/origin-film.test.ts`** — `lib/scenes/origin-film/`, the origin
  film as a `SceneModule` on the shared engine (it used to be a bespoke
  `<canvas>` with its own renderer). Covers the pure rig builders, per-quality
  leaf/shelf-can counts, plant-to-can pose staging off scroll progress,
  re-runnable `init()` for context-loss restore, camera restore on `dispose()`,
  and the reduced-motion split — all without a GPU in Vitest.
- **`test/origin-timeline.test.ts`** — `lib/visuals/origin-timeline.ts`, the
  chapter clock both the DOM film and the GL film read from, including
  out-of-range progress clamping.
- **`test/flavor-showcase.test.tsx`** — `components/FlavorShowcase.tsx`, an
  interactive component with state. Verifies all picker buttons render, exactly one
  is pressed at a time, and clicking updates both the pressed state and the
  `aria-live` announcement.
- **`test/social-proof.test.tsx`** — `components/SocialProof.tsx`. Verifies the
  accessible star rating and the testimonial attribution text.
- **`test/benefits.test.tsx`** — `components/Benefits.tsx`. Verifies the three
  benefit cards render and decorative leaves are `aria-hidden`.
- **`test/footer.test.tsx`** — `components/Footer.tsx`. Verifies the shop link's
  `href`/`target`/`rel` safety attributes, disclaimer, and hidden watermark.
- **`test/page.test.tsx`** — `app/page.tsx` integration. Renders the full page
  and asserts every in-page anchor (`#flavors`, `#benefits`) targets a real id.
- **`test/svg.test.tsx`** — `components/svg/{Leaf,Citrus,Berry}.tsx` render
  smoke tests with color-prop application.

### Referral Ontology tests (`/refer`)

- **`test/referral.test.ts`** — data-layer tests for `lib/referral.ts`. Covers
  both branches of `buildReferralBlurb`'s optional résumé line, and pins the
  template to pronoun-neutral wording.
- **`test/refer-page.test.tsx`** — `app/refer/page.tsx` integration. Walks the
  five-step machine end to end, asserts the entity-resolution acknowledgement
  gate, the Back control, the graph's accessible description, and the parody
  disclaimer.
- **`test/refer-clearance-step.test.tsx`** — `components/refer/ClearanceStep.tsx`
  and, through it, the shared `useTimedLog` hook. Covers **both** reduced-motion
  branches: instant full log vs. one line per tick under fake timers.
- **`test/refer-submit-step.test.tsx`** — `components/refer/SubmitReferralStep.tsx`.
  Covers the clipboard success path and both failure paths (no clipboard API,
  rejected write), since a silently no-op button would defeat the page's only
  delivery mechanism.

### Deep Wave engine tests (42 files)

The `/deep-wave` engine ships its own suites, mirroring the source layout:
`test/engine/core/` (scroll/ticker/rect/pointer/math — the pure core, both
reduced-motion branches), `test/engine/gl/` (stage lifecycle and culling
against a mock renderer, post, assets, raycast, gpgpu, timeline, noise),
`test/engine/text/` (SDF atlas EDT math, bmfont parsing, layout engine,
GlText), `test/engine/splats/` (format parsers, synthesis invariants, sort
vs reference, covariance math, worker handshake), `test/engine/worker/`
(protocol round-trips, both render hosts, HIT/INIT_FAILED paths),
`test/engine/react/` (provider lifecycle, hooks), `test/scenes/` (one per
scene), and `test/scripts/` (bundle-budget checker). GL visuals and scroll
feel are browser-only — see the Playwright deferral in TODOS.md.

## Conventions

- Tests live in `test/`, named `<subject>.test.ts` (data/logic) or
  `<subject>.test.tsx` (components).
- Query by role/label/text (`getByRole`, `getByText`) the way a user or screen
  reader would — avoid querying by CSS class or test-id unless there's no
  accessible alternative.
- Never write assertion-free or trivial tests (e.g. `expect(x).toBeDefined()`).
  Every test should fail if the behavior it names actually breaks.
- `test/setup.ts` mocks `window.matchMedia` and `IntersectionObserver`, both of
  which framer-motion needs (`useReducedMotion`, `whileInView`) but jsdom doesn't
  implement. Import `@testing-library/jest-dom/vitest` there, not per-test-file.
- Framer-motion components render as their underlying DOM element (e.g.
  `motion.div` → `div`), so component tests assert on rendered DOM/attributes, not
  animation internals.
