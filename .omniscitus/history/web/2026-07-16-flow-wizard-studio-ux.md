# FLOW 마법사 재설계 · 스튜디오 토글/비용/아카이브 UX

**Participants**: Danial Nam, claude

## Summary
FLOW 패널을 "전 스테이지 동시 노출" → **한 번에 한 스텝 마법사**(집owner
STEP n/N 패턴)로 재설계 + 스튜디오 토글 스위치화(REFINE/SPEC/Auto-title) +
세션 자동 제목(/api/title) + 비용 estimate 정직화 + 아카이브 페이지네이션.
v0.9.3 → v0.10.0 (2026-07-16).

## Context
- **Background**: /follow-up 후 오너 피드백 5건에서 출발 — "flow UX가
  복잡해서 공짜라도 못 쓸 것 같다" → 마법사 전환이 핵심. 부수: 실비용
  확인 경로, flow 세션 누수, 세션 제목 자동화, refine 배지 설명.
- **Requirements**: 스텝 이동은 **항상 수동 ← 이전/다음 →**(자동 전진 X,
  오너 확정), Animate는 각 스텝 **인라인**(플로팅 바 퇴역), 생성 후엔
  칩으로 스테이지 자유 이동, 수정 시 Regenerate, 히스토리는 chat처럼
  마법사 아래 적재 + 클릭 시 OUTPUT 프레임 재생.
- **Decisions**: ① 마법사 백본 = 기존 `flowSteps`(required/done 게이팅
  재사용) + `stepIdx`; flow 전환 시 첫 미완 required 스텝에 착지.
  ② 스텝 칩은 **솔리드 세그먼트 탭**(요약/나 스타일) — 위 flow 탭
  (아웃라인 필)과 시각 구분, 상세 blurb 제거하고 STEP n/N + 도트만 하단에.
  ③ flow 탭은 1줄 캐러셀(overflow-x), ＋New flow 왼쪽 sticky 고정,
  최신순 정렬. ④ 작업 영역은 `.flow-workspace` 서피스로 감싸 탭과 분리.
  ⑤ 수직 리듬: flex column + **단일 gap 16px**(개별 margin 전부 제거 —
  flex라 margin이 collapse 안 되고 합산돼 중구난방이었음). ⑥ 토글 3종
  (REFINE/SPEC/Auto-title)은 ZToggle(트랙+노브 스위치, role=switch) +
  ZInfoTip(**클릭** 툴팁, ? 수직중앙) — title 속성은 hover-only라 부족.
  ⑦ 세션 자동 제목: Gemini flash /api/title, 사이드바 토글(키 없으면
  강제 off), renamed 세션은 불가침, autoTitled 플래그로 auto-save 충돌
  방지. ⑧ 비용은 전부 estimate임을 명시 + PROVIDERS.dashboardUrl 6종
  추가, spend 팝오버에 "Verify the real charge ↗" 링크(실시간 실비 API는
  전 provider 부재 — Seedance만 토큰 usage 반환 가능성). ⑨ 아카이브:
  최신순 정렬 + **2행 페이지네이션**(ResizeObserver로 컬럼 실측 ×2).
  ⑩ Clip에 `modelLabel` 추가 — provider 기본 라벨이 변형 모델을
  잠식하던 버그(Seedance 2.0 Mini가 "1.0 Pro"로 표기) 수정 + 세션 turns
  jobId 매칭으로 기존 클립 부트 백필. variantLabel은 메서드(Chat/Flow)로
  일원화.
- **Constraints**: 세션 스코핑 버그의 진범은 `sessionId ?? undefined`가
  빈 문자열을 통과시킨 것(`??`는 null/undefined만) + studio 하이드레이션
  전 flow 생성 → `|| undefined` 정규화 + orphan flow를 현 세션에 귀속하는
  self-limiting 마이그레이션. 오너 dev 서버는 여전히 v0.4.0 부팅 상태
  (env 인라인은 재시작 필요 — 코드는 핫리로드로 반영됨).

## Timeline

### 2026-07-16
**Focus**: 오너 피드백 5건 → 번들 A + plan mode 마법사 재설계 + 실시간 폴리시 20여회
- 번들 A: REFINE 툴팁 → flow 세션 누수 수정 → Auto-title 토글+/api/title →
  estimate 라벨+대시보드 링크 (모두 tsc clean, :3333 헤드리스 검증)
- Phase 0: ZToggle/ZInfoTip 3종 적용 (오너 실시간 피드백: 스위치 명시성,
  ? 수직중앙, 클릭 툴팁)
- Phase 1: 마법사 셸 — 칩 스트립·activeStage 단일 렌더·수동 내비·인라인
  Animate·포탈 바/mounted/createPortal 제거
- Phase 2: Regenerate 라벨("↻ Animate again") + 상시 take 히스토리 스택
- 폴리시: 솔리드 세그먼트 칩, 1줄 캐러셀+New flow 좌측 고정+최신순,
  STEP n/N+도트, 16px 단일 리듬, .flow-workspace 서피스
- 아카이브: 2행 페이지네이션(컬럼 실측), 최신순, modelLabel 수정+백필
- /follow-up 부산물: 직접 업로드 pending 2건 완료 확인([[zclip-chat-studio]])
- 릴리스: v0.10.0 범프 + CHANGELOG + CLAUDE.md 마법사 갱신 →
  **PR #4 오픈** (release/v0.10.0, 17 files +1,349/−269)
- 번외 — xAI 503 진단: 오너 localhost 생성 실패 신고 → 인증/모델 API는
  200(0.3s)인데 생성 요청만 ~0.5s 즉답 503 → xAI Imagine 생성 캐파
  로드셰딩 확정(우리 코드·이번 PR 무관). 대응: 잠시 후 재시도 or 모델
  갈아타고 Retry(설계상 현재 선택 모델로 재실행)

**Learned**: flex column 안에선 margin이 collapse되지 않고 합산된다 —
개별 margin 대신 부모 gap 하나로 리듬을 통일하는 게 정답. auto-fill 그리드의
"N행 제한"은 CSS로 불가 — ResizeObserver로 컬럼 수를 CSS와 같은 공식으로
실측해야 페이지가 항상 정확히 2행. 그리고 아카이브 라벨 버그처럼 "한
어댑터=여러 모델" 구조에선 provider 기본값 폴백이 조용히 거짓말을 한다.

## Pending
- [x] 릴리스 v0.10.0 — PR #4 머지 + tag v0.10.0 + gh release 완료
      (2026-07-16 오후, [[session-flow-unification]] 세션). 프로드 배포는
      같은 날 v0.11.0으로 직행(0.9.3→0.11.0 — 업데이트 배너 정상 발화)
- [ ] provider 503/529 humanize 한 줄 — "일시 과부하, 잠시 후 재시도 or
      모델 바꿔 Retry" (v0.9.3 credit/safety 케이스와 같은 패턴; 오너에게
      제안만 한 상태, 미결정)
- [x] CLAUDE.md의 flow 설명 마법사 구조로 갱신 — 완료 (CLAUDE.md:73
      "Since v0.10.0 the panel is a step WIZARD" 절, 릴리스 커밋에 포함)
- [ ] Auto-title이 세션 열람 시에도 1회 발화(신규 take만으로 제한하려면
      lastTitledRef를 로드 시점 시딩 — 원라인)
- [x] 오너 dev 서버(:3333) 재시작 — 완료: 7/16 :3333 /api/version = 0.10.0
- [ ] 아카이브 modelLabel 백필은 세션 히스토리(최대 20개)에 남은 클립만
      복구 — 그보다 오래된 클립은 provider 기본 라벨 유지

## Notes
결정 뿌리: 오너 스크린샷 기반 실시간 피드백(집owner 마법사·요약/나 세그먼트
탭·STEP 도트). 관련: [[motion-transfer-flow]](직전 flow UX 대수술, v0.6.0~
0.9.3), [[zclip-hosted-byok]](Vercel Analytics·/privacy 잔여), [[video-prompt-
spec-gate]](SPEC 토글이 ZToggle로 이관). plan 파일:
~/.claude/plans/starry-strolling-bentley.md.
