# GRAB — Threads 글 다운로드 지원

**Participants**: Dan, claude

## Summary
GRAB(`app/api/grab/route.ts`)에 Threads 글 URL 지원 추가. yt-dlp 에 Threads 추출기가 없어 `Unsupported URL` 로 실패하던 것을, 글 페이지에서 직접 mp4 를 찾아 기존 "직접 파일" 경로로 받게 했다.

## Context
- **Background**: 2026-10-10 Dan 이 3333 의 GRAB 으로 threads.com 글 영상(한글날 영상) 다운로드 실패를 보고
- **Requirements**: 클라이언트 호출부(archive · flow-panel 4 곳) 수정 없이 서버에서 해결
- **Decisions**:
  - 원인 확인: yt-dlp 2026.08.19 → generic 추출기 → `Unsupported URL`
  - Threads 는 Chrome UA 에 로그인 벽 껍데기만 주고, Googlebot UA 에는 서버 렌더 JSON(`video_versions`)을 준다
  - 페이지에 답글 · 다른 글 미디어가 섞여 있어 정규식 첫 매치 대신 JSON 을 파싱해 `code === <글 코드>` 객체의 영상(캐러셀이면 첫 영상)을 고른다
  - `fetch` 액션에서 Threads URL 이면 mp4 로 바꾼 뒤 기존 직접 다운로드 + trim 경로 재사용
- **Constraints**: 캐러셀은 첫 영상만. Meta 가 크롤러용 HTML 을 바꾸면 "No video found in that Threads post" 로 실패

## Timeline

### 2026-10-10
**Focus**: Threads 추출 추가 (`resolveThreadsVideo`)
- 원본 URL(쿼리 포함)로 90 초 1280×720 H.264/AAC 9.8 MB 다운로드, 10→15 초 trim 5.0 초 확인. `bun x tsc --noEmit` 통과

**Learned**: 같은 URL 이라도 UA 별로 다른 HTML 을 주는 사이트가 있다 — 링크 미리보기용 UA 로 받으면 영상 정보가 담긴 HTML 이 온다.

## Pending
- [ ] 커밋 (main 에 다른 미커밋 변경이 섞여 있어 이 파일만 따로)
- [ ] 필요하면 `probe` 에 Threads 를 붙여 캐러셀 영상 고르기

## Notes
none
