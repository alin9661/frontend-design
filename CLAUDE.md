# Mateína Landing Page

Next.js 15 (app router) landing page for Mateína, using framer-motion for
animation and Tailwind CSS v4. Package manager is **Bun only** — use `bun add`,
`bunx`, `bun run`. Never `npm`/`npx`/`yarn`.

## Motion

- Easing and duration live in `lib/motion.ts`, not in components. Import the
  token you need: `EASE_OUT` (the curve), `REVEAL` / `REVEAL_SLOW` (scroll
  entrances, the slow one for wordmark-scale elements), `SWAP` / `SWAP_FAST`
  (flavor-swap choreography and its exits), `CTA_SPRING` (button hover/tap),
  `CAN_SPRING` (product entrance).
- Do not hand-roll a curve in a component. `test/motion.test.ts` scans
  `components/*.tsx` and `components/deep-wave/*.tsx` and fails on an inline
  `[0.22, 1, 0.36, 1]` tuple or a bare `ease: "easeOut"` string.
- Retuning a token is a one-line change in `lib/motion.ts`; the tests assert
  relationships between tokens (exits faster than swaps, `REVEAL_SLOW` slower
  than `REVEAL`), not hardcoded numbers, so they survive a retune.

## Testing

- Run tests: `bun run test` (this is `vitest run` — a single pass, never watch
  mode). Never invoke bare `vitest` or `bun run dev` — both hang forever in an
  agent/CI session.
- Tests live in `test/`. See `TESTING.md` for the testing philosophy, framework
  choice (Vitest + Testing Library), and conventions in detail.
- Expectations for any code change:
  - Any new function or component gets a test covering its real behavior — not
    a placeholder like `expect(x).toBeDefined()`.
  - Any bug fix gets a regression test that fails on the old code and passes on
    the new code.
  - Cover both branches of a conditional (e.g. `prefersReducedMotion` true and
    false; a prop present and a prop omitted), not just the happy path.
  - Never commit or leave behind a failing test. If a test can't be made to
    pass after a reasonable fix attempt, delete it rather than skip/xfail it.
