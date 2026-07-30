export default function Leaf({
  className,
  color = "#2E6B5A",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* elegant pointed yerba leaf, serrated silhouette */}
      <path
        d="M50 6
           C68 14 84 30 88 50
           C90 60 88 70 82 78
           C72 90 58 94 50 96
           C42 94 28 90 18 78
           C12 70 10 60 12 50
           C16 30 32 14 50 6 Z"
        fill={color}
      />
      {/* subtle serrated edge accents */}
      <path
        d="M50 6C48 20 44 34 38 46C32 58 22 68 12 74"
        stroke="#00000014"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M50 6C52 20 56 34 62 46C68 58 78 68 88 74"
        stroke="#00000014"
        strokeWidth="1.5"
        fill="none"
      />
      {/* center vein */}
      <path
        d="M50 14C50 36 50 66 50 92"
        stroke="#00000030"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* side veins */}
      <path
        d="M50 34C42 40 36 44 28 48M50 34C58 40 64 44 72 48"
        stroke="#00000022"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M50 54C43 60 37 64 30 68M50 54C57 60 63 64 70 68"
        stroke="#00000022"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* highlight */}
      <path
        d="M40 20C30 34 24 46 24 58"
        stroke="#ffffff33"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
