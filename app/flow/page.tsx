import type { Metadata } from "next";
import { isCloud } from "@/lib/deploy";
import { RunLocalGuide } from "../run-local-guide";
import { FlowStudio } from "./flow-client";

export const metadata: Metadata = {
  title: "ZCLIP — Flow",
  description: "Pipeline method: confirm a still, then iterate its motion.",
};

/** Server gate — same cloud rule as /chat (see lib/deploy.ts). */
export default function FlowPage() {
  if (isCloud()) return <RunLocalGuide gated />;
  return <FlowStudio />;
}
