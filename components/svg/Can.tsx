import { useId } from "react";

export default function Can({
  body,
  accent,
  label,
  className,
}: {
  body: string;
  accent: string;
  label?: string;
  className?: string;
}) {
  // useId() works in both Server and Client Components and guarantees a
  // unique id per instance, so two Cans sharing the same colors no longer
  // mint duplicate gradient/clip def ids in the document.
  const uid = `can-${useId().replace(/:/g, "")}`;

  return (
    <svg
      viewBox="0 0 200 480"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role={label ? "img" : undefined}
      aria-label={label ? `${label} can` : undefined}
    >
      <defs>
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.14" />
          <stop offset="18%" stopColor="#000000" stopOpacity="0" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="72%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="86%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id={`${uid}-top`} cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="70%" stopColor="#e7e7e2" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#c9c9c3" stopOpacity="0.9" />
        </radialGradient>
        <clipPath id={`${uid}-clip`}>
          <rect x="18" y="18" width="164" height="444" rx="26" />
        </clipPath>
      </defs>

      {/* body */}
      <rect x="18" y="18" width="164" height="444" rx="26" fill={body} />

      {/* soft vertical highlight + shading overlay, clipped to body */}
      <g clipPath={`url(#${uid}-clip)`}>
        <rect x="18" y="18" width="164" height="444" fill={`url(#${uid}-body)`} />
        {/* subtle base shadow */}
        <ellipse cx="100" cy="450" rx="82" ry="18" fill="#000000" opacity="0.08" />
      </g>

      {/* top rim */}
      <ellipse cx="100" cy="34" rx="72" ry="16" fill={`url(#${uid}-rim)`} />
      <ellipse cx="100" cy="30" rx="60" ry="12" fill={`url(#${uid}-top)`} />
      <ellipse
        cx="100"
        cy="30"
        rx="60"
        ry="12"
        fill="none"
        stroke="#00000022"
        strokeWidth="1.5"
      />

      {/* pull tab */}
      <g transform="translate(100 30)">
        <ellipse
          cx="6"
          cy="0"
          rx="16"
          ry="9"
          fill="none"
          stroke="#8a8a84"
          strokeWidth="4"
        />
        <circle cx="-10" cy="0" r="4" fill="#8a8a84" />
      </g>

      {/* leaf glyph */}
      <g transform="translate(100 96) scale(0.5)" opacity="0.95">
        <path
          d="M0 -46C24 -46 42 -24 42 6C42 34 22 52 0 60C-22 52 -42 34 -42 6C-42 -24 -24 -46 0 -46Z"
          fill={accent}
        />
        <path
          d="M0 -40C0 -10 0 30 0 56"
          stroke={body}
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* wordmark, stacked heavy condensed caps */}
      <g
        textAnchor="middle"
        fill={accent}
        style={{ fontFamily: "var(--font-anton), sans-serif", fontWeight: 400 }}
      >
        <text x="100" y="150" fontSize="34" letterSpacing="0.5">
          MATE
        </text>
        <text x="100" y="186" fontSize="34" letterSpacing="0.5">
          ÍNA
        </text>
      </g>

      {/* flavor label, constrained to the can body width so long names
          (e.g. "RASPBERRY YUZU", "MANGO KEY LIME") never clip at the edges.
          Only the longer names actually need the textLength squeeze — short
          ones like "MINT LIMEADE" must render at their natural width instead
          of being stretched out to fill 148 units. */}
      {label ? (
        <text
          x="100"
          y="330"
          textAnchor="middle"
          fill={accent}
          fontSize="18"
          {...(label.length > 12
            ? { textLength: "148", lengthAdjust: "spacingAndGlyphs" as const }
            : {})}
          style={{ fontFamily: "var(--font-anton), sans-serif", fontWeight: 400 }}
        >
          {label.toUpperCase()}
        </text>
      ) : null}

      {/* accent band */}
      <rect x="18" y="392" width="164" height="26" fill={accent} opacity="0.92" />
      <text
        x="100"
        y="409"
        textAnchor="middle"
        fill={body}
        fontSize="10"
        letterSpacing="2.5"
        style={{ fontFamily: "var(--font-anton), sans-serif", fontWeight: 400 }}
      >
        ZERO SUGAR · ENERGY BREW
      </text>

      {/* bottom rim */}
      <rect x="18" y="440" width="164" height="22" rx="11" fill={accent} opacity="0.35" />
      <ellipse cx="100" cy="462" rx="72" ry="10" fill={accent} opacity="0.45" />
    </svg>
  );
}
