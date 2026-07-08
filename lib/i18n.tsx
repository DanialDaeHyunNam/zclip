"use client";

/**
 * Minimal EN/KO i18n for ZCLIP's PUBLIC pages only (landing + local-install
 * guide). The studio (/chat) is intentionally English-only — see
 * docs/ARCHITECTURE.md § Internationalization.
 *
 * Not a framework: no URL locale, no middleware. A React context holds the
 * chosen language, persists it to localStorage, and mirrors it onto
 * <html lang>. Each page keeps its own `{ en, ko }` copy object and reads
 * `copy[lang]` — translations live next to the markup that uses them.
 *
 * Hydration: we ALWAYS render `en` on the server and on first client paint
 * (matching layout's <html lang="en">), then adopt the stored / browser
 * language in an effect. That's a post-mount state update, not a mismatch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "ko";
export const LANGS: Lang[] = ["en", "ko"];
const LABELS: Record<Lang, string> = { en: "EN", ko: "한국어" };
const STORAGE_KEY = "zclip.lang";

type LangCtx = { lang: Lang; setLang: (l: Lang) => void };
const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Adopt the persisted choice, or fall back to the browser's language,
  // once on mount (never during SSR — keeps first paint === server output).
  useEffect(() => {
    let next: Lang | null = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "ko") next = stored;
    } catch {
      /* private mode / disabled storage — fine, keep default */
    }
    if (!next && typeof navigator !== "undefined" && navigator.language?.startsWith("ko")) {
      next = "ko";
    }
    if (next && next !== "en") setLangState(next);
  }, []);

  // Keep <html lang> honest for a11y / SEO whenever the choice changes.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}

/** Segmented EN · 한국어 switch. Styled by `.lang-seg` in globals.css. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`lang-seg ${className}`} role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={lang === l ? "on" : ""}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
