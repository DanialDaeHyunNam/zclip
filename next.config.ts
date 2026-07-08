import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// Inline package.json's version into the client bundle as NEXT_PUBLIC_APP_VERSION.
// A running local copy compares this against the canonical Vercel deployment's
// /api/version to detect updates. Override via env to preview the "update
// available" state locally, e.g. NEXT_PUBLIC_APP_VERSION=0.0.1 bun dev.
const version = (JSON.parse(readFileSync("package.json", "utf8")).version as string) || "0.0.0";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || version },
};

export default nextConfig;
