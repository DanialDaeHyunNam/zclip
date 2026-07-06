import type { Metadata } from "next";
import { CHARACTERS } from "@/lib/prompts";

export const metadata: Metadata = {
  title: "ZCLIP — 1 prompt, 10 takes. Hook 10x faster.",
  description:
    "Open-source AI studio for UGC reaction hooks: chat out takes, rewind anything, blend takes, pay cents per clip with your own keys.",
};

// TODO: point at the real repo after `gh repo create`
const REPO_URL = "https://github.com/your-handle/zclip";
const CUT_URL = "https://cut.donkeyuse.com";

const FEATURES = [
  {
    title: "Chat is the timeline",
    body: "Every message becomes a new take. The refiner rewrites the full prompt with minimal edits — say it in any language, it lands in clean English prompt-craft.",
  },
  {
    title: "Rewind anything",
    body: "Branch from any take, Claude-style. The archive keeps every render you paid for, even after a rewind.",
  },
  {
    title: "A cast that's ready",
    body: "27 realistic faces × 10 sets, baked in — photoreal texture, no beauty-filter plastic. Add your own character from a single photo.",
    cast: true,
  },
  {
    title: "Real continuity",
    body: "A frame from each take carries into the next automatically. Pin any takes as context and the next take blends them — prompt and pixels.",
  },
  {
    title: "Every model, one chat",
    body: "Veo 3.1 Fast by default; Sora 2, Grok Imagine and Seedance are one dropdown away. Paste a key into the UI and it just works.",
  },
  {
    title: "Costs you can see",
    body: "Per-take estimates before you send, and a per-session, per-model spend chart after. No subscription — your keys, your pennies.",
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
    body: "Send it to cut — the AI copilot editor that sees your whole project. Split, title, subtitle and caption by chat.",
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
          1 prompt, 10 takes.
          <br />
          <span>Hook 10x faster.</span>
        </h1>
        <p>
          ZCLIP spins scroll-stopping UGC reaction hooks out of a chat — pick
          a face, pick a room, type the beat. Iterate take by take, rewind
          anything, and pay cents per clip on your own API keys.
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
      </header>

      <section className="ld-section" id="features">
        <span className="label">What it does</span>
        <div className="ld-grid">
          {FEATURES.map((f) => (
            <div className="ld-card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              {f.cast && (
                <div className="ld-cast">
                  {cast.map((c) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={c.id}
                      src={`/starters/${c.id}.jpg`}
                      alt={c.label}
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
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
