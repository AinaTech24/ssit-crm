"use client";

/**
 * Small dependency-free Markdown renderer for AI assistant replies. Handles the
 * subset the assistant emits: headings, bold/italic/inline-code, links
 * (internal → next/link so redirection works in-app), unordered/ordered lists,
 * and GitHub-flavored tables. Not a general Markdown engine — intentionally tiny.
 */

import React from "react";
import Link from "next/link";
import { SSITChart, type ChartSpec } from "@/components/ai/SSITChart";

let keySeq = 0;
const k = () => `md-${keySeq++}`;

/** Inline: **bold**, *italic*, `code`, [text](href). */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<strong key={k()}>{m[2]}</strong>);
    else if (m[3]) nodes.push(<code key={k()} className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">{m[4]}</code>);
    else if (m[5]) nodes.push(<em key={k()}>{m[6]}</em>);
    else if (m[7]) {
      const label = m[8];
      const href = m[9];
      const internal = href.startsWith("/");
      nodes.push(
        internal ? (
          <Link key={k()} href={href} className="text-brand-cyan-deep font-medium hover:underline">
            {label}
          </Link>
        ) : (
          <a key={k()} href={href} target="_blank" rel="noreferrer" className="text-brand-cyan-deep font-medium hover:underline">
            {label}
          </a>
        )
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}
// Static classes so Tailwind's purge keeps them (no dynamic `text-${x}`).
const alignCls = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
const isTableSep = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

export function Markdown({ text }: { text: string }) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line → skip.
    if (!line.trim()) { i++; continue; }

    // Fenced block: ```ssit-chart → SVG chart; any other ``` → code block.
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      const info = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      if (i < lines.length) i++; // consume closing ```
      if (info === "ssit-chart") {
        try {
          const spec = JSON.parse(body.join("\n")) as ChartSpec;
          blocks.push(<SSITChart key={k()} spec={spec} />);
        } catch { /* malformed chart → skip silently */ }
      } else {
        blocks.push(
          <pre key={k()} className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-[0.8em] font-mono scrollbar-none">
            <code>{body.join("\n")}</code>
          </pre>
        );
      }
      continue;
    }

    // Table: header row + separator + body.
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={k()} className="my-2 overflow-x-auto scrollbar-none">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                {header.map((h, ci) => (
                  <th key={ci} className={`py-1.5 px-3 font-semibold whitespace-nowrap ${alignCls(aligns[ci])}`}>
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {r.map((c, ci) => (
                    <td key={ci} className={`py-1.5 px-3 tabular-nums ${alignCls(aligns[ci])}`}>
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Heading.
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl <= 1 ? "text-lg font-bold mt-3 mb-1" : lvl === 2 ? "text-base font-bold mt-3 mb-1" : "text-sm font-semibold mt-2 mb-1";
      blocks.push(<div key={k()} className={cls}>{renderInline(h[2])}</div>);
      i++;
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(<li key={k()}>{renderInline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ul key={k()} className="list-disc pl-5 my-1.5 space-y-0.5">{items}</ul>);
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(<li key={k()}>{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ol key={k()} className="list-decimal pl-5 my-1.5 space-y-0.5">{items}</ol>);
      continue;
    }

    // Paragraph (gather consecutive non-blank, non-special lines).
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("|") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k()} className="my-1.5 leading-relaxed">
        {para.map((p, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(p)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="text-sm text-foreground/90">{blocks}</div>;
}
