# Mateína Landing Page

Next.js 15 (app router) landing page for Mateína, using framer-motion for
animation and Tailwind CSS v4. Package manager is **Bun only** — use `bun add`,
`bunx`, `bun run`. Never `npm`/`npx`/`yarn`.

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
