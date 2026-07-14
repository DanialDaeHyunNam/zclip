import { resolveProvider } from "@/lib/providers";
import {
  PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULTS,
  ASPECT_RATIOS,
  DURATION_MIN,
  DURATION_MAX,
  RESOLUTIONS,
  type AspectRatio,
  type Resolution,
} from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";
import { resolveKey, missingKey } from "@/lib/server-keys";
import { isCloud } from "@/lib/deploy";

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_B64 = 4_000_000; // ~3MB decoded — client downscales well below this
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_VIDEO_B64 = 22_000_000; // ~16MB decoded — Runway's inline data-URI cap

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

/** Validate an optional video (Act-Two driving reference). */
function parseVideo(
  raw: unknown,
): { base64: string; mimeType: string } | undefined | string {
  if (raw == null) return undefined;
  if (typeof raw !== "object") return "Invalid video";
  const { base64, mimeType } = raw as Record<string, unknown>;
  if (typeof base64 !== "string" || typeof mimeType !== "string")
    return "Invalid video";
  if (!VIDEO_MIMES.includes(mimeType)) return "Unsupported video type";
  if (base64.length > MAX_VIDEO_B64) return "Driving video too large (max ~16MB — trim it)";
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return "Invalid video encoding";
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

  const resolved = resolveProvider(
    typeof body.provider === "string" ? body.provider : DEFAULT_PROVIDER,
  );
  if (!resolved) {
    return Response.json({ error: "Unknown provider" }, { status: 400 });
  }

  // Act-Two is a pure performance transfer (video + face); it takes no text
  // prompt. Every other provider requires one.
  const isTransfer = resolved.name === "runway";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!isTransfer && !prompt.trim()) {
    return Response.json({ error: "Prompt is empty" }, { status: 400 });
  }
  // Spec-gate prompts legitimately run 2–4k chars; 6000 keeps a sanity
  // ceiling without rejecting a slightly-long assembled spec (the
  // assembler targets ≤3600, but Gemini overshoots sometimes).
  if (prompt.length > 6000) {
    return Response.json({ error: "Prompt too long (6000 char max)" }, { status: 400 });
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
    !Number.isInteger(durationSeconds) ||
    durationSeconds < DURATION_MIN ||
    durationSeconds > DURATION_MAX ||
    !RESOLUTIONS.includes(resolution)
  ) {
    return Response.json({ error: "Invalid video parameters" }, { status: 400 });
  }

  const image = parseImage(body.image);
  if (typeof image === "string") {
    return Response.json({ error: image }, { status: 400 });
  }
  const character = parseImage(body.character);
  if (typeof character === "string") {
    return Response.json({ error: character }, { status: 400 });
  }
  const drivingVideo = parseVideo(body.drivingVideo);
  if (typeof drivingVideo === "string") {
    return Response.json({ error: drivingVideo }, { status: 400 });
  }

  const modelId =
    typeof body.modelId === "string" && /^[\w.:-]{1,80}$/.test(body.modelId)
      ? body.modelId
      : undefined;

  // Hosted: the reference-video Seedance path parks the clip on the OWNER's
  // Vercel Blob (lib/blob.ts) — a shared quota public visitors must not
  // drain. Keyless-ref Seedance still works hosted (docs/HOSTED.md §3.3).
  if (isCloud() && resolved.name === "seedance" && drivingVideo) {
    return Response.json(
      {
        error:
          "Reference-video Seedance isn't available on the hosted app — it stages the clip on the operator's storage. Install ZCLIP locally (see /install) to use it; Seedance without a reference video works right here.",
      },
      { status: 400 },
    );
  }

  const apiKey = resolveKey(req, info.envVar);
  if (!apiKey) return missingKey(info.envVar, info.label);

  try {
    const { jobId } = await resolved.adapter.submit(prompt.trim(), {
      aspectRatio,
      durationSeconds,
      resolution,
      image,
      character,
      drivingVideo,
      modelId,
    }, apiKey);
    return Response.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submit failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
