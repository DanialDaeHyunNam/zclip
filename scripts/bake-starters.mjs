/**
 * Bake card images for the built-in starter blocks into public/starters/.
 * Uses the Gemini image model with your existing GEMINI_API_KEY.
 *
 *   bun scripts/bake-starters.mjs            # bakes missing images only
 *   bun scripts/bake-starters.mjs --force    # re-bakes everything
 *
 * ~12 images, roughly $0.04 each — costs real money, run deliberately.
 * Prefer your own photos? Just drop <asset-id>.jpg files into
 * public/starters/ instead (see public/starters/README.md).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHARACTERS, SETTINGS } from "../lib/prompts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "starters");
const MODEL = "gemini-2.5-flash-image"; // verify current id at ai.google.dev/gemini-api/docs/models

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const env = readFileSync(join(root, ".env.local"), "utf8");
    const m = env.match(/^GEMINI_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  console.error("GEMINI_API_KEY not found (env or .env.local)");
  process.exit(1);
}

const jobs = [
  ...CHARACTERS.map((c) => ({
    id: c.id,
    text: `Amateur smartphone selfie-style photo portrait of ${c.prompt}, looking at the camera, soft natural indoor light, realistic skin texture, no text, no watermark.`,
  })),
  ...SETTINGS.map((s) => ({
    id: s.id,
    text: `Amateur smartphone photo of the place described, empty, no people: ${s.prompt}. Natural light, realistic, slightly imperfect framing, no text, no watermark.`,
  })),
];

async function bake(job, key) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: job.text }] }],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`${job.id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData ?? p.inline_data,
  );
  const inline = part?.inlineData ?? part?.inline_data;
  if (!inline?.data) throw new Error(`${job.id}: no image in response`);
  writeFileSync(join(outDir, `${job.id}.jpg`), Buffer.from(inline.data, "base64"));
}

const force = process.argv.includes("--force");
const key = apiKey();
mkdirSync(outDir, { recursive: true });

for (const job of jobs) {
  const file = join(outDir, `${job.id}.jpg`);
  if (!force && existsSync(file)) {
    console.log(`skip   ${job.id} (exists)`);
    continue;
  }
  try {
    await bake(job, key);
    console.log(`baked  ${job.id}.jpg`);
  } catch (e) {
    console.error(`FAIL   ${e.message}`);
  }
}
console.log("done — cards pick the images up automatically.");
