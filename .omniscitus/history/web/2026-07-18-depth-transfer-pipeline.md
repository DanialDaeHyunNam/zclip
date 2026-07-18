# Depth Transfer Pipeline — /depth 툴 · 자동 depth 패스 · 캐스팅/오디오/씬 UX (v0.12.0)

**Participants**: Danial Nam, claude

## Summary
"실사 댄스 클립 → 브라우저 내 depth 변환 → look 캐릭터가 새 배경에서 그 안무를
춤" 파이프라인을 통째로 구축. Depth Anything V2 인브라우저 엔진(/depth 툴 +
lib/depth-extract), ANIMATE 자동 depth 패스, Vercel Blob 제거(무료 임시 호스트),
캐스팅(text-first 정체성 자동 추출)·씬 캐러셀·REF AUDIO·COMPARE까지. v0.12.0.

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
- **Constraints**: ModelArk r2v 픽셀 하한 409,600(라이브 검증) — 전송 직전
  범용 가드가 미달 레퍼런스를 무AI 업스케일 재인코딩; Seedance 레퍼런스 ≤15s;
  transformers.js는 webgpu 실패가 모델 로드를 오염시킴(requestAdapter 선프로브
  필수) + ONNX 백엔드는 첫 추론에서 lazy init(워밍업을 폴백 try 안에).

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
**Focus**: 같은-얼굴 근본 해결(정체성 자동 추출) + MOVES 캐러셀 + v0.12.0 릴리스.
- 같은-얼굴 post-mortem: store에서 실제 라이드된 텍스트 확인 — 구도 브리프
  + 아이돌 보일러플레이트가 원인. `/api/describe` 신설, confirm 시 자동
  distill(textOverrides), ✎ identity 에디터, 다인 시 "different individuals"
  강조 라인 자동 삽입.
- MOVES 후보를 썸네일 카드 캐러셀로(MUSIC FROM과 동일 킷), 위저드 nav 영어화
  ("← Back / Next →" — 스튜디오 마지막 한국어 제거).
- v0.12.0 릴리스(PR 플로우): 버전 범프 + CHANGELOG + PR + tag + gh release +
  vercel --prod.

**Learned**: 미검증 API 가정은 라이브에서 순차적으로 깨진다(3연속 submit 거절,
전부 $0) — "거절이 과금 전 검증"인 구조 덕에 실험 비용이 0였음. 멀티탭
파일스토어는 last-writer-wins라 소유 탭 지정+메시지 패싱이 유일한 안전 경로.
텍스트 정체성의 품질은 "무엇을 텍스트로 보내는가"가 전부 — 이미지를 텍스트로
증류하는 계층(describe)이 정답이었음.

## Pending
- [ ] Seedream 4.0 첫 실런 검증 (images/generations 형태 + size enum — 거부 시
      에러만, $0)
- [ ] 자동 정체성 distill로 두 댄서가 실제로 다른 얼굴로 나오는지 실런 1회
- [ ] +EXPRESSION(적응형)·DA V2 Base가 depth 얼굴 가독성에 주는 효과 실런 비교
- [ ] uguu.se/litterbox 임시 호스트 장기 신뢰성 관찰 (다운 시 폴백 에러 문구로
      드러남)
- [ ] hosted에서 depth 패스 + 4.5MB 바디 캡 경계 확인 (긴 depth 레퍼런스)
- [ ] Kling Motion Control 어댑터 — 정확한 표정/실사 전이의 다음 단계
      ([[motion-transfer-flow]] 이월)

## Notes
[[motion-transfer-flow]]에서 파생 — 그 유닛의 "Seedance role 페어링 실제 성공"
pending을 이 유닛의 07-18 실런이 해소. DEVLOG #34–#44가 세부 기록.
자매 기능: /depth의 PENDING_DEPTH_KEY 핸드오프 패턴은 향후 모든 툴 탭의 규칙.
