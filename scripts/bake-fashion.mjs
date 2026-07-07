/**
 * Bake wardrobe reference images for the Fashion carousel into
 * public/fashion/. Same Gemini image model + GEMINI_API_KEY as the
 * starter baker; these are clean garment product shots that /api/dress
 * composites onto a character before Act-Two.
 *
 *   bun scripts/bake-fashion.mjs            # bakes missing images only
 *   bun scripts/bake-fashion.mjs --force    # re-bakes everything
 *   bun scripts/bake-fashion.mjs w-hoodie   # bake specific ids
 *
 * ~16 images, roughly $0.04 each — costs real money, run deliberately.
 * Prefer your own garment photos? Drop <id>.jpg into public/fashion/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FASHION } from "../lib/prompts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "fashion");
const MODEL = "gemini-2.5-flash-image";

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

async function call(job, key, withAspect) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: job.prompt }] }],
        ...(withAspect
          ? { generationConfig: { imageConfig: { aspectRatio: "3:4" } } }
          : {}),
      }),
    },
  );
}

async function bake(job, key) {
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

const force = process.argv.includes("--force");
const idFilter = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const key = apiKey();
mkdirSync(outDir, { recursive: true });

const todo = FASHION.filter(
  (f) =>
    (idFilter.length === 0 || idFilter.includes(f.id)) &&
    (force || !existsSync(join(outDir, `${f.id}.jpg`))),
);
if (todo.length === 0) {
  console.log("Nothing to bake (all present; use --force to re-bake).");
  process.exit(0);
}
console.log(`Baking ${todo.length} fashion image(s)…`);
for (const job of todo) {
  try {
    await bake(job, key);
    console.log(`  ✓ ${job.id}`);
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
  }
}
console.log("Done → public/fashion/");
