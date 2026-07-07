import type { Metadata } from "next";
import { Fragment } from "react";
import { CHARACTERS } from "@/lib/prompts";
import DemoReel from "./demo-reel";

export const metadata: Metadata = {
  title: "ZCLIP — 1 prompt, 10 takes. Hook 10x faster.",
  description:
    "Open-source AI studio for UGC reaction hooks: chat out takes, rewind anything, blend takes, pay cents per clip with your own keys.",
};

const REPO_URL = "https://github.com/DanialDaeHyunNam/zclip";
const CUT_URL = "https://cut.donkeyuse.com";

const DIFFS = [
  {
    n: "01",
    title: "A model marketplace in a dropdown",
    body: "Veo, Sora, Grok, Runway, Seedance and their variants — filtered by maker, priced per second, keys pasted straight into the UI. Swap mid-chat without losing the thread. Adding the next one is a two-function adapter, so it's a pull request away.",
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
    title: "Real performance transfer",
    body: "Point Runway Act-Two at any reference clip and it maps that exact motion and expression onto the face you picked — true video-to-video. No Runway key? The free path transcribes the clip into a timestamped beat map and re-performs it. Either way: the reaction you saw, on your person.",
    big: false,
  },
  {
    n: "04",
    title: "Actually multimodal input",
    body: "Images, videos, earlier takes, cast cards, even a wardrobe swap — everything attaches to the composer as a chip and verifiably lands in the take. Grab a reference straight off YouTube or X. The base prompt is always visible and editable. Nothing hidden.",
    big: false,
  },
  {
    n: "05",
    title: "A spend dashboard, built in",
    body: "Every take shows its cost before you send and after it lands; a confirm step guards each spend, and a dashboard charts the total by day, session and model. No subscription — your keys, your pennies.",
    big: false,
  },
];

const STEPS = [
  {
    n: "01",
    tag: "In ZCLIP",
    title: "Generate the hook",
    body: "Chat out the first 3 seconds — face, room, beat. ~1 min, ~$0.40 a take.",
    link: null as { href: string; label: string } | null,
  },
  {
    n: "02",
    tag: "In cut",
    title: "Edit the video",
    body: "Hand it to cut — split, title, subtitle and caption by chat.",
    link: { href: CUT_URL, label: "cut.donkeyuse.com ↗" },
  },
  {
    n: "03",
    tag: "Anywhere",
    title: "Post it",
    body: "Export 9:16 and ship. Hook + full video, in minutes.",
    link: null,
  },
];

export default function Landing() {
  // Balanced sample of the cast — 3 women, 3 men.
  const castIds = ["blonde-1", "guy-1", "asian-f-1", "black-m-1", "latina-1", "asian-m-1"];
  const cast = castIds
    .map((id) => CHARACTERS.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
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
          <span className="ld-lead">Stop buying reaction clips.</span>
          <br />
          Chat out the scroll-stopping first 3 seconds of your ad for cents —
          and iterate till one converts.
        </p>
        <div className="ld-cta-row">
          <a className="btn-primary ld-cta" href="/chat">
            Launch Studio →
          </a>
          <a
            className="btn-ghost ld-cta ld-star"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            <span className="ld-star-icon">★</span> Star on GitHub
          </a>
        </div>
        <DemoReel />
      </header>

      <section className="ld-section" id="features">
        <h2 className="ld-h2">Why it&apos;s different</h2>
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
            Also in the box · reference grabber (YouTube / X) · wardrobe swaps ·
            rewind &amp; branch · 27-face / 10-set cast · shared-password deploy
          </p>
        </div>
      </section>

      <section className="ld-section" id="workflow">
        <h2 className="ld-h2">Hook → full video in minutes</h2>
        <p className="ld-sub">
          The hook is the hard 20% that decides whether anyone stays.
        </p>
        <div className="ld-steps">
          {STEPS.map((s, i) => (
            <Fragment key={s.n}>
              {i > 0 && (
                <span className="ld-step-arrow" aria-hidden>
                  →
                </span>
              )}
              <div className="ld-step">
                <div className="ld-step-top">
                  <span className="ld-step-n">{s.n}</span>
                  <span className="ld-step-tag">{s.tag}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.link && (
                  <a href={s.link.href} target="_blank" rel="noreferrer">
                    {s.link.label}
                  </a>
                )}
              </div>
            </Fragment>
          ))}
        </div>
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
          Bring your own keys · Veo · Sora · Grok · Runway · Seedance · No data
          leaves your browser except the prompts you send to providers.
        </p>
      </footer>
    </div>
  );
}
