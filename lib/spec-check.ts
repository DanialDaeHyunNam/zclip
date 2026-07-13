import {
  GATES,
  MODEL_PROFILES,
  SELF_CHECKS,
  type SpecGate,
} from "@/lib/video-prompt-spec";

/**
 * Client/server-shared pieces of the Video Prompt Spec Gate.
 * The RULES live in lib/video-prompt-spec.ts (versioned mirror of the mono
 * skill); this file is app plumbing — request/response shapes for
 * /api/spec-check and the mechanical SELF_CHECKS that annotate the preview
 * card. Kept separate so the spec mirror stays a pure data port.
 */

/** One resolved gate: the user's answer to a GATES question. */
export interface SpecAnswer {
  id: string;
  answer: string;
}

/** /api/spec-check mode:"check" response. */
export interface SpecVerdict {
  /** Critical gate ids still unresolved, in priority order. */
  missing: string[];
  /** One-line note about non-critical defaults applied ("" if none). */
  note: string;
  /** Provider-fit problems per MODEL_PROFILES (duration over cap, formats
   *  the selected provider is known to break on). Empty if none. */
  warnings: string[];
}

/** Resolve a gate id against the shared GATES plus the selected provider's
 *  profile extraGates (per-model adaptation). */
export function gateForProvider(
  id: string,
  provider: string,
): SpecGate | undefined {
  return (
    GATES.find((g) => g.id === id) ??
    MODEL_PROFILES[provider]?.extraGates?.find((g) => g.id === id)
  );
}

/** Quick-reply options for a gate, clamped to the provider's duration cap —
 *  an option advertising "TikTok 15s" is misleading on an 8s-capped model. */
export function gateOptions(gate: SpecGate, provider: string): string[] {
  const max = MODEL_PROFILES[provider]?.maxSeconds;
  if (!max) return gate.options;
  return gate.options.filter((o) => {
    const m = o.match(/(\d+)\s*s\b/i);
    return !m || Number(m[1]) <= max;
  });
}

export interface SelfCheckResult {
  label: string;
  pass: boolean;
  /** Short evidence line, e.g. "34 words / budget 20". */
  detail?: string;
}

/** Words inside straight or curly double quotes = spoken dialogue. */
const quotedWords = (prompt: string): number => {
  const matches = prompt.match(/"([^"]+)"|“([^”]+)”/g) ?? [];
  return matches.reduce(
    (n, q) => n + q.replace(/["“”]/g, "").trim().split(/\s+/).filter(Boolean).length,
    0,
  );
};

/**
 * Mechanical string checks on an ASSEMBLED spec prompt — heuristic
 * annotations for the preview card, not a hard gate (the user can always
 * generate anyway). Mirrors SELF_CHECKS in lib/video-prompt-spec.ts:
 * string-checkable ones are evaluated, the rest lean on keyword presence.
 */
export function runSelfChecks(
  prompt: string,
  seconds: number,
): SelfCheckResult[] {
  const p = prompt.toLowerCase();
  const results: SelfCheckResult[] = [];

  // 1 — bans present (a spec prompt names each ban explicitly, so keyword
  // presence ≈ ban present).
  const bans = ["subtitle", "split", "storyboard"].filter((k) => !p.includes(k));
  const gearBan = /(camera|gear|equipment|crew)/.test(p);
  results.push({
    label: SELF_CHECKS[0],
    pass: bans.length === 0 && gearBan,
    detail: bans.length ? `no mention of: ${bans.join(", ")}` : undefined,
  });

  // 2 — dialogue budget: ≤2.5 words/sec of runtime.
  const words = quotedWords(prompt);
  const budget = Math.floor(seconds * 2.5);
  results.push({
    label: SELF_CHECKS[1],
    pass: words <= budget,
    detail: `${words} quoted words / budget ${budget} (${seconds}s)`,
  });

  // 3 — fragile-state double lock.
  const lockA = /first frame to (the )?last/.test(p);
  const lockB = /no cut/.test(p);
  results.push({
    label: SELF_CHECKS[2],
    pass: lockA && lockB,
    detail: !lockA
      ? 'missing "from first frame to last"'
      : !lockB
        ? 'missing "in no cut"'
        : undefined,
  });

  // 4 — ending hold. "Camera lingers …" is a valid hold variant (CHASE
  // reference: subject exits, camera stays on the vanity half a beat).
  results.push({
    label: SELF_CHECKS[3],
    pass: /do not end abruptly|hold(s|ing)? (the |this |her |his |final )?(pose|frame|position|expression)|linger(s|ing)?\b/.test(p),
  });

  // 5 — NOT a bare screenplay: fail when most non-empty lines are
  // "NAME: line" script rows (that format makes some models burn subtitles).
  const lines = prompt.split("\n").filter((l) => l.trim());
  const scriptLines = lines.filter((l) =>
    /^[A-Z][A-Za-z .]{0,24}:\s*["“]?/.test(l.trim()),
  ).length;
  results.push({
    label: SELF_CHECKS[4],
    pass: lines.length === 0 || scriptLines / lines.length < 0.5,
    detail: `${scriptLines}/${lines.length} script-format lines`,
  });

  // 6 — named character canon lock.
  results.push({
    label: SELF_CHECKS[5],
    pass: /identity drift|same [a-z]+.{0,40}(cut|frame|throughout|scene)/.test(p),
  });

  return results;
}
