# ZCLIP Hosted BYOK Open-Up

**Participants**: Danial Nam, claude

## Summary
zclip.vercel.app이 쇼윈도에서 실사용 BYOK 스튜디오로 전환(v0.5.0–0.5.2).
키 패스스루 아키텍처 + 오너 지갑 방화벽 + 2트랙 랜딩("로컬이 집,
브라우저는 맛보기"). 설계 SSOT = docs/HOSTED.md.

## Context
- **Background**: 7/14 방침 변경("쇼윈도 유지" 폐기) — 영상 제공자들은
  CORS 불가+인증 MP4 프록시 필수라 card-news식 브라우저 직통이 불가능,
  "패스스루"가 정직한 상한. 오너 요청: hosted는 입구, 로컬 설치가 목적지.
- **Requirements**: 키는 방문자 localStorage에만(요청 중에만 서버 경유,
  무저장·무로깅 — 문구가 곧 계약); 오너 비용 폭탄 원천 차단; /lab은
  계속 404+gitignored; APP_PASSWORD 옵션 존속; 릴리스 규칙 준수.
- **Decisions**: ① 어댑터가 키를 명시 파라미터로 받음(submit/status 3번째
  인자) — process.env 요청 중 변조는 동시요청 키 오염이라 절대 금지.
  ② 클라우드는 env 폴백 차단(lib/server-keys.ts) — Vercel env에 키를
  남겨도 구조적으로 못 씀. /api/keys GET도 클라우드에선 env 키를 "없음"
  으로 보고. ③ Veo/Sora 재생·다운로드 = fetch(헤더 키)→blob URL
  (lib/video-src.ts) — ?key= URL은 Vercel 로그에 남아 "무기록" 문구가
  거짓이 되므로 탈락. ④ 참조영상 Seedance hosted 차단(오너 Blob 월2천
  ops 보호), Act-Two는 4.5MB 클라이언트 사전체크(Vercel 바디 캡).
  ⑤ 데이터 삭제는 hosted 전용 버튼(대시보드) — 로컬은 파일스토어가
  원본이라 localStorage만 지우면 부활, ".zclip-data 폴더 삭제" 안내로
  대체. ⑥ 스튜디오는 영어 단일 유지(오너 확인 7/15) — i18n은 공개
  페이지까지만. ⑦ 링크 밑줄 전면 금지(오너 콜) — text-decoration 전역
  리셋 + border-bottom 가짜 밑줄 4곳 제거.
- **Constraints**: 오너 비용 노출면은 Vercel 전송량뿐(Veo/Sora 프록시
  스트리밍) — Hobby면 과금 불가(정지만). 검증은 ZCLIP_CLOUD=1 프로드
  빌드에 무효 키 curl(실 generate 호출 0회). dev 서버 :3333 존중 —
  클라우드 스모크는 빈 포트(4517)에 격리.

## Timeline

### 2026-07-15
**Focus**: 설계 논의→docs/HOSTED.md→구현→v0.5.0/0.5.1/0.5.2 릴리스+배포
- 어댑터 6개 시그니처 변경 + 라우트 7개(generate/status/refine/image/
  spec-check/dress/video) 헤더 키 배선, lib/server-keys.ts·client-keys.ts·
  video-src.ts 신설
- /chat 게이트 해제, hosted 배너(✕ 영구 기억)·키 패널 패스스루 문구·
  다운로드 유도·hosted Delete all data(대시보드)
- 랜딩 2트랙: 로컬 설치 1순위 CTA + "차이가 뭔가요?" 질문 → 4행 비교
  모달(EN/KO, 로컬 열 하이라이트)
- 프로덕션 검증: 키리스 요청 loud 거절, 무효 헤더 키가 제공자까지
  도달(패스스루 실증), Seedance ref 차단 문구, /lab 404
- 0.5.1: 배너 밑줄/영구 dismiss, key-popover 잘림(absolute라 높이
  미기여 → key-open 클래스로 margin 예약), 0.5.2: border-bottom
  가짜 밑줄 제거

**Learned**: "무저장·무로깅" 문구는 구현 제약으로 되먹임된다 — 키를
URL에 넣는 순간(로그 잔존) 카피가 거짓이 되므로 아키텍처가 카피를
따라가야 했음. absolute 팝오버는 레이아웃에 높이를 안 보태 페이지
하단에서 반드시 잘린다(열릴 때 부모 margin 예약이 정답).

## Pending
- [x] Vercel 플랜 확인 — **Hobby 확인됨** (7/13 루트 세션 실사: 사용량 API가
      Pro 전용으로 거절 = Hobby; 초과 시 과금이 아니라 기능 일시정지.
      product/two-track-distribution 유닛 참조) → 비용 걱정 0
- [ ] 실키 hosted 스모크 1회: 키 패널 저장→생성→Veo/Sora blob 재생·
      다운로드 end-to-end (지금까지는 무효 키로 경로만 실증)
- [ ] 2트랙 계획의 잔여 항목: Vercel Web Analytics(trackEvent no-op
      래퍼) + /privacy 페이지 (memory: two-track-distribution-plan)
- [ ] 키 삭제 UI: 키 패널에서 localStorage 키 개별 제거(현재는 Delete
      all data로만 가능)

## Notes
설계 SSOT: docs/HOSTED.md. 커밋 61290d5→dcb14bf (v0.5.0~v0.5.2 태그+
GitHub 릴리스). 관련 유닛: [[zclip-deploy-versioning]](구 배포 모델),
[[zclip-chat-studio]]. 루트 메모리 two-track-distribution-plan.md가
이 방침으로 갱신됨.
