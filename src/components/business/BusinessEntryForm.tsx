"use client";

/**
 * BusinessEntryForm — header + Zoho-style scheme sub-form for a Business Closing
 * Entry. Each line picks a scheme from the shared MF catalog (category + AMC
 * auto-fill, with a free-text fallback for PMS/AIF), its own amount and
 * transaction type, plus a "from scheme" for switch / STP / SWP.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Search, Save } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";
import { useToast } from "@/components/ui/Toast";
import { classifyAssetClass } from "@/lib/business/asset-class";

const PRODUCT_OPTS: [string, string][] = [
  ["mutual_fund", "Mutual Fund"], ["direct_equity", "Direct Equity / Demat"], ["pms", "PMS"], ["aif", "AIF"], ["sif", "SIF"], ["bond", "Bond"], ["ncd", "NCD"], ["p2p", "P2P"], ["las", "LAS"], ["other", "Other"],
];

/**
 * Per-product-type behaviour for each Schemes line. Only Mutual Fund uses the
 * AMFI scheme catalog + the full SIP/Switch/STP/SWP transaction set; PMS / AIF /
 * SIF / Bond / NCD are free-typed instruments with the transaction types that
 * actually apply to them.
 */
interface ProductConfig {
  schemeLabel: string;
  schemePlaceholder: string;
  /** Use the MF catalog autocomplete (true) or a plain text input (false). */
  catalog: boolean;
  /** Transaction types allowed for this product (subset of TXN_OPTS keys). */
  txnTypes: string[];
  /** Product-specific labels for txn types (e.g. equity calls a Lumpsum a "Buy"
   *  and a Redemption a "Sell"). Falls back to the generic TXN_OPTS label. */
  txnLabels?: Record<string, string>;
  /** Default asset class for new/converted lines. */
  defaultAssetClass?: string;
  /** Asset class is fixed for this product (e.g. Bond/NCD = Debt) — shown read-only. */
  lockAssetClass?: boolean;
}
const PRODUCT_CONFIG: Record<string, ProductConfig> = {
  mutual_fund: { schemeLabel: "Scheme", schemePlaceholder: "Search catalog or type a name…", catalog: true,
    txnTypes: ["lumpsum", "additional_purchase", "sip", "sip_topup", "sip_stop", "switch", "stp", "swp", "redemption", "other"] },
  // Direct Equity is bought/sold, not SIP'd/switched — show Buy/Sell, not the MF set.
  direct_equity: { schemeLabel: "Stock / scrip", schemePlaceholder: "Stock name or symbol (e.g. RELIANCE)…", catalog: false,
    txnTypes: ["lumpsum", "additional_purchase", "redemption", "other"],
    txnLabels: { lumpsum: "Buy", additional_purchase: "Buy (add-on)", redemption: "Sell" },
    defaultAssetClass: "equity" },
  pms: { schemeLabel: "Strategy", schemePlaceholder: "PMS strategy name…", catalog: false,
    txnTypes: ["lumpsum", "additional_purchase", "redemption", "other"], defaultAssetClass: "equity" },
  aif: { schemeLabel: "Scheme / fund", schemePlaceholder: "AIF scheme name…", catalog: false,
    txnTypes: ["lumpsum", "additional_purchase", "redemption", "other"], defaultAssetClass: "other" },
  sif: { schemeLabel: "Strategy", schemePlaceholder: "SIF strategy name…", catalog: false,
    txnTypes: ["lumpsum", "additional_purchase", "sip", "sip_topup", "sip_stop", "redemption", "other"], defaultAssetClass: "equity" },
  bond: { schemeLabel: "Bond / instrument", schemePlaceholder: "Bond name / ISIN…", catalog: false,
    txnTypes: ["lumpsum", "redemption", "other"], defaultAssetClass: "debt", lockAssetClass: true },
  ncd: { schemeLabel: "NCD / instrument", schemePlaceholder: "NCD name / ISIN…", catalog: false,
    txnTypes: ["lumpsum", "redemption", "other"], defaultAssetClass: "debt", lockAssetClass: true },
  p2p: { schemeLabel: "Platform / plan", schemePlaceholder: "P2P platform / plan…", catalog: false,
    txnTypes: ["lumpsum", "additional_purchase", "redemption", "other"], defaultAssetClass: "debt" },
  las: { schemeLabel: "Facility", schemePlaceholder: "Loan-against-securities facility…", catalog: false,
    txnTypes: ["lumpsum", "redemption", "other"], defaultAssetClass: "other" },
  other: { schemeLabel: "Item", schemePlaceholder: "Product / item name…", catalog: false,
    txnTypes: ["lumpsum", "additional_purchase", "sip", "sip_topup", "sip_stop", "redemption", "other"] },
};
const productCfg = (pt: string): ProductConfig => PRODUCT_CONFIG[pt] ?? PRODUCT_CONFIG.mutual_fund;
const TXN_OPTS: [string, string][] = [
  ["lumpsum", "Lumpsum"], ["additional_purchase", "Additional Purchase"], ["sip", "SIP"],
  ["sip_topup", "SIP Top-Up"], ["sip_stop", "SIP Stop"], ["other", "Others"],
  ["switch", "Switch"], ["stp", "STP"], ["swp", "SWP"], ["redemption", "Redemption"],
];
const FREQ_OPTS: [string, string][] = [
  ["one_time", "One-time"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"], ["yearly", "Yearly"],
];
const CLASS_OPTS: [string, string][] = [
  ["equity", "Equity"], ["hybrid", "Hybrid"], ["debt", "Debt"], ["liquid", "Liquid"], ["gold", "Gold"], ["other", "Other"],
];
const STATUS_OPTS: [string, string][] = [["draft", "Draft"], ["confirmed", "Confirmed"]];
const NEEDS_FREQ = new Set(["sip", "sip_stop", "stp", "swp"]);
const NEEDS_FROM = new Set(["switch", "stp", "swp"]);
/** Recurring installments (amount is per-installment, not a one-time figure). */
const RECURRING_TXN = new Set(["sip", "sip_stop", "stp", "swp"]);
/** Money leaving the book — never adds to "business booked". A SIP Stop is a
 *  reduction of the SIP book, so it likewise must not count as positive business. */
const OUTFLOW_TXN = new Set(["redemption", "swp", "sip_stop"]);

type Line = {
  key: string;
  schemeCode: string;
  schemeName: string;
  amcName: string;
  assetCategory: string;
  assetClass: string;
  txnType: string;
  amount: string;
  frequency: string;
  sipDate: string;
  fromSchemeCode: string;
  fromSchemeName: string;
  fromAssetClass: string;
  folioNo: string;
};

let _k = 0;
const blankLine = (): Line => ({
  key: `l${++_k}`, schemeCode: "", schemeName: "", amcName: "", assetCategory: "", assetClass: "equity",
  txnType: "lumpsum", amount: "", frequency: "", sipDate: "", fromSchemeCode: "", fromSchemeName: "", fromAssetClass: "", folioNo: "",
});

function inr(n: number): string {
  if (!Number.isFinite(n)) return "₹0";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

type InitialEntry = {
  id: string;
  investorId: string | null;
  clientName: string;
  productType: string;
  platform?: string | null;
  businessDate: string;
  status: string;
  rmId: string | null;
  amcName: string | null;
  folioNo: string | null;
  notes: string | null;
};
type InitialLine = any;

export function BusinessEntryForm({
  initial,
  initialLines,
  members,
  currentUserId,
  prefillClient,
}: {
  initial?: InitialEntry;
  initialLines?: InitialLine[];
  members: { id: string; name: string }[];
  currentUserId: string;
  /** Pre-select the client on a NEW entry (e.g. opened from a blueprint action). */
  prefillClient?: { id: string; name: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!initial;

  const [investorId, setInvestorId] = useState(initial?.investorId ?? prefillClient?.id ?? "");
  const [clientName, setClientName] = useState(initial?.clientName ?? prefillClient?.name ?? "");
  const [productType, setProductType] = useState(initial?.productType ?? "mutual_fund");
  const [platform, setPlatform] = useState(initial?.platform ?? "");
  const [businessDate, setBusinessDate] = useState(initial?.businessDate ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState(initial?.status === "draft" || initial?.status === "confirmed" ? initial.status : "draft");
  const [rmId, setRmId] = useState(initial?.rmId ?? currentUserId);
  // AMC is no longer an entry-level field — each scheme carries its own AMC
  // (auto-fetched from the MF catalog), since one entry can mix AMCs. The
  // entry-level amcName is derived from the lines on save for list/detail views.
  const [folioNo, setFolioNo] = useState(initial?.folioNo ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const [lines, setLines] = useState<Line[]>(() =>
    initialLines && initialLines.length
      ? initialLines.map((l: any) => ({
          key: `l${++_k}`,
          schemeCode: l.schemeCode ?? "", schemeName: l.schemeName ?? "", amcName: l.amcName ?? "",
          assetCategory: l.assetCategory ?? "", assetClass: l.assetClass ?? "equity",
          txnType: l.txnType ?? "lumpsum", amount: l.amount != null ? String(l.amount) : "",
          frequency: l.frequency ?? "", sipDate: l.sipDate ?? "", fromSchemeCode: l.fromSchemeCode ?? "", fromSchemeName: l.fromSchemeName ?? "",
          fromAssetClass: l.fromAssetClass ?? "", folioNo: l.folioNo ?? "",
        }))
      : [blankLine()]
  );

  const cfg = productCfg(productType);

  function patchLine(i: number, p: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  }

  /** Switch product type + re-normalize every line to the new product's rules:
   *  coerce an out-of-range transaction type, apply the default asset class, and
   *  drop the catalog code when leaving catalog mode. */
  function changeProduct(pt: string) {
    setProductType(pt);
    const c = productCfg(pt);
    setLines((ls) =>
      ls.map((l) => ({
        ...l,
        txnType: c.txnTypes.includes(l.txnType) ? l.txnType : c.txnTypes[0],
        assetClass: c.lockAssetClass && c.defaultAssetClass
          ? c.defaultAssetClass // fixed for this product (e.g. Bond/NCD = Debt)
          : !c.catalog && c.defaultAssetClass && (!l.assetClass || l.assetClass === "equity")
            ? c.defaultAssetClass
            : l.assetClass,
        schemeCode: c.catalog ? l.schemeCode : "",
      }))
    );
  }

  function addLine() {
    const c = productCfg(productType);
    const l = blankLine();
    l.txnType = c.txnTypes[0];
    if (c.defaultAssetClass) l.assetClass = c.defaultAssetClass;
    setLines((ls) => [...ls, l]);
  }

  // Totals are grouped BY TRANSACTION TYPE and never summed across types — a
  // monthly SIP installment, a one-time Lumpsum, and a Redemption (outflow) are
  // different units + directions, so a single combined figure is meaningless.
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const a = Number(l.amount) || 0;
      if (a <= 0) continue;
      m.set(l.txnType, (m.get(l.txnType) ?? 0) + a);
    }
    return TXN_OPTS.filter(([v]) => m.has(v)).map(([v, lab]) => ({ type: v, label: cfg.txnLabels?.[v] ?? lab, amount: m.get(v)! }));
  }, [lines, cfg]);
  const liquidNet = useMemo(() => {
    let inn = 0, out = 0;
    for (const l of lines) {
      const a = Number(l.amount) || 0;
      if (l.assetClass === "liquid" && ["lumpsum", "additional_purchase", "switch", "stp"].includes(l.txnType)) inn += a;
      if ((l.assetClass === "liquid" && ["swp", "redemption"].includes(l.txnType)) || (l.fromAssetClass === "liquid" && ["switch", "stp"].includes(l.txnType))) out += a;
    }
    return inn - out;
  }, [lines]);

  async function save() {
    if (!clientName.trim()) { toast.error("Pick or enter a client", "Missing client"); return; }
    const cleaned = lines.filter((l) => l.schemeName.trim() && Number(l.amount) > 0);
    if (cleaned.length === 0) { toast.error("Add at least one scheme with an amount", "No schemes"); return; }
    setBusy(true);
    try {
      // Entry-level AMC is derived from the lines (first scheme that carries one)
      // — kept for list/detail summaries now that AMC lives per scheme.
      const headerAmc = cleaned.find((l) => l.amcName?.trim())?.amcName?.trim() || null;
      const body = {
        investorId: investorId || null,
        clientName: clientName.trim(),
        productType, platform: platform.trim() || null, businessDate, status, rmId: rmId || null,
        amcName: headerAmc, folioNo: folioNo.trim() || null, notes: notes.trim() || null,
        lines: cleaned.map((l) => ({
          schemeCode: l.schemeCode || null, schemeName: l.schemeName.trim(), amcName: l.amcName || null,
          assetCategory: l.assetCategory || null, assetClass: l.assetClass,
          txnType: l.txnType, amount: Number(l.amount) || 0,
          frequency: NEEDS_FREQ.has(l.txnType) ? l.frequency || null : null,
          sipDate: l.txnType === "sip" ? l.sipDate || null : null,
          fromSchemeCode: NEEDS_FROM.has(l.txnType) ? l.fromSchemeCode || null : null,
          fromSchemeName: NEEDS_FROM.has(l.txnType) ? l.fromSchemeName || null : null,
          fromAssetClass: NEEDS_FROM.has(l.txnType) ? l.fromAssetClass || null : null,
          folioNo: l.folioNo || null,
        })),
      };
      const res = await fetch(isEdit ? `/api/business-entries/${initial!.id}` : "/api/business-entries", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error ?? "Could not save entry", "Save failed"); return; }
      toast.success(isEdit ? "Entry updated" : "Business entry saved");
      router.push(`/dashboard/business-entries/${isEdit ? initial!.id : j.id}`);
      router.refresh();
    } catch {
      toast.error("Network error — please try again", "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card-surface p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Label>Client</Label>
          <ClientField value={clientName} onPick={(c) => { setInvestorId(c.id); setClientName(c.name); }} onText={(v) => { setClientName(v); setInvestorId(""); }} />
        </div>
        <div>
          <Label>Product type</Label>
          <SelectField value={productType} onChange={(e) => changeProduct(e.target.value)} className="w-full">
            {PRODUCT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
        </div>
        <div>
          <Label>Platform</Label>
          <input
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            list="be-platforms"
            placeholder="NJ, Motilal, Piper Serica…"
            className="w-full rounded-md border border-border px-2 py-2 text-sm focus:outline-none focus:border-brand-cyan"
          />
          <datalist id="be-platforms">
            {["NJ", "Motilal Oswal", "Piper Serica", "Anand Rathi", "Phillip Capital", "Advisorkhoj", "AK Capital", "Omni Science", "BSE Star MF", "MFU"].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div>
          <Label>Business date</Label>
          <DateField value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className="w-full" />
        </div>
        <div>
          <Label>Relationship manager</Label>
          <SelectField value={rmId} onChange={(e) => setRmId(e.target.value)} className="w-full">
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </SelectField>
        </div>
        <div>
          <Label>Status</Label>
          <SelectField value={status} onChange={(e) => setStatus(e.target.value)} className="w-full">
            {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
        </div>
        <div>
          <Label>Folio no. (optional)</Label>
          <Input value={folioNo} onChange={setFolioNo} placeholder="Folio / account no." />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Label>Notes (optional)</Label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15" />
        </div>
      </div>

      {/* Scheme sub-form */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">{productType === "mutual_fund" ? "Schemes" : cfg.schemeLabel + "s"}</h3>
          <button type="button" onClick={addLine} className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <Plus className="size-3.5" /> Add {cfg.schemeLabel.toLowerCase()}
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-lg border border-border p-3 bg-secondary/20">
              <div className="grid lg:grid-cols-12 gap-2.5">
                <div className="lg:col-span-5">
                  <Label sm>{cfg.schemeLabel}</Label>
                  {cfg.catalog ? (
                    <SchemeAutocomplete
                      size="sm"
                      defaultValue={l.schemeName}
                      onQueryChange={(v) => patchLine(i, { schemeName: v, schemeCode: "" })}
                      onSelect={(s) => patchLine(i, {
                        schemeName: s.schemeName, schemeCode: s.schemeCode, amcName: s.amc ?? "",
                        assetCategory: s.category ?? "", assetClass: classifyAssetClass(s.category, s.schemeName),
                      })}
                      placeholder={cfg.schemePlaceholder}
                    />
                  ) : (
                    <input
                      value={l.schemeName}
                      onChange={(e) => patchLine(i, { schemeName: e.target.value, schemeCode: "" })}
                      placeholder={cfg.schemePlaceholder}
                      className="w-full h-8 rounded-lg border border-border bg-card px-2.5 text-xs focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
                    />
                  )}
                  {cfg.catalog && (l.amcName || l.assetCategory) && (
                    <div className="text-[10px] text-muted-foreground mt-1 truncate">
                      {l.amcName ? <><span className="font-medium text-foreground/70">AMC:</span> {l.amcName}</> : null}
                      {l.amcName && l.assetCategory ? " · " : ""}
                      {l.assetCategory}
                    </div>
                  )}
                </div>
                <div className="lg:col-span-2">
                  <Label sm>Type</Label>
                  <SelectField size="sm" value={l.txnType} onChange={(e) => patchLine(i, { txnType: e.target.value })} className="w-full">
                    {TXN_OPTS.filter(([v]) => cfg.txnTypes.includes(v)).map(([v, lab]) => <option key={v} value={v}>{cfg.txnLabels?.[v] ?? lab}</option>)}
                  </SelectField>
                </div>
                <div className="lg:col-span-2">
                  <Label sm>Asset class</Label>
                  <SelectField
                    size="sm"
                    value={l.assetClass}
                    onChange={(e) => patchLine(i, { assetClass: e.target.value })}
                    disabled={cfg.lockAssetClass}
                    className={`w-full ${cfg.lockAssetClass ? "opacity-70 cursor-not-allowed" : ""}`}
                  >
                    {CLASS_OPTS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                  </SelectField>
                </div>
                <div className="lg:col-span-2">
                  <Label sm>Amount (₹)</Label>
                  <input type="number" min={0} inputMode="numeric" value={l.amount} onChange={(e) => patchLine(i, { amount: e.target.value })}
                    className="w-full h-8 rounded-lg border border-border bg-card px-2.5 text-xs tabular-nums focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15" />
                </div>
                <div className="lg:col-span-1 flex items-end">
                  <button type="button" onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls)}
                    className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors" title="Remove">
                    <Trash2 className="size-4" />
                  </button>
                </div>

                {/* Conditional row: frequency + from-scheme */}
                {(NEEDS_FREQ.has(l.txnType) || NEEDS_FROM.has(l.txnType)) && (
                  <div className="lg:col-span-12 grid lg:grid-cols-12 gap-2.5 pt-1">
                    {NEEDS_FREQ.has(l.txnType) && (
                      <div className="lg:col-span-3">
                        <Label sm>Frequency</Label>
                        <SelectField size="sm" value={l.frequency} onChange={(e) => patchLine(i, { frequency: e.target.value })} className="w-full">
                          <option value="">Select…</option>
                          {FREQ_OPTS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                        </SelectField>
                      </div>
                    )}
                    {l.txnType === "sip" && (
                      <div className="lg:col-span-3">
                        <Label sm>SIP date (ECS day) <span className="text-muted-foreground">· 1–28</span></Label>
                        <input
                          inputMode="numeric"
                          value={l.sipDate}
                          onChange={(e) => patchLine(i, { sipDate: e.target.value })}
                          placeholder="e.g. 5"
                          className="w-full h-8 rounded-lg border border-border bg-card px-2.5 text-xs focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">Drives the SIP reminder workflow.</div>
                      </div>
                    )}
                    {NEEDS_FROM.has(l.txnType) && (
                      <>
                        <div className="lg:col-span-6">
                          <Label sm>From scheme (source)</Label>
                          <SchemeAutocomplete size="sm" defaultValue={l.fromSchemeName}
                            onQueryChange={(v) => patchLine(i, { fromSchemeName: v, fromSchemeCode: "" })}
                            onSelect={(s) => patchLine(i, { fromSchemeName: s.schemeName, fromSchemeCode: s.schemeCode, fromAssetClass: classifyAssetClass(s.category, s.schemeName) })}
                            placeholder="Source scheme…" />
                        </div>
                        <div className="lg:col-span-3">
                          <Label sm>From class</Label>
                          <SelectField size="sm" value={l.fromAssetClass} onChange={(e) => patchLine(i, { fromAssetClass: e.target.value })} className="w-full">
                            <option value="">Select…</option>
                            {CLASS_OPTS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                          </SelectField>
                        </div>
                        {/* Destination class for the switch / STP / SWP — the
                            money moves INTO this asset class (= the line's scheme
                            class above; kept in sync). */}
                        <div className="lg:col-span-3">
                          <Label sm>To class</Label>
                          <SelectField size="sm" value={l.assetClass} onChange={(e) => patchLine(i, { assetClass: e.target.value })} className="w-full">
                            <option value="">Select…</option>
                            {CLASS_OPTS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                          </SelectField>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-4 pt-3 border-t space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Business by type</span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {byType.length === 0 ? (
                <span className="text-xs text-muted-foreground">Add schemes to see totals by type.</span>
              ) : (
                byType.map((t) => (
                  <span
                    key={t.type}
                    className={`chip ${OUTFLOW_TXN.has(t.type) ? "bg-rose-50 text-rose-700" : RECURRING_TXN.has(t.type) ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
                    title={OUTFLOW_TXN.has(t.type) ? "Outflow — money leaving the book" : RECURRING_TXN.has(t.type) ? "Recurring — amount is per installment" : "One-time inflow"}
                  >
                    {t.label}:{" "}
                    <span className="font-bold tabular-nums">
                      {OUTFLOW_TXN.has(t.type) ? "−" : ""}{inr(t.amount)}
                    </span>
                    {RECURRING_TXN.has(t.type) ? <span className="opacity-70"> /installment</span> : null}
                  </span>
                ))
              )}
            </div>
          </div>
          {liquidNet !== 0 && (
            <div className="flex justify-end">
              <span className="chip bg-sky-50 text-sky-700">Liquid net {inr(liquidNet)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="btn-secondary text-sm">Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {isEdit ? "Save changes" : "Save entry"}
        </button>
      </div>
    </div>
  );
}

function Label({ children, sm }: { children: React.ReactNode; sm?: boolean }) {
  return <span className={`block font-medium text-muted-foreground ${sm ? "text-[10px] mb-0.5" : "text-xs mb-1"}`}>{children}</span>;
}
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15" />
  );
}

/** Inline client search over /api/investors (free-text allowed for prospects). */
function ClientField({ value, onPick, onText }: { value: string; onPick: (c: { id: string; name: string }) => void; onText: (v: string) => void }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; name: string; email?: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  function onChange(v: string) {
    setQ(v); onText(v); setOpen(true);
    const query = v.trim();
    if (query.length < 2) { setResults([]); return; }
    const id = ++reqId.current; setBusy(true);
    setTimeout(async () => {
      try {
        const j = await fetch(`/api/investors?q=${encodeURIComponent(query)}&limit=8`).then((r) => r.json()).catch(() => ({}));
        const list = (j.investors ?? j.rows ?? j.data ?? []) as any[];
        if (id === reqId.current) setResults(list.map((x) => ({ id: x.id, name: x.name, email: x.email })));
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, 200);
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search clients or type a name…"
          className="w-full h-9 rounded-lg border border-border bg-card pl-9 pr-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
        />
        {busy && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-brand-cyan" />}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 max-h-60 overflow-y-auto card-elevated bg-card p-1 animate-scale-in">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick({ id: r.id, name: r.name }); setQ(r.name); setOpen(false); }}
                className="w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-secondary transition">
                <span className="font-medium">{r.name}</span>
                {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
