import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { isCloud } from "@/lib/deploy";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
  variable: "--font-sans",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ZCLIP",
  description: "Reaction-hook clip generator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. GA opt-out) inject
    // attributes into <html> before React hydrates — not an app bug.
    <html
      lang="en"
      // `data-hosted="1"` on the hosted (Vercel) deploy, read client-side so the
      // studio never runs its self-update check against itself. See lib/use-version.
      data-hosted={isCloud() ? "1" : undefined}
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
