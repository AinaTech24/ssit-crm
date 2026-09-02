"use client";

/**
 * New Proposal builder.
 *
 *  - Pick recipient (existing client OR lead) via InvestorLookup or a lead search.
 *  - Set title, type, valid-until, risk rating.
 *  - Build line items: MF / Insurance / PMS / AIF — each with its own form
 *    that captures product-specific fields.
 *  - Compute totals live (investment & projected corpus).
 *  - Cover letter + disclaimer (sensible defaults).
 *  - Save → redirects to /dashboard/proposals/[id] with the next-actions panel.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  FileSignature,
  Plus,
  Trash2,
  Save,
  Loader2,
  TrendingUp,
  Shield,
  Briefcase,
  Sparkles,
  Landmark,
} from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { RiskAlignmentBanner } from "@/components/proposals/RiskAlignmentBanner";
import { formatINR } from "@/lib/utils";
import { proposalTotals } from "@/lib/proposals/projections";

type Recipient = { type: "investor" | "lead" | "family"; id: string; name: string };

type MF = {
  kind: "mf";
  schemeName: string;
  amcName?: string;
  category?: string;
  monthlyAmount?: number;
  lumpsum?: number;
  sipTermYears?: number;
  expectedReturn?: number;
  riskRating?: "low" | "moderate" | "high" | "very_high";
  projectedCorpus?: number;
  notes?: string;
};
type Ins = {
  kind: "insurance";
  policyName: string;
  insurer?: string;
  policyType?: "term" | "ulip" | "endowment" | "health" | "money_back" | "other";
  sumAssured?: number;
  annualPremium?: number;
  termYears?: number;
  notes?: string;
};
type PMS = {
  kind: "pms";
  strategyName: string;
  manager?: string;
  minInvestment?: number;
  proposedAmount?: number;
  expectedReturn?: number;
  termYears?: number;
  exitLoad?: string;
  notes?: string;
};
type AIF = {
  kind: "aif";
  fundName: string;
  manager?: string;
  category?: "cat1" | "cat2" | "cat3";
  minInvestment?: number;
  proposedAmount?: number;
  lockInYears?: number;
  targetIrr?: number;
  notes?: string;
};
type Other = {
  kind: "other";
  productName: string;
  company?: string;
  amount?: number;
  expectedReturn?: number;
  termYears?: number;
  remarks?: string;
  notes?: string;
};
type Item = MF | Ins | PMS | AIF | Other;

const DEFAULT_DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme-related documents carefully. Past performance is not indicative of future returns. Insurance is the subject matter of solicitation. The information provided here is for illustrative purposes only.";

export default function NewProposalPage() {
  const router = useRouter();
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [recipientMode, setRecipientMode] = useState<"investor" | "lead" | "family">("investor");
  const [leadResults, setLeadResults] = useState<any[]>([]);
  const [leadQuery, setLeadQuery] = useState("");
  const [familyOptions, setFamilyOptions] = useState<any[]>([]);
  const [familyQuery, setFamilyQuery] = useState("");
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [selectedFamilyMemberId, setSelectedFamilyMemberId] = useState<string | null>(null);

  const [title, setTitle] = useState("Investment Proposal");
  const [type, setType] = useState<
    "comprehensive" | "mutual_fund" | "insurance" | "pms" | "aif" | "mixed"
  >("mutual_fund");
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [riskRating, setRiskRating] = useState<
    "conservative" | "moderate" | "aggressive" | "mixed"
  >("moderate");
  const [coverLetter, setCoverLetter] = useState("");
  const [disclaimer, setDisclaimer] = useState(DEFAULT_DISCLAIMER);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clientRiskProfile, setClientRiskProfile] = useState<string | null>(null);

  // Search leads when recipient mode is 'lead'
  useEffect(() => {
    if (recipientMode !== "lead" || leadQuery.trim().length < 2) {
      setLeadResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(leadQuery)}`);
      const j = await r.json();
      setLeadResults(j.leads ?? []);
    }, 220);
    return () => clearTimeout(t);
  }, [leadQuery, recipientMode]);

  // Load all families when 'family' mode is picked (typically <100 per tenant).
  useEffect(() => {
    if (recipientMode !== "family") return;
    let cancelled = false;
    (async () => {
      const r = await fetch("/api/families");
      const j = await r.json();
      if (!cancelled) setFamilyOptions(j.families ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [recipientMode]);

  // Load client or family head risk profile
  useEffect(() => {
    if (!recipient) {
      setClientRiskProfile(null);
      return;
    }
    if (recipient.type === "investor") {
      fetch(`/api/investors/${recipient.id}`)
        .then((res) => res.json())
        .then((data) => {
          setClientRiskProfile(data?.investor?.riskProfile ?? null);
        })
        .catch(() => {
          setClientRiskProfile(null);
        });
    } else if (recipient.type === "family") {
      const targetId = selectedFamilyMemberId || recipient.id;
      if (selectedFamilyMemberId) {
        fetch(`/api/investors/${selectedFamilyMemberId}`)
          .then((res) => res.json())
          .then((data) => {
            setClientRiskProfile(data?.investor?.riskProfile ?? null);
          })
          .catch(() => {
            setClientRiskProfile(null);
          });
      } else {
        fetch(`/api/families/${recipient.id}`)
          .then((res) => res.json())
          .then((data) => {
            const primaryId = data?.primaryInvestorId ?? data?.family?.primaryInvestorId;
            if (primaryId) {
              return fetch(`/api/investors/${primaryId}`)
                .then((res) => res.json())
                .then((data) => {
                  setClientRiskProfile(data?.investor?.riskProfile ?? null);
                });
            } else {
              setClientRiskProfile(null);
            }
          })
          .catch(() => {
            setClientRiskProfile(null);
          });
      }
    } else {
      setClientRiskProfile(null);
    }
  }, [recipient, selectedFamilyMemberId]);

  // Filter families client-side by name
  const filteredFamilies = familyOptions.filter((f) => {
    if (!familyQuery.trim()) return true;
    const q = familyQuery.trim().toLowerCase();
    const display = (f.familyName ?? f.headName ?? "").toLowerCase();
    return display.includes(q);
  });

  // When a family is picked, optionally load members to choose a specific head/member
  async function pickFamily(fam: any) {
    const displayName = fam.familyName ?? (fam.headName ? `${fam.headName} Family` : "Family");
    setRecipient({ type: "family", id: fam.id, name: displayName });
    setSelectedFamilyMemberId(null);
    // Best-effort fetch of members for the optional "specific member" selector
    try {
      const r = await fetch(`/api/families/${fam.id}`);
      if (r.ok) {
        const j = await r.json();
        setFamilyMembers(j.members ?? []);
      } else {
        setFamilyMembers([]);
      }
    } catch {
      setFamilyMembers([]);
    }
  }

  function addItem(kind: Item["kind"]) {
    const defaults: Record<Item["kind"], Item> = {
      mf: { kind: "mf", schemeName: "" },
      insurance: { kind: "insurance", policyName: "" },
      pms: { kind: "pms", strategyName: "" },
      aif: { kind: "aif", fundName: "" },
      other: { kind: "other", productName: "" },
    };
    // Prepend — the newest product shows at the TOP of the list.
    setItems((s) => [defaults[kind], ...s]);
    // Auto-pick "mixed" if multiple kinds present
    if (items.length >= 1 && items[0].kind !== kind) setType("mixed");
  }

  function patchItem(idx: number, patch: Partial<Item>) {
    setItems((s) => s.map((it, i) => (i === idx ? ({ ...it, ...patch } as Item) : it)));
  }

  function removeItem(idx: number) {
    setItems((s) => s.filter((_, i) => i !== idx));
  }

  const totals = useMemo(() => {
    const t = proposalTotals(items);
    return { inv: t.totalInvestment ?? 0, corpus: t.expectedCorpus ?? 0 };
  }, [items]);

  async function save() {
    if (!recipient) {
      setErr("Pick a recipient first.");
      return;
    }
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (items.length === 0) {
      setErr("Add at least one product line item.");
      return;
    }
    // Validate min-required fields per line
    for (const it of items) {
      if (it.kind === "mf" && !it.schemeName.trim()) {
        setErr("Every MF item needs a scheme name.");
        return;
      }
      if (it.kind === "insurance" && !it.policyName.trim()) {
        setErr("Every insurance item needs a policy name.");
        return;
      }
      if (it.kind === "pms" && !it.strategyName.trim()) {
        setErr("Every PMS item needs a strategy name.");
        return;
      }
      if (it.kind === "aif" && !it.fundName.trim()) {
        setErr("Every AIF item needs a fund name.");
        return;
      }
      if (it.kind === "other" && !it.productName.trim()) {
        setErr("Every other-product item needs a product name.");
        return;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        recipientType: recipient.type,
        title,
      };
      if (recipient.type === "investor") {
        payload.investorId = recipient.id;
      } else if (recipient.type === "lead") {
        payload.leadId = recipient.id;
      } else if (recipient.type === "family") {
        payload.familyId = recipient.id;
        // If the user picked a specific family member, override the investor pointer
        if (selectedFamilyMemberId) payload.investorId = selectedFamilyMemberId;
      }
      Object.assign(payload, {
        type,
        riskRating,
        validUntil,
        coverLetter: coverLetter || undefined,
        disclaimer,
        products: items,
      });
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        // Surface which field failed so "invalid body" is never a dead end.
        const issue = Array.isArray(j.issues) ? j.issues[0] : null;
        const detail = issue ? ` — ${(issue.path ?? []).join(".") || "field"}: ${issue.message}` : "";
        setErr((j.error ?? `Save failed (${res.status})`) + detail);
        return;
      }
      router.push(`/dashboard/proposals/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto w-full">
      {/* Sticky header — title on the left, actions pinned on the right so Save
          is always one click away while filling a long form (sits just below
          the app topbar, which is h-16). */}
      <div className="sticky top-16 z-30 bg-background/95 backdrop-blur border-b border-border/60 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link
            href="/dashboard/proposals"
            className="text-xs text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 mb-0.5 transition-colors"
          >
            <ChevronLeft className="size-3.5" /> Back to proposals
          </Link>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 text-foreground">
            <FileSignature className="size-5 text-brand-cyan" /> New proposal
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/dashboard/proposals" className="btn-secondary text-sm">
            Cancel
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={busy || !recipient || !title || items.length === 0}
            className="btn-primary text-sm"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save proposal"}
          </button>
        </div>
      </div>

      {/* Save errors surface here (top) so they're visible from the sticky Save button. */}
      {err && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
          {err}
        </div>
      )}

      {/* ─── Recipient ─── */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">1. Recipient</h2>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setRecipientMode("investor");
              setRecipient(null);
            }}
            className={`rounded-lg border p-3 text-sm font-medium transition ${recipientMode === "investor"
                ? "border-brand-cyan bg-brand-cyan-light/40 text-brand-cyan-deep"
                : "border-border hover:bg-secondary"
              }`}
          >
            Existing client
          </button>
          <button
            type="button"
            onClick={() => {
              setRecipientMode("family");
              setRecipient(null);
              setSelectedFamilyMemberId(null);
            }}
            className={`rounded-lg border p-3 text-sm font-medium transition ${recipientMode === "family"
                ? "border-brand-cyan bg-brand-cyan-light/40 text-brand-cyan-deep"
                : "border-border hover:bg-secondary"
              }`}
          >
            Family / Family head
          </button>
          <button
            type="button"
            onClick={() => {
              setRecipientMode("lead");
              setRecipient(null);
            }}
            className={`rounded-lg border p-3 text-sm font-medium transition ${recipientMode === "lead"
                ? "border-brand-cyan bg-brand-cyan-light/40 text-brand-cyan-deep"
                : "border-border hover:bg-secondary"
              }`}
          >
            Lead (prospect)
          </button>
        </div>

        {recipientMode === "investor" ? (
          <InvestorLookup
            value={recipient?.type === "investor" ? recipient.id : null}
            displayName={recipient?.type === "investor" ? recipient.name : null}
            onSelect={(id, name) => setRecipient({ type: "investor", id, name })}
            onClear={() => setRecipient(null)}
            placeholder="Search client by name, PAN, mobile, or email…"
          />
        ) : recipientMode === "family" ? (
          <div className="space-y-3">
            {recipient?.type === "family" ? (
              <>
                {/* Picked family pill */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2">
                    <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0 shadow-sm">
                      {recipient.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{recipient.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Family group · contact resolves to the head
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRecipient(null);
                      setSelectedFamilyMemberId(null);
                      setFamilyMembers([]);
                    }}
                    className="btn-icon"
                    title="Clear"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {/* Optional: pick a specific family member as the addressee */}
                {familyMembers.length > 0 && (
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                      Address proposal to (optional)
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedFamilyMemberId(null)}
                        className={`text-left rounded-md border px-2.5 py-1.5 text-xs transition ${!selectedFamilyMemberId
                            ? "border-brand-cyan bg-brand-cyan-light/30"
                            : "border-border hover:bg-secondary"
                          }`}
                      >
                        <div className="font-semibold">Whole family</div>
                        <div className="text-[10px] text-muted-foreground">
                          Default · contact = head
                        </div>
                      </button>
                      {familyMembers.map((m: any) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedFamilyMemberId(m.id)}
                          className={`text-left rounded-md border px-2.5 py-1.5 text-xs transition ${selectedFamilyMemberId === m.id
                              ? "border-brand-cyan bg-brand-cyan-light/30"
                              : "border-border hover:bg-secondary"
                            }`}
                        >
                          <div className="font-semibold truncate">{m.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {m.familyRole ?? m.family_role ?? "Member"}
                            {m.isPrimary || m.is_primary ? " · Head" : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="relative">
                <input
                  value={familyQuery}
                  onChange={(e) => setFamilyQuery(e.target.value)}
                  placeholder="Search families by family name or head name…"
                  className="input-base"
                />
                {familyOptions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Loading families…
                  </p>
                ) : (
                  <ul className="mt-1 card-elevated max-h-72 overflow-y-auto scrollbar-thin">
                    {filteredFamilies.slice(0, 30).map((f: any) => {
                      const display = f.familyName ?? (f.headName ? `${f.headName} Family` : "Family");
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => pickFamily(f)}
                            className="w-full text-left px-3 py-2 hover:bg-brand-cyan-light/40 flex items-center gap-2"
                          >
                            <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0 shadow-sm">
                              {display
                                .split(" ")
                                .map((n: string) => n[0])
                                .filter(Boolean)
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-sm truncate">{display}</div>
                              <div className="text-[11px] text-muted-foreground">
                                Head · {f.headName ?? "—"}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                    {filteredFamilies.length === 0 && (
                      <li className="px-3 py-3 text-xs text-muted-foreground text-center">
                        No families match "{familyQuery}".
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : recipient?.type === "lead" ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2">
              <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0 shadow-sm">
                {recipient.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{recipient.name}</div>
                <div className="text-[11px] text-muted-foreground">Linked from Leads</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRecipient(null)}
              className="btn-icon"
              title="Clear"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
              placeholder="Search leads by name, phone, or email…"
              className="input-base"
            />
            {leadResults.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-60 overflow-y-auto scrollbar-thin">
                <ul className="py-1.5">
                  {leadResults.map((l: any) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setRecipient({ type: "lead", id: l.id, name: l.name });
                          setLeadQuery("");
                          setLeadResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-brand-cyan-light/40"
                      >
                        <div className="font-semibold text-sm">{l.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {l.phone ?? "—"} · {l.stage} · {l.source}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Cover + meta ─── */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">2. Title & framing</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Proposal title *</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Investment Proposal — Tax Saver FY26"
              className="input-base"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Type</div>
            <SelectField
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="input-base"
            >
              <option value="mutual_fund">Mutual Fund</option>
              <option value="insurance">Insurance</option>
              <option value="pms">PMS</option>
              <option value="aif">AIF</option>
              <option value="comprehensive">Comprehensive</option>
              <option value="mixed">Mixed</option>
            </SelectField>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Valid until</div>
            <DateField
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="input-base"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Overall risk rating</div>
            <SelectField
              value={riskRating}
              onChange={(e) => setRiskRating(e.target.value as any)}
              className="input-base"
            >
              <option value="conservative">Conservative</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
              <option value="mixed">Mixed</option>
            </SelectField>
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Cover letter (shown above products in PDF)</div>
          <textarea
            value={coverLetter}
            onChange={(e) => setCoverLetter(e.target.value)}
            rows={3}
            placeholder={`Dear ${recipient?.name ?? "Mr. Patel"},\n\nBasis our conversation, here is the proposal we discussed…`}
            className="input-base"
          />
        </label>
      </div>

      {/* ─── Products ─── */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded-full brand-bar" />
            <h2 className="section-title">3. Products ({items.length})</h2>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button type="button" onClick={() => addItem("mf")} className="btn-secondary text-xs">
              <Sparkles className="size-3.5" /> Add Mutual Fund
            </button>
            <button
              type="button"
              onClick={() => addItem("insurance")}
              className="btn-secondary text-xs"
            >
              <Shield className="size-3.5" /> Add Insurance
            </button>
            <button type="button" onClick={() => addItem("pms")} className="btn-secondary text-xs">
              <Briefcase className="size-3.5" /> Add PMS
            </button>
            <button type="button" onClick={() => addItem("aif")} className="btn-secondary text-xs">
              <TrendingUp className="size-3.5" /> Add AIF
            </button>
            <button type="button" onClick={() => addItem("other")} className="btn-secondary text-xs">
              <Landmark className="size-3.5" /> Add Other (FD / Bonds)
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
            No products yet. Click <strong>Add Mutual Fund / Insurance / PMS / AIF</strong> to
            start.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((it, i) => (
              <li key={i} className="rounded-xl border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`chip text-[10px] ${it.kind === "mf"
                          ? "bg-emerald-50 text-emerald-700"
                          : it.kind === "insurance"
                            ? "bg-blue-50 text-blue-700"
                            : it.kind === "pms"
                              ? "bg-amber-50 text-amber-700"
                              : it.kind === "other"
                                ? "bg-slate-100 text-slate-700"
                                : "bg-rose-50 text-rose-700"
                        }`}
                    >
                      {it.kind === "mf"
                        ? "Mutual Fund"
                        : it.kind === "insurance"
                          ? "Insurance"
                          : it.kind === "pms"
                            ? "PMS"
                            : it.kind === "other"
                              ? "Other Product"
                              : "AIF"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="btn-icon hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {it.kind === "mf" && (
                  <MFRow item={it} onPatch={(p) => patchItem(i, p)} />
                )}
                {it.kind === "insurance" && (
                  <InsRow item={it} onPatch={(p) => patchItem(i, p)} />
                )}
                {it.kind === "pms" && (
                  <PMSRow item={it} onPatch={(p) => patchItem(i, p)} />
                )}
                {it.kind === "aif" && (
                  <AIFRow item={it} onPatch={(p) => patchItem(i, p)} />
                )}
                {it.kind === "other" && (
                  <OtherRow item={it} onPatch={(p) => patchItem(i, p)} />
                )}
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
            <div className="rounded-lg bg-brand-cyan-light/30 border border-brand-cyan/20 p-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-brand-cyan-deep">
                Total investment
              </div>
              <div className="text-xl font-bold mt-1 tabular-nums">{formatINR(totals.inv)}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">
                Projected corpus
              </div>
              <div className="text-xl font-bold mt-1 tabular-nums text-emerald-700">
                {totals.corpus > 0 ? formatINR(totals.corpus) : "—"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Risk Suitability check ─── */}
      {recipient && items.some((it) => it.kind === "mf") && (
        <div className="card-surface p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded-full bg-amber-500" />
            <h2 className="section-title">Risk Suitability check</h2>
          </div>
          <RiskAlignmentBanner
            profile={clientRiskProfile as any}
            schemes={items
              .filter((it): it is MF => it.kind === "mf")
              .map((it) => ({
                name: it.schemeName,
                riskRating: it.riskRating,
              }))}
          />
        </div>
      )}

      {/* ─── Disclaimer + actions ─── */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">4. Disclaimer (shown in PDF footer)</h2>
        </div>
        <textarea
          value={disclaimer}
          onChange={(e) => setDisclaimer(e.target.value)}
          rows={3}
          className="input-base text-xs"
        />
        <p className="text-[11px] text-muted-foreground pt-1">
          Use <strong>Save proposal</strong> at the top to save &amp; continue to the branded PDF.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────── Per-kind row editors ─────────────────────── */

function NumberInput({
  label,
  value,
  setValue,
  placeholder,
  unit,
}: {
  label: string;
  value?: number;
  setValue: (n: number | undefined) => void;
  placeholder?: string;
  unit?: string;
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium mb-1 text-muted-foreground">
        {label}
        {unit && <span className="opacity-70 ml-1">({unit})</span>}
      </div>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value ?? ""}
        onChange={(e) =>
          setValue(e.target.value === "" ? undefined : Number(e.target.value))
        }
        placeholder={placeholder}
        className="input-base text-sm"
      />
    </label>
  );
}

function TextInput({
  label,
  value,
  setValue,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  setValue: (s: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium mb-1 text-muted-foreground">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="input-base text-sm"
      />
    </label>
  );
}

function MFRow({ item, onPatch }: { item: MF; onPatch: (p: Partial<MF>) => void }) {
  // Auto-calculate projected corpus on input changes
  useEffect(() => {
    const lumpsum = Number(item.lumpsum ?? 0);
    const sip = Number(item.monthlyAmount ?? 0);
    const years = Number(item.sipTermYears ?? 0);
    const rate = Number(item.expectedReturn ?? 0);
    if ((lumpsum > 0 || sip > 0) && years > 0 && rate > 0) {
      const fvLump = lumpsum * Math.pow(1 + rate / 100, years);
      const m = rate / 100 / 12;
      const months = years * 12;
      const fvSip = sip * ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
      const computed = Math.round(fvLump + fvSip);
      if (computed !== item.projectedCorpus) {
        onPatch({ projectedCorpus: computed });
      }
    }
  }, [item.lumpsum, item.monthlyAmount, item.sipTermYears, item.expectedReturn]);

  const MF_CATEGORIES = [
    "Large Cap", "Large & Mid Cap", "Mid Cap", "Small Cap", "Flexi Cap", "Multi Cap",
    "ELSS", "Index", "Hybrid", "Balanced Advantage", "Debt", "Liquid", "Gold", "Other",
  ];
  // Map a raw MFAPI scheme_category onto one of MF_CATEGORIES; most-specific first.
  const mapSchemeCategory = (raw?: string | null): string | undefined => {
    if (!raw) return undefined;
    const rules: Array<[RegExp, string]> = [
      [/large\s*&\s*mid|large\s*and\s*mid/i, "Large & Mid Cap"],
      [/flexi\s*cap/i, "Flexi Cap"],
      [/multi\s*cap/i, "Multi Cap"],
      [/large\s*cap/i, "Large Cap"],
      [/mid\s*cap/i, "Mid Cap"],
      [/small\s*cap/i, "Small Cap"],
      [/elss|tax\s*saver/i, "ELSS"],
      [/index|nifty|sensex|etf/i, "Index"],
      [/balanced\s*advantage|dynamic\s*asset/i, "Balanced Advantage"],
      [/hybrid|balanced|arbitrage/i, "Hybrid"],
      [/liquid|overnight|money\s*market/i, "Liquid"],
      [/debt|bond|gilt|duration|credit/i, "Debt"],
      [/gold|silver|commodit/i, "Gold"],
    ];
    for (const [re, cat] of rules) if (re.test(raw)) return cat;
    return undefined;
  };
  const [customCat, setCustomCat] = useState(false);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <div className="text-[11px] font-medium mb-1 text-muted-foreground">
          Scheme name <span className="text-rose-500">*</span>
        </div>
        <SchemeAutocomplete
          defaultValue={item.schemeName}
          onQueryChange={(v) => onPatch({ schemeName: v })}
          onSelect={(s) =>
            onPatch({
              schemeName: s.schemeName,
              amcName: s.amc ?? item.amcName,
              // Map the raw MFAPI scheme category onto a clean bucket so the
              // dropdown reflects the picked scheme (e.g. "…Large & Mid Cap
              // Fund" → "Large & Mid Cap"). Falls back to whatever was set.
              category: mapSchemeCategory(s.category) ?? item.category,
            })
          }
          placeholder="Search live MF catalog — or type a name…"
        />
      </div>
      <TextInput
        label="AMC"
        value={item.amcName ?? ""}
        setValue={(v) => onPatch({ amcName: v })}
        placeholder="HDFC AMC"
      />
      <div>
        <div className="text-[11px] font-medium mb-1 text-muted-foreground">Category</div>
        {customCat || (item.category && !MF_CATEGORIES.includes(item.category)) ? (
          <div className="flex items-center gap-1">
            <input
              value={item.category ?? ""}
              onChange={(e) => onPatch({ category: e.target.value })}
              placeholder="Type a custom category"
              autoFocus={customCat}
              className="input-base text-sm w-full"
            />
            <button
              type="button"
              onClick={() => { setCustomCat(false); onPatch({ category: "" }); }}
              className="btn-ghost text-xs px-2 shrink-0"
              title="Back to the list"
            >
              ↩
            </button>
          </div>
        ) : (
          <select
            value={item.category ?? ""}
            onChange={(e) => {
              if (e.target.value === "__custom__") {
                setCustomCat(true);
                onPatch({ category: "" });
              } else {
                onPatch({ category: e.target.value });
              }
            }}
            className="input-base text-sm w-full"
          >
            <option value="">— Select category —</option>
            {MF_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="__custom__">+ Add custom…</option>
          </select>
        )}
      </div>
      <NumberInput
        label="Lumpsum"
        unit="₹"
        value={item.lumpsum}
        setValue={(n) => onPatch({ lumpsum: n })}
      />
      <NumberInput
        label="Monthly SIP"
        unit="₹/mo"
        value={item.monthlyAmount}
        setValue={(n) => onPatch({ monthlyAmount: n })}
      />
      <NumberInput
        label="SIP term"
        unit="yrs"
        value={item.sipTermYears}
        setValue={(n) => onPatch({ sipTermYears: n })}
      />
      <NumberInput
        label="Expected return"
        unit="% p.a."
        value={item.expectedReturn}
        setValue={(n) => onPatch({ expectedReturn: n })}
      />
      <NumberInput
        label="Projected corpus"
        unit="₹"
        value={item.projectedCorpus}
        setValue={(n) => onPatch({ projectedCorpus: n })}
      />
      <label className="block">
        <div className="text-[11px] font-medium mb-1 text-muted-foreground">Risk rating</div>
        <SelectField
          value={item.riskRating ?? ""}
          onChange={(e) => onPatch({ riskRating: (e.target.value || undefined) as any })}
          className="input-base text-sm"
        >
          <option value="">Select…</option>
          <option value="low">Low</option>
          <option value="moderate">Moderate</option>
          <option value="high">High</option>
          <option value="very_high">Very High</option>
        </SelectField>
      </label>
      <div className="sm:col-span-3">
        <TextInput
          label="Notes / rationale"
          value={item.notes ?? ""}
          setValue={(v) => onPatch({ notes: v })}
          placeholder="Recommended for 80C tax benefit; matches client's moderate risk profile."
        />
      </div>
    </div>
  );
}

function InsRow({ item, onPatch }: { item: Ins; onPatch: (p: Partial<Ins>) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <TextInput
          label="Policy name"
          required
          value={item.policyName}
          setValue={(v) => onPatch({ policyName: v })}
          placeholder="HDFC Life Click 2 Protect Super"
        />
      </div>
      <TextInput
        label="Insurer"
        value={item.insurer ?? ""}
        setValue={(v) => onPatch({ insurer: v })}
        placeholder="HDFC Life"
      />
      <label className="block">
        <div className="text-[11px] font-medium mb-1 text-muted-foreground">Policy type</div>
        <SelectField
          value={item.policyType ?? ""}
          onChange={(e) => onPatch({ policyType: (e.target.value || undefined) as any })}
          className="input-base text-sm"
        >
          <option value="">Select…</option>
          <option value="term">Term</option>
          <option value="ulip">ULIP</option>
          <option value="endowment">Endowment</option>
          <option value="health">Health</option>
          <option value="money_back">Money-back</option>
          <option value="other">Other</option>
        </SelectField>
      </label>
      <NumberInput
        label="Sum assured"
        unit="₹"
        value={item.sumAssured}
        setValue={(n) => onPatch({ sumAssured: n })}
      />
      <NumberInput
        label="Annual premium"
        unit="₹"
        value={item.annualPremium}
        setValue={(n) => onPatch({ annualPremium: n })}
      />
      <NumberInput
        label="Term"
        unit="yrs"
        value={item.termYears}
        setValue={(n) => onPatch({ termYears: n })}
      />
      <div className="sm:col-span-3">
        <TextInput
          label="Notes / rationale"
          value={item.notes ?? ""}
          setValue={(v) => onPatch({ notes: v })}
          placeholder="₹1 cr cover at age 35; rider for critical illness recommended."
        />
      </div>
    </div>
  );
}

function PMSRow({ item, onPatch }: { item: PMS; onPatch: (p: Partial<PMS>) => void }) {
  const projectedPMS = useMemo(() => {
    const amt = Number(item.proposedAmount ?? 0);
    const ret = Number(item.expectedReturn ?? 0);
    const yrs = Number(item.termYears ?? 0);
    if (amt > 0 && ret > 0 && yrs > 0) {
      return amt * Math.pow(1 + ret / 100, yrs);
    }
    return 0;
  }, [item.proposedAmount, item.expectedReturn, item.termYears]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <TextInput
          label="Strategy name"
          required
          value={item.strategyName}
          setValue={(v) => onPatch({ strategyName: v })}
          placeholder="Marcellus Consistent Compounders"
        />
      </div>
      <TextInput
        label="Manager"
        value={item.manager ?? ""}
        setValue={(v) => onPatch({ manager: v })}
        placeholder="Marcellus PMS"
      />
      <NumberInput
        label="Min investment"
        unit="₹"
        value={item.minInvestment}
        setValue={(n) => onPatch({ minInvestment: n })}
      />
      <NumberInput
        label="Proposed amount"
        unit="₹"
        value={item.proposedAmount}
        setValue={(n) => onPatch({ proposedAmount: n })}
      />
      <NumberInput
        label="Expected return"
        unit="% p.a."
        value={item.expectedReturn}
        setValue={(n) => onPatch({ expectedReturn: n })}
      />
      <NumberInput
        label="Horizon"
        unit="yrs"
        value={item.termYears}
        setValue={(n) => onPatch({ termYears: n })}
      />
      {projectedPMS > 0 && (
        <div className="sm:col-span-3 text-[11px] text-emerald-600 font-semibold px-1 py-0.5 bg-emerald-50/50 rounded-md">
          Projected value: {formatINR(projectedPMS)} after {item.termYears} years
        </div>
      )}
      <div className="sm:col-span-3">
        <TextInput
          label="Notes / rationale"
          value={item.notes ?? ""}
          setValue={(v) => onPatch({ notes: v })}
          placeholder="Suitable for HNI clients with ≥50L investible surplus and 5+ yr horizon."
        />
      </div>
    </div>
  );
}

function AIFRow({ item, onPatch }: { item: AIF; onPatch: (p: Partial<AIF>) => void }) {
  const projectedAIF = useMemo(() => {
    const amt = Number(item.proposedAmount ?? 0);
    const irr = Number(item.targetIrr ?? 0);
    const yrs = Number(item.lockInYears ?? 0);
    if (amt > 0 && irr > 0 && yrs > 0) {
      return amt * Math.pow(1 + irr / 100, yrs);
    }
    return 0;
  }, [item.proposedAmount, item.targetIrr, item.lockInYears]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <TextInput
          label="Fund name"
          required
          value={item.fundName}
          setValue={(v) => onPatch({ fundName: v })}
          placeholder="ICICI Pru Long-Short Fund Series II"
        />
      </div>
      <TextInput
        label="Manager"
        value={item.manager ?? ""}
        setValue={(v) => onPatch({ manager: v })}
        placeholder="ICICI Prudential AIF"
      />
      <label className="block">
        <div className="text-[11px] font-medium mb-1 text-muted-foreground">Category</div>
        <SelectField
          value={item.category ?? ""}
          onChange={(e) => onPatch({ category: (e.target.value || undefined) as any })}
          className="input-base text-sm"
        >
          <option value="">Select…</option>
          <option value="cat1">Cat I</option>
          <option value="cat2">Cat II</option>
          <option value="cat3">Cat III</option>
        </SelectField>
      </label>
      <NumberInput
        label="Min investment"
        unit="₹"
        value={item.minInvestment}
        setValue={(n) => onPatch({ minInvestment: n })}
      />
      <NumberInput
        label="Proposed amount"
        unit="₹"
        value={item.proposedAmount}
        setValue={(n) => onPatch({ proposedAmount: n })}
      />
      <NumberInput
        label="Lock-in"
        unit="yrs"
        value={item.lockInYears}
        setValue={(n) => onPatch({ lockInYears: n })}
      />
      <NumberInput
        label="Target IRR"
        unit="% p.a."
        value={item.targetIrr}
        setValue={(n) => onPatch({ targetIrr: n })}
      />
      {projectedAIF > 0 && (
        <div className="sm:col-span-3 text-[11px] text-emerald-600 font-semibold px-1 py-0.5 bg-emerald-50/50 rounded-md">
          Projected value: {formatINR(projectedAIF)} after {item.lockInYears} years
        </div>
      )}
      <div className="sm:col-span-3">
        <TextInput
          label="Notes / rationale"
          value={item.notes ?? ""}
          setValue={(v) => onPatch({ notes: v })}
          placeholder="₹1cr min; 3-yr lock-in; suitable only for accredited investors."
        />
      </div>
    </div>
  );
}

function OtherRow({ item, onPatch }: { item: Other; onPatch: (p: Partial<Other>) => void }) {
  const projected = useMemo(() => {
    const amt = Number(item.amount ?? 0);
    const ret = Number(item.expectedReturn ?? 0);
    const yrs = Number(item.termYears ?? 0);
    return amt > 0 && ret > 0 && yrs > 0 ? amt * Math.pow(1 + ret / 100, yrs) : 0;
  }, [item.amount, item.expectedReturn, item.termYears]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <TextInput
          label="Product name"
          required
          value={item.productName}
          setValue={(v) => onPatch({ productName: v })}
          placeholder="Bank Fixed Deposit / Sovereign Gold Bond / NPS Tier-I"
        />
      </div>
      <TextInput
        label="Company / Issuer"
        value={item.company ?? ""}
        setValue={(v) => onPatch({ company: v })}
        placeholder="SBI / RBI / NSDL"
      />
      <NumberInput
        label="Amount"
        unit="₹"
        value={item.amount}
        setValue={(n) => onPatch({ amount: n })}
      />
      <NumberInput
        label="Expected return"
        unit="% p.a."
        value={item.expectedReturn}
        setValue={(n) => onPatch({ expectedReturn: n })}
      />
      <NumberInput
        label="Term"
        unit="yrs"
        value={item.termYears}
        setValue={(n) => onPatch({ termYears: n })}
      />
      {projected > 0 && (
        <div className="sm:col-span-3 text-[11px] text-emerald-600 font-semibold px-1 py-0.5 bg-emerald-50/50 rounded-md">
          Expected future value: {formatINR(projected)} after {item.termYears} years
        </div>
      )}
      <div className="sm:col-span-3">
        <TextInput
          label="Remarks"
          value={item.remarks ?? ""}
          setValue={(v) => onPatch({ remarks: v })}
          placeholder="5-yr tax-saver FD; auto-renew on maturity."
        />
      </div>
    </div>
  );
}
