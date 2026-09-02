"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Download, Pencil, Loader2, BarChart3, AlertCircle, Copy, Mail, Printer, FileSpreadsheet, FileText, ChevronDown, Send } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

// Recharts is heavy + not tree-shakeable; load it only when a report actually
// has a chart, not on every report view.
const ReportChart = dynamic(() => import("@/components/reports/ReportChart"), {
  ssr: false,
  loading: () => <div className="skeleton h-72 w-full rounded-xl" />,
});

type Detailed = { kind: "detailed"; columns: { key: string; label: string; type: string }[]; rows: Record<string, unknown>[] };
type Matrix = { kind: "matrix"; groupByLabel: string; colLabels: string[]; rows: { key: string; cells: number[]; total: number }[]; grandTotal: number; aggregate: string };
type SummaryNode = { key: string; count: number; aggregates: number[]; children?: SummaryNode[]; rows?: Record<string, unknown>[] };
type Summary = {
  kind: "summary";
  groupLabels: string[];
  aggregateDefs: { key: string; label: string; fn: string; type: string }[];
  detailColumns: { key: string; label: string; type: string }[];
  showDetailRows: boolean;
  tree: SummaryNode[];
  grand: { count: number; aggregates: number[] };
};
type RunResult = Detailed | Matrix | Summary;

function fmt(v: unknown, type?: string): string {
  if (v == null || v === "") return "—";
  if (type === "currency" || type === "number" || type === "integer") {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString("en-IN");
  }
  if (v instanceof Date) return new Date(v).toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}
const num = (v: number) => Number(v).toLocaleString("en-IN");

export default function ReportViewPage() {
  const id = (useParams() as { id: string }).id;
  const router = useRouter();
  const [meta, setMeta] = useState<{ name: string; description?: string; reportType: string; chartType?: string; isMine?: boolean } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [m, run] = await Promise.all([
          fetch(`/api/reports/saved/${id}`).then((r) => r.json()),
          fetch(`/api/reports/saved/${id}/run?limit=500`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        ]);
        setMeta({ name: m.name, description: m.description, reportType: m.reportType, chartType: m.chartType });
        if (!run.ok) setErr(run.body?.error ?? "Failed to run report");
        else setResult(run.body.result);
      } catch (e: any) {
        setErr(e.message ?? "Failed to load report");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function clone() {
    const r = await fetch(`/api/reports/saved/${id}/clone`, { method: "POST" });
    const j = await r.json();
    if (r.ok && j.id) router.push(`/dashboard/reports/custom/new?edit=${j.id}`);
    else alert(j.error ?? "Clone failed");
  }

  return (
    <div className="space-y-4 max-w-6xl print:max-w-none">
      <div className="print:hidden">
        <Link href="/dashboard/reports/custom" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ChevronLeft className="size-4" /> Back to custom reports
        </Link>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <BarChart3 className="size-6 text-brand-cyan print:hidden" /> {meta?.name ?? "Report"}
          </h1>
          {meta?.description && <p className="page-subtitle">{meta.description}</p>}
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href={`/dashboard/reports/custom/new?edit=${id}`} className="btn-secondary text-xs"><Pencil className="size-3.5" /> Edit</Link>
          <button onClick={clone} className="btn-secondary text-xs"><Copy className="size-3.5" /> Clone</button>
          <SendMenu id={id} />
          <ExportMenu id={id} />
        </div>
      </div>

      {!loading && !err && result?.kind === "matrix" && meta?.chartType && meta.chartType !== "none" && (
        <div className="card-surface p-5">
          <ReportChart chartType={meta.chartType as any} matrix={result} />
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {loading ? (
          <div className="p-12 grid place-items-center text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
        ) : err ? (
          <div className="p-8 text-center text-sm text-rose-600 flex flex-col items-center gap-2">
            <AlertCircle className="size-6" /> {err}
          </div>
        ) : result?.kind === "detailed" ? (
          <DetailedTable r={result} />
        ) : result?.kind === "matrix" ? (
          <MatrixTable r={result} />
        ) : result?.kind === "summary" ? (
          <SummaryTable r={result} />
        ) : (
          <div className="p-12 text-center text-sm text-muted-foreground">No data.</div>
        )}
      </div>
      {result?.kind === "detailed" && (
        <p className="text-xs text-muted-foreground print:hidden">{result.rows.length} row{result.rows.length === 1 ? "" : "s"} (first 500).</p>
      )}
    </div>
  );
}

function ExportMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-primary text-xs"><Download className="size-4" /> Export <ChevronDown className="size-3.5" /></button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-20 py-1 text-sm">
          <DownloadButton url={`/api/reports/saved/${id}/export?format=xlsx`} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-secondary/50"><FileSpreadsheet className="size-4 text-emerald-600" /> Excel (.xlsx)</DownloadButton>
          <DownloadButton url={`/api/reports/saved/${id}/export?format=csv`} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-secondary/50"><FileText className="size-4 text-sky-600" /> CSV (.csv)</DownloadButton>
          <button onClick={() => { setOpen(false); window.print(); }} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-secondary/50"><Printer className="size-4 text-muted-foreground" /> Print / PDF</button>
        </div>
      )}
    </div>
  );
}

function SendMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  async function send() {
    setBusy(true); setMsg(null);
    try {
      const list = emails.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await fetch(`/api/reports/saved/${id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(list.length ? { emails: list } : {}),
      });
      const j = await r.json();
      setMsg(r.ok ? `Sent to ${j.sent} recipient${j.sent === 1 ? "" : "s"}.` : j.error ?? "Send failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary text-xs"><Mail className="size-3.5" /> Email</button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg z-20 p-3 space-y-2 text-sm">
          <div className="text-xs text-muted-foreground">Email this report now. Leave blank to use the saved schedule recipients.</div>
          <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="rm@firm.com, owner@firm.com" className="input-base text-xs" />
          <button onClick={send} disabled={busy} className="btn-primary text-xs w-full justify-center">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send now
          </button>
          {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
        </div>
      )}
    </div>
  );
}

function DetailedTable({ r }: { r: Detailed }) {
  if (r.rows.length === 0) return <div className="p-12 text-center text-sm text-muted-foreground">No rows match this report's filters.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
          <tr>{r.columns.map((c) => <th key={c.key} className="text-left px-3 py-2 font-medium whitespace-nowrap">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
              {r.columns.map((c) => <td key={c.key} className="px-3 py-2 whitespace-nowrap">{fmt(row[c.key], c.type)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixTable({ r }: { r: Matrix }) {
  if (r.rows.length === 0) return <div className="p-12 text-center text-sm text-muted-foreground">No rows match this report's filters.</div>;
  const colTotals = r.colLabels.map((_, ci) => r.rows.reduce((s, row) => s + (row.cells[ci] ?? 0), 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
          <tr>
            <th className="text-left px-3 py-2 font-medium">{r.groupByLabel}</th>
            {r.colLabels.map((c) => <th key={c} className="text-right px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}
            <th className="text-right px-3 py-2 font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
              <td className="px-3 py-2 font-medium whitespace-nowrap">{row.key}</td>
              {row.cells.map((v, ci) => <td key={ci} className="px-3 py-2 text-right tabular-nums">{num(v)}</td>)}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(row.total)}</td>
            </tr>
          ))}
          <tr className="bg-secondary/40 font-semibold">
            <td className="px-3 py-2">Total</td>
            {colTotals.map((v, ci) => <td key={ci} className="px-3 py-2 text-right tabular-nums">{num(v)}</td>)}
            <td className="px-3 py-2 text-right tabular-nums">{num(r.grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Summary report: nested groups with sub-totals, optional detail rows, grand total. */
function SummaryTable({ r }: { r: Summary }) {
  if (r.tree.length === 0) return <div className="p-12 text-center text-sm text-muted-foreground">No rows match this report's filters.</div>;
  const aggCols = r.aggregateDefs;
  const span = 1 + 1 + aggCols.length;
  const renderNode = (node: SummaryNode, depth: number, path: string): React.ReactNode[] => {
    const isLeaf = !node.children?.length;
    const out: React.ReactNode[] = [];
    out.push(
      <tr key={`g-${path}`} className={`border-b ${depth === 0 ? "bg-secondary/40 font-semibold" : "bg-secondary/20 font-medium"}`}>
        <td className="px-3 py-2 whitespace-nowrap" style={{ paddingLeft: 12 + depth * 18 }}>
          {node.key} <span className="text-[10px] font-normal text-muted-foreground">· {num(node.count)} rec</span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">{num(node.count)}</td>
        {node.aggregates.map((v, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{num(v)}</td>)}
      </tr>
    );
    if (node.children?.length) {
      node.children.forEach((c, i) => out.push(...renderNode(c, depth + 1, `${path}-${i}`)));
    } else if (r.showDetailRows && node.rows?.length) {
      out.push(
        <tr key={`d-${path}`} className="border-b">
          <td colSpan={span} className="px-0 py-0">
            <div className="overflow-x-auto bg-card" style={{ paddingLeft: 12 + (depth + 1) * 18 }}>
              <table className="w-full text-xs">
                <thead className="text-[11px] text-muted-foreground">
                  <tr>{r.detailColumns.map((c) => <th key={c.key} className="text-left px-3 py-1.5 font-medium whitespace-nowrap">{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {node.rows!.map((row, ri) => (
                    <tr key={ri} className="hover:bg-secondary/30">
                      {r.detailColumns.map((c) => <td key={c.key} className="px-3 py-1 whitespace-nowrap">{fmt(row[c.key], c.type)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      );
    }
    return out;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
          <tr>
            <th className="text-left px-3 py-2 font-medium">{r.groupLabels.join(" › ")}</th>
            <th className="text-right px-3 py-2 font-medium">Records</th>
            {aggCols.map((a) => <th key={a.key} className="text-right px-3 py-2 font-medium whitespace-nowrap">{a.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {r.tree.map((root, i) => renderNode(root, 0, String(i)))}
          <tr className="bg-brand-navy/5 font-bold border-t-2">
            <td className="px-3 py-2">Grand Total</td>
            <td className="px-3 py-2 text-right tabular-nums">{num(r.grand.count)}</td>
            {r.grand.aggregates.map((v, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{num(v)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
