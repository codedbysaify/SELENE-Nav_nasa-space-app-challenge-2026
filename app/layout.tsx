import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SELENE-Nav — Lunar South Pole Exploration",
  description:
    "Interactive 3D exploration of the lunar South Pole built on NASA LOLA elevation, slope and permanently-shadowed-region data (Barker et al. 2023).",
};

export const viewport: Viewport = {
  themeColor: "#030509",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
