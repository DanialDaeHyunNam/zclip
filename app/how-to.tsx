"use client";

import { Fragment } from "react";
import type { Lang } from "@/lib/i18n";

/**
 * The short "how to use ZCLIP" guide — shared by the in-app help modal
 * (studio, English) and the install guide's "How it works" section (bilingual).
 * `**bold**` in a body is rendered as an accent-highlighted key phrase.
 * The Act-Two point is framed as a deliberate ethical limit (motion referenced,
 * identity never cloned) — good positioning and safer than "perfect deepfake".
 */

type HowStep = { icon: string; title: string; body: string };

export const HOWTO: Record<Lang, HowStep[]> = {
  en: [
    {
      icon: "✦",
      title: "Pick a character",
      body: "Choose from the built-in cast, or add your own with **“+ Custom”** (your image + a short description). It's the face of your clip.",
    },
    {
      icon: "◫",
      title: "Combine background + fashion",
      body: "Add a **background** (the setting) and a **fashion** (the outfit) to your character, then describe the beat. The base prompt is composed for you — **refine it by chat, take after take.**",
    },
    {
      icon: "▤",
      title: "Library — grab & reuse",
      body: "**Every take you generate piles into the library** automatically. Paste a **YouTube / X / direct link** and the reference video is downloaded in too. And **anything you upload** (your own reference images or videos) lands there as well — pull any of it back as a reference anytime.",
    },
    {
      icon: "⑆",
      title: "Keep the motion, swap the person",
      body: "Point **Runway Act-Two** at a reference clip to re-perform its motion on your character. **Exact replication is intentionally limited** — it references the motion and expression but **never clones anyone's identity**: your character stays the star. It re-performs the feeling, not the exact person.",
    },
  ],
  ko: [
    {
      icon: "✦",
      title: "캐릭터 선택",
      body: "내장 캐스트에서 고르거나 **“+ Custom”**으로 직접 추가하세요(이미지 + 짧은 설명). 클립의 얼굴이 됩니다.",
    },
    {
      icon: "◫",
      title: "배경 + 패션 조합",
      body: "캐릭터에 **배경**(공간)과 **패션**(의상)을 조합하고 비트를 설명하세요. 베이스 프롬프트가 자동 구성되고, **테이크마다 채팅으로 다듬으면** 됩니다.",
    },
    {
      icon: "▤",
      title: "라이브러리 — 가져오고 재사용",
      body: "**생성한 테이크는 라이브러리에 자동으로 계속 쌓입니다.** **YouTube / X / 직접 링크**를 붙이면 참조 영상도 받아지고, **직접 올린 것**(참조 이미지·영상)도 함께 들어가요 — 무엇이든 언제든 참조로 다시 불러올 수 있습니다.",
    },
    {
      icon: "⑆",
      title: "모션은 그대로, 사람만 교체",
      body: "**Runway Act-Two**로 참조 클립의 동작을 당신 캐릭터에 다시 연기시킵니다. **정확한 복제는 의도적으로 제한**돼 있어요 — 동작·표정은 참고하되 **누구의 신원도 복제하지 않습니다**(당신 캐릭터가 주인공). “그 사람”이 아니라 “그 느낌의 연기”를 재현합니다.",
    },
  ],
};

/** Renders `**bold**` spans within a body string as accent highlights. */
function emphasize(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
    seg.startsWith("**") && seg.endsWith("**") ? (
      <b key={i} className="howto-em">
        {seg.slice(2, -2)}
      </b>
    ) : (
      <Fragment key={i}>{seg}</Fragment>
    ),
  );
}

/** Renders the how-to steps for a language. Styled by `.howto-*` in globals.css. */
export function HowToList({ lang }: { lang: Lang }) {
  return (
    <ol className="howto">
      {HOWTO[lang].map((s, i) => (
        <li key={i} className="howto-step">
          <span className="howto-icon" aria-hidden>
            {s.icon}
          </span>
          <div>
            <h3>{s.title}</h3>
            <p>{emphasize(s.body)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
