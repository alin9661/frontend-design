import type { Metadata, Viewport } from "next";
import { Anton, Space_Grotesk } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const title = "Mateína — Smooth Lift. Zero Crash.";
const description =
  "Clean, sustained energy brewed from organic yerba mate grown in the forests of Misiones, Argentina. No sugar. No jitters. No compromise.";

export const metadata: Metadata = {
  metadataBase: new URL("https://frontend-design.vercel.app"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#F9F9EE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${anton.variable} ${spaceGrotesk.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
