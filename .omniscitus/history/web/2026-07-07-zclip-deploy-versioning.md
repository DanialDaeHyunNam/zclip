# ZCLIP Deploy, Storage & Versioning

**Participants**: dan, claude

## Summary
Making ZCLIP shippable: a local-first deploy model (the public Vercel site is an
about page; the studio is gated to local), a filesystem session store that fixes
localStorage's failure modes, a version-awareness + update-notification system
with a real release process, and install/usage guides. Deployed at
zclip.vercel.app; cut v0.1.0 then v0.1.1.

## Context
- **Background**: ZCLIP spends real money on the user's own keys and its key
  writer/GRAB are dev-only, so a public URL with a working studio is unsafe. Dan
  wanted the hosted site to be an about page that, when you try to "do" anything,
  shows how to run it locally (like all-libertas.vercel.app) — EN/한국어 only.
  Later: sessions kept "disappearing" (the real bite that drove the store), and a
  version/update system modeled on card-news-studio.
- **Requirements**: hosted = about page + local-install guide (mac/Win) as a
  popup; sessions must never silently vanish; a local copy must detect when the
  deploy is newer and prompt an update; guides bilingual, studio English-only;
  keep the design system (black/#6fdcff/JetBrains Mono); do NOT re-add the removed
  studio header/"Make the hook" hero.
- **Decisions**: cloud-vs-local via `process.env.VERCEL==="1"` (+ `ZCLIP_CLOUD`
  override) in `lib/deploy.ts`; `/chat` became a server gate rendering the studio
  locally or the install guide on cloud (heavy studio bundle never ships to a
  cloud visitor). Filesystem store (`.zclip-data/store.json` via dev-only
  `/api/store`) is the source of truth, localStorage a fallback mirror; first
  hydrate per origin merges prior localStorage in ONCE (sessions by id, gallery by
  jobId) then trusts the file — kills both the ~5MB quota loss and the per-port
  (:3000 vs :3001) origin split. Version inlined from package.json via
  next.config → `NEXT_PUBLIC_APP_VERSION`; `/api/version` (CORS, no-store, NOT
  dev-gated); a local copy fetches CANONICAL_URL/api/version and compares
  (isNewerVersion). Act-Two framed as "intentionally limited" (motion referenced,
  identity never cloned) — better positioning + safer legally.
- **Constraints**: the update prompt only fires if every release bumps the
  version (documented as a hard rule); Vercel is NOT git-connected, so main merges
  don't auto-deploy — CLI `vercel --prod` only; first `vercel deploy` auto-promoted
  to production (no preview gate); Vercel PREVIEW deploys are auth-gated (302), so
  headless verification uses production or an isolated port. legal: free/local/BYOK
  keeps operator exposure low but not zero — risk lives in USER behavior (real-
  person deepfakes, unlicensed reference video, ad disclosure); keep README
  disclaimers.

## Timeline

### 2026-07-07
**Focus**: Local-first deploy model, filesystem store, session-loss recovery.
- Cloud detection (`lib/deploy.ts` isCloud) + `/chat` server gate → studio local /
  install guide on cloud; landing CTAs open the guide as an in-place POPUP
  (`InstallModal`). Studio moved to `app/chat/studio.tsx`; `app/page.tsx` split
  into a server shell + `app/landing-client.tsx`.
- Install guide `app/run-local-guide.tsx` — ported the Libertas kit (mac/Win
  toggle, terminal/browser/key mocks, "runs on your machine" trust diagram,
  numbered steps) recolored to ZCLIP tokens; bilingual via `lib/i18n.tsx`
  (EN/한국어 LangProvider, PUBLIC pages only) at `/install` + the gate.
- Modal design fix: sticky header bled over the hero → flex-column card with a
  fixed head + internally-scrolling body.
- `tee` → `t-shirt` across cast/wardrobe labels + prompt fragments (`lib/prompts`).
- **Session-loss diagnosis**: sessions vanished due to (1) per-port localStorage
  split (:3001 vs :3000) and (2) uncaught 5MB quota on big base64-carrying
  sessions. Recovered :3001's sessions via a bridge page + a worktree studio.
- **Filesystem store** (`lib/store.ts` + dev-only `/api/store` atomic writes):
  swapped all studio `localStorage.*` for `store.*`, gated save effects on a
  `hydrated` flag so empty initial state can't clobber the file. Verified
  end-to-end headlessly (studio hydrates a file-written session; survives reload;
  merge-not-clobber).
- README + new `docs/ARCHITECTURE.md` (contributor deep-dive) + `.vercelignore`.

### 2026-07-08
**Focus**: Version awareness + release system, usage guide, cut v0.1.0 & v0.1.1.
- Version plumbing: package.json version → next.config inline → `lib/version.ts`
  (VERSION, CANONICAL_URL=zclip.vercel.app, isNewerVersion, RELEASES_URL) +
  `lib/use-version.ts` (useHosted, useUpdateCheck) + `/api/version` +
  `data-hosted` stamp in layout.
- UI: rail version chip (→⬆ pulse on update), "update available" banner +
  `UpdateGuide` modal (AI-CLI + `git pull` manual), landing nav + footer version
  chips (footer rebuilt Card News-style: brand / project / follow + version bar).
- Usage guide (c = both): in-app `?` help (`help-guide.tsx`) + install-guide
  "What you can do" section, shared bilingual content `app/how-to.tsx` with a
  `**bold**` highlight parser; a `WorkflowDemo` CSS/JS animation (clicks
  Character→Background→Fashion, types, sends, renders, lands a real cast face).
- Documented the release process (bump→CHANGELOG→commit→tag→gh release→redeploy)
  in ARCHITECTURE/README/CLAUDE.md; created CHANGELOG.md.
- Cut **v0.1.0** then **v0.1.1** (workflow anim + highlights): tag + GitHub release
  + prod deploy each. Verified the update flow live — an isolated v0.0.1 instance
  detected prod v0.1.1 → banner + rail ⬆.

**Learned**: `data-hosted`/`isCloud` unify hosted detection across the deploy gate,
the update check, and the footer; a server/client split on `/chat` keeps the
studio bundle off cloud visitors; the "sessions vanish" bug was localStorage's two
inherent limits, not a code regression — a filesystem store is the right fit for a
LOCAL tool; the release-must-bump rule is the load-bearing convention (documented
everywhere) or the update prompt is inert.

### 2026-07-08 (install-guide polish + an 8-release cadence — v0.1.2→v0.1.9)
**Focus**: Install/usage guide UX and a burst of small user-facing releases.
- Install guide **paginated into 3 sequential steps** (What you can do →
  Nothing runs on our servers → Install guide) with a tabbed stepper + Back/Next
  + progress dots, instead of one long scroll — done in the shared `GuideBody`,
  so `/install`, the `/chat` gate, AND the landing `InstallModal` all inherit it.
- Dropped the redundant hero (title + lead) from the guide — it opens straight to
  the pager (the landing already sets that context); removed the modal's
  redundant Star/Close footer row (the ✕ in its head already closes it).
- **Language-toggle scope decision**: asked whether to add a studio globe →
  owner chose English-only, so no toggle (a half-translated studio reads worse).
- Cut **v0.1.2 → v0.1.9** (8 releases) each via the documented flow
  (bump → CHANGELOG → commit → tag → `gh release` → `vercel --prod`), verifying
  prod `/api/version` after every one; the release-must-bump rule held.

**Learned**: paginating the ONE shared `GuideBody` fixed the long-scroll across
all three render surfaces at once — the payoff of a single source; a rapid
review-driven release burst stays clean when each bump is a small, verified,
single-concern change with its own CHANGELOG stanza.

### 2026-07-09 (transparent star request in the install prompt — v0.2.1)
**Focus**: A friendly GitHub-star ask baked into the copy-paste CLI install prompt.
- Owner floated sneaking a "go star the repo" instruction into the AI-CLI install
  prompt. Pushed back: a HIDDEN instruction in text the user pastes at full trust
  into their own agent is effectively prompt injection — it hijacks their agent for
  an unrequested action, contradicts ZCLIP's "nothing runs on our servers /
  transparent / open-source" brand, and auto-starring games the count. Landed on the
  transparent version instead.
- Appended to `cliPrompt` (EN + 한국어) in `app/run-local-guide.tsx`: once the app
  is running, the agent RELAYS a "if you like this project, please consider a ⭐ on
  GitHub — <repo>" note to the user. Surfaced at success time, decision stays with
  the user; never an automatic click. One edit covers `/install`, the `/chat` gate,
  and the landing InstallModal (shared `GuideBody`).
- Cut **v0.2.1** via the documented flow (bump 0.2.0→0.2.1 → CHANGELOG → commit →
  tag `v0.2.1` → `gh release` → `vercel --prod`). Verified live: `/api/version` →
  `{"version":"0.2.1"}`; EN + KO star copy present in the deployed JS chunk
  (`run-local-guide` is a client component, so the copy lives in the bundle, not the
  initial SSR HTML — and the CLI prompt sits on step 3 of the paginated stepper).

**Learned**: the copy-paste install prompt sits ON the user's trust boundary — text
they hand their agent at full permission — so a growth ask there must be transparent
(agent relays it, user decides), never a covert instruction; verifying client-only
copy means grepping the deployed JS chunk, not the SSR HTML (curl of the page shows
neither the prompt nor the emoji even on a healthy deploy).

## Pending
- [x] "How to use?" entry point in the empty session's center (rail `?` stays).
- [x] Session thread: max-height + internal scroll + always start at bottom (most recent).
- [x] Pickers: confirm real asset images render (they do); real demo video now on
      the workflow demo (studio render frame left blank by owner's request).
- [x] Library intro (chip or page): generated takes pile in / URL-grab / uploads.
- [ ] Sora input_reference res-match untested live (normalizeRefB64 cover-crop
      mitigates; unconfirmed against a real Sora call). Seedance half is DONE —
      adapter verified by real runs 2026-07-09+ ([[zclip-seedance-provider]]).
- [x] Direct upload INTO the Library needs a server persist endpoint — BUILT as
      `app/api/clips` POST multipart (dev-only) with the v0.6.0 transfer flow.

## Notes
Deployed: https://zclip.vercel.app · releases: github.com/DanialDaeHyunNam/zclip/releases.
A self-contained handoff prompt for the 4 Pending items was handed to Dan for a
fresh `/clear` session. Related: [[zclip-chat-studio]] (studio chrome + store swap),
[[zclip-landing-demo]] (landing footer/nav + install guide).
