# 하이퍼리얼 UGC 편집 스튜디오 — Kling 4.0 · ✎ 참고 편집 · ✂ POST → Lightroom 편집 + AI 편집 채팅

**Participants**: Dan, claude

## Summary
AI 인물 카드로 만든 셀카 리액션 클립을 실제 폰 영상처럼 보이게 만들기 위해 ZCLIP 에 붙인 기능 묶음. 10-27 생성 쪽(✎ 편집 참고 사진 · Grok 편집 · Pose from frame · Kling 4.0 · ✂ POST v1) → 10-28 후처리 쪽(✂ POST 를 Lightroom 식 편집판 + WebGL 미리보기로, 편집 모드 레이아웃, Claude CLI 가 슬라이더를 움직이는 AI 편집 채팅 + 사진 · 영상 참고). DEVLOG #47–#53.

## Context
- **Background**: UGC 공정(고정 본편 + 앞 3초 리액션 훅). 실험 표는 `lab/HYPERREAL.md` + `lab/experiments.jsonl`(gitignore)
- **Requirements (Dan)**: 필요한 건 전부 ZCLIP 기능으로 붙이고 Chrome 으로 과정을 보이게(따로 API 를 부르는 스크립트 금지) · "진짜처럼 보이는 건 전부 후처리로 가능하게" · "Lightroom 처럼 각종 변경" · "편집 누르면 오른쪽에 조절판 · 좌우 보면서" · "조절판 위에 채팅, Claude CLI 가 하나의 primitive tool 로 조정 · 컨텍스트 차면 알아서 새 세션" · "채팅 키우고 조절판은 기본 접기 · 마크다운은 HTML 로" · "Edit 은 모든 결과 아래에 똑같이" · "채팅에 사진 · 영상 넣고 유사하게"
- **Decisions**:
  - 0.5× lens(배럴 · 비네트) 는 만들었다가 같은 날 걷음 — Dan 1×/0.5× 사진 쌍으로 보니 0.5 는 구도 · 원근이고 직선은 곧다(아이폰 보정) → 생성으로
  - 미리보기 = 렌더: 색 보정은 함수 하나(`lib/post-grade.ts`)를 33³ LUT 로 구워 WebGL(미리보기) 와 ffmpeg lut3d(렌더) 가 같이 씀(1/255 이내 일치). 손떨림 · 빛 · 비네트도 `lib/post-frame.ts` 표 하나에서 JS · ffmpeg 식 두 벌
  - 미리보기 셰이더 마지막에 Apple bt709 재생 감마(≈1.961→sRGB) — 캔버스는 원값, <video> 는 Mac/아이폰 방식으로 보여 달라 보였다(디코드는 동일 200/142/127)
  - ffmpeg 색 변환은 `format=` 자동(왕복 오차 <0.1/255). in/out_color_matrix 명시는 2/255 어두워짐
  - AI 편집 채팅 = `/api/post-agent` 가 Dan 구독 `claude -p` 를 MCP 서버 하나(`scripts/post-agent-mcp.mjs`: get_look · set_look · view_frame)와 띄움. 내장 도구 끔 · API 키 env 제거 · 중립 cwd. 컨텍스트 60% 넘으면 새 세션 + 최근 8 턴 · 마지막 참고 자료 재첨부
  - 참고 영상 = 장면 4 장 + signalstats 수치(밝기 avg/p10/p90 · 채도 · Cb/Cr), view_frame 도 같은 수치 → 숫자로 맞춤(첫 시험: 133/71/189·17·23 대 129/70/192·16·22)
  - 편집 대상 = chat 테이크든 flow 테이크든 하나(`editTarget`) — Edit 버튼 · 미리보기 · 렌더 · 채팅 공통
- **Constraints**: dev 전용(ffmpeg · Claude CLI 는 로컬). dev 서버 떠 있는 동안 `next build` 금지 → `bun x tsc --noEmit` 만. 커밋 안 함 — Dan 의 다른 미커밋 변경(cut-panel 등)과 섞여 있어 나눠서

## Timeline

### 2026-10-27
**Focus**: 생성 쪽 — ✎ 편집 참고 · Grok 편집 엔진 · Pose from frame · Kling 4.0(fal) · ✂ POST v1 (DEVLOG #47 #48)
- 참고 사진 · 영상 프레임을 ✎ 편집에 · Grok 편집 엔진 · ↺ Pose template / from frame(Gemini 가 프레임을 글로)
- Kling 4.0 i2v + reference-to-video(연기 = 참고, 얼굴 · 입은 생성) · fal 결과 보관 · Runway 5MB · 모델 선택 유지
- ✂ POST v1: 확대 · 위치 실시간 미리보기 + Phone look

**Learned**: 자세는 참고 사진이 아니라 글로. 다른 얼굴형의 입을 옮기는 전이(Act-Two)는 괴물 — 참고형이 답.

### 2026-10-28
**Focus**: 후처리 — ✂ POST 를 Lightroom 편집판 + WebGL 미리보기 + AI 편집 채팅으로 (DEVLOG #49–#53)
- #49 0.5× lens 만들고 걷음 · #50 자르기 · 손떨림 · 창가 빛 · 30fps · 방 소리 + `/api/clips` Range(206, 미리보기 탐색이 0초로 튀던 원인) · #51 LIGHT/COLOR/EFFECTS/MOTION 섹션 · 프리셋 6 · Hold: before · WebGL 미리보기 · #52 ✎ Edit 모드(오른쪽 칸 = 조절판, 채팅은 숨김) · AI 편집 채팅(Claude CLI + MCP 3 도구) · #53 사진 · 영상 참고 · Edit 을 flow 테이크에도 · 채팅 칸 = 영상 높이 · 조절판 기본 접힘 · 답 렌더러(agent-text, 숫자 변화 칩)
- 실기 확인(Chrome): 프리셋 · 미리보기=렌더(같은 2.5 초 프레임), Claude 가 "창가 빛 오른쪽 + 필터 느낌 줄여" 를 프레임 2 번 보며 처리, 참고 영상 수치 맞춤 4 라운드

- #56 AI EDIT 채팅 compact: 60% 넘는 턴이 끝나면 같은 세션이 인계 노트(목표 · 좋아한/버린 것 + 숫자 · 시도 · 다음)를 쓰고 다음 메시지는 새 세션에서 노트로 시작. `compact` 버튼(new chat 옆). 테스트 키로 실측: 6.8 초, 새 세션이 노트만으로 "그림자 0→10" 이어받음. 창이 100만 토큰이라 60% = 약 60만

**Learned**: 미리보기를 "보이는 대로" 맞추려면 디코드가 아니라 표시 경로(Apple bt709 감마)까지 맞춰야 한다. 상태(슬라이더)를 대화 밖(서버)에 두면 세션 교체 때 넘길 게 대화 몇 줄뿐이다.

## Pending
- [ ] 커밋 — Dan 이 말할 때, Dan 의 다른 미커밋 변경(cut-panel · cut-script · tts · stock · cut-compose · CUT-FLOW)과 분리해서. 버전 / CHANGELOG Unreleased 정리
- [ ] 인물 기본 프리셋 — Dan 이 고른 값으로 POST_PRESETS 에 추가
- [ ] AI 영상 편집(옷 · 운 얼굴 · 재조명): Runway Aleph 2(첫 프레임 고정) 어댑터 — Dan OK 대기(카드 $0.08 + 약 $1.12)
- [ ] 편집 채팅: 이미지 편집(카드 다시 그리기)도 도구로? · 참고 자료 썸네일을 대화 기록에
- [ ] GPT Image 2.5 Flare · Nano Banana Pro 엔진(조사 결과) · Gemini Omni Flash 1.1(Veo 후속, 영상)
- [ ] flow 결과에도 Show render · 렌더 결과를 flow 테이크 목록에

## Notes
- DEVLOG #47–#53 · CHANGELOG Unreleased · `lab/HYPERREAL.md`(실험 1–16 + 조사 3 묶음)
- 새 파일: lib/post-frame.ts · post-grade.ts · post-settings.ts · post-render.ts · app/chat/post-preview.tsx · agent-text.tsx · app/api/post-agent/route.ts · scripts/post-agent-mcp.mjs · lib/providers/kling4.ts
- 비용 장부 작업은 [[cost-ledger-billing]]
