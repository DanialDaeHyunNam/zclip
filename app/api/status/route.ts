import { resolveProvider } from "@/lib/providers";
import { DEFAULT_PROVIDER, PROVIDERS } from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";
import { resolveKey, missingKeyMessage } from "@/lib/server-keys";

/** One cheap poll of provider-side job state. Client calls this every 3s. */
export async function GET(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing ?id=" }, { status: 400 });

  const resolved = resolveProvider(
    url.searchParams.get("provider") ?? DEFAULT_PROVIDER,
  );
  if (!resolved) {
    return Response.json({ error: "Unknown provider" }, { status: 400 });
  }

  const info = PROVIDERS[resolved.name];
  const apiKey = resolveKey(req, info.envVar);
  if (!apiKey) {
    // Poll-shaped payload — a bare {error} would leave the client polling
    // forever waiting for a state field.
    return Response.json({
      state: "error",
      error: missingKeyMessage(info.envVar, info.label),
    });
  }

  try {
    return Response.json(await resolved.adapter.status(id, apiKey));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Status check failed";
    // Delivered as a normal payload so the client has one shape to handle.
    return Response.json({ state: "error", error: message });
  }
}
