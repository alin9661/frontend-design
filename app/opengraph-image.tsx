import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export const alt = "Mateína — Smooth Lift. Zero Crash.";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1D423C",
          padding: "80px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -2,
            color: "#F9F9EE",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          MATEÍNA
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 48,
            fontWeight: 700,
            color: "#F9F9EE",
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1.2,
          }}
        >
          SMOOTH LIFT. ZERO CRASH.
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
