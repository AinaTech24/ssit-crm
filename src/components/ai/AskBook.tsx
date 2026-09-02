"use client";

/**
 * "Ask your book" — hero card for the AI Assistant page. The advisor types a
 * natural-language question about their client book; the server turns it into
 * a Zod-validated FilterAST (never SQL) and runs it through the segment
 * compiler. We show the matches + the exact filter used, for transparency.
 */

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Search } from "lucide-react";

type Row = {
  id: string;
  name: string | null;
  aum: string | number | null;
  active_sip_amount: string | number | null;
  status: string | null;
  city: string | null;
};

type AskResult = {
  question: string;
  explanation: string;
  ast: unknown;
  count: number;
  rows: Row[];
};

const EXAMPLES = [
  "Clients with SIPs over ₹10,000",
  "Who hasn't invested in 2 years?",
  "HNI clients in Mumbai",
];

const inr = (n: unknown) =>
  n == null || n === "" ? "—" : "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

const STATUS_TONE: Record<string, string> = {
  active: "text-emerald-700 bg-emerald-500/10",
  dormant: "text-amber-700 bg-amber-500/10",
  exited: "text-rose-700 bg-rose-500/10",
};

export function AskBook() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/ask-book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(null);
        setError(j.error ?? "Couldn't answer that — please try again.");
      } else {
        setResult({ question: q, explanation: j.explanation, ast: j.ast, count: j.count, rows: j.rows ?? [] });
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-brand-cyan" />
        <h2 className="text-sm font-semibold">Ask your book</h2>
        <span className="text-[11px] text-muted-foreground">— live answers from your client base</span>
      </div>

      <div className="flex gap-2 mt-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder="Ask anything about your client book…"
          className="flex-1 border rounded-md px-3 py-2.5 text-sm bg-background"
        />
        <button
          onClick={ask}
          disabled={busy || !question.trim()}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Ask
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {EXAMPLES.map((s) => (
          <button
            key={s}
            onClick={() => setQuestion(s)}
            disabled={busy}
            className="text-[11px] rounded-full border px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {busy && (
        <div className="mt-4 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" /> Reading your book…
        </div>
      )}

      {error && !busy && <div className="mt-4 text-sm text-rose-600">⚠ {error}</div>}

      {result && !busy && (
        <div className="mt-4 border-t pt-4">
          <div className="text-xs text-muted-foreground italic">&ldquo;{result.question}&rdquo;</div>
          <div className="text-sm mt-1">
            {result.explanation}{" "}
            <span className="font-semibold tabular-nums">
              {result.count.toLocaleString("en-IN")} {result.count === 1 ? "match" : "matches"}
            </span>
            {result.count > result.rows.length && (
              <span className="text-xs text-muted-foreground"> · showing first {result.rows.length}</span>
            )}
          </div>

          {result.rows.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-1.5 pr-3 font-medium">Name</th>
                    <th className="py-1.5 pr-3 font-medium">City</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium text-right">AUM</th>
                    <th className="py-1.5 font-medium text-right">Active SIP</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-accent/30">
                      <td className="py-1.5 pr-3">
                        <Link href={`/dashboard/investors/${r.id}`} className="font-medium text-brand-cyan-deep hover:underline">
                          {r.name ?? "—"}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{r.city ?? "—"}</td>
                      <td className="py-1.5 pr-3">
                        {r.status ? (
                          <span className={`text-[11px] rounded-full px-2 py-0.5 ${STATUS_TONE[r.status] ?? "text-muted-foreground bg-muted"}`}>
                            {r.status}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{inr(r.aum)}</td>
                      <td className="py-1.5 text-right tabular-nums">{inr(r.active_sip_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.rows.length === 0 && (
            <div className="mt-3 text-sm text-muted-foreground">No clients match that filter.</div>
          )}

          {/* Transparency builds trust — show exactly how the question was filtered. */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">How I filtered</summary>
            <pre className="mt-2 text-[11px] leading-relaxed border rounded-md bg-muted/40 p-3 overflow-auto max-h-64 scrollbar-thin">
              {JSON.stringify(result.ast, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
