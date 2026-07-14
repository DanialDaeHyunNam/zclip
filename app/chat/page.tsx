import type { Metadata } from "next";
import Studio from "./studio";

export const metadata: Metadata = {
  title: "ZCLIP — Studio",
  description: "Chat out UGC reaction-hook clips, take by take.",
};

/**
 * The studio runs everywhere since v0.5.0 (docs/HOSTED.md): hosted visitors
 * bring their own keys (localStorage → per-request pass-through headers),
 * local installs keep the .env.local flow. Hosted-specific behavior keys off
 * useHosted() (the data-hosted stamp in app/layout.tsx); the local-install
 * guide still lives at /install and is where every hosted limit points.
 */
export default function ChatPage() {
  return <Studio />;
}
