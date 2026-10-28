"use client";

/**
 * ✎ Edit chat replies, lightly formatted (owner 2026-10-28: "markdown and
 * the important bits should get some HTML"). A tiny, safe subset — no HTML
 * from the model ever reaches the DOM: paragraphs, "- " / "1. " lists,
 * "#" headings, **bold**, `code`, and any "a → b" change turned into a
 * before/after chip so the numbers that moved stand out.
 */

import type { ReactNode } from "react";

// "−20→−12", "0.20 -> 0.25", "+5 → 0", "15→10%" …
const NUM = String.raw`[+\-−]?\d+(?:\.\d+)?%?°?`;
const INLINE = new RegExp(String.raw`(\*\*[^*]+\*\*|\x60[^\x60]+\x60|${NUM}\s*(?:→|->)\s*${NUM})`, "g");
const DELTA = new RegExp(String.raw`^(${NUM})\s*(?:→|->)\s*(${NUM})$`);

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) {
      const inner = part.slice(1, -1);
      const d = inner.match(DELTA);
      return d ? delta(d[1], d[2], key) : <code key={key}>{inner}</code>;
    }
    const d = part.match(DELTA);
    if (d) return delta(d[1], d[2], key);
    return <span key={key}>{part}</span>;
  });
}

function delta(from: string, to: string, key: string) {
  return (
    <span key={key} className="agent-delta">
      <s>{from}</s>
      <span aria-hidden>→</span>
      <b>{to}</b>
    </span>
  );
}

export function AgentText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `li${out.length}-${i}`)}</li>);
    out.push(list.ordered ? <ol key={`l${out.length}`}>{items}</ol> : <ul key={`l${out.length}`}>{items}</ul>);
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      out.push(
        <div key={`h${i}`} className="agent-h">
          {inline(h[1], `h${i}`)}
        </div>,
      );
      return;
    }
    out.push(<p key={`p${i}`}>{inline(line, `p${i}`)}</p>);
  });
  flush();
  return <div className="agent-text">{out}</div>;
}
