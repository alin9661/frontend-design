# Mateína Landing Page

An unofficial fan concept landing page for [Mateína](https://drinkmateina.com) — not
affiliated with or endorsed by the brand. A full-viewport hero with a floating parallax
scene, an auto-rotating flavor showcase across all five Energy Brews, and scroll-triggered
benefits/social-proof/footer sections, all built with hand-drawn SVG art (no external
images).

## Stack

- [Next.js 15](https://nextjs.org/) (App Router)
- [React 19](https://react.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Framer Motion](https://www.framer.com/motion/) for animation, with shared
  easing/duration tokens in `lib/motion.ts` (import them rather than
  hand-rolling a curve in a component — a test enforces this)
- [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/) for tests
- **Bun only** for tooling — never `npm`/`npx`/`yarn`

## Getting started

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command | Description |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run dev` | Start the dev server |
| `bun run test` | Run the test suite (`vitest run`, single pass — never bare `vitest`) |
| `bun run build` | Production build |
| `bun run start` | Serve the production build |

## Docs

| Doc | What's in it |
| --- | --- |
| [TESTING.md](./TESTING.md) | Testing philosophy, framework choice, conventions |
| [TODOS.md](./TODOS.md) | Known gaps and deferred work |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |
| [docs/deep-wave-engine-design.md](./docs/deep-wave-engine-design.md) | Design contract for `lib/engine/` and the `/deep-wave` WebGL demo route |
| [docs/msdf-fallback.md](./docs/msdf-fallback.md) | Why GL text uses a runtime SDF atlas instead of a build-time MSDF one |
