"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type ParsedRow = { name: string; email: string; roles: string[] };
type RowResult = { email: string; status: "invited" | "skipped" | "error"; reason?: string };

const VALID_ROLES = new Set(["owner", "compliance", "branch_head", "rm", "back_office", "ops", "marketing", "assistant", "gifting_hr", "sub_broker", "ra_research", "ra_sales", "ria", "insurance"]);

/** Parse "name,email,role" lines (header row auto-skipped). */
function parseCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const cells = line.split(",").map((c) => c.trim());
    // Skip an obvious header row.
    if (i === 0 && /email/i.test(line) && !/@/.test(line)) continue;
    const [name, email, roleRaw] = cells;
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`Line ${i + 1}: missing/invalid email`);
      continue;
    }
    const roles = (roleRaw ? roleRaw.split(/[;|/]/).map((r) => r.trim().toLowerCase()) : ["rm"]).filter(Boolean);
    const bad = roles.find((r) => !VALID_ROLES.has(r));
    if (bad) {
      errors.push(`Line ${i + 1}: unknown role "${bad}"`);
      continue;
    }
    rows.push({ name: name || "", email, roles });
  }
  return { rows, errors };
}

export default function ImportEmployeesPage() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [summary, setSummary] = useState<{ invited: number; skipped: number; errors: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { rows, errors: parseErrors } = parseCsv(text);

  async function submit() {
    if (rows.length === 0) return;
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const res = await fetch("/api/employees/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Import failed (HTTP ${res.status})`);
        return;
      }
      setResults(j.results ?? []);
      setSummary(j.summary ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <Link href="/dashboard/employees" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to employees
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Bulk-invite employees</h1>
      <p className="text-sm text-muted-foreground">
        Paste one employee per line as <code className="text-xs bg-secondary px-1 rounded">name, email, role</code>. Role defaults to RM; use
        multiple roles with <code className="text-xs bg-secondary px-1 rounded">|</code> (e.g. <code className="text-xs bg-secondary px-1 rounded">rm|compliance</code>).
        Each gets a 7-day invite email. Valid roles: owner, branch_head, rm, ops, back_office, compliance, marketing, assistant, gifting_hr, sub_broker, ra_research, ra_sales, ria, insurance.
      </p>

      {!results && (
        <div className="border rounded-lg bg-card p-5 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"Priya Sharma, priya@firm.in, rm\nAmit Rao, amit@firm.in, ops|compliance\nteam@firm.in"}
            className="w-full border rounded-md px-3 py-2 text-sm font-mono bg-background"
          />
          <div className="flex items-center justify-between text-xs">
            <div className="text-muted-foreground">
              {rows.length} valid row{rows.length !== 1 ? "s" : ""}
              {parseErrors.length > 0 && <span className="text-amber-700"> · {parseErrors.length} issue(s)</span>}
            </div>
            <button onClick={submit} disabled={busy || rows.length === 0} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {busy ? "Inviting…" : `Invite ${rows.length || ""}`}
            </button>
          </div>
          {parseErrors.length > 0 && (
            <div className="text-[11px] text-amber-700 bg-amber-50 rounded-md p-2 space-y-0.5">
              {parseErrors.slice(0, 8).map((e, i) => <div key={i}>{e}</div>)}
              {parseErrors.length > 8 && <div>+{parseErrors.length - 8} more…</div>}
            </div>
          )}
          {err && <div className="text-sm text-rose-600">{err}</div>}
        </div>
      )}

      {results && (
        <div className="border rounded-lg bg-card p-5 space-y-3">
          {summary && (
            <div className="flex gap-4 text-sm font-medium">
              <span className="text-emerald-700">{summary.invited} invited</span>
              <span className="text-muted-foreground">{summary.skipped} skipped</span>
              {summary.errors > 0 && <span className="text-rose-600">{summary.errors} errors</span>}
            </div>
          )}
          <div className="divide-y divide-border border rounded-md overflow-hidden">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                {r.status === "invited" ? (
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className={`size-4 shrink-0 ${r.status === "error" ? "text-rose-600" : "text-amber-600"}`} />
                )}
                <span className="flex-1 truncate">{r.email}</span>
                <span className={`text-xs ${r.status === "invited" ? "text-emerald-700" : r.status === "error" ? "text-rose-600" : "text-muted-foreground"}`}>
                  {r.status}{r.reason ? ` — ${r.reason}` : ""}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/employees" className="btn-primary text-sm">Done</Link>
            <button onClick={() => { setResults(null); setSummary(null); setText(""); }} className="btn-secondary text-sm">Import more</button>
          </div>
        </div>
      )}
    </div>
  );
}
