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
    text:
      c.pronoun === "He"
        ? `Stunning amateur smartphone selfie-style photo portrait of ${c.prompt}. Exceptionally handsome and photogenic, strong masculine features, sharp jawline, clear skin, athletic physique, tastefully styled, relaxed confident expression, looking at the camera. Soft flattering natural light, realistic skin texture, shot on an iPhone front camera, vertical framing, no text, no watermark.`
        : `Stunning amateur smartphone selfie-style photo portrait of ${c.prompt}. Exceptionally attractive and photogenic with naturally beautiful facial features, clear glowing skin, fit healthy physique, tastefully styled, subtle confident smile, looking at the camera. Soft flattering natural light, realistic skin texture, shot on an iPhone front camera, vertical framing, no text, no watermark.`,
  })),
  ...SETTINGS.map((s) => ({
    id: s.id,
    text: `Beautiful amateur smartphone photo of the place described, no people: ${s.prompt}. Aesthetically pleasing and inviting, natural light, realistic, slightly imperfect casual framing, no text, no watermark.`,
  })),
];

async function call(job, key, withAspect) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: job.text }] }],
        ...(withAspect
          ? { generationConfig: { imageConfig: { aspectRatio: "3:4" } } }
          : {}),
      }),
    },
  );
}

async function bake(job, key) {
  // Try portrait aspect first; fall back if the field is rejected.
  let res = await call(job, key, true);
  if (res.status === 400) res = await call(job, key, false);
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

// Usage: bun scripts/bake-starters.mjs [ids…] [--force]
// ids filter lets you re-bake just the ugly ones: `… blonde cafe --force`
const force = process.argv.includes("--force");
const idFilter = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const key = apiKey();
mkdirSync(outDir, { recursive: true });

for (const job of jobs) {
  if (idFilter.length && !idFilter.includes(job.id)) continue;
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
