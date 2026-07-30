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
- **`test/floating-item.test.tsx`** — `components/FloatingItem.tsx`, a framer-motion
  wrapper. Verifies children render and the wrapper's accessibility/positioning
  attributes, independent of animation timing.
- **`test/flavor-showcase.test.tsx`** — `components/FlavorShowcase.tsx`, an
  interactive component with state. Verifies all picker buttons render, exactly one
  is pressed at a time, and clicking updates both the pressed state and the
  `aria-live` announcement.
- **`test/social-proof.test.tsx`** — `components/SocialProof.tsx`. Verifies the
  accessible star rating and the testimonial attribution text.
- **`test/hero.test.tsx`** — `components/Hero.tsx`. Verifies the two-line
  headline, CTA anchor targets, and both decor cans' accessible names.
- **`test/benefits.test.tsx`** — `components/Benefits.tsx`. Verifies the three
  benefit cards render and decorative leaves are `aria-hidden`.
- **`test/footer.test.tsx`** — `components/Footer.tsx`. Verifies the shop link's
  `href`/`target`/`rel` safety attributes, disclaimer, and hidden watermark.
- **`test/page.test.tsx`** — `app/page.tsx` integration. Renders the full page
  and asserts every in-page anchor (`#flavors`, `#benefits`) targets a real id.
- **`test/parallax-scene.test.tsx`** — `components/ParallaxScene.tsx`. Verifies
  the `useParallax` out-of-provider fallback, pointer-listener lifecycle, and
  reduced-motion behavior.
- **`test/svg.test.tsx`** — `components/svg/{Leaf,Citrus,Berry}.tsx` render
  smoke tests with color-prop application.

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
