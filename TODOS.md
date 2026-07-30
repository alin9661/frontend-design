# TODOS

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
