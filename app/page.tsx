import type { Metadata } from "next";
import { CHARACTERS } from "@/lib/prompts";
import DemoReel from "./demo-reel";

export const metadata: Metadata = {
  title: "ZCLIP — 1 prompt, 10 takes. Hook 10x faster.",
  description:
    "Open-source AI studio for UGC reaction hooks: chat out takes, rewind anything, blend takes, pay cents per clip with your own keys.",
};

// TODO: point at the real repo after `gh repo create`
const REPO_URL = "https://github.com/your-handle/zclip";
const CUT_URL = "https://cut.donkeyuse.com";

const DIFFS = [
  {
    n: "01",
    title: "Swap the model mid-chat",
    body: "Veo, Sora, Grok, Seedance — one dropdown, same conversation, keys pasted straight into the UI. Four models today; the adapter interface is two functions, so the fifth is a pull request away.",
    big: false,
  },
  {
    n: "02",
    title: "Takes become context",
    body: "Pin any earlier take and the next one is built ON it — its prompt becomes source material, its frames become the visual reference. Iteration compounds instead of starting over. This is the whole game.",
    big: true,
  },
  {
    n: "03",
    title: "Video-to-video, in spirit",
    body: "Nobody sells true video-to-video yet — so ZCLIP does the honest version: drop any clip and it's compacted into key frames, read for subject, scene and motion, then re-directed into your next take. The result feels like v2v, today.",
    big: false,
  },
  {
    n: "04",
    title: "Actually multimodal input",
    body: "Images, videos, earlier takes, cast cards — everything attaches to the composer as a chip and verifiably lands in the prompt. The base prompt is always visible and editable. Nothing hidden.",
    big: false,
  },
  {
    n: "05",
    title: "A spend dashboard, built in",
    body: "Every take shows its cost before and after, and a per-session, per-model chart keeps the running total honest. No subscription — your keys, your pennies.",
    big: false,
  },
];

const STEPS = [
  {
    n: "01",
    title: "Generate",
    body: "Chat the hook out of ZCLIP — face, room, beat. A take lands in about a minute for ~$0.40.",
    link: null as { href: string; label: string } | null,
  },
  {
    n: "02",
    title: "Cut",
    body: "Send it to cut — the AI copilot editor that sees your whole project. Split, title, subtitle and caption by chat. Open source and free, same as this.",
    link: { href: CUT_URL, label: "cut.donkeyuse.com ↗" },
  },
  {
    n: "03",
    title: "Ship",
    body: "Export 9:16 and post. ZCLIP makes the first 3 seconds; cut makes the next 30.",
    link: null,
  },
];

export default function Landing() {
  const cast = CHARACTERS.filter((_, i) => i % 3 === 0).slice(0, 6);
  return (
    <div className="landing">
      <nav className="ld-nav">
        <span className="wordmark">
          ZCLIP<span>_</span>
        </span>
        <span className="ld-nav-links">
          <a className="link-btn" href="#features">
            Features
          </a>
          <a className="link-btn" href="#workflow">
            Workflow
          </a>
          <a className="link-btn" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="btn-ghost ld-nav-cta" href="/chat">
            Launch Studio
          </a>
        </span>
      </nav>

      <header className="ld-hero">
        <span className="ld-badge">Open-source AI UGC hook studio</span>
        <h1>
          UGC reaction hooks,
          <br />
          <span>typed, not filmed.</span>
        </h1>
        <p>
          The scroll-stopping first 3 seconds of a TikTok ad, out of a chat —
          pick a face, pick a room, type the beat. Iterate take by take on
          your own API keys, cents per clip.
        </p>
        <div className="ld-cta-row">
          <a className="btn-primary ld-cta" href="/chat">
            Launch Studio →
          </a>
          <a
            className="btn-ghost ld-cta"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            ★ Star on GitHub
          </a>
        </div>
        <p className="ld-stats">
          ~60s a take · ~$0.40 a clip on Veo Fast · 4 video models · 27-face
          cast
        </p>
        <DemoReel />
      </header>

      <section className="ld-section" id="features">
        <span className="label">Why it&apos;s different</span>
        <div className="ld-diffs">
          {DIFFS.map((d) => (
            <div className="ld-diff" key={d.n}>
              <span className="ld-step-n">{d.n}</span>
              <div>
                <h3>
                  {d.title}
                  {d.big && <em className="ld-big">The big one</em>}
                </h3>
                <p>{d.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="ld-cast ld-cast-row">
          {cast.map((c) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={c.id} src={`/starters/${c.id}.jpg`} alt={c.label} loading="lazy" />
          ))}
          <p className="ld-stats">
            Also in the box · chat-native takes · rewind &amp; branch ·
            27-face / 10-set cast · shared-password deploy
          </p>
        </div>
      </section>

      <section className="ld-section" id="workflow">
        <span className="label">Hook → full video in minutes</span>
        <div className="ld-steps">
          {STEPS.map((s) => (
            <div className="ld-step" key={s.n}>
              <span className="ld-step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              {s.link && (
                <a href={s.link.href} target="_blank" rel="noreferrer">
                  {s.link.label}
                </a>
              )}
            </div>
          ))}
        </div>
        <p className="ld-note">
          The hook is the hard 20% that decides whether anyone stays. ZCLIP
          batches that part; <a href={CUT_URL}>cut</a> finishes the video —
          subtitles, titles and cuts driven by the same kind of chat.
        </p>
      </section>

      <footer className="ld-footer">
        <span className="wordmark">
          ZCLIP<span>_</span>
        </span>
        <p>
          Open source — if this saved you an afternoon,{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            a star on the repo ★
          </a>{" "}
          is how you say thanks.
        </p>
        <p className="ld-fine">
          Bring your own keys · Veo · Sora · Grok · Seedance · No data leaves
          your browser except the prompts you send to providers.
        </p>
      </footer>
    </div>
  );
}
