#!/usr/bin/env node
/**
 * stdio MCP server for the ✎ Edit chat (owner 2026-10-28: "let the connected
 * Claude CLI drive the panel as one primitive tool"). /api/post-agent spawns
 * `claude -p --mcp-config …` and this script is that config's one server.
 * Tools talk back to the running ZCLIP over HTTP (ZCLIP_URL + ZCLIP_KEY =
 * the studio session whose edit panel is open), so every set_look shows up
 * live on the owner's sliders and preview.
 *
 * No SDK on purpose (none installed): MCP over stdio is newline-delimited
 * JSON-RPC — initialize, tools/list, tools/call, ping.
 */
import { createInterface } from "node:readline";

const BASE = process.env.ZCLIP_URL ?? "http://localhost:3333";
const KEY = process.env.ZCLIP_KEY ?? "";
const PW = process.env.ZCLIP_PW ?? "";

async function api(body) {
  const r = await fetch(`${BASE}/api/post-agent`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(PW ? { "x-app-password": PW } : {}) },
    body: JSON.stringify({ ...body, key: KEY }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

const pct = (d) => ({ type: "number", minimum: 0, maximum: 100, description: d });
const signed = (d) => ({ type: "number", minimum: -100, maximum: 100, description: d });

const TOOLS = [
  {
    name: "get_look",
    description:
      "Read the current ✎ Edit settings of the take on screen (crop, trim, grade, effects, motion). Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_look",
    description:
      "Change the edit. Send ONLY the knobs you are turning — everything else stays. The owner's sliders and live " +
      "preview move with it. Returns the full new look. Zero = neutral for all grade sliders.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        zoom: { type: "number", minimum: 1, maximum: 3, description: "1 = whole take; takes are already close-ups" },
        cx: { type: "number", minimum: 0, maximum: 1, description: "crop centre x (0 left … 1 right)" },
        cy: { type: "number", minimum: 0, maximum: 1, description: "crop centre y (0 top … 1 bottom)" },
        trimStart: { type: "number", minimum: 0, description: "seconds — only if the owner asks" },
        trimEnd: { type: ["number", "null"], description: "seconds, null = to the end — only if asked" },
        shake: { type: "integer", enum: [0, 1, 2], description: "handheld wobble: 0 off · 1 held still · 2 restless" },
        light: { type: "number", minimum: 0, maximum: 0.6, description: "window light: the far side darkens by this much" },
        lightSide: { type: "string", enum: ["left", "right"], description: "which side the window is on" },
        vignette: pct("darker edges"),
        sharpen: pct("3×3 sharpen; keep low (0–25) — AI frames are already crisp"),
        grain: pct("sensor noise; 30–60 reads like a phone"),
        phoneEncode: { type: "boolean", description: "render-only phone re-compression + slight soften" },
        fps30: { type: "boolean", description: "render at 30fps like a phone (render-only)" },
        room: { type: "boolean", description: "quiet room tone instead of silence (render-only)" },
        grade: {
          type: "object",
          additionalProperties: false,
          description: "Lightroom-style colour, all optional",
          properties: {
            exposure: { type: "number", minimum: -2, maximum: 2, description: "EV stops" },
            contrast: signed("darks vs brights"),
            highlights: signed("bright areas only (−) recovers"),
            shadows: signed("dark areas only (+) lifts"),
            whites: signed("very top end"),
            blacks: signed("very bottom end (+) = lighter blacks"),
            temp: signed("blue (−) ↔ yellow (+)"),
            tint: signed("green (−) ↔ magenta (+)"),
            vibrance: signed("muted colours more than saturated ones"),
            saturation: signed("every colour"),
            shadowHue: { type: "number", minimum: 0, maximum: 360, description: "split-tone hue for darks" },
            shadowTint: pct("split-tone amount for darks"),
            highlightHue: { type: "number", minimum: 0, maximum: 360, description: "split-tone hue for brights" },
            highlightTint: pct("split-tone amount for brights"),
          },
        },
      },
    },
  },
  {
    name: "view_frame",
    description:
      "See the current look: ONE still, LEFT = the take as generated (same crop), RIGHT = with the edit — rendered by " +
      "the exact ffmpeg pipeline of the final video (grain included; phone encode/30fps/sound are not visible in a still). " +
      "Use after each set_look to judge.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { t: { type: "number", minimum: 0, description: "seconds into the kept clip (default: its middle)" } },
    },
  },
];

async function call(name, args) {
  if (name === "get_look") {
    const j = await api({ action: "look" });
    return [{ type: "text", text: JSON.stringify(j.look) }];
  }
  if (name === "set_look") {
    const j = await api({ action: "patch", patch: args });
    return [{ type: "text", text: JSON.stringify(j.look) }];
  }
  if (name === "view_frame") {
    const j = await api({ action: "frame", t: args.t });
    return [
      { type: "image", data: j.image, mimeType: j.mimeType },
      {
        type: "text",
        text:
          `Left = original crop · right = current look · t = ${j.t.toFixed(2)}s of the kept clip.` +
          (j.stats ? `\nEdited (right) stats: ${j.stats}` : ""),
      },
    ];
  }
  throw new Error(`Unknown tool ${name}`);
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  switch (m.method) {
    case "initialize":
      return reply({
        protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "zclip-post", version: "1.0.0" },
      });
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      try {
        return reply({ content: await call(m.params?.name, m.params?.arguments ?? {}) });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : e}` }], isError: true });
      }
    case "ping":
      return reply({});
    default:
      if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
  }
});
