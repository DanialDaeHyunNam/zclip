# Depth Transfer Pipeline — /depth 툴 · 자동 depth 패스 · 캐스팅/오디오/씬 UX (v0.12.0) + Lucy restyle(dormant)

**Participants**: Danial Nam, claude

## Summary
"실사 댄스 클립 → 브라우저 내 depth 변환 → look 캐릭터가 새 배경에서 그 안무를
춤" 파이프라인을 통째로 구축(v0.12.0, 배포): Depth Anything V2 인브라우저 엔진
(/depth 툴 + lib/depth-extract), ANIMATE 자동 depth 패스, Vercel Blob 제거(무료
임시 호스트), 캐스팅(text-first 정체성 자동 추출)·씬 캐러셀·REF AUDIO·COMPARE.
대안으로 Lucy Edit v2v restyle flow도 구축했으나 오프라인 모델 품질 미달로
잠재움(RESTYLE_ENABLED=false, 코드는 머지).

## Context
- **Background**: 오너가 바이럴 depth-transfer 워크플로우(왼쪽 depth 댄스 영상 +
  캐릭터 이미지 → 새 배경에서 안무 재현)를 목표로 스크린샷 앱("DepthSkeleton
  Video Extractor")과 레퍼런스 프롬프트를 제시. depth 레퍼런스는 정체성이 없어
  Seedance 실인물 필터를 통과한다는 기존 발견([[motion-transfer-flow]])이 출발점.
- **Requirements**: 브라우저 로컬 처리(서버·API 키 0), 출력 ≥30fps 보장, transfer
  flow(MOVES→IMAGE→MOTION)에 depth가 기본 경로로 통합, 원본 음악이 완성 take에
  실릴 것, 배경·캐스트가 일급 컨트롤일 것.
- **Decisions**:
  - 30fps는 처리 속도가 아니라 인코딩 속성: WebCodecs에 i/fps 타임스탬프로
    오프라인 인코딩 (H.264→mp4, VP9/webm 폴백).
  - 멀티탭 스토어 클로버 방지: /depth 탭은 lib/store를 절대 안 씀 —
    PENDING_DEPTH_KEY(플레인 localStorage 포인터)로 스튜디오 탭이 focus 시 adopt.
  - depth 패스는 ANIMATE의 자동 전처리(refClip당 캐시, 모드 키드); 실패 시
    제출 안 하고 크게 에러(무음 폴백 금지 — 필터에 걸려 과금됨).
  - Vercel Blob 완전 제거(오너: 무료 쿼터 소진, 결제 거부). ModelArk가 data
    URL을 거부("web url" 필수, 라이브 검증)해서 무료 임시 호스트 체인
    (lib/ref-host: uguu.se → litterbox)으로 해결. depth 레퍼런스는 정체성이
    없어 공개 임시 호스트가 허용 가능하다는 논리.
  - 정체성은 TEXT가 기본: 포토리얼 reference_image는 depth 영상 옆에서도
    필터에 걸림(라이브 검증). 텍스트 정체성의 같은-얼굴 문제는 생성 프롬프트가
    구도 브리프라서 — /api/describe(Gemini가 카드를 보고 얼굴-우선 묘사)로
    confirm 시 자동 추출(textOverrides), 편집 가능(✎ identity).
  - look 카드 기본 엔진 = Seedream 4.0(같은 ModelArk 키·계열 — 카드가 렌더
    예고편; API 형태 UNVERIFIED until first run).
  - REF AUDIO(기본 ON): take 볼트 직후 ffmpeg mux(-map 0:v -map 1:a? -c:v
    copy)로 원본 음악을 입힘 — 안무가 1:1이라 박자 자동 일치. depth 레퍼런스는
    audioUrl(원본 포인터, /depth 핸드오프가 자동 세팅)로 음원 해결.
  - Lucy restyle은 별도 flow kind(transfer 드롭다운에 안 넣음 — 이미 고른
    depth ref를 되물려야 해서 UX 복잡). 오프라인 품질 미달 판정 후 삭제 대신
    RESTYLE_ENABLED 플래그로 잠재움(재발전 여지).
- **Constraints**: ModelArk r2v 픽셀 하한 409,600(라이브 검증) — 전송 직전
  범용 가드가 미달 레퍼런스를 무AI 업스케일 재인코딩; Seedance 레퍼런스 ≤15s;
  transformers.js는 webgpu 실패가 모델 로드를 오염시킴(requestAdapter 선프로브
  필수) + ONNX 백엔드는 첫 추론에서 lazy init(워밍업을 폴백 try 안에).
  Lucy: 오프라인 lucy-edit은 Wan-2.2 5B(포토리얼 identity 인형 얼굴 + ~4s
  출력 캡); 데모 품질 Lucy 2.5는 realtime-WebRTC 전용; fal은 선불 잔액 차감식.

## Timeline

### 2026-07-18
**Focus**: /depth 툴 구축 → ANIMATE 자동 depth 패스 → Blob 제거 → 캐스팅/씬/오디오 UX.
- `/depth` 페이지 + `lib/depth-extract.ts`(공유 엔진): Depth Anything V2 Small,
  WebGPU/WASM, EMA 스무딩, 코덱 래더. 헤드리스 end-to-end 검증(ffprobe:
  h264 · 30/1fps · 30프레임).
- transfer flow 통합: DEPTH REF 토글(기본 ON), refClip당 캐시, 라이브 depth
  프레임이 OUTPUT 프레임에 스트리밍, 파이프라인 내레이션(flow-fire-note →
  좌측 프레임 아래로 이동).
- Blob 제거 여정: data URL 시도 → ModelArk "web url" 거부(라이브) → 임시
  호스트 체인(uguu 검증, tmpfiles는 HTML 끼워넣어 탈락) → 픽셀 하한 409,600
  거절(라이브) → minPixels 업스케일 + 범용 pre-send 가드.
- **첫 depth transfer 성공**(해변 2인, Seedance 2.0 Mini) — role 페어링
  (reference_video + 정체성) 라이브 검증. [[motion-transfer-flow]]의 핵심
  pending 해소.
- 캐스팅 UX: CAST 슬롯 자동 증가(선택 수만큼, 최대 3), 폼 접힘("✎ Generate
  with a prompt" 사이드 도어), 슬롯별 👕 옷 스왑(/api/dress), SETTING 이미지
  카드 캐러셀(16 built-in + 커스텀 추가), REF AUDIO(+MUSIC FROM 썸네일 캐러셀
  ▶청취), COMPARE 오버레이(동시 재생, 소리 소스 토글), 소급 "♪ Add ref audio".
- depth 표정 한계 대응: +EXPRESSION(적응형 로컬 분산 균등화 — 할로 없음),
  /depth에 DA V2 Base(~370MB) 옵션. 한계 명시: depth는 고개 방향+입 정도까지,
  정확한 표정 전이는 Kling MC/Act-Two 영역.

### 2026-07-19
**Focus**: 같은-얼굴 근본 해결 + MOVES 캐러셀 + v0.12.0 릴리스 + Lucy Edit v2v
restyle flow(구축·라이브 검증·품질 판정·잠재움).
- 같은-얼굴 post-mortem: store에서 실제 라이드된 텍스트 확인 — 구도 브리프
  + 아이돌 보일러플레이트가 원인. `/api/describe` 신설, confirm 시 자동
  distill(textOverrides), ✎ identity 에디터, 다인 시 "different individuals"
  강조 라인 자동 삽입.
- MOVES 후보를 썸네일 카드 캐러셀로(MUSIC FROM과 동일 킷), 위저드 nav 영어화
  ("← Back / Next →" — 스튜디오 마지막 한국어 제거).
- v0.12.0 릴리스(PR #5/#6 플로우): 버전 범프 + CHANGELOG + PR + tag + gh
  release + vercel --prod. prod /api/version=0.12.0 확인.
- **Lucy Edit v2v (Decart/fal)**: lucy.decart.ai 데모(Lucy 2.5 realtime)를
  보고 조사 → 오프라인 v2v는 `lucy-edit/pro`뿐(fast/dev deprecated, 2.5는
  realtime-WebRTC 전용). 세 번째 flow kind `restyle`(VIDEO→IMAGE) 신설:
  원본 클립이 드라이버(모션/카메라/타이밍 공짜, depth·필터 불필요), look
  1장의 자동 정체성이 프롬프트에 접혀 "무엇이 될지" 지정. 어댑터
  `lib/providers/lucy.ts`(fal queue, FAL_KEY, 임시 호스트 재사용), config
  lucy provider + `restylesClip()`, MOVES/IMAGE 스테이지·REF AUDIO·COMPARE
  전부 재사용. FAL 키 온보딩(키 패널 방식), 키 카드는 wiz-steps 바로 아래
  (`.key-inline`로 absolute 오버라이드 — 원래 팝오버라 워크벤치 밖으로
  순간이동하던 버그), restyle 마지막 스텝에 ANIMATE.
- **품질 판정 → 미노출**: 라이브 실런 end-to-end 성공(어댑터 검증 완료,
  fal 선불잔액 게이트도 확인 → humanizeError provider-라우팅)했으나 결과가
  "개판"(오너) — 오프라인 lucy-edit은 Wan-2.2 5B 기반이라 포토리얼 identity
  swap이 인형 얼굴 + 출력 ~4s 캡. `RESTYLE_ENABLED=false`로 ＋New flow
  픽커에서 숨김, 코드는 전부 배선 유지(플래그로 부활). 버전업/배포 없이
  main 머지(PR #7) — 사용자 대면 변화 0.

**Learned**: 미검증 API 가정은 라이브에서 순차적으로 깨진다(depth 경로 3연속
submit 거절 + Lucy data-URL·잔액 게이트, 전부 $0) — "거절이 과금 전 검증"인
구조 덕에 실험 비용이 0. 같은 회사(Decart)라도 데모 모델(Lucy 2.5 realtime)과
API로 살 수 있는 모델(lucy-edit Wan 기반)의 체급이 딴판 — 데모 보고 기대치
잡으면 안 됨. "잘 안 되는 기능은 지우지 말고 플래그로 잠재워 머지"가 재발전
여지를 남기는 정답.

## Pending
- [ ] Seedream 4.0 첫 실런 검증 (images/generations 형태 + size enum — 거부 시
      에러만, $0)
- [ ] +EXPRESSION(적응형)·DA V2 Base가 depth 얼굴 가독성에 주는 효과 실런 비교
- [ ] uguu.se/litterbox 임시 호스트 장기 신뢰성 관찰 (다운 시 폴백 에러 문구로
      드러남)
- [ ] hosted에서 depth 패스 + 4.5MB 바디 캡 경계 확인 (긴 depth 레퍼런스)
- [ ] Kling Motion Control 어댑터 — 정확한 표정/실사 전이의 다음 단계
      ([[motion-transfer-flow]] 이월)
- [ ] Lucy 재발전 트리거: Lucy 2.5급 오프라인 v2v가 나오면 `RESTYLE_ENABLED`
      true로 부활. 그전까지 lucy-edit은 스타일 변환(claymation/anime) 용도만
      가능성 있음 — identity swap은 depth 경로 우위 확정
- [ ] Lucy 2.5 realtime(데모 품질)은 WebRTC라 cinerec의 LIVE 작업에서 먼저
      검증 후 ZCLIP 역수입 (파일→realtime 스트림→녹화)
- [ ] 씬 인식 키프레임 선별 — 멀티샷 레퍼런스 기능 착수 시 재검토(현재 보류).
      조사: `claude-real-video`(HUANGCHIHHUNGLeo, MIT)는 번역/더빙/생성이 아닌
      "영상→LLM 이해용 스마트 키프레임+Whisper 전사" 전처리기. 핵심 IP =
      씬 체인지 dedup(전역 RGB diff + 로컬 엣지). 코드 직접 이식 ❌(Python+서버
      FFmpeg+Whisper vs 우리 브라우저·서버0). 매핑 지점은 `attachMediaFile`
      (studio.tsx:1389, 현재 1fps 균등 샘플링 최대10장 — 주석 "3 frames
      start/mid/end"는 낡음). 현재 참조 클립이 싱글샷 얼굴 리액션이라 씬 감지가
      골라낼 컷이 없어 이득 ≈0. 멀티샷(편집된 뮤비/브이로그 "이 연출 따라해줘")
      또는 "레퍼런스 클립 분석→spec 자동 작성" 착수 시에만 Canvas 픽셀-diff
      포팅(20~30줄)이 값어치. Whisper 전사는 우리(영상 생성)와 무관

Resolved (이번 세션):
- [x] Seedance role 페어링 실제 성공 영상 — 해변 2인 take (07-18)
- [x] 자동 정체성 distill로 두 댄서 다른 얼굴 — confirm 시 /api/describe
      자동 distill + "different individuals" 강조 라인 (07-19)

## Notes
[[motion-transfer-flow]]에서 파생 — 그 유닛의 "Seedance role 페어링 실제 성공"
pending을 이 유닛의 07-18 실런이 해소. DEVLOG #34–#44가 세부 기록.
자매 기능: /depth의 PENDING_DEPTH_KEY 핸드오프 패턴은 향후 모든 툴 탭의 규칙.
