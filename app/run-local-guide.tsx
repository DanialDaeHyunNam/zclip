"use client";

/**
 * The local-install guide — ZCLIP's answer to "I clicked the studio on the
 * public site and nothing generates". Ported in spirit from the Libertas
 * projects page (mac/win toggle, terminal mocks, "runs on your machine"
 * trust diagram), recolored to ZCLIP's own tokens.
 *
 * Rendered THREE ways, all sharing one `GuideBody`:
 *  - full page at /install (its own hero)
 *  - the /chat gate on the cloud deploy (`gated` framing) — for direct hits
 *  - a POPUP modal (<InstallModal>) fired from the landing's CTAs on cloud —
 *    the primary experience: the public site is the about page, and trying to
 *    "do" anything opens the install instructions in place.
 *
 * Bilingual (EN/KO) via the shared LangProvider. Shell commands are
 * language-neutral; only prose is translated. macOS/Windows is local UI
 * state (persisted), because the two OSes need genuinely different commands.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LangProvider, LangToggle, useLang, type Lang } from "@/lib/i18n";
import { REPO_URL, BUN_URL, GEMINI_KEY_URL } from "@/lib/links";
import { HowToList } from "./how-to";
import WorkflowDemo from "./workflow-demo";

type OS = "mac" | "win";

// ── shell commands (shared across languages) ──────────────────────────
const CMD = {
  installBun: {
    mac: "curl -fsSL https://bun.sh/install | bash",
    win: 'powershell -c "irm bun.sh/install.ps1 | iex"',
  },
  clone: `git clone ${REPO_URL}\ncd zclip`,
  install: "bun install",
  dev: "bun dev",
} as const;

// ── copy deck ─────────────────────────────────────────────────────────
type Copy = {
  home: string;
  badge: string;
  gatedTitle: string;
  gatedLead: string;
  soloTitle: string;
  soloLead: string;
  trustTitle: string;
  youLabel: string;
  youItems: string[];
  provLabel: string;
  provItems: string[];
  arrow: string;
  trustNote: string;
  reqTitle: string;
  req: { name: string; why: string; need: boolean }[];
  needTag: string;
  optTag: string;
  stepsTitle: string;
  s1t: string; s1b: string; s1win: string;
  s2t: string; s2b: string;
  s3t: string; s3b: string;
  s4t: string; s4b: string; s4cap: string; devReady: string;
  s5t: string; s5b: string; keyName: string; keySave: string; keyHint: string;
  costLabel: string; costBody: string;
  howToTitle: string;
  installStepTitle: string;
  next: string; prev: string; stepOf: string;
  cliTitle: string; cliBadge: string; cliBody: string; cliPrompt: string; orManual: string;
  copy: string; copied: string; expect: string;
  ctaStar: string; ctaBack: string; close: string; foot: string;
};

const COPY: Record<Lang, Copy> = {
  en: {
    home: "Home",
    badge: "Runs on your machine",
    gatedTitle: "The studio runs on your computer — not here.",
    gatedLead:
      "You opened ZCLIP on the public demo. Generating clips spends real money against your own API keys, and the in-app key panel only works locally — so the studio itself runs on your machine. Setup takes about two minutes.",
    soloTitle: "Run ZCLIP locally",
    soloLead:
      "ZCLIP is open source and runs entirely on your own computer. Follow the steps for macOS or Windows — about two minutes, start to finish.",
    trustTitle: "Nothing runs on our servers",
    youLabel: "Your computer",
    youItems: [
      "The whole app + studio UI",
      "Your API keys — saved to .env.local on disk, never uploaded",
      "Every session, take and the spend ledger — in your browser's localStorage",
    ],
    provLabel: "AI providers",
    provItems: [
      "Only the prompt + reference frames you send",
      "Billed to your own key, per second",
    ],
    arrow: "your prompts only",
    trustNote:
      "There is no ZCLIP account, database, or server that stores your work. This page is the only thing we host.",
    reqTitle: "What you need",
    req: [
      { name: "bun", why: "the JavaScript runtime + package manager ZCLIP runs on", need: true },
      {
        name: "A Gemini API key",
        why: "powers the prompt refiner and the default Veo model — enable billing (no free video tier)",
        need: true,
      },
      {
        name: "yt-dlp + ffmpeg",
        why: "optional — the GRAB tool that pulls reference clips from YouTube / X",
        need: false,
      },
    ],
    needTag: "required",
    optTag: "optional",
    stepsTitle: "Install & run",
    s1t: "Install bun",
    s1b: "The runtime ZCLIP uses. One line in your terminal:",
    s1win: "Run this in PowerShell. Missing git? Install it too: winget install Git.Git",
    s2t: "Get the code",
    s2b: "Clone the repository and step into it:",
    s3t: "Install dependencies",
    s3b: "Three packages only — Next.js, React, TypeScript:",
    s4t: "Start the studio",
    s4b: "Launch the dev server, then open the studio in your browser:",
    s4cap: "the studio, live on your own machine",
    devReady: "ready on http://localhost:3000",
    s5t: "Paste your Gemini key",
    s5b: "Open the studio, click the key chip, and paste your key. It's written to .env.local on your disk — it never reaches the browser or our servers. Then pick a face, pick a room, and hit send.",
    keyName: "GEMINI_API_KEY",
    keySave: "Save",
    keyHint: "Written to .env.local — dev only, never uploaded.",
    costLabel: "Heads up — video costs real money",
    costBody:
      "Generation runs on your own provider keys: about $0.30–0.80 per take. ZCLIP shows the estimate next to Send before every take and tracks spend in a built-in dashboard. The text refiner is effectively free.",
    howToTitle: "What you can do",
    installStepTitle: "Install guide",
    next: "Next",
    prev: "Back",
    stepOf: "Step",
    cliTitle: "Easiest way — an AI coding CLI",
    cliBadge: "Recommended",
    cliBody:
      "Already using an AI coding CLI like Claude Code or Cursor? Open it in your terminal and paste the one line below — it installs whatever's needed and runs it for you. (Not sure what this is? Follow the manual install below.)",
    cliPrompt:
      "Clone https://github.com/DanialDaeHyunNam/zclip and run it locally. If anything needed to run it (bun, etc.) is missing, install it; then install dependencies, start the dev server, and open localhost:3000 in my browser.",
    orManual: "Or, install it manually",
    copy: "Copy",
    copied: "Copied",
    expect: "expected",
    ctaStar: "Star on GitHub",
    ctaBack: "Back to home",
    close: "Close",
    foot: "Open source (MIT) · bring your own keys · nothing leaves your browser but the prompts you send to providers.",
  },
  ko: {
    home: "홈",
    badge: "내 컴퓨터에서 실행",
    gatedTitle: "스튜디오는 여기가 아니라 당신의 컴퓨터에서 돌아갑니다.",
    gatedLead:
      "지금은 공개 데모 페이지입니다. 클립 생성은 당신 소유의 API 키로 실제 비용이 나가고, 인앱 키 패널은 로컬에서만 동작하기 때문에 스튜디오 자체는 당신의 컴퓨터에서 실행됩니다. 설치는 약 2분이면 됩니다.",
    soloTitle: "ZCLIP 로컬 실행",
    soloLead:
      "ZCLIP은 오픈소스이며 전적으로 당신의 컴퓨터에서 실행됩니다. macOS 또는 Windows 단계를 따라오세요 — 처음부터 끝까지 약 2분.",
    trustTitle: "우리 서버에서 도는 것은 없습니다",
    youLabel: "당신의 컴퓨터",
    youItems: [
      "앱 전체 + 스튜디오 UI",
      "당신의 API 키 — 디스크의 .env.local에 저장, 절대 업로드되지 않음",
      "모든 세션·테이크·지출 원장 — 브라우저 localStorage에",
    ],
    provLabel: "AI 제공자",
    provItems: [
      "당신이 보낸 프롬프트와 참조 프레임만",
      "당신 소유의 키로, 초당 과금",
    ],
    arrow: "프롬프트만 전송",
    trustNote:
      "당신의 작업을 저장하는 ZCLIP 계정·데이터베이스·서버는 없습니다. 우리가 호스팅하는 것은 지금 보고 있는 이 페이지뿐입니다.",
    reqTitle: "필요한 것",
    req: [
      { name: "bun", why: "ZCLIP이 돌아가는 자바스크립트 런타임 + 패키지 매니저", need: true },
      {
        name: "Gemini API 키",
        why: "프롬프트 리파이너와 기본 Veo 모델을 구동 — 결제 활성화 필요(무료 영상 티어 없음)",
        need: true,
      },
      {
        name: "yt-dlp + ffmpeg",
        why: "선택 — YouTube / X에서 참조 클립을 가져오는 GRAB 도구용",
        need: false,
      },
    ],
    needTag: "필수",
    optTag: "선택",
    stepsTitle: "설치 & 실행",
    s1t: "bun 설치",
    s1b: "ZCLIP이 사용하는 런타임입니다. 터미널에 한 줄:",
    s1win: "PowerShell에서 실행하세요. git이 없다면 함께 설치: winget install Git.Git",
    s2t: "코드 받기",
    s2b: "저장소를 클론하고 폴더로 들어갑니다:",
    s3t: "의존성 설치",
    s3b: "패키지는 셋뿐 — Next.js, React, TypeScript:",
    s4t: "스튜디오 실행",
    s4b: "개발 서버를 띄우고 브라우저에서 스튜디오를 엽니다:",
    s4cap: "당신의 컴퓨터에서 실행되는 스튜디오",
    devReady: "http://localhost:3000 에서 준비 완료",
    s5t: "Gemini 키 붙여넣기",
    s5b: "스튜디오를 열고 키 칩을 클릭한 뒤 키를 붙여넣으세요. 디스크의 .env.local에 기록되며 브라우저나 우리 서버에는 절대 닿지 않습니다. 그다음 얼굴과 공간을 고르고 전송을 누르세요.",
    keyName: "GEMINI_API_KEY",
    keySave: "저장",
    keyHint: ".env.local에 기록 — 개발 모드 전용, 업로드 안 됨.",
    costLabel: "참고 — 영상 생성은 실제 비용이 듭니다",
    costBody:
      "생성은 당신 소유의 제공자 키로 실행됩니다: 테이크당 약 $0.30–0.80. ZCLIP은 매 테이크 전 전송 버튼 옆에 예상 비용을 보여주고, 내장 대시보드로 지출을 추적합니다. 텍스트 리파이너는 사실상 무료입니다.",
    howToTitle: "무엇을 할 수 있나",
    installStepTitle: "설치 가이드",
    next: "다음",
    prev: "이전",
    stepOf: "단계",
    cliTitle: "가장 쉬운 방법 — AI 코딩 CLI",
    cliBadge: "강력 추천",
    cliBody:
      "Claude Code·Cursor 같은 AI 코딩 CLI를 이미 쓴다면, 터미널에서 켜고 아래 한 줄만 붙여넣으세요. 필요한 건 알아서 설치하고 실행까지 해줍니다. (뭔지 모르면 아래 수동 설치를 따라가세요.)",
    cliPrompt:
      "https://github.com/DanialDaeHyunNam/zclip 를 클론해서 로컬에서 실행해줘. 실행에 필요한 게 (bun 등) 없으면 알아서 설치하고, 의존성 설치 후 개발 서버를 띄운 다음 localhost:3000을 브라우저로 열어줘.",
    orManual: "또는, 직접 설치하기",
    copy: "복사",
    copied: "복사됨",
    expect: "예상 출력",
    ctaStar: "GitHub에서 스타",
    ctaBack: "홈으로",
    close: "닫기",
    foot: "오픈소스(MIT) · 키는 직접 준비 · 제공자에게 보내는 프롬프트 외에는 브라우저를 벗어나지 않습니다.",
  },
};

// ── macOS/Windows local state (persisted) ─────────────────────────────
function useOsState(): [OS, (o: OS) => void] {
  const [os, setOs] = useState<OS>("mac");
  useEffect(() => {
    let next: OS | null = null;
    try {
      const stored = localStorage.getItem("zclip.os");
      if (stored === "mac" || stored === "win") next = stored;
    } catch {
      /* ignore */
    }
    if (!next && typeof navigator !== "undefined") {
      next = /win/i.test(navigator.userAgent) ? "win" : "mac";
    }
    if (next && next !== "mac") setOs(next);
  }, []);
  const pickOs = (o: OS) => {
    setOs(o);
    try {
      localStorage.setItem("zclip.os", o);
    } catch {
      /* ignore */
    }
  };
  return [os, pickOs];
}

function OsSeg({ os, pickOs }: { os: OS; pickOs: (o: OS) => void }) {
  return (
    <div className="os-seg" role="group" aria-label="Operating system">
      <button type="button" className={os === "mac" ? "on" : ""} aria-pressed={os === "mac"} onClick={() => pickOs("mac")}>
        macOS
      </button>
      <button type="button" className={os === "win" ? "on" : ""} aria-pressed={os === "win"} onClick={() => pickOs("win")}>
        Windows
      </button>
    </div>
  );
}

// ── copy-to-clipboard button ──────────────────────────────────────────
function CopyBtn({ text, label, okLabel }: { text: string; label: string; okLabel: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={`rlg-copy ${ok ? "ok" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
    >
      {ok ? okLabel : label}
    </button>
  );
}

// ── terminal window mock (OS-aware chrome) ────────────────────────────
function Term({ os, title, cmd, expect, t }: { os: OS; title: string; cmd: string; expect?: string; t: Copy }) {
  return (
    <div className={`rlg-term os-${os}`}>
      <div className="rlg-bar">
        {os === "mac" ? (
          <span className="rlg-dots" aria-hidden>
            <i /><i /><i />
          </span>
        ) : (
          <span className="rlg-winctl" aria-hidden>
            &#8211; &#9633; &#10005;
          </span>
        )}
        <span className="rlg-bar-title">{title}</span>
      </div>
      <div className="rlg-term-body">
        <pre>
          <code>
            {cmd.split("\n").map((line, i) => (
              <span key={i} className="rlg-line">
                <span className="rlg-prompt">{os === "mac" ? "$" : ">"}</span> {line}
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
        <CopyBtn text={cmd} label={t.copy} okLabel={t.copied} />
      </div>
      {expect && (
        <div className="rlg-expect">
          <span>{t.expect}</span>
          <pre>
            <code>{expect}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ── the shared guide body (no page chrome — parents wrap it) ──────────
// Paginated into three sequential pages so the guide never becomes one
// overwhelming scroll: (1) what you can do, (2) the local-by-design trust
// diagram, (3) the actual install steps. The hero stays fixed above the pager.
function GuideBody({ os, gated, t }: { os: OS; gated: boolean; t: Copy }) {
  const { lang } = useLang();
  const termTitle = os === "mac" ? "Terminal" : "PowerShell";
  const [page, setPage] = useState(0);
  const pagerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  const steps = [t.howToTitle, t.trustTitle, t.installStepTitle];
  const last = steps.length - 1;
  const go = (p: number) => setPage(Math.max(0, Math.min(last, p)));

  // on page change (not initial mount) bring the pager top into view — inside
  // the modal this scrolls the modal body, on the full page it scrolls the window
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    pagerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page]);

  return (
    <>
      <header className="rlg-hero">
        <span className="rlg-badge">◆ {t.badge}</span>
        <h1>{gated ? t.gatedTitle : t.soloTitle}</h1>
        <p>{gated ? t.gatedLead : t.soloLead}</p>
      </header>

      <div className="rlg-pager" ref={pagerRef}>
        {/* step tabs — click to jump, current + completed states */}
        <div className="rlg-steps-nav" role="tablist" aria-label={t.installStepTitle}>
          {steps.map((label, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={page === i}
              className={`rlg-step-tab ${page === i ? "on" : ""} ${i < page ? "done" : ""}`}
              onClick={() => go(i)}
            >
              <span className="rlg-step-num">{i + 1}</span>
              <span className="rlg-step-label">{label}</span>
            </button>
          ))}
        </div>

        <div className="rlg-page">
          {/* page 1 — what you can do (the short usage guide) */}
          {page === 0 && (
            <section className="rlg-section">
              <h2 className="rlg-h2">{t.howToTitle}</h2>
              <WorkflowDemo />
              <HowToList lang={lang} />
            </section>
          )}

          {/* page 2 — local-by-design trust diagram */}
          {page === 1 && (
            <section className="rlg-section">
              <h2 className="rlg-h2">{t.trustTitle}</h2>
              <div className="rlg-trust">
                <div className="rlg-td you">
                  <span className="rlg-td-label">{t.youLabel}</span>
                  <div className="rlg-td-items">
                    {t.youItems.map((it, i) => (
                      <span key={i}>{it}</span>
                    ))}
                  </div>
                </div>
                <div className="rlg-td-link">
                  <span className="rlg-arrow" aria-hidden>→</span>
                  <em>{t.arrow}</em>
                </div>
                <div className="rlg-td prov">
                  <span className="rlg-td-label">{t.provLabel}</span>
                  <div className="rlg-td-items">
                    {t.provItems.map((it, i) => (
                      <span key={i}>{it}</span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="rlg-td-note">{t.trustNote}</p>
            </section>
          )}

          {/* page 3 — the actual install guide */}
          {page === 2 && (
            <>
              {/* easiest path — paste a one-liner into an AI coding CLI */}
              <section className="rlg-section">
                <div className="rlg-cli">
                  <div className="rlg-cli-head">
                    <span className="rlg-cli-title">⚡ {t.cliTitle}</span>
                    <span className="rlg-cli-badge">{t.cliBadge}</span>
                  </div>
                  <p className="rlg-cli-body">{t.cliBody}</p>
                  <div className="rlg-cli-prompt">
                    <p>{t.cliPrompt}</p>
                    <CopyBtn text={t.cliPrompt} label={t.copy} okLabel={t.copied} />
                  </div>
                </div>
                <div className="rlg-or">{t.orManual} ↓</div>
              </section>

              {/* requirements */}
              <section className="rlg-section">
                <h2 className="rlg-h2">{t.reqTitle}</h2>
                <ul className="rlg-req">
                  {t.req.map((r) => (
                    <li key={r.name}>
                      <span className={`rlg-req-tag ${r.need ? "need" : "opt"}`}>
                        {r.need ? t.needTag : t.optTag}
                      </span>
                      <b>{r.name}</b>
                      <span className="rlg-req-why">{r.why}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* steps */}
              <section className="rlg-section">
                <h2 className="rlg-h2">{t.stepsTitle}</h2>
                <ol className="rlg-steps">
                  <li>
                    <h3>{t.s1t}</h3>
                    <p>{t.s1b}</p>
                    <Term os={os} title={termTitle} cmd={CMD.installBun[os]} t={t} />
                    {os === "win" && <p className="rlg-step-note">{t.s1win}</p>}
                  </li>
                  <li>
                    <h3>{t.s2t}</h3>
                    <p>{t.s2b}</p>
                    <Term os={os} title={termTitle} cmd={CMD.clone} t={t} />
                  </li>
                  <li>
                    <h3>{t.s3t}</h3>
                    <p>{t.s3b}</p>
                    <Term os={os} title={termTitle} cmd={CMD.install} t={t} />
                  </li>
                  <li>
                    <h3>{t.s4t}</h3>
                    <p>{t.s4b}</p>
                    <Term
                      os={os}
                      title={termTitle}
                      cmd={CMD.dev}
                      expect={`  ▲ Next.js 16.2\n  - Local:   http://localhost:3000\n  ✓ Ready`}
                      t={t}
                    />
                    <div className="rlg-browser">
                      <div className="rlg-bar">
                        <span className="rlg-dots" aria-hidden>
                          <i /><i /><i />
                        </span>
                        <span className="rlg-url">
                          <span className="host">localhost</span>
                          <span className="port">:3000</span>/chat
                        </span>
                      </div>
                      <div className="rlg-browser-view">
                        <span className="rlg-phone" aria-hidden><i /></span>
                        <span className="rlg-browser-cap">{t.s4cap}</span>
                      </div>
                    </div>
                  </li>
                  <li>
                    <h3>{t.s5t}</h3>
                    <p>{t.s5b}</p>
                    <div className="rlg-keypanel">
                      <div className="rlg-bar">
                        <span className="rlg-dots" aria-hidden>
                          <i /><i /><i />
                        </span>
                        <span className="rlg-bar-title">API keys</span>
                      </div>
                      <div className="rlg-key-body">
                        <span className="rlg-key-name">{t.keyName}</span>
                        <span className="rlg-key-input">
                          AIza<span className="rlg-caret" />
                        </span>
                        <span className="rlg-key-save">{t.keySave}</span>
                      </div>
                      <p className="rlg-key-hint">{t.keyHint}</p>
                    </div>
                  </li>
                </ol>
              </section>

              {/* cost callout */}
              <section className="rlg-section">
                <div className="rlg-callout">
                  <span className="rlg-callout-label">{t.costLabel}</span>
                  <p>{t.costBody}</p>
                </div>
              </section>
            </>
          )}
        </div>

        {/* pager controls — Back / dots / Next */}
        <div className="rlg-pager-nav">
          <button
            type="button"
            className="btn-ghost rlg-pager-prev"
            onClick={() => go(page - 1)}
            style={{ visibility: page === 0 ? "hidden" : "visible" }}
          >
            ← {t.prev}
          </button>
          <span className="rlg-pager-dots" aria-hidden>
            {steps.map((_, i) => (
              <i key={i} className={page === i ? "on" : ""} />
            ))}
          </span>
          {page < last ? (
            <button type="button" className="btn-primary rlg-pager-next" onClick={() => go(page + 1)}>
              {t.next} →
            </button>
          ) : (
            <span className="rlg-pager-next-spacer" aria-hidden />
          )}
        </div>
      </div>
    </>
  );
}

// ── full-page guide (/install + /chat gate) ───────────────────────────
function GuideInner({ gated }: { gated: boolean }) {
  const { lang } = useLang();
  const t = COPY[lang];
  const [os, pickOs] = useOsState();

  return (
    <div className="rlg">
      <nav className="rlg-nav">
        <Link className="wordmark" href="/">
          ZCLIP<span>_</span>
        </Link>
        <span className="rlg-nav-tools">
          <OsSeg os={os} pickOs={pickOs} />
          <LangToggle />
          <a className="link-btn" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </nav>

      <GuideBody os={os} gated={gated} t={t} />

      <footer className="rlg-footer">
        <div className="rlg-cta-row">
          <a className="btn-primary" href={REPO_URL} target="_blank" rel="noreferrer">
            ★ {t.ctaStar}
          </a>
          <Link className="btn-ghost" href="/">
            {t.ctaBack}
          </Link>
        </div>
        <p className="rlg-fine">
          {t.foot}
          {" · "}
          <a href={BUN_URL} target="_blank" rel="noreferrer">bun.sh</a>
          {" · "}
          <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer">Gemini key</a>
        </p>
      </footer>
    </div>
  );
}

/** Full-page entry: wraps the guide in its own language provider. */
export function RunLocalGuide({ gated = false }: { gated?: boolean }) {
  return (
    <LangProvider>
      <GuideInner gated={gated} />
    </LangProvider>
  );
}

/**
 * Popup entry — the primary cloud experience. Must be rendered INSIDE an
 * existing <LangProvider> (the landing already is) so it shares the language
 * choice. Esc / backdrop-click / ✕ all close it; body scroll is locked while
 * open. `gated` defaults true (the "you reached the demo" framing).
 */
export function InstallModal({
  open,
  onClose,
  gated = true,
}: {
  open: boolean;
  onClose: () => void;
  gated?: boolean;
}) {
  const { lang } = useLang();
  const t = COPY[lang];
  const [os, pickOs] = useOsState();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="rlg-modal" role="dialog" aria-modal="true" aria-label={t.soloTitle} onClick={onClose}>
      <div className="rlg-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="rlg-modal-head">
          <Link className="wordmark" href="/" onClick={onClose}>
            ZCLIP<span>_</span>
          </Link>
          <span className="rlg-nav-tools">
            <OsSeg os={os} pickOs={pickOs} />
            <LangToggle />
            <button type="button" className="rlg-modal-close" onClick={onClose} aria-label={t.close}>
              ✕
            </button>
          </span>
        </div>
        <div className="rlg-modal-body">
          <GuideBody os={os} gated={gated} t={t} />
          <div className="rlg-cta-row">
            <a className="btn-primary" href={REPO_URL} target="_blank" rel="noreferrer">
              ★ {t.ctaStar}
            </a>
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
