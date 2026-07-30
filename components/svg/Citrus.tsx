function wedgePath(cx: number, cy: number, rOuter: number, startDeg: number, endDeg: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + rOuter * Math.cos(toRad(startDeg));
  const y1 = cy + rOuter * Math.sin(toRad(startDeg));
  const x2 = cx + rOuter * Math.cos(toRad(endDeg));
  const y2 = cy + rOuter * Math.sin(toRad(endDeg));
  return `M${cx} ${cy} L${x1} ${y1} A${rOuter} ${rOuter} 0 0 1 ${x2} ${y2} Z`;
}

export default function Citrus({
  className,
  color = "#F2C94C",
}: {
  className?: string;
  color?: string;
}) {
  const cx = 50;
  const cy = 50;
  const rindOuter = 46;
  const fleshOuter = 40;
  const segments = 8;
  const step = 360 / segments;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* rind ring */}
      <circle cx={cx} cy={cy} r={rindOuter} fill={color} />
      <circle cx={cx} cy={cy} r={fleshOuter} fill="#FFFDF3" />

      {/* 8 wedge segments */}
      {Array.from({ length: segments }).map((_, i) => {
        const start = i * step - 90;
        const end = start + step;
        return (
          <path
            key={i}
            d={wedgePath(cx, cy, fleshOuter - 2, start, end)}
            fill={color}
            opacity={i % 2 === 0 ? 0.85 : 0.65}
          />
        );
      })}

      {/* segment membranes */}
      {Array.from({ length: segments }).map((_, i) => {
        const angle = ((i * step - 90) * Math.PI) / 180;
        const x2 = cx + (fleshOuter - 1) * Math.cos(angle);
        const y2 = cy + (fleshOuter - 1) * Math.sin(angle);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x2}
            y2={y2}
            stroke="#FFFDF3"
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}

      {/* center pith */}
      <circle cx={cx} cy={cy} r={5} fill="#FFFDF3" />

      {/* rind outer stroke for crispness */}
      <circle
        cx={cx}
        cy={cy}
        r={rindOuter}
        fill="none"
        stroke="#00000018"
        strokeWidth={1.5}
      />
      <circle
        cx={cx}
        cy={cy}
        r={fleshOuter}
        fill="none"
        stroke="#00000014"
        strokeWidth={1}
      />
    </svg>
  );
}
