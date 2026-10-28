import { checkPassword, unauthorized } from "@/lib/auth";

/**
 * Keyless text-to-speech for the CUT pipeline (docs/CUT-FLOW.md) — Microsoft
 * Edge's read-aloud voices via msedge-tts, the same free path MPT defaults
 * to. UNOFFICIAL endpoint: it can break without notice, so every failure is
 * loud and names the fallback (Gemini TTS is the keyed alternative, later).
 *
 * POST { text, voice } → { audioB64, mime: "audio/mpeg" }
 * One call per SCENE — per-scene audio makes scene durations exact (the
 * voiceover owns the timeline) and lets scenes reorder without re-synthesis.
 */

// The voice name is interpolated into SSML by the lib — whitelist hard.
const VOICE_RE = /^[a-z]{2,3}-[A-Za-z]{2,10}-[A-Za-z0-9]{2,40}Neural$/;
const MAX_CHARS = 3000;

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  let text: unknown, voice: unknown;
  try {
    ({ text, voice } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Text is empty" }, { status: 400 });
  }
  if (typeof voice !== "string" || !VOICE_RE.test(voice)) {
    return Response.json({ error: "Unknown voice" }, { status: 400 });
  }
  const clean = text.trim().slice(0, MAX_CHARS);

  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    const fmt =
      (OUTPUT_FORMAT as Record<string, string>)[
        "AUDIO_24KHZ_96KBITRATE_MONO_MP3"
      ] ?? "audio-24khz-96kbitrate-mono-mp3";
    await tts.setMetadata(voice, fmt as never);

    // v1 returned a Readable, v2 returns a Promise of { audioStream } —
    // accept both so a dep bump can't silently break synthesis.
    const raw: unknown = tts.toStream(clean);
    const resolved = raw instanceof Promise ? await raw : raw;
    const stream =
      (resolved as { audioStream?: NodeJS.ReadableStream })?.audioStream ??
      (resolved as NodeJS.ReadableStream);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("TTS timed out (30s)")),
        30_000,
      );
      stream.on("data", (d: Buffer) => chunks.push(d));
      stream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      stream.on("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    const buf = Buffer.concat(chunks);
    if (buf.length < 200) {
      throw new Error("Edge TTS returned no audio (endpoint may have changed)");
    }
    return Response.json({
      audioB64: buf.toString("base64"),
      mime: "audio/mpeg",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed";
    return Response.json(
      { error: `Edge TTS failed: ${message}` },
      { status: 502 },
    );
  }
}
