import { resolveProvider } from "@/lib/providers";
import {
  PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULTS,
  ASPECT_RATIOS,
  DURATIONS,
  RESOLUTIONS,
  type AspectRatio,
  type Resolution,
} from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_B64 = 4_000_000; // ~3MB decoded — client downscales well below this

/** Validate an optional client-supplied reference image. Returns the image,
 *  undefined when absent, or an error string. */
function parseImage(
  raw: unknown,
): { base64: string; mimeType: string } | undefined | string {
  if (raw == null) return undefined;
  if (typeof raw !== "object") return "Invalid image";
  const { base64, mimeType } = raw as Record<string, unknown>;
  if (typeof base64 !== "string" || typeof mimeType !== "string")
    return "Invalid image";
  if (!IMAGE_MIMES.includes(mimeType)) return "Unsupported image type";
  if (base64.length > MAX_IMAGE_B64) return "Image too large (max ~3MB)";
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return "Invalid image encoding";
  return { base64, mimeType };
}

/** Submit a generation job. Returns { jobId } immediately — never waits. */
export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = body.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "Prompt is empty" }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return Response.json({ error: "Prompt too long (4000 char max)" }, { status: 400 });
  }

  const resolved = resolveProvider(
    typeof body.provider === "string" ? body.provider : DEFAULT_PROVIDER,
  );
  if (!resolved) {
    return Response.json({ error: "Unknown provider" }, { status: 400 });
  }
  const info = PROVIDERS[resolved.name];
  if (!info.implemented) {
    return Response.json(
      {
        error: `${info.label} isn't wired yet — implement ${info.adapterFile} (docs: ${info.docsUrl}), flip implemented:true in lib/config.ts, and set ${info.envVar}.`,
      },
      { status: 400 },
    );
  }

  // Validate params against the whitelists — never trust raw client input.
  const aspectRatio = (body.aspectRatio ?? DEFAULTS.aspectRatio) as AspectRatio;
  const durationSeconds = Number(body.durationSeconds ?? DEFAULTS.durationSeconds);
  const resolution = (body.resolution ?? DEFAULTS.resolution) as Resolution;
  if (
    !ASPECT_RATIOS.includes(aspectRatio) ||
    !DURATIONS.includes(durationSeconds) ||
    !RESOLUTIONS.includes(resolution)
  ) {
    return Response.json({ error: "Invalid video parameters" }, { status: 400 });
  }
  if (resolution !== "720p" && durationSeconds !== 8) {
    return Response.json(
      { error: "1080p output requires 8s duration (Veo constraint)" },
      { status: 400 },
    );
  }

  const image = parseImage(body.image);
  if (typeof image === "string") {
    return Response.json({ error: image }, { status: 400 });
  }

  try {
    const { jobId } = await resolved.adapter.submit(prompt.trim(), {
      aspectRatio,
      durationSeconds,
      resolution,
      image,
    });
    return Response.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submit failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
