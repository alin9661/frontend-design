// Shared motion vocabulary for the landing page. Centralizing these tokens
// keeps entrances, swaps, and CTA feedback visually consistent across
// components instead of each one hand-rolling its own easing/duration pairs.

/** easeOutQuint-like curve: fast start, long decelerating tail. Used for
 * anything that should feel like it's settling into place (entrances,
 * swaps) rather than gliding at a constant rate. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Standard scroll-reveal transition: content entering the viewport should
 * decelerate into its resting position. */
export const REVEAL = { duration: 0.6, ease: EASE_OUT } as const;

/** Sync token for the flavor-swap choreography — every piece of the swap
 * (background, backdrop text, tagline) shares this duration/easing so the
 * swap reads as one event instead of several independently-timed ones. */
export const SWAP = { duration: 0.5, ease: EASE_OUT } as const;

/** Spring used for CTA hover/tap feedback — snappy, slightly overshooting. */
export const CTA_SPRING = { type: "spring", stiffness: 400, damping: 25 } as const;
