# Starter card images

Drop a `<asset-id>.jpg` here and the matching starter card shows it
automatically (cards fall back to text-only when the file is missing).

Built-in ids — characters: `blonde` `korean` `freckles` `redhead` `guy`
`mom` · settings: `bedroom` `cafe` `car` `kitchen` `desk` `dorm`
(source of truth: `lib/prompts.ts`).

Two ways to fill this folder:

1. **Bake with AI** (uses your GEMINI_API_KEY, ~$0.04/image):
   `bun scripts/bake-starters.mjs`
2. **Bring your own** — any JPG works; 4:3-ish crops look best on the
   cards.

Custom assets added in the UI store their image in the browser
(localStorage), not here — this folder is only for the built-ins.
