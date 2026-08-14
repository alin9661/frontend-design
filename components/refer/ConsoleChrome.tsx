// Presentational primitives for the /refer console. No "use client" — these
// are pure markup wrappers with no hooks, following the same reasoning as
// components/deep-wave/GagStats.tsx.

import type { ReactNode } from "react";

/** Tiny uppercase micro-label — the workhorse of dense enterprise UI. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="block text-[0.625rem] uppercase tracking-[0.2em] text-console-dim/70">
      {children}
    </span>
  );
}

/** Hairline-bordered panel. The console's only container shape. */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-console-line bg-white/[0.015] ${className}`}>
      {children}
    </div>
  );
}

/** Panel with a titled header strip. */
export function TitledPanel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel>
      <div className="flex items-center justify-between gap-4 border-b border-console-line px-4 py-2">
        <FieldLabel>{title}</FieldLabel>
        {aside ? (
          <span className="text-[0.625rem] uppercase tracking-[0.2em] text-console-amber">
            {aside}
          </span>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </Panel>
  );
}

/** A key/value row, the way every internal tool renders object properties. */
export function PropertyRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-console-line/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="w-44 shrink-0 text-[0.625rem] uppercase tracking-[0.2em] text-console-dim/70">
        {label}
      </span>
      <span
        className={`text-sm ${accent ? "text-console-amber" : "text-console-bright"}`}
      >
        {value}
      </span>
    </div>
  );
}
