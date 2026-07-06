/**
 * Regenerate landing-demo takes 2 & 3 with expression-hold engineering
 * (~$0.80 on Veo Fast). Run with the dev server up:
 *   bun scripts/regen-demo-takes.mjs [host]
 */
import { writeFileSync } from "node:fs";

const HOST = process.argv[2] ?? "http://localhost:3001";
const PROVIDER = process.env.PROVIDER ?? "veo";

const CORE =
  "A very pretty young East Asian woman in her early-to-mid 20s with a fresh natural look, clear realistic skin, long dark hair with soft balayage, soft natural makeup";
const HOLD =
  "Her face is frozen mid-reaction the entire time: eyes wide, lips parted, silently mouthing 'whaaaat?' in stunned quiet disbelief at her phone — she holds exactly this expression from the first frame to the last. She does not smile, she does not laugh, no gasping, no panting, no hand movements, minimal motion, slow and natural, with natural blinks and relaxed posture.";
const SUFFIX =
  "Hyper-realistic, indistinguishable from real found iPhone footage: natural skin texture with visible pores, no beauty filter, no airbrushed smoothing, authentic unpolished UGC look, subtle handheld camera shake, slightly imperfect exposure, no cinematic color grading. Natural micro-expressions, natural blinking, relaxed lifelike body language. 3 seconds.";

const P2 = `Vertical 9:16 amateur front-camera selfie video, handheld iPhone. ${CORE}, cozy cream oversized cardigan, sitting on a city rooftop at dusk, two friends behind her chatting quietly while looking away at the skyline. ${HOLD} ${SUFFIX}`;
const P3 = `Vertical 9:16 amateur front-camera selfie video, handheld iPhone. ${CORE}, now wearing a chic black leather jacket over a white tee, sitting on the same city rooftop at dusk, the same two friends behind her chatting quietly while looking away at the skyline. ${HOLD} ${SUFFIX}`;

async function gen(prompt, out) {
  const submit = await fetch(`${HOST}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      provider: PROVIDER,
      aspectRatio: "9:16",
      durationSeconds: 4,
      resolution: "720p",
    }),
  });
  const body = await submit.json();
  if (!body.jobId) throw new Error(`submit ${out}: ${JSON.stringify(body)}`);
  console.log(`SUBMIT ${out}: ${body.jobId}`);

  for (let i = 1; i <= 40; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const st = await (
      await fetch(
        `${HOST}/api/status?id=${encodeURIComponent(body.jobId)}&provider=${PROVIDER}`,
      )
    ).json();
    console.log(`  poll ${i}: ${st.state}`);
    if (st.state === "done") {
      const mp4 = await (await fetch(`${HOST}${st.videoUrl}`)).arrayBuffer();
      writeFileSync(out, Buffer.from(mp4));
      console.log(`  saved ${out} (${mp4.byteLength} bytes)`);
      return;
    }
    if (st.state === "error") throw new Error(`${out}: ${st.error}`);
  }
  throw new Error(`${out}: timed out`);
}

await gen(P2, "public/demo/take-2.mp4");
await gen(P3, "public/demo/take-3.mp4");
console.log("done — refresh the landing page.");
