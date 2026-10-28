# 비용 장부를 실제 청구에 맞추기 — /api/billing · 대시보드 · Veo 종료

**Participants**: Dan, claude

## Summary
ZCLIP 의 비용이 전부 "초 × 단가" 어림이었던 것을 각 회사의 실제 청구로 바꾸는 작업. 테이크가 끝나면 스튜디오가 `/api/billing` 으로 실제 금액을 받아 "billed" 로 표시하고, 어림 대비 비율로 다음 견적을 보정한다. 대시보드는 같은 파일 저장소를 읽고 기간 · 출처를 밝힌다. Veo 3.1 종료 확인 → 기본 모델 Grok.

## Context
- **Background**: Dan "여기 금액과 우상단 1.44 는 뭔 차이?" · "대시보드 49 달러가 언제 기준? 너무 불투명" · "실제 청구에 최대한 맞춰야 하고 같게 할 수 있으면 무조건 같게" · "키 부족한 거 없는지" · "구멍은 다 채워야지"
- **Requirements**: 금액마다 출처(청구 / 어림)를 밝힐 것 · 막히는 키는 기능(키 입력 칸)으로 푼다
- **Decisions**:
  - 조사(공식 문서, 10-28): xAI = 영상 폴 응답 `usage.cost_in_usd_ticks`(÷1e10, 청구액) · Runway = task `cost.credits`(×$0.01) · BytePlus = `usage.completion_tokens` × 공식 $/1M(비디오 입력 유무 별) · fal = `billing-events?request_id` 인데 **BILLING 프리셋 키** 필요 · Google 은 요청별 청구 없음, Veo 3.1 은 10-22 종료(모델 목록에 없음 확인)
  - `lib/billing.ts` + `/api/billing` · 스튜디오가 끝난 테이크를 4 초 뒤 · 45 초마다(10 회 · 6 일 안) 정산, 어림은 estUsd 로 보관, costSource billed/units/est
  - 견적 보정: 모델별 (청구 ÷ 어림) 중앙값 — Grok Imagine 실제 **$0.57**/4초(어림 $0.32 의 1.8 배), Act-Two $0.30 = 어림
  - Kling 참고 영상 어림 = (참고 + 출력)초, 최소 출력 2 배, $0.094/$0.141
  - 대시보드는 localStorage 직접 읽기 → 파일 저장소(lib/store) 로. 살아 있는 세션이 "Removed session" 으로 보이던 버그. since 날짜 · 이번 달 / 7 일 / 오늘 · 막대 금액 · 세션 날짜 · 청구 맞춘 금액 / 어림
  - OUTPUT 옆에 이 테이크 비용(billed / ≈est)
  - DEFAULT_PROVIDER grok, Veo implemented:false
- **Constraints**: 회사 쪽 기록 보관(BytePlus 7 일 등) 이 지난 옛 테이크(7 월)는 어림으로 남는다. FAL_BILLING_KEY 는 Dan 이 만들어 넣어야(대시보드 칸)

## Timeline

### 2026-10-28
**Focus**: 청구 조회 · 자동 정산 · 견적 보정 · 대시보드 · Veo
- 실측: 오늘 · 어제 Grok 3 편 실제 $1.71(어림 $0.96), 대시보드 전체 $50.06 = 청구 맞춤 $2.01 + 어림 $48.05, 이번 달 $3.27
- 키 점검: 영상 · 이미지 키 전부 있음, ANTHROPIC_API_KEY 만 비어 있음(CUT 대본 전용 · 편집 채팅은 구독 CLI)

**Learned**: `JobStatus.costUsd` 칸은 처음부터 있었는데 아무도 채우지도 읽지도 않았다 — "만들어 둔 빈칸" 이 정확도 구멍.

**Focus (오후)**: 장부 구멍 메우기 — 사진 · 글 호출 장부, Kling 공식 · Seedance 영상 입력, flow 정합, 대시보드 (DEVLOG #55)
- `lib/call-ledger.ts`: 유료 라우트(image 5 엔진 · dress · describe · refine · title · spec-check · cut-script · lab assemble)가 자기 응답의 usage 로 값을 매겨 `.zclip-data/calls.jsonl` 에 한 줄. 서버 쪽이라 호출 자리를 빠뜨릴 수 없다. 200 인데 그림이 없어도 기록(토큰은 청구됨)
- 단가는 공식 페이지를 브라우저로(10-28): xAI 는 채팅 · 이미지 · 영상 응답 전부 `cost_in_usd_ticks` = 청구액. Gemini · OpenAI · Anthropic 토큰 × 공식 단가, Seedream 장당 $0.03. 페이지의 장당 값과 대조 통과
- 발견: **gpt-image-1 은 10-23 종료** — gpt 사진 엔진은 죽은 상태. gemini-2.5-flash-image 는 문서상 10-02 종료지만 아직 답한다
- 세션 태그 `x-zclip-session`(keyHeader) → 장부가 세션별로 묶임. 스튜디오 자동 제목 호출($0.00027)이 열린 세션으로 잡히는 것 확인
- Seedance 영상 입력: `/api/generate` 가 `jobs.jsonl` 에 적고 정산이 읽는다(제출 경로 5 곳 대신 1 곳)
- Kling 공식: `/account/billing/balance`(작업별 차감액) → billed, 유닛 패키지면 이유로 남김
- OpenAI: Admin 키 칸(OPENAI_ADMIN_KEY) + Costs API 대조
- flow ↔ 스튜디오 경쟁: flow 가 갤러리에 직접 쓰고 스튜디오는 상태로 통째 덮어써서, flow 테이크는 정산도 안 되고 지워질 수도 있었다 → `zclip:gallery` 이벤트로 스튜디오가 흡수. flow 테이크 목록에 billed 표시
- 대시보드: 영상 + 사진 + 글 한 목록으로 합계 · 차트 · 세션. "Not matched to a bill" 이유 + Match again(대시보드가 조회해 보여 주고, 저장은 유일한 저장자인 스튜디오가 `zclip.rebillAt` 신호로). 첫 실행: 60 건 중 1 건 추가 매칭($2.01 → $2.66), 나머지는 이유(7월 Grok xAI 404 · Seedance 7 일 보관 · fal 키)

**Learned**: 저장소를 쓰는 주체가 둘이면 장부가 샌다 — 쓰는 쪽은 하나로 두고, 나머지는 신호만 보낸다.
- Dan fal BILLING 키 추가 → Kling 4.0 4초 참고형 실제 **$0.91**/편(어림 $0.63), 7월 Lucy **$0.75**(어림 $2.25). fal 조회는 90 일 제한 → 제출 시각 앞뒤 2 일 창으로. 장부 매칭 8 건 $5.23
- Match again 이 시작하자마자 "처리함" 을 찍어, 중간에 스튜디오를 떠나면 나머지 묶음이 영영 빠졌다 → 끝까지 돈 뒤에만 찍음 (로그로 확인)
- OpenAI: 옛 키 폐기 → Dan 이 ZCLIP 전용 프로젝트 + 새 키. 같은 조직에 다른 프로젝트도 있어서 대조를 ZCLIP 프로젝트로만(관리자 API 로 키의 프로젝트를 찾아 Costs API project_ids, 프로젝트 생성일부터)

## Pending
- [x] Dan: fal 키(preset **Billing**) + 충전 — 10-28 완료, Kling · Lucy 청구 맞춤
- [x] Dan: ZCLIP 프로젝트 + 새 OpenAI 키 — 10-28
- [ ] Dan: Admin 키(zclip-costs) 만들어 대시보드 OPENAI_ADMIN_KEY 칸에
- [ ] gpt 사진 엔진(gpt-image-1, 10-23 종료) → GPT Image 2.5 Flare/Sunburst 로 갈아끼우기 — 단가($5 text · $8 image in · $30 out /1M) 는 확인함, 엔진 교체는 OK 대기 항목과 같이
- [ ] gemini-2.5-flash-image → 3.1 Flash Image 이전 시점 정하기(문서상 이미 종료일 지남)
- [ ] 외부 콘텐츠 원장으로 ZCLIP 청구액 내보내기 — Dan OK 대기
- [x] 장부 구멍: 사진 편집(Grok ticks · Gemini usage) · describe / refine / title / spec-check / dress / CUT 대본 · lab assemble
- [x] Seedance 비디오 입력 여부 기록(서버 jobs.jsonl)
- [x] Kling 공식 청구 API — 있음(Deduction Query), 붙임
- [x] 정산 이유(billingNote) 대시보드 표시 + Match again
- [x] flow 테이크 비용 표시 갱신 (+ 스튜디오 장부 경쟁 수정)

## Notes
- DEVLOG #54 · #55 · 조사 근거 `lab/HYPERREAL.md` · 관련 [[hyperreal-edit-studio]]
