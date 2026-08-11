# Mateína Landing Page

An unofficial fan concept landing page for [Mateína](https://drinkmateina.com) — not
affiliated with or endorsed by the brand. A cinematic plant-to-drink origin story follows
one animated line from the forests of Misiones through leaf and brew to the finished can.
An in-house WebGL layer adds instanced leaves, a custom brewed-energy shader, and the
project's procedural 3D can while preserving the complete SVG experience as a fallback.
The story is followed by an auto-rotating showcase of all five Energy Brews and
scroll-triggered benefits/social-proof/footer sections. The origin film optionally loads
`public/origin-assets.glb` for its hand and machine, falling back to procedural geometry
when that uncommitted file is absent; the rest remains hand-drawn or procedural art. See
[the Blender authoring brief](docs/origin-assets-blender-brief.md) for how to make one.

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
