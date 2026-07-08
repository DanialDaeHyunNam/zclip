import type { Metadata } from "next";
import { isCloud } from "@/lib/deploy";
import { RunLocalGuide } from "../run-local-guide";
import Studio from "./studio";

export const metadata: Metadata = {
  title: "ZCLIP — Studio",
  description: "Chat out UGC reaction-hook clips, take by take.",
};

/**
 * Server gate. On the public cloud deploy the studio can't actually work
 * (keys are dev-only, generation spends real money) — so we serve the
 * local-install guide instead, and the heavy client studio never ships to
 * the visitor. Locally (`bun dev` / self-host) the real studio loads.
 * See lib/deploy.ts for how cloud-vs-local is decided.
 */
export default function ChatPage() {
  if (isCloud()) return <RunLocalGuide gated />;
  return <Studio />;
}
