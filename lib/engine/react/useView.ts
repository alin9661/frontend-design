// lib/engine/react/useView.ts
//
// useView(sceneId): RefCallback<HTMLElement> (design doc §4 react/). Attach
// the returned ref to a section's root element: on attach it registers that
// element as `sceneId`'s tracked GL view (EngineProvider assigns a viewId,
// tracks its rect, and calls `host.addView` once the engine is ready); on
// detach — a re-render swapping the ref to a different element, or the
// owning component unmounting — it unregisters exactly once.
//
// `opts.onReady` (M2 addition, picker workstream): useView's return type is
// documented as just a RefCallback, with no way for a caller to learn the
// viewId EngineProvider assigned it — but SectionPicker needs that viewId to
// drive `useEngine().invoke(viewId, "select", [i])` (the cross-thread
// SCENE_INVOKE RPC path, see ../types.ts SceneModule.invoke). Rather than
// widen the return type (a bigger, less obviously-compatible change to an
// already-shipped M1 hook used by all 6 sections), this is the minimal
// additive extension: an optional second-argument callback, fired with the
// assigned viewId right after registerView on attach, and with `null` right
// after unregisterView on detach — so a caller only pays for it by opting
// in.

"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SceneId } from "@/lib/engine/types";
import { useEngine } from "./useEngine";

export type ViewRefCallback = (el: HTMLElement | null) => void;

export interface UseViewOptions {
  /** Fired with the assigned viewId on attach, and with `null` on detach. */
  onReady?: (viewId: number | null) => void;
}

export function useView(sceneId: SceneId, opts?: UseViewOptions): ViewRefCallback {
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
  // Always call the *latest* onReady without making it a `ref`/`detach`
  // dependency — an inline callback prop (the common case, see
  // SectionPicker.tsx) would otherwise churn identity every render and, via
  // `ref`'s own dependency array, spuriously re-run the attach/detach cycle.
  const onReadyRef = useRef(opts?.onReady);
  onReadyRef.current = opts?.onReady;

  const detach = useCallback(() => {
    if (viewIdRef.current !== null) {
      unregisterView(viewIdRef.current);
      viewIdRef.current = null;
      onReadyRef.current?.(null);
    }
  }, [unregisterView]);

  const ref = useCallback<ViewRefCallback>(
    (el) => {
      detach();
      if (el) {
        const viewId = registerView(el, sceneId);
        viewIdRef.current = viewId;
        onReadyRef.current?.(viewId);
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
