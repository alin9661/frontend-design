// components/deep-wave/GagStats.tsx
//
// Shared "gag stat" row used by every /deep-wave section — the oryzo-style
// deadpan mini-metrics under each section's copy (§5). Plain presentational
// component, no client-only APIs, so it's safe to import from both server-
// rendered and "use client" sections alike.

export interface GagStat {
  label: string;
  value: string;
  detail?: string;
}

export default function GagStats({ stats }: { stats: GagStat[] }) {
  return (
    <dl className="mt-10 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="font-body text-xs uppercase tracking-[0.2em] opacity-60">
            {stat.label}
          </dt>
          <dd className="font-display text-3xl">{stat.value}</dd>
          {stat.detail ? (
            <p className="mt-1 font-body text-sm opacity-70">{stat.detail}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
