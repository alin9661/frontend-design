// lib/engine/core/quality.ts
//
// Hardware-only quality selection. This module intentionally has no GL or
// THREE dependency so React can choose a tier before the renderer chunk is
// requested.

import type { QualityTier } from "../types";

/** Pure inputs for tier detection — every field is plain data (worker-safe). */
export interface QualityProbe {
  hardwareConcurrency: number;
  dpr: number;
  /** Optional measured ms of a first probe frame; omit if not yet measured. */
  firstFrameMs?: number;
}

/**
 * Pure quality-tier heuristic. The caller gathers browser or worker values;
 * this function only applies the thresholds.
 */
export function detectQualityTier(probe: QualityProbe): QualityTier {
  // Browser probes are typed as numbers, but privacy modes and test/device
  // shims can still surface `undefined`/NaN at runtime. Unknown hardware must
  // not fall through every comparison and accidentally earn the highest tier.
  const hardwareConcurrency = Number.isFinite(probe.hardwareConcurrency)
    ? probe.hardwareConcurrency
    : 4;
  const dpr = Number.isFinite(probe.dpr) ? probe.dpr : 1;
  const firstFrameMs = Number.isFinite(probe.firstFrameMs)
    ? probe.firstFrameMs
    : undefined;

  if (hardwareConcurrency <= 2 || dpr > 2.5 || (firstFrameMs !== undefined && firstFrameMs > 32)) {
    return "low";
  }
  if (hardwareConcurrency <= 4 || (firstFrameMs !== undefined && firstFrameMs > 18)) {
    return "medium";
  }
  return "high";
}
