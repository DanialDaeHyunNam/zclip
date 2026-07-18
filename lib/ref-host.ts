/**
 * Free, keyless hosting for Seedance reference videos. ModelArk REQUIRES
 * `reference_video` to be a public web url (verified live 2026-07-18 —
 * data: URLs are rejected at submit: "must be provided as a web url"), and
 * the owner retired Vercel Blob (op quota + no billing), so the clip is
 * parked on a free auto-expiring file host just long enough for ModelArk
 * to fetch it at task start.
 *
 * Privacy note: the DEFAULT transfer path uploads a DEPTH pass — identity-
 * free motion silhouettes — so a public temp host is acceptable. A raw
 * clip (DEPTH REF off) rides the same way; that's the trade for $0.
 *
 * Hosts are tried in order; each is account-less and self-deletes:
 *   1. uguu.se        — direct file URL, ~3h retention, ≤128MB
 *   2. litterbox      — catbox.moe's temp service, 1–72h, ≤1GB
 * (tmpfiles.org was rejected: its /dl/ URL serves an HTML interstitial,
 * not the raw bytes — verified with a byte-count check 2026-07-18.)
 */

const uguu = async (blob: Blob, name: string): Promise<string> => {
  const fd = new FormData();
  fd.append("files[]", blob, name);
  const res = await fetch("https://uguu.se/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`uguu.se HTTP ${res.status}`);
  const body = (await res.json()) as { files?: { url?: string }[] };
  const url = body.files?.[0]?.url;
  if (!url || !/^https?:\/\//.test(url)) throw new Error("uguu.se returned no url");
  return url;
};

const litterbox = async (blob: Blob, name: string): Promise<string> => {
  const fd = new FormData();
  fd.append("reqtype", "fileupload");
  fd.append("time", "1h");
  fd.append("fileToUpload", blob, name);
  const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
    method: "POST",
    body: fd,
  });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//.test(text)) {
    throw new Error(`litterbox ${res.ok ? `bad response: ${text.slice(0, 60)}` : `HTTP ${res.status}`}`);
  }
  return text;
};

/** Upload to the first host that works and return its public URL. Throws
 *  with every host's failure if none do — the submit surfaces it loudly
 *  and nothing has been billed. */
export async function hostTempRef(bytes: Uint8Array, mime: string): Promise<string> {
  const name = mime.includes("webm") ? "ref.webm" : "ref.mp4";
  // Copy into a plain ArrayBuffer once — Buffer's ArrayBufferLike backing
  // doesn't satisfy BlobPart under strict DOM types.
  const blob = new Blob([new Uint8Array(bytes).slice().buffer], { type: mime });
  const errors: string[] = [];
  for (const host of [uguu, litterbox]) {
    try {
      return await host(blob, name);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(
    `Couldn't host the reference video on any free temp host (${errors.join(" · ")}) — retry in a minute, the hosts may be busy`,
  );
}
