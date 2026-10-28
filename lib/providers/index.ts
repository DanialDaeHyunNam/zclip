import { PROVIDERS, type ProviderName } from "@/lib/config";
import type { VideoProvider } from "./types";
import { veo } from "./veo";
import { sora } from "./sora";
import { grok } from "./grok";
import { seedance } from "./seedance";
import { runway } from "./runway";
import { kling } from "./kling";
import { kling4 } from "./kling4";
import { lucy } from "./lucy";

const registry: Record<ProviderName, VideoProvider> = {
  veo,
  sora,
  grok,
  seedance,
  runway,
  kling,
  kling4,
  lucy,
};

/** Resolve a client-supplied provider name to its adapter, or null if the
 *  name is unknown. Callers should also check PROVIDERS[name].implemented. */
export function resolveProvider(
  name: string | null | undefined,
): { name: ProviderName; adapter: VideoProvider } | null {
  if (!name || !(name in registry)) return null;
  return { name: name as ProviderName, adapter: registry[name as ProviderName] };
}

export { PROVIDERS };
