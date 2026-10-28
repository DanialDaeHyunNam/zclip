# Launch Prep — Analytics · FLOW 발견성 · Library 정직성 · Spec 1.1.0 · @build_useful

**Participants**: Danial Nam, claude

## Summary
v0.12.0(depth transfer) 배포 이후 공개 런치/성장 준비 세션 — Vercel Web
Analytics(호스티드 전용·쿼리 제거·no-op 래퍼), FLOW 첫 진입 빈 상태(픽커 강제 →
2번째 파이프라인 발견성), Library의 사라진 take 미노출 + 호스티드 카피 정정,
Spec 1.1.0(캠코더 레퍼런스 학습). 곁들여 개인 브랜드 소셜 계정(@build_useful)
네이밍과 경쟁 스캔(claude-real-video 분석 · 아이돌 자컨 UI 오버레이 아티팩트).

## Context
- **Background**: depth-transfer 파이프라인(v0.12.0)이 배포 완료된 상태에서,
  "공짜 좋은 툴 대량배포" 개인 브랜드로 공개 런치를 준비. 계측·발견성·정확성을
  정리하고, 소셜 계정과 경쟁 지형을 스캔.
- **Requirements**: 로컬/셀프호스트는 외부호출 0 유지(오픈소스 클론 배려),
  키/URL 절대 로깅 금지(호스티드 공개 약속), gallery는 spend ledger라 "미노출"은
  화면에서만·원장 유지, spec 변경은 additive면 A/B 없이 오너 verdict로 ship.
- **Decisions**:
  - **Analytics는 `isCloud()` 게이트 + `beforeSend` 쿼리 제거** — 로컬은 스크립트
    자체가 안 붙고, 호스티드도 `/depth?src=`·비디오 프록시의 temp-host URL이
    URL에 안 실림. `lib/analytics.ts` track()은 `data-hosted="1"` no-op 래퍼로
    coarse non-PII props만.
  - **FLOW 자동 생성 폐지** — 두 경로(하이드레이션·세션 effect) 모두 제거,
    `+ New flow`가 항상 kind 픽커를 엶. flow1을 미리 만들면 MOVES→IMAGE→MOTION
    (flow2)을 볼 일이 없어 발견성 0이던 문제. 픽커를 `kindPicker` const로 추출해
    빈 상태·탭 행 양쪽 재사용. newFlow 호출은 이제 픽커 선택 단 한 곳.
  - **사라진 take는 Library에서 미노출** — videoUrl 없음 또는 링크 만료(로드
    onError, 호스티드 blob 페치 중 빈 src 오탐 가드) 시 카드 숨김. 카운트는
    노출분 기준, `clips` 원장은 유지(대시보드 spend·Clear All은 다 봄).
  - **호스티드 "video unavailable" 카피 정정** — `.zclip-data`는 로컬 전용이라
    브라우저에선 틀림 → hosted 분기(만료/삭제 → install 또는 download).
  - **Spec 1.1.0 (additive, 오너 verdict)** — CHASE 캠코더 프롬프트에서 3개 학습:
    `style` lo-fi 장르 OVERRIDE(캠코더/VHS는 8K 강제 금지), `acting` 단일 감정
    스루라인, `continuity` 생리적 상태 연속성, `subject` modesty=필터안전 가설.
    photoreal DEFAULT는 byte-불변이라 A/B 불필요. 진짜 flip은 /lab로 이월.
  - **소셜 계정 = @build_useful** — "build something ~~great~~ useful" 만트라.
    @somethinguseful은 선점됨. 핸들=만트라, 표시이름=dan.builder(개인 정체성)
    분업. (별도 커밋 9578d6a: 소셜 링크를 @build_useful로 통일 — 오너 작업.)
- **Constraints**: Vercel Hobby(초과 시 과금 아닌 일시정지), 아티팩트 CSP는
  유튜브 임베드를 막을 수 있음(퀵테스트용, 깨끗한 결과는 파일 드롭), spec의
  photoreal→genre-driven 완전 flip은 /lab A/B 게이트 유지.

## Timeline

### 2026-07-21
**Focus**: v0.12.0 이후 계측·발견성·정직성 폴리시 + 성장 준비. 4커밋 배포.
- **local↔prod 확인 + /follow-up**: 버전 일치(0.12.0), 전 커밋 푸시됨. v0.12.0
  태그 이후 Lucy restyle(ca66ce9)은 dormant라 버전범프 없이 배포 정상 확인.
- **claude-real-video 분석**: 번역/생성 툴이 아니라 "영상→LLM 이해 전처리기"
  (씬 키프레임+Whisper). 코드 직접 이식 ❌(Python/서버 vs 브라우저), 씬 dedup
  아이디어만 이식 가능하나 싱글샷 리액션 클립엔 이득 0 → 멀티샷 착수 시 재검토로
  [[depth-transfer-pipeline]] pending에 기록.
- **아이돌 자컨 UI 오버레이 아티팩트**: "클로드가 영상 편집"의 실체 = `<video>`
  위 CSS 오버레이(CHROMA CAM·REC·핑크 자막). 껍데기는 5%, 원본 생성이 95%이고
  그게 ZCLIP 영역임을 확인. YouTube URL 입력도 추가(임베드는 CSP 불확실).
- **Spec 1.1.0** (커밋 955fc44): 위 3개 additive 학습 + SELF_CHECK.
- **Vercel Web Analytics** (커밋 74cc905): @vercel/analytics@2.0.1, ZAnalytics
  클라이언트 래퍼(beforeSend 쿼리 제거), isCloud 게이트 마운트, track no-op 래퍼.
- **Library 사라진 take 미노출 + 호스티드 카피** (커밋 4ec1a91).
- **FLOW 빈 상태 → 픽커 강제** (커밋 f2b421d).

**Learned**: "버전 일치 = 배포 완료"가 항상 참은 아님 — 버전범프 없는 커밋
(dormant Lucy)은 버전으로 안 잡혀 git으로 태그-이후 델타를 봐야 함. "A/B가
맞다"는 규율의 목적은 회귀 방지 — 변경을 additive(기본값 불변)로 재설계하면
회귀 위험이 0이라 게이트 목적이 구조적으로 충족되어 오너 verdict로 ship 가능,
진짜 behavior flip만 A/B 유지. 발견성: 편의로 flow1을 미리 만들면 2번째 옵션이
죽음 — 강제 선택이 발견성을 산다.

## Pending
- [x] **Vercel 대시보드 Analytics Enable + 재배포** — 완료 확인 (2026-08-02 f/u:
      `zclip.vercel.app/_vercel/insights/script.js` 200 = 대시보드 Enable + 배포 반영)
- [ ] 스튜디오 this-session strip도 사라진 take 숨기기 (현재 archive만 처리)
- [ ] @build_useful X/Threads 가용성 최종 확정 + 첫 소개 스레드(툴 4개 한 줄+링크)
- [ ] /privacy 페이지 (2트랙 잔여 — 쿠키리스/무PII라 법적 필수 아님)
- [ ] 4커밋 모두 버전범프 없이 배포됨(0.12.0 유지) → 다음 정식 릴리스 때
      CHANGELOG로 묶고 버전범프+태그 (로컬 카피 업데이트 배너 발화)

## Notes
세부 검증 이월은 각 원 유닛 pending 참조 — Spec 1.1.0 진짜 flip A/B +
modesty 필터-통과 테스트는 [[video-prompt-spec-gate]], 실키 hosted 스모크는
[[zclip-hosted-byok]], depth/멀티샷 씬-키프레임 재검토는 [[depth-transfer-pipeline]].
FLOW 발견성은 [[session-flow-unification]]·[[flow-wizard-studio-ux]]의 후속.
