// lib/engine/react/useEngine.ts
//
// Reads the EngineContext (design doc §4 react/). Throws outside an
// <EngineProvider> instead of silently returning a dummy value — every
// consumer (useView, useScrollProgress, LoadingScreen, DebugHud) needs a
// real engine, and a clear error here beats a confusing null-prop bug three
// components downstream.

"use client";

import { useContext } from "react";
import { EngineContext, type EngineContextValue } from "./engine-context";

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) {
    throw new Error("useEngine() must be called within an <EngineProvider>.");
  }
  return ctx;
}
