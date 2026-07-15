"use client";

/**
 * The public landing / about page — bilingual (EN/KO) client shell.
 * Kept out of app/page.tsx so that file can stay a server component
 * (metadata + isCloud()). Copy lives in the `COPY` deck below; the studio
 * CTA points to /install on the cloud deploy (where the studio is gated)
 * and /chat locally.
 */

import { Fragment, useState } from "react";
import Link from "next/link";
import { CHARACTERS } from "@/lib/prompts";
import { REPO_URL, CUT_URL, SOCIAL } from "@/lib/links";
import { VERSION, CANONICAL_URL, RELEASES_URL } from "@/lib/version";
import { LangProvider, LangToggle, useLang, type Lang } from "@/lib/i18n";
import { InstallModal } from "./run-local-guide";
import DemoReel from "./demo-reel";

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
    </svg>
  );
}

type Diff = { n: string; title: string; body: string; big?: boolean };
type Step = { n: string; tag: string; title: string; body: string; link?: { href: string; label: string } };
type DiffRow = { label: string; browser: string; local: string };
type Copy = {
  navFeatures: string; navWorkflow: string; launch: string; runLocal: string;
  tryWeb: string; trackQ: string;
  diffTitle: string; diffBrowserH: string; diffLocalH: string;
  diffRows: DiffRow[]; diffVerdict: string; diffInstall: string; diffTry: string;
  badge: string; h1a: string; h1b: string;
  leadStrong: string; lead1: string; lead2: string; star: string;
  whyTitle: string; bigTag: string; diffs: Diff[];
  workflowTitle: string; workflowSub: string; steps: Step[];
  castStats: string; footStar: string;
  footDesc1: string; footDesc2: string;
  footProjectH: string; footFollowH: string; footFollowNote: string;
  footRights: string; footCheck: string; footLatestTag: string;
};

const COPY: Record<Lang, Copy> = {
  en: {
    navFeatures: "Features",
    navWorkflow: "Workflow",
    launch: "Launch Studio",
    runLocal: "Run it locally",
    tryWeb: "Try it in the browser",
    trackQ: "What's the difference between running it locally or in the browser?",
    diffTitle: "Local vs browser — the honest comparison",
    diffBrowserH: "🌐 In the browser",
    diffLocalH: "💻 Installed locally",
    diffRows: [
      {
        label: "Your API keys",
        browser: "Stay in this browser (localStorage) and pass through the server only while a request runs — never stored or logged there.",
        local: "Never leave your machine (.env.local). Nothing to trust but your own computer.",
      },
      {
        label: "Your takes",
        browser: "Live in this browser only. Providers delete their files within days — download what you want to keep.",
        local: "Every take is vaulted to disk automatically, forever. Rewind, reuse, re-reference any time.",
      },
      {
        label: "Features",
        browser: "No GRAB (reference by URL) · no reference-video Seedance · Act-Two capped at ~4.5MB clips.",
        local: "Everything unlocks — GRAB, the clip vault, reference-video Seedance, Act-Two up to 16MB.",
      },
      {
        label: "Setup",
        browser: "Zero. Paste a key, generate in 30 seconds.",
        local: "One copy-paste install (macOS / Windows guide, ~3 minutes).",
      },
    ],
    diffVerdict: "Local is the better home — more private, more capable. The browser is the fastest taste.",
    diffInstall: "Install locally",
    diffTry: "Try in the browser",
    badge: "Open-source AI UGC hook studio",
    h1a: "UGC reaction hooks,",
    h1b: "typed, not filmed.",
    leadStrong: "Stop buying reaction clips.",
    lead1: "Chat out the scroll-stopping first 3 seconds of your ad for cents.",
    lead2: "Then iterate till one converts.",
    star: "Star on GitHub",
    whyTitle: "Why it's different",
    bigTag: "The big one",
    diffs: [
      { n: "01", title: "A model marketplace in a dropdown", body: "Veo, Sora, Grok, Runway, Seedance and their variants — filtered by maker, priced per second, keys pasted straight into the UI. Swap mid-chat without losing the thread. Adding the next one is a two-function adapter, so it's a pull request away." },
      { n: "02", title: "Takes become context", body: "Pin any earlier take and the next one is built ON it — its prompt becomes source material, its frames become the visual reference. Iteration compounds instead of starting over. This is the whole game.", big: true },
      { n: "03", title: "Real performance transfer", body: "Point Runway Act-Two at any reference clip and it maps that exact motion and expression onto the face you picked — true video-to-video. No Runway key? The free path transcribes the clip into a timestamped beat map and re-performs it. Either way: the reaction you saw, on your person." },
      { n: "04", title: "Actually multimodal input", body: "Images, videos, earlier takes, cast cards, even a wardrobe swap — everything attaches to the composer as a chip and verifiably lands in the take. Grab a reference straight off YouTube or X. The base prompt is always visible and editable. Nothing hidden." },
      { n: "05", title: "A spend dashboard, built in", body: "Every take shows its cost before you send and after it lands; a confirm step guards each spend, and a dashboard charts the total by day, session and model. No subscription — your keys, your pennies." },
    ],
    workflowTitle: "Hook → full video in minutes",
    workflowSub: "The hook is the hard 20% that decides whether anyone stays.",
    steps: [
      { n: "01", tag: "In ZCLIP", title: "Generate the hook", body: "Chat out the first 3 seconds — face, room, beat. ~1 min, ~$0.40 a take." },
      { n: "02", tag: "In cut", title: "Edit the video", body: "Hand it to cut — split, title, subtitle and caption by chat.", link: { href: CUT_URL, label: "cut.donkeyuse.com ↗" } },
      { n: "03", tag: "Anywhere", title: "Post it", body: "Export 9:16 and ship. Hook + full video, in minutes." },
    ],
    castStats: "Also in the box · reference grabber (YouTube / X) · wardrobe swaps · rewind & branch · 27-face / 10-set cast · shared-password deploy",
    footStar: "Star on GitHub",
    footDesc1: "Open-source AI studio for UGC reaction hooks.",
    footDesc2: "Runs on your machine — your keys, your data. Nothing leaves the browser but the prompts you send to providers.",
    footProjectH: "Project",
    footFollowH: "Follow the maker",
    footFollowNote: "Building in public — a follow means a lot 🙌",
    footRights: "© 2026 ZCLIP · Open source (MIT)",
    footCheck: "Check for the latest ↗",
    footLatestTag: "latest",
  },
  ko: {
    navFeatures: "기능",
    navWorkflow: "워크플로우",
    launch: "스튜디오 열기",
    runLocal: "로컬로 실행",
    tryWeb: "브라우저에서 써보기",
    trackQ: "로컬 실행과 브라우저 실행, 뭐가 다른가요?",
    diffTitle: "로컬 vs 브라우저 — 정직한 비교",
    diffBrowserH: "🌐 브라우저에서",
    diffLocalH: "💻 로컬 설치",
    diffRows: [
      {
        label: "API 키",
        browser: "이 브라우저(localStorage)에만 저장되고, 요청이 처리되는 동안에만 서버를 경유합니다 — 서버에 저장·기록되지 않습니다.",
        local: "내 컴퓨터 밖으로 나가지 않습니다(.env.local). 믿을 것은 내 컴퓨터뿐.",
      },
      {
        label: "테이크",
        browser: "이 브라우저에만 남습니다. 제공자는 며칠 안에 파일을 지우니, 남길 것은 다운로드하세요.",
        local: "모든 테이크가 디스크에 자동으로, 영구히 보관됩니다. 언제든 되감고 재사용.",
      },
      {
        label: "기능",
        browser: "GRAB(URL 참조) 없음 · 참조영상 Seedance 없음 · Act-Two는 ~4.5MB까지.",
        local: "전부 열립니다 — GRAB, 클립 볼트, 참조영상 Seedance, Act-Two 16MB.",
      },
      {
        label: "시작",
        browser: "설치 0. 키 붙여넣고 30초 만에 생성.",
        local: "복사-붙여넣기 설치 한 번 (macOS/Windows 가이드, 약 3분).",
      },
    ],
    diffVerdict: "진짜 집은 로컬입니다 — 더 프라이빗하고 더 강력합니다. 브라우저는 가장 빠른 맛보기.",
    diffInstall: "로컬로 설치",
    diffTry: "브라우저에서 써보기",
    badge: "오픈소스 AI UGC 훅 스튜디오",
    h1a: "UGC 리액션 훅,",
    h1b: "찍지 말고, 입력하세요.",
    leadStrong: "리액션 클립, 이제 그만 사세요.",
    lead1: "광고의 스크롤을 멈추는 첫 3초를, 몇 센트로 채팅해 만드세요.",
    lead2: "그리고 전환되는 하나가 나올 때까지 반복하세요.",
    star: "GitHub에서 스타",
    whyTitle: "무엇이 다른가",
    bigTag: "핵심",
    diffs: [
      { n: "01", title: "드롭다운 속 모델 마켓플레이스", body: "Veo, Sora, Grok, Runway, Seedance와 그 변형들 — 제작사별로 필터링되고, 초당 가격이 매겨지며, 키는 UI에 바로 붙여넣습니다. 대화 흐름을 잃지 않고 도중에 모델을 교체하세요. 다음 모델을 추가하는 건 함수 두 개짜리 어댑터, 즉 풀 리퀘스트 하나면 됩니다." },
      { n: "02", title: "테이크가 곧 컨텍스트", body: "이전 테이크를 핀으로 고정하면 다음 테이크가 그 위에 만들어집니다 — 그 프롬프트가 소재가 되고, 그 프레임이 시각 참조가 됩니다. 처음부터 다시 하는 대신 반복이 쌓입니다. 이게 전부입니다.", big: true },
      { n: "03", title: "진짜 퍼포먼스 트랜스퍼", body: "Runway Act-Two를 아무 참조 클립에 겨누면, 그 움직임과 표정을 당신이 고른 얼굴에 그대로 매핑합니다 — 진짜 비디오-투-비디오. Runway 키가 없다고요? 무료 경로는 클립을 타임스탬프 비트맵으로 옮겨 적어 다시 연기합니다. 어느 쪽이든: 당신이 본 그 리액션을, 당신의 인물로." },
      { n: "04", title: "진짜로 멀티모달인 입력", body: "이미지, 영상, 이전 테이크, 캐스트 카드, 심지어 의상 교체까지 — 모든 것이 칩으로 컴포저에 붙고, 실제로 테이크에 반영되는 것이 확인됩니다. YouTube나 X에서 참조를 바로 가져오세요. 베이스 프롬프트는 항상 보이고 편집할 수 있습니다. 숨김은 없습니다." },
      { n: "05", title: "내장된 지출 대시보드", body: "모든 테이크는 전송 전과 후에 비용을 보여줍니다; 확인 단계가 매 지출을 지키고, 대시보드가 날짜·세션·모델별 총액을 차트로 그립니다. 구독 없음 — 당신의 키, 당신의 몇 푼." },
    ],
    workflowTitle: "훅 → 완성 영상, 몇 분 만에",
    workflowSub: "훅은 사람들이 남을지 떠날지를 결정하는, 가장 어려운 20%입니다.",
    steps: [
      { n: "01", tag: "ZCLIP에서", title: "훅 생성", body: "첫 3초를 채팅으로 — 얼굴, 공간, 비트. 약 1분, 테이크당 약 $0.40." },
      { n: "02", tag: "cut에서", title: "영상 편집", body: "cut에 넘기세요 — 채팅으로 컷 분할·제목·자막·캡션.", link: { href: CUT_URL, label: "cut.donkeyuse.com ↗" } },
      { n: "03", tag: "어디서나", title: "게시", body: "9:16으로 내보내고 배포하세요. 훅 + 완성 영상, 몇 분 만에." },
    ],
    castStats: "그 밖에도 · 참조 그래버(YouTube / X) · 의상 교체 · 되감기 & 분기 · 얼굴 27종 / 배경 10종 캐스트 · 공유 비밀번호 배포",
    footStar: "GitHub에서 스타",
    footDesc1: "UGC 리액션 훅을 위한 오픈소스 AI 스튜디오.",
    footDesc2: "당신의 컴퓨터에서 실행 — 키도 데이터도, 제공자에게 보내는 프롬프트 외엔 브라우저를 벗어나지 않습니다.",
    footProjectH: "프로젝트",
    footFollowH: "만든 사람 팔로우",
    footFollowNote: "만드는 과정을 공유하고 있어요. 팔로우해 주시면 큰 힘이 됩니다 🙌",
    footRights: "© 2026 ZCLIP · 오픈소스(MIT)",
    footCheck: "최신 버전 확인 ↗",
    footLatestTag: "최신",
  },
};

function LandingInner({ cloud }: { cloud: boolean }) {
  const { lang } = useLang();
  const t = COPY[lang];
  // On the cloud deploy the studio can't run, so the CTA opens the install
  // guide as a POPUP in place (the public site stays the about page). Locally
  // it's a normal link to the working studio.
  const [installOpen, setInstallOpen] = useState(false);
  // Local-vs-browser comparison modal (cloud only — locally there's no fork).
  const [diffOpen, setDiffOpen] = useState(false);
  const studioLabel = cloud ? t.runLocal : t.launch;
  const openStudio = () => setInstallOpen(true);

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
          <a className="link-btn" href="#features">{t.navFeatures}</a>
          <a className="link-btn" href="#workflow">{t.navWorkflow}</a>
          <a className="link-btn" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a
            className="ld-ver"
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            title={`v${VERSION} · release notes`}
          >
            v{VERSION}
          </a>
          <LangToggle />
          {cloud ? (
            <button type="button" className="btn-ghost ld-nav-cta" onClick={openStudio}>{studioLabel}</button>
          ) : (
            <Link className="btn-ghost ld-nav-cta" href="/chat">{studioLabel}</Link>
          )}
        </span>
      </nav>

      <header className="ld-hero">
        <span className="ld-badge">{t.badge}</span>
        <h1>
          {t.h1a}
          <br />
          <span>{t.h1b}</span>
        </h1>
        <p>
          <span className="ld-lead">{t.leadStrong}</span>
          <br />
          {t.lead1}
          <br />
          {t.lead2}
        </p>
        <div className="ld-cta-row">
          {cloud ? (
            // Two-track (docs/HOSTED.md §1): local install stays the PRIMARY
            // CTA — it's the more private, more capable way to run ZCLIP —
            // and the browser studio is the honest quick taste next to it.
            <>
              <button type="button" className="btn-primary ld-cta" onClick={openStudio}>{studioLabel} →</button>
              <Link className="btn-ghost ld-cta" href="/chat">{t.tryWeb} →</Link>
            </>
          ) : (
            <Link className="btn-primary ld-cta" href="/chat">{studioLabel} →</Link>
          )}
          <a className="btn-ghost ld-cta ld-star" href={REPO_URL} target="_blank" rel="noreferrer">
            <span className="ld-star-icon">★</span> {t.star}
          </a>
        </div>
        {cloud && (
          <button
            type="button"
            className="ld-track-note ld-diff-q"
            onClick={() => setDiffOpen(true)}
          >
            {t.trackQ}
          </button>
        )}
        <DemoReel />
      </header>

      <section className="ld-section" id="features">
        <h2 className="ld-h2">{t.whyTitle}</h2>
        <div className="ld-diffs">
          {t.diffs.map((d) => (
            <div className="ld-diff" key={d.n}>
              <span className="ld-step-n">{d.n}</span>
              <div>
                <h3>
                  {d.title}
                  {d.big && <em className="ld-big">{t.bigTag}</em>}
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
          <p className="ld-stats">{t.castStats}</p>
        </div>
      </section>

      <section className="ld-section" id="workflow">
        <h2 className="ld-h2">{t.workflowTitle}</h2>
        <p className="ld-sub">{t.workflowSub}</p>
        <div className="ld-steps">
          {t.steps.map((s, i) => (
            <Fragment key={s.n}>
              {i > 0 && (
                <span className="ld-step-arrow" aria-hidden>→</span>
              )}
              <div className="ld-step">
                <div className="ld-step-top">
                  <span className="ld-step-n">{s.n}</span>
                  <span className="ld-step-tag">{s.tag}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.link && (
                  <a href={s.link.href} target="_blank" rel="noreferrer">{s.link.label}</a>
                )}
              </div>
            </Fragment>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <span className="wordmark">
              ZCLIP<span>_</span>
            </span>
            <p>
              {t.footDesc1}
              <br />
              {t.footDesc2}
            </p>
          </div>

          <div className="footer-col">
            <h4>{t.footProjectH}</h4>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <span className="footer-star">★</span> {t.footStar}
            </a>
            <span className="footer-dim">MIT License</span>
          </div>

          <div className="footer-col">
            <h4>{t.footFollowH}</h4>
            <a href={SOCIAL.threads.url} target="_blank" rel="noreferrer">
              <span className="footer-ic">@</span> Threads {SOCIAL.threads.handle}
            </a>
            <a href={SOCIAL.x.url} target="_blank" rel="noreferrer">
              <span className="footer-ic">
                <XIcon />
              </span>{" "}
              X {SOCIAL.x.handle}
            </a>
            <span className="footer-dim">{t.footFollowNote}</span>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-copy">
            {t.footRights}
            <span className="footer-version">
              v{VERSION}
              {cloud ? (
                <span className="footer-latest-tag">{t.footLatestTag}</span>
              ) : (
                <a
                  href={CANONICAL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="footer-check"
                >
                  {t.footCheck}
                </a>
              )}
            </span>
          </span>
          <div className="footer-socials">
            <a href={SOCIAL.threads.url} target="_blank" rel="noreferrer" title="Threads" aria-label="Threads">
              <span className="footer-ic">@</span>
            </a>
            <a href={SOCIAL.x.url} target="_blank" rel="noreferrer" title="X" aria-label="X">
              <span className="footer-ic">
                <XIcon />
              </span>
            </a>
          </div>
        </div>
      </footer>

      {cloud && (
        <InstallModal open={installOpen} onClose={() => setInstallOpen(false)} gated />
      )}

      {cloud && diffOpen && (
        <div
          className="rlg-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t.diffTitle}
          onClick={() => setDiffOpen(false)}
        >
          <div
            className="rlg-modal-card ld-diff-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rlg-modal-head">
              <span className="label">{t.diffTitle}</span>
              <button
                type="button"
                className="rlg-modal-close"
                onClick={() => setDiffOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="rlg-modal-body">
              <div className="ld-diff-grid">
                <span className="ld-diff-corner" aria-hidden />
                <span className="ld-diff-col-h">{t.diffBrowserH}</span>
                <span className="ld-diff-col-h ld-diff-col-h-local">
                  {t.diffLocalH}
                </span>
                {t.diffRows.map((r) => (
                  <Fragment key={r.label}>
                    <span className="ld-diff-row-h">{r.label}</span>
                    <span className="ld-diff-cell">{r.browser}</span>
                    <span className="ld-diff-cell ld-diff-cell-local">
                      {r.local}
                    </span>
                  </Fragment>
                ))}
              </div>
              <p className="ld-diff-verdict">{t.diffVerdict}</p>
              <div className="rlg-cta-row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setDiffOpen(false);
                    setInstallOpen(true);
                  }}
                >
                  {t.diffInstall} →
                </button>
                <Link className="btn-ghost" href="/chat">
                  {t.diffTry} →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LandingClient({ cloud }: { cloud: boolean }) {
  return (
    <LangProvider>
      <LandingInner cloud={cloud} />
    </LangProvider>
  );
}
