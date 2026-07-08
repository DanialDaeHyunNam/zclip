import type { Metadata } from "next";
import { RunLocalGuide } from "../run-local-guide";

export const metadata: Metadata = {
  title: "ZCLIP — Run it locally",
  description:
    "Install and run the open-source ZCLIP studio on your own machine (macOS / Windows). Available in English and Korean.",
};

export default function InstallPage() {
  return <RunLocalGuide />;
}
