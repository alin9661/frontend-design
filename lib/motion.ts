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

/** Oversized/wordmark-scale reveal — same curve as REVEAL, slower so a big
 * element doesn't feel like it's rushing into place. */
export const REVEAL_SLOW = { duration: 0.8, ease: EASE_OUT } as const;

/** Sync token for the flavor-swap choreography — every piece of the swap
 * (background, backdrop text, tagline) shares this duration/easing so the
 * swap reads as one event instead of several independently-timed ones. */
export const SWAP = { duration: 0.5, ease: EASE_OUT } as const;

/** Faster sibling of SWAP — exits and the reduced-motion swap read better
 * clipped short than at SWAP's full 0.5s. */
export const SWAP_FAST = { duration: 0.3, ease: EASE_OUT } as const;

/** Spring used for CTA hover/tap feedback — snappy, slightly overshooting. */
export const CTA_SPRING = { type: "spring", stiffness: 400, damping: 25 } as const;

/** Spring used for the product (can) entrance — same shape as CTA_SPRING's
 * category but tuned softer for a larger, slower-settling element. */
export const CAN_SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;
