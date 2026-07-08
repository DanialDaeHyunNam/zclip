import type { Metadata } from "next";
import { isCloud } from "@/lib/deploy";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "ZCLIP — 1 prompt, 10 takes. Hook 10x faster.",
  description:
    "Open-source AI studio for UGC reaction hooks: chat out takes, rewind anything, blend takes, pay cents per clip with your own keys. Runs locally — English / 한국어.",
};

export default function Landing() {
  // Server-only cloud check → the studio CTA sends cloud visitors to the
  // local-install guide (the studio can't work on the public deploy).
  return <LandingClient cloud={isCloud()} />;
}
