# Motion Transfer Flow & Studio UX

**Participants**: Danial Nam, claude

## Summary
FLOW에 두 번째 파이프라인 MOVES→IMAGE→MOTION(모션 트랜스퍼) 추가 +
대규모 flow UX 재설계(단일 캐러셀·플로팅 진행바·칩·image/text 토글) +
chat refine 토글(기본 OFF). v0.6.0~v0.9.3 (2026-07-15~16).

## Context
- **Background**: 참조 댄스 영상의 안무를 내 캐릭터가 그대로 추도록(원본
  2인 depth 프롬프트에서 착안). "동작만 문제가 아니라 결국 Act-Two가 하는
  걸 우리도 다 할 수 있냐"는 오너 질문 → 몸=Seedance ref 상위호환,
  얼굴/표정=Act-Two로 분업이라는 결론.
- **Requirements**: ＋New flow에서 종류 선택(IMAGE→MOTION vs
  MOVES→IMAGE→MOTION), 종류별 템플릿 프리필. 영상 2인이면 룩 2개
  선택(멀티 참조). 이미지 없이 텍스트 캐릭터만으로도 생성 가능. chat은
  크래프팅한 프롬프트를 verbatim 전송(refine 기본 OFF).
- **Decisions**: ① seedance 어댑터가 이미지+영상을 role 조합
  (reference_image + reference_video)으로 전송 — **첫 실런에서 ModelArk가
  수락 확인**(content[2] 길이 거절 = role 페어링은 통과). ② 참조영상 15.2s
  하드캡 사전검증. ③ Seedance 2.0 Fast/Mini 변형 추가(mini가 최저가, 영상
  입력 $2.1/M 플랫 실단가). readsClip() 계열 헬퍼로 게이트 통일.
  ④ 이미지 정체성은 선택사항 — 텍스트로만도 가능(useLookAsText → 칩별
  IMG/TEXT 토글로 진화). ⑤ ANIMATE는 하단 **플로팅 바 단일**(인라인 제거),
  document.body 포탈로 fixed(부모 .fade transform이 containing block을
  바꿔 가로스크롤 유발하던 것 해결), 사이드바 열리면 오프셋 중앙배치,
  렌더링 중/발사 후 미노출·수정 시 복귀, 더블파이어 락. ⑥ flow는 독립적 —
  전환 시 그 flow의 pending/done/look/빈 상태로 프리뷰 동기화. ⑦ chat
  refine 토글(기본 OFF, localStorage), 리파인 take는 ORIGINAL/SENT 토글.
- **Constraints**: **Seedance 실인물 안전필터가 참조 영상(실제 댄서)에
  걸린다** — 이미지 없이 텍스트로만 넣어도 영상 프레임에서 실제 사람을
  잡아 차단. 원본이 통과한 건 참조가 **depth 렌더**(실제 얼굴 없음)였기
  때문. 실사 댄스 클립엔 Seedance r2v 부적합 → **Kling Motion Control**
  (pose 추출, 필터 우회) 또는 Act-Two가 정답. depth 전처리는 ML 필요라
  스택에 없음. GRAB/트림/클립볼트는 로컬 dev 전용(hosted 불가).

## Timeline

### 2026-07-15
**Focus**: 모션 트랜스퍼 flow 설계·구현 + Seedance 변형 + GRAB 개선
- seedance 어댑터 role 조합, /api/generate images[] 다중 참조, blob 60MB 캡
- flow kind 선택 팝오버 + TRANSFER_PRESETS(카메라고정/그린스크린) 템플릿
- GRAB: 트림 시 구간만 다운로드(yt-dlp --download-sections, exit-0 skip
  버그 수정), 인라인 MOVES 트림(vault된 클립 ffmpeg), m:ss 타임코드
- chat: refine 토글(기본 OFF), 프롬프트 3줄 클램프+Copy+FullView,
  verbatim 중복 제거, ORIGINAL/SENT 토글

### 2026-07-16
**Focus**: flow UX 대수술 + 에러 진단 정확화 (오너 실시간 피드백 20+회)
- 단일 pick 캐러셀(생성+재사용 통합, 밑 스트립 제거), 선택=컴팩트 칩
- 칩별 IMG/TEXT 모드 토글(reference_image vs 프롬프트 텍스트 정체성)
- 플로팅 ANIMATE 바: 포탈 fixed·사이드바 오프셋·렌더중/발사후 미노출·
  더블파이어 락·완료 시 다운로드 버튼
- 독립 per-flow 렌더링 동기화, 모션 프롬프트 접기(✎Edit), take카드 중복 제거
- Seedance 2.0 Fast+Mini, 에러에 provider 원문 verbatim 병기 + 크레딧 케이스

**Learned**: `position: fixed`는 조상의 transform/filter가 있으면 뷰포트가
아닌 그 조상 기준이 된다 — 포탈(document.body)이 확실한 해법. 그리고
실인물 필터는 정체성 이미지가 아니라 **참조 영상**에 걸린다(원본은 depth
렌더라 통과). 오너 dev 서버가 아침 v0.4.0으로 켜진 뒤 재시작 없이 40+회
핫리로드 → Fast Refresh 상태 깨짐(빈 flow 패널·유령 버그) → 재시작 필요.

## Pending
- [ ] **Kling Motion Control 어댑터** — 실사 댄스 클립을 pose 추출로
      전이(Seedance 실인물 필터 우회). $9.80 트라이얼 키로 첫 실런.
      TRANSFER flow 모델 선택지에 Seedance와 나란히 추가. [[flow-method-kling]]
- [ ] Seedance role 페어링 **실제 성공 영상** 1회(스타일라이즈드 룩 or
      depth 참조로) — 지금까지 검증·필터 거절만, 완성 결과물 미확인
- [ ] 오너 dev 서버(:3333) 재시작 안내 — 누적 핫리로드로 stale, 오늘 코드
      반영 안 될 수 있음(배너 "now v0.4.0")
- [ ] Higgsfield motion_control로 댄스+캐릭터 품질 데모(ZCLIP 무접촉, MCP)

## Notes
설계 뿌리: 오너 제공 2인 depth 댄스 프롬프트(dance-prompt0.mp4, 22.6s).
커밋 v0.6.0(2659063대)~v0.9.3(a10b9f4). 관련: [[flow-method-kling]](Kling
provider·FLOW method 원조), [[zclip-hosted-byok]](같은 개방 이니셔티브),
[[zclip-chat-studio]]. 에러 humanizeError는 lib 아닌 flow-panel 내부.
