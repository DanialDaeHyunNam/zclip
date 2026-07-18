import type { Metadata } from "next";
import DepthClient from "./depth-client";

/**
 * /depth — the MOVES-stage depth converter. Pure client-side (Depth Anything
 * V2 in-browser), so it renders everywhere; the Save-to-Library affordance
 * is hidden on hosted (the clip vault is dev-only).
 */

export const metadata: Metadata = {
  title: "Depth Video Extractor — ZCLIP",
  description:
    "Turn any clip into a depth-map video entirely in your browser — Depth Anything V2, WebGPU, no upload, no API key.",
};

export default function DepthPage() {
  return <DepthClient />;
}
