// components/deep-wave/DebugHud.tsx
//
// The `?debug` HUD (design doc §4A/§6): ms, drawCalls, tier, worker on|off,
// splats, sortMs — sourced from EngineContext's `stats`/`hostMode`/`quality`
// (STATS messages + RenderHost.mode, relayed by EngineProvider). The
// `?debug` check runs in an effect (reads `window.location.search`) so
// server and first-client-paint markup match — this HUD renders nothing
// until that effect confirms the query param, same as everything else in
// EngineProvider's tree that depends on browser-only state.

"use client";

import { useEffect, useState } from "react";
import { useEngine } from "@/lib/engine/react/useEngine";

function useDebugEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(new URLSearchParams(window.location.search).has("debug"));
  }, []);
  return enabled;
}

export default function DebugHud() {
  const enabled = useDebugEnabled();
  const { status, hostMode, quality, stats } = useEngine();

  if (!enabled) return null;

  const rows: ReadonlyArray<{ label: string; value: string }> = [
    { label: "status", value: status },
    { label: "ms", value: stats ? stats.ms.toFixed(1) : "—" },
    { label: "draw calls", value: stats ? String(stats.drawCalls) : "—" },
    { label: "tier", value: quality ?? "—" },
    { label: "worker", value: hostMode ? (hostMode === "worker" ? "on" : "off") : "—" },
    { label: "splats", value: stats ? String(stats.splats) : "—" },
    { label: "sort ms", value: stats ? stats.sortMs.toFixed(2) : "—" },
  ];

  return (
    <dl
      aria-label="Debug stats"
      className="fixed bottom-4 right-4 z-50 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-forest-deep/90 px-4 py-3 font-mono text-xs text-cream"
    >
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="uppercase tracking-wide text-cream/60">{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
