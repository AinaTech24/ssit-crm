"use client";

/**
 * Scheme Master catalog — the interactive surface that activates our (until
 * now UI-less) scheme model: browse, manually add/edit, inline shortlist
 * toggle, bulk IC shortlist, and the 11-criteria evaluation scorecard.
 *
 * Wires the existing APIs:
 *   POST  /api/schemes                      (create)
 *   PATCH /api/schemes/[id]                 (edit metadata)
 *   POST  /api/scheme-shortlist             (single toggle)
 *   PATCH /api/scheme-shortlist             (bulk)
 *   PUT   /api/schemes/[id]/evaluation      (IC scorecard)
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Star, X, Plus, Pencil, ClipboardList, Save } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { SchemeAutocomplete, type SchemePick } from "@/components/mf/SchemeAutocomplete";

const COARSE = [
  ["equity", "Equity"], ["hybrid", "Hybrid"], ["debt", "Debt"], ["liquid", "Liquid"],
  ["commodity", "Commodity"], ["international", "International"], ["other", "Other"],
] as const;
const cap = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// Option lists for the custom dropdowns (value + themed label).
const PLAN_OPTS = [{ value: "", label: "—" }, ...["regular", "direct"].map((v) => ({ value: v, label: cap(v) }))];
const OPTION_OPTS = [{ value: "", label: "—" }, ...["growth", "idcw_payout", "idcw_reinvest"].map((v) => ({ value: v, label: cap(v) }))];
const RISK_OPTS = [{ value: "", label: "—" }, ...["very_low", "low", "moderate", "high", "very_high"].map((v) => ({ value: v, label: cap(v) }))];
const SCHEME_RISK_OPTS = [{ value: "", label: "—" }, ...["low", "moderate", "high", "very_high"].map((v) => ({ value: v, label: cap(v) }))];
const COARSE_OPTS = [{ value: "", label: "—" }, ...COARSE.map(([k, l]) => ({ value: k, label: l }))];

/** Plan / Option columns are usually empty in the AMFI feed, but the scheme
 *  name reliably encodes them (e.g. "… Direct Plan - Growth"). Derive as a
 *  display fallback so the detail panel isn't blank. */
function derivePlan(s: any): string {
  if (s?.plan) return String(s.plan);
  const n = String(s?.scheme_name ?? "");
  if (/\bdirect\b/i.test(n)) return "Direct";
  if (/\bregular\b/i.test(n)) return "Regular";
  return "";
}
function deriveOption(s: any): string {
  if (s?.option) return String(s.option).replace(/_/g, " ");
  const n = String(s?.scheme_name ?? "");
  if (/reinvest/i.test(n)) return "IDCW Reinvest";
  if (/\bgrowth\b/i.test(n)) return "Growth";
  if (/idcw|dividend|payout/i.test(n)) return "IDCW Payout";
  return "";
}
const COARSE_TONE: Record<string, string> = {
  equity: "bg-emerald-50 text-emerald-700", hybrid: "bg-blue-50 text-blue-700", debt: "bg-amber-50 text-amber-700",
  liquid: "bg-cyan-50 text-cyan-700", commodity: "bg-orange-50 text-orange-700", international: "bg-violet-50 text-violet-700", other: "bg-slate-50 text-slate-600",
};
const VERDICT_TONE: Record<string, string> = { pass: "bg-emerald-100 text-emerald-700", watch: "bg-amber-100 text-amber-700", reject: "bg-rose-100 text-rose-700" };

type Scheme = Record<string, any>;

export function SchemesCatalog({ rows, amcs, canManage }: { rows: Scheme[]; amcs: Array<{ code: string; name: string }>; canManage: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCoarse, setBulkCoarse] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edit, setEdit] = useState<{ mode: "new" | "edit"; scheme: Scheme | null } | null>(null);
  const [evalFor, setEvalFor] = useState<Scheme | null>(null);
  const [detail, setDetail] = useState<Scheme | null>(null);

  const allSel = rows.length > 0 && selected.size === rows.length;
  function toggle(id: string) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  async function toggleShortlist(s: Scheme) {
    setRowBusy(s.id);
    try {
      const res = await fetch("/api/scheme-shortlist", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemeId: s.id, isShortlisted: !s.is_shortlisted, coarseCategory: s.coarse_category ?? undefined }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Failed"); return; }
      router.refresh();
    } finally { setRowBusy(null); }
  }

  async function runBulk(isShortlisted: boolean) {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/scheme-shortlist", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemeIds: [...selected], isShortlisted, coarseCategory: bulkCoarse || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { alert(j.error ?? "Bulk failed"); return; }
      setSelected(new Set()); setBulkOpen(false); router.refresh();
    } finally { setBulkBusy(false); }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {selected.size > 0 ? (
              <>
                <span className="text-sm font-semibold">{selected.size} selected</span>
                <button onClick={() => setBulkOpen((o) => !o)} className="btn-ghost text-xs"><Star className="size-3.5" /> Bulk shortlist</button>
                <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">Clear</button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Select rows for a bulk IC shortlist update.</span>
            )}
          </div>
          <button onClick={() => setEdit({ mode: "new", scheme: null })} className="btn-primary text-sm"><Plus className="size-4" /> New scheme</button>
        </div>
      )}

      {bulkOpen && selected.size > 0 && (
        <div className="card-surface p-3 flex items-center gap-3 flex-wrap text-sm bg-secondary/30">
          <span className="text-xs font-semibold">Apply to {selected.size}:</span>
          <Select size="sm" value={bulkCoarse} onChange={setBulkCoarse} options={COARSE_OPTS} placeholder="— coarse category (optional) —" ariaLabel="Coarse category" className="w-56" />
          <button onClick={() => runBulk(true)} disabled={bulkBusy} className="btn-primary text-xs inline-flex items-center gap-1">{bulkBusy && <Loader2 className="size-3 animate-spin" />} Shortlist</button>
          <button onClick={() => runBulk(false)} disabled={bulkBusy} className="btn-ghost text-xs text-rose-600">Remove from shortlist</button>
        </div>
      )}

      <div className="card-surface table-scroll">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No schemes yet. {canManage && "Click “Sync from AMFI” (top-right) to pull the full AMFI scheme universe, or add one manually with “New scheme”."}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 bg-card z-10">
              <tr>
                {canManage && <th className="px-3 py-2 w-8"><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} className="size-3.5 rounded" /></th>}
                <th className="px-2 py-2 w-8"></th>
                <th className="text-left py-2 font-medium">Scheme</th>
                <th className="text-left py-2 font-medium">AMC</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Plan</th>
                <th className="text-left py-2 font-medium">Risk</th>
                <th className="text-left py-2 font-medium">Verdict</th>
                <th className="text-right py-2 font-medium pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const v = s.evaluation?.verdict as string | undefined;
                return (
                  <tr key={s.id} className={`border-b last:border-0 hover:bg-secondary/40 ${selected.has(s.id) ? "bg-brand-cyan-light/30" : ""}`}>
                    {canManage && <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="size-3.5 rounded" /></td>}
                    <td className="px-2 py-2.5">
                      <button onClick={() => canManage && toggleShortlist(s)} disabled={!canManage || rowBusy === s.id} title={s.is_shortlisted ? "Shortlisted" : "Add to shortlist"}>
                        {rowBusy === s.id ? <Loader2 className="size-4 animate-spin" /> : <Star className={`size-4 ${s.is_shortlisted ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />}
                      </button>
                    </td>
                    <td className="py-2.5">
                      <button onClick={() => setDetail(s)} className="font-medium max-w-[280px] truncate text-left hover:text-brand-cyan hover:underline" title="View scheme details">{s.scheme_name}</button>
                      <div className="text-[11px] text-muted-foreground font-mono">{s.scheme_code}{s.is_closed ? " · closed" : !s.is_active ? " · inactive" : ""}</div>
                    </td>
                    <td className="py-2.5 text-xs whitespace-nowrap">{s.amc_name ?? s.amc_code}</td>
                    <td className="py-2.5 text-xs">
                      {s.coarse_category && <span className={`chip text-[10px] ${COARSE_TONE[s.coarse_category] ?? ""}`}>{s.coarse_category}</span>}
                      <div className="text-[11px] text-muted-foreground max-w-[160px] truncate">{s.category ?? ""}</div>
                    </td>
                    <td className="py-2.5 text-xs capitalize">{s.plan ?? ""}</td>
                    <td className="py-2.5 text-xs capitalize">{s.risk_category ? String(s.risk_category).replace(/_/g, " ") : ""}</td>
                    <td className="py-2.5">{v ? <span className={`chip capitalize text-[10px] ${VERDICT_TONE[v] ?? ""}`}>{v}</span> : null}</td>
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setEvalFor(s)} className="btn-ghost text-xs inline-flex items-center gap-1"><ClipboardList className="size-3.5" /> Evaluate</button>
                          <button onClick={() => setEdit({ mode: "edit", scheme: s })} className="btn-ghost text-xs inline-flex items-center gap-1"><Pencil className="size-3.5" /> Edit</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && <SchemeFormDrawer mode={edit.mode} scheme={edit.scheme} amcs={amcs} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); router.refresh(); }} />}
      {evalFor && <EvaluationDrawer scheme={evalFor} onClose={() => setEvalFor(null)} onSaved={() => { setEvalFor(null); router.refresh(); }} />}
      {detail && (
        <SchemeDetailDrawer
          scheme={detail}
          onClose={() => setDetail(null)}
          onEvaluate={canManage ? () => { const s = detail; setDetail(null); setEvalFor(s); } : undefined}
          onEdit={canManage ? () => { const s = detail; setDetail(null); setEdit({ mode: "edit", scheme: s }); } : undefined}
        />
      )}
    </div>
  );
}

function SchemeDetailDrawer({
  scheme: s,
  onClose,
  onEvaluate,
  onEdit,
}: {
  scheme: Scheme;
  onClose: () => void;
  onEvaluate?: () => void;
  onEdit?: () => void;
}) {
  const v = s.evaluation?.verdict as string | undefined;
  // Fetch live enriched detail (NAV, ISIN, type, category) from the shared MF
  // catalog when the panel opens. Errors are ignored — we keep showing the
  // sparse local row in that case.
  const [api, setApi] = useState<any | null>(null);
  const [loadingApi, setLoadingApi] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoadingApi(true);
    (async () => {
      try {
        const res = await fetch(`/api/mf/schemes/${encodeURIComponent(String(s.scheme_code))}`);
        const j = await res.json().catch(() => ({}));
        if (!cancelled) setApi(j?.scheme ?? null);
      } catch {
        /* keep local row data */
      } finally {
        if (!cancelled) setLoadingApi(false);
      }
    })();
    return () => { cancelled = true; };
  }, [s.scheme_code]);

  const Row = ({ label, value }: { label: string; value: any }) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-right">{value === undefined || value === null || value === "" ? "" : value}</span>
    </div>
  );
  const overlay = (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-lg sm:rounded-xl shadow-xl border border-border/60 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold flex items-center gap-2">
              {s.is_shortlisted && <Star className="size-4 fill-amber-400 text-amber-400 shrink-0" />}
              <span className="truncate">{s.scheme_name}</span>
            </div>
            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{s.scheme_code}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-secondary text-muted-foreground" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          <div className="flex flex-wrap gap-1.5">
            {s.coarse_category && <span className={`chip text-[10px] ${COARSE_TONE[s.coarse_category] ?? ""}`}>{s.coarse_category}</span>}
            {v && <span className={`chip capitalize text-[10px] ${VERDICT_TONE[v] ?? ""}`}>IC: {v}</span>}
            <span className={`chip text-[10px] ${s.is_closed ? "bg-rose-50 text-rose-700" : s.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {s.is_closed ? "Closed" : s.is_active ? "Active / open" : "Inactive"}
            </span>
          </div>
          {loadingApi && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading latest…
            </div>
          )}
          <div className="rounded-lg border border-border px-3">
            <Row label="AMC" value={s.amc_name ?? s.amc_code} />
            <Row label="Type" value={api?.type} />
            <Row label="Category" value={s.category ?? api?.category} />
            <Row label="ISIN" value={api?.isin ? <span className="font-mono">{api.isin}</span> : undefined} />
            <Row
              label="NAV"
              value={
                api?.nav != null
                  ? <span>₹{api.nav}{api?.navDate ? <span className="text-muted-foreground font-normal"> · {api.navDate}</span> : null}</span>
                  : undefined
              }
            />
            <Row label="Sub-category" value={s.sub_category} />
            {/* Plan / Option: fall back to deriving from the scheme name — the
                AMFI feed encodes them there but rarely fills the columns. */}
            <Row label="Plan" value={derivePlan(s) ? <span className="capitalize">{derivePlan(s)}</span> : undefined} />
            <Row label="Option" value={deriveOption(s) ? <span className="capitalize">{deriveOption(s)}</span> : undefined} />
            <Row label="Risk" value={s.risk_category ? <span className="capitalize">{String(s.risk_category).replace(/_/g, " ")}</span> : undefined} />
            <Row label="Exit load" value={s.exit_load} />
            <Row label="Min SIP" value={s.min_sip ? `₹${Number(s.min_sip).toLocaleString("en-IN")}` : undefined} />
            <Row label="Min investment" value={s.min_investment ? `₹${Number(s.min_investment).toLocaleString("en-IN")}` : undefined} />
          </div>
          {s.shortlist_rationale && (
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Shortlist rationale</div>
              <p className="text-xs text-foreground/80 whitespace-pre-wrap">{s.shortlist_rationale}</p>
            </div>
          )}
          {s.evaluation && (
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">IC evaluation</div>
              <div className="rounded-lg border border-border px-3 py-1">
                {v && <Row label="Verdict" value={<span className="capitalize font-semibold">{v}</span>} />}
                {typeof s.evaluation.score === "number" && <Row label="Score" value={`${s.evaluation.score}/100`} />}
                {s.evaluation.notes && <p className="text-xs text-foreground/80 whitespace-pre-wrap pt-2">{s.evaluation.notes}</p>}
              </div>
            </div>
          )}
        </div>
        {(onEvaluate || onEdit) && (
          <div className="border-t px-5 py-3 flex justify-end gap-2">
            {onEvaluate && <button onClick={onEvaluate} className="btn-secondary text-sm inline-flex items-center gap-1"><ClipboardList className="size-4" /> Evaluate</button>}
            {onEdit && <button onClick={onEdit} className="btn-primary text-sm inline-flex items-center gap-1"><Pencil className="size-4" /> Edit</button>}
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(overlay, document.body);
}

function SchemeFormDrawer({ mode, scheme, amcs, onClose, onSaved }: { mode: "new" | "edit"; scheme: Scheme | null; amcs: Array<{ code: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    amcCode: scheme?.amc_code ?? (amcs[0]?.code ?? ""),
    schemeCode: scheme?.scheme_code ?? "",
    schemeName: scheme?.scheme_name ?? "",
    category: scheme?.category ?? "",
    subCategory: scheme?.sub_category ?? "",
    coarseCategory: scheme?.coarse_category ?? "",
    plan: scheme?.plan ?? "",
    option: scheme?.option ?? "",
    exitLoad: scheme?.exit_load ?? "",
    riskCategory: scheme?.risk_category ?? "",
    minSip: scheme?.min_sip ?? "",
    minInvestment: scheme?.min_investment ?? "",
    isActive: scheme?.is_active ?? true,
    isClosed: scheme?.is_closed ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((s) => ({ ...s, [k]: v })); }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const payload: any = {
        schemeName: f.schemeName, category: f.category || null, subCategory: f.subCategory || null,
        coarseCategory: f.coarseCategory || undefined, plan: f.plan || undefined, option: f.option || undefined,
        exitLoad: f.exitLoad || null, riskCategory: f.riskCategory || null, minSip: f.minSip || null,
        minInvestment: f.minInvestment || null, isActive: f.isActive, isClosed: f.isClosed,
      };
      let res;
      if (mode === "new") {
        res = await fetch("/api/schemes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amcCode: f.amcCode, schemeCode: f.schemeCode, ...payload, coarseCategory: f.coarseCategory || undefined }) });
      } else {
        res = await fetch(`/api/schemes/${scheme!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Drawer title={mode === "new" ? "New scheme" : "Edit scheme"} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-3">
        {mode === "new" && (
          <div className="sm:col-span-2">
            <Field label="Search AMFI scheme">
              <SchemeAutocomplete
                onSelect={(p: SchemePick) => {
                  set("schemeCode", p.schemeCode);
                  set("schemeName", p.schemeName);
                  if (p.category && !f.category) set("category", p.category);
                }}
              />
            </Field>
          </div>
        )}
        <Field label="AMC"><Select value={f.amcCode} onChange={(v) => set("amcCode", v)} disabled={mode === "edit"} options={amcs.map((a) => ({ value: a.code, label: `${a.name} (${a.code})` }))} placeholder="Select AMC…" ariaLabel="AMC" /></Field>
        <Field label="Scheme code"><input value={f.schemeCode} onChange={(e) => set("schemeCode", e.target.value)} disabled={mode === "edit"} placeholder="e.g. 119551" className="input-base font-mono" /></Field>
        <div className="sm:col-span-2"><Field label="Scheme name"><input value={f.schemeName} onChange={(e) => set("schemeName", e.target.value)} className="input-base" /></Field></div>
        <Field label="Coarse category"><Select value={f.coarseCategory} onChange={(v) => set("coarseCategory", v)} options={COARSE_OPTS} placeholder="Select…" ariaLabel="Coarse category" /></Field>
        <Field label="Category (fine)"><input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Equity - Large Cap" className="input-base" /></Field>
        <Field label="Plan"><Select value={f.plan} onChange={(v) => set("plan", v)} options={PLAN_OPTS} placeholder="Select…" ariaLabel="Plan" /></Field>
        <Field label="Option"><Select value={f.option} onChange={(v) => set("option", v)} options={OPTION_OPTS} placeholder="Select…" ariaLabel="Option" /></Field>
        <Field label="Risk"><Select value={f.riskCategory} onChange={(v) => set("riskCategory", v)} options={RISK_OPTS} placeholder="Select…" ariaLabel="Risk" /></Field>
        <Field label="Exit load"><input value={f.exitLoad} onChange={(e) => set("exitLoad", e.target.value)} placeholder="1% if < 1yr" className="input-base" /></Field>
        <Field label="Min SIP"><input value={f.minSip} onChange={(e) => set("minSip", e.target.value)} placeholder="500" className="input-base" /></Field>
        <Field label="Min investment"><input value={f.minInvestment} onChange={(e) => set("minInvestment", e.target.value)} placeholder="5000" className="input-base" /></Field>
        <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 rounded" /> Active</label>
        <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.isClosed} onChange={(e) => set("isClosed", e.target.checked)} className="size-4 rounded" /> Closed for purchase</label>
      </div>
      {err && <div className="text-sm text-rose-600 mt-2">{err}</div>}
      <DrawerFooter onClose={onClose} onSave={save} busy={busy} />
    </Drawer>
  );
}

function EvaluationDrawer({ scheme, onClose, onSaved }: { scheme: Scheme; onClose: () => void; onSaved: () => void }) {
  const ev = scheme.evaluation ?? {};
  const [f, setF] = useState({
    verdict: ev.verdict ?? "watch",
    schemeRiskProfile: ev.schemeRiskProfile ?? "",
    fmName: ev.fmName ?? "",
    fmExperienceYears: ev.fmExperienceYears ?? "",
    fiveYearCagrPct: ev.fiveYearCagrPct ?? "",
    consistencyPct: ev.consistencyPct ?? "",
    sharpeRatio: ev.sharpeRatio ?? "",
    stdDevPct: ev.stdDevPct ?? "",
    expenseRatioPct: ev.expenseRatioPct ?? "",
    aumCrore: ev.aumCrore ?? "",
    fundObjective: ev.fundObjective ?? "",
    portfolioCompositionNote: ev.portfolioCompositionNote ?? "",
    liquidityNote: ev.liquidityNote ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((s) => ({ ...s, [k]: v })); }
  const num = (v: any) => (v === "" || v == null ? undefined : Number(v));

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/schemes/${scheme.id}/evaluation`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verdict: f.verdict || undefined,
          schemeRiskProfile: f.schemeRiskProfile || undefined,
          fmName: f.fmName || undefined,
          fmExperienceYears: num(f.fmExperienceYears),
          fiveYearCagrPct: num(f.fiveYearCagrPct),
          consistencyPct: num(f.consistencyPct),
          sharpeRatio: num(f.sharpeRatio),
          stdDevPct: num(f.stdDevPct),
          expenseRatioPct: num(f.expenseRatioPct),
          aumCrore: num(f.aumCrore),
          fundObjective: f.fundObjective || undefined,
          portfolioCompositionNote: f.portfolioCompositionNote || undefined,
          liquidityNote: f.liquidityNote || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Drawer title={`IC evaluation — ${scheme.scheme_name}`} onClose={onClose}>
      <Field label="Verdict">
        <div className="flex gap-2">
          {["pass", "watch", "reject"].map((v) => (
            <button key={v} type="button" onClick={() => set("verdict", v)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize border ${f.verdict === v ? (VERDICT_TONE[v] ?? "") + " border-current" : "border-border text-muted-foreground"}`}>{v}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="5y CAGR %"><input type="number" value={f.fiveYearCagrPct} onChange={(e) => set("fiveYearCagrPct", e.target.value)} className="input-base" /></Field>
        <Field label="Consistency %"><input type="number" value={f.consistencyPct} onChange={(e) => set("consistencyPct", e.target.value)} className="input-base" /></Field>
        <Field label="Sharpe ratio"><input type="number" step="0.01" value={f.sharpeRatio} onChange={(e) => set("sharpeRatio", e.target.value)} className="input-base" /></Field>
        <Field label="Std dev %"><input type="number" value={f.stdDevPct} onChange={(e) => set("stdDevPct", e.target.value)} className="input-base" /></Field>
        <Field label="Expense ratio %"><input type="number" step="0.01" value={f.expenseRatioPct} onChange={(e) => set("expenseRatioPct", e.target.value)} className="input-base" /></Field>
        <Field label="AUM (₹ Cr)"><input type="number" value={f.aumCrore} onChange={(e) => set("aumCrore", e.target.value)} className="input-base" /></Field>
        <Field label="Fund manager"><input value={f.fmName} onChange={(e) => set("fmName", e.target.value)} className="input-base" /></Field>
        <Field label="FM experience (yrs)"><input type="number" value={f.fmExperienceYears} onChange={(e) => set("fmExperienceYears", e.target.value)} className="input-base" /></Field>
        <Field label="Scheme risk"><Select value={f.schemeRiskProfile} onChange={(v) => set("schemeRiskProfile", v)} options={SCHEME_RISK_OPTS} placeholder="Select…" ariaLabel="Scheme risk" /></Field>
      </div>
      <Field label="Fund objective"><textarea value={f.fundObjective} onChange={(e) => set("fundObjective", e.target.value)} rows={2} className="input-base" /></Field>
      <Field label="Portfolio composition note"><textarea value={f.portfolioCompositionNote} onChange={(e) => set("portfolioCompositionNote", e.target.value)} rows={2} className="input-base" /></Field>
      <Field label="Liquidity note"><input value={f.liquidityNote} onChange={(e) => set("liquidityNote", e.target.value)} className="input-base" /></Field>
      {err && <div className="text-sm text-rose-600 mt-2">{err}</div>}
      <DrawerFooter onClose={onClose} onSave={save} busy={busy} saveLabel="Save evaluation" />
    </Drawer>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const overlay = (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full bg-card border-l border-border shadow-2xl flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between"><div className="font-semibold truncate">{title}</div><button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(overlay, document.body);
}
function DrawerFooter({ onClose, onSave, busy, saveLabel = "Save" }: { onClose: () => void; onSave: () => void; busy: boolean; saveLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3 border-t mt-3">
      <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
      <button onClick={onSave} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {saveLabel}</button>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>{children}</label>;
}
