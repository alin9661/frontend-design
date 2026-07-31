// lib/engine/react/useView.ts
//
// useView(sceneId): RefCallback<HTMLElement> (design doc §4 react/). Attach
// the returned ref to a section's root element: on attach it registers that
// element as `sceneId`'s tracked GL view (EngineProvider assigns a viewId,
// tracks its rect, and calls `host.addView` once the engine is ready); on
// detach — a re-render swapping the ref to a different element, or the
// owning component unmounting — it unregisters exactly once.

"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SceneId } from "@/lib/engine/types";
import { useEngine } from "./useEngine";

export type ViewRefCallback = (el: HTMLElement | null) => void;

export function useView(sceneId: SceneId): ViewRefCallback {
  // Destructure the two specific functions instead of depending on the
  // whole `engine` object below: EngineProvider's context value is a fresh
  // object on every status/progress/hostMode/stats change (all of which
  // happen routinely during boot and while STATS messages stream in), even
  // though registerView/unregisterView themselves are individually stable
  // (useCallback with no deps). Depending on `engine` instead of these two
  // functions would make `ref`'s identity — and therefore React's
  // detach-old/attach-new ref cycle — churn on every such change, spuriously
  // unregistering and re-registering this view.
  const { registerView, unregisterView } = useEngine();
  const viewIdRef = useRef<number | null>(null);

  const detach = useCallback(() => {
    if (viewIdRef.current !== null) {
      unregisterView(viewIdRef.current);
      viewIdRef.current = null;
    }
  }, [unregisterView]);

  const ref = useCallback<ViewRefCallback>(
    (el) => {
      detach();
      if (el) {
        viewIdRef.current = registerView(el, sceneId);
      }
    },
    [detach, registerView, sceneId]
  );

  // Safety net: React always calls a ref callback with `null` before
  // unmounting the element it's attached to, so in practice `detach` above
  // already covers unmount. This only matters if a consumer stops rendering
  // the ref'd element without React ever invoking the callback with null
  // (e.g. the whole subtree is torn down without a commit in between) —
  // guarantees `unregisterView` still fires exactly once.
  useEffect(() => detach, [detach]);

  return ref;
}
