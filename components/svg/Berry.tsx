const DRUPELETS: { x: number; y: number; r: number }[] = [
  // top row (widest, near the calyx)
  { x: 34, y: 30, r: 13 },
  { x: 50, y: 26, r: 13.5 },
  { x: 66, y: 30, r: 13 },
  // upper-mid row
  { x: 27, y: 45, r: 12.5 },
  { x: 50, y: 44, r: 13 },
  { x: 73, y: 45, r: 12.5 },
  // lower-mid row (tapering)
  { x: 37, y: 59, r: 11 },
  { x: 62, y: 59, r: 11 },
  // tip
  { x: 50, y: 71, r: 9.5 },
];

export default function Berry({
  className,
  color = "#D94F3D",
}: {
  className?: string;
  color?: string;
}) {
  const uid = `berry-${color.replace("#", "")}`;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={`${uid}-shine`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* tiny leaf / calyx at top */}
      <g transform="translate(50 12)">
        <path
          d="M0 -8C6 -10 12 -6 13 0C12 6 6 9 0 10C-6 9 -12 6 -13 0C-12 -6 -6 -10 0 -8Z"
          fill="#2E6B5A"
          opacity="0.9"
        />
        <path
          d="M0 -6C0 -2 0 5 0 10"
          stroke="#1D423C"
          strokeWidth="1"
          fill="none"
          opacity="0.5"
        />
      </g>

      {/* drupelet cluster */}
      {DRUPELETS.map((d, i) => (
        <g key={i}>
          <circle
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={color}
            stroke="#00000022"
            strokeWidth="0.75"
          />
          <circle cx={d.x} cy={d.y} r={d.r} fill={`url(#${uid}-shine)`} />
          <ellipse
            cx={d.x - d.r * 0.35}
            cy={d.y - d.r * 0.4}
            rx={d.r * 0.28}
            ry={d.r * 0.2}
            fill="#ffffff"
            opacity="0.45"
          />
        </g>
      ))}
    </svg>
  );
}
