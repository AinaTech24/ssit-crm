"use client";

/**
 * New/Edit Insurance Policy form.
 *
 *  0. Upload policy document → AI auto-fill (advisory; RM reviews before save).
 *  1. Pick the client (InvestorLookup).
 *  2. Plan details — insurer, plan name, type, sum assured, premium.
 *  3. Schedule — start, term, next premium due.
 *  4. Type-specific details (motor / health / general).
 *  5. Nominee.
 *  6. Status + remarks.
 *
 * The form is TYPE-AWARE: the fields shown adapt to the selected policy type's
 * category (life / health / motor / general), like the Sanchay tracker.
 */

import { useMemo, useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  Shield,
  Loader2,
  Save,
  IndianRupee,
  UploadCloud,
  Sparkles,
  AlertTriangle,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { SelectField } from "@/components/ui/SelectField";
import { DatePicker } from "@/components/ui/DatePicker";
import { ExtractionTimeline } from "@/components/insurance/ExtractionTimeline";
import { OptionalCoversMatrix } from "@/components/insurance/OptionalCoversMatrix";
import { formatINR } from "@/lib/utils";
import type { InsuranceExtraction, InsuranceCategory } from "@/lib/ai/assistant";

const POLICY_TYPES: [string, string][] = [
  ["term", "Term Life"],
  ["ulip", "ULIP"],
  ["endowment", "Endowment"],
  ["money_back", "Money-back"],
  ["health", "Health"],
  ["critical_illness", "Critical Illness"],
  ["personal_accident", "Personal Accident"],
  ["motor", "Motor"],
  ["travel", "Travel"],
  ["home", "Home"],
  ["life_other", "Life — Other"],
  ["fire", "Fire / Property"],
  ["marine", "Marine"],
  ["burglary", "Burglary"],
  ["workmen_comp", "Workmen Comp (WC)"],
  ["group_personal_accident", "Group Personal Accident (GPA)"],
  ["group_health", "Group Health (GHI)"],
  ["general_other", "General — Other"],
];

const CATEGORY_BY_TYPE: Record<string, InsuranceCategory> = {
  term: "life",
  ulip: "life",
  endowment: "life",
  money_back: "life",
  life_other: "life",
  health: "health",
  critical_illness: "health",
  personal_accident: "general",
  motor: "motor",
  travel: "general",
  home: "general",
  fire: "general",
  marine: "general",
  burglary: "general",
  workmen_comp: "general",
  group_personal_accident: "general",
  group_health: "health",
  general_other: "general",
};

const FREQ_FACTORS: Record<string, number> = {
  single: 0,
  annual: 1,
  semi_annual: 2,
  quarterly: 4,
  monthly: 12,
};

/** Friendly labels for the low-confidence + filled-field summaries. */
const FIELD_LABELS: Record<string, string> = {
  insurer: "Insurer",
  planName: "Plan name",
  policyNumber: "Policy number",
  policyType: "Policy type",
  sumAssured: "Sum assured",
  annualPremium: "Premium",
  premiumFrequency: "Frequency",
  policyStartDate: "Start date",
  maturityDate: "Expiry date",
  nextPremiumDueDate: "Next due",
  nomineeName: "Nominee",
};

export default function NewInsurancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="size-8 animate-spin text-brand-cyan" />
        </div>
      }
    >
      <NewInsuranceForm />
    </Suspense>
  );
}

function NewInsuranceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const [investor, setInvestor] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({
    policyNumber: "",
    insurer: "",
    planName: "",
    policyType: "term",
    livesCovered: 1,
    sumAssured: "",
    annualPremium: "",
    commission: "",
    premiumFrequency: "annual",
    premiumPayingTermYears: "",
    policyTermYears: "",
    policyStartDate: new Date().toISOString().slice(0, 10),
    maturityDate: "",
    nextPremiumDueDate: "",
    nomineeName: "",
    nomineeRelation: "",
    nomineeShare: 100,
    status: "active",
    remarks: "",
  });
  /** Category-specific extras + businessType + proposer (lands in details JSONB). */
  const [details, setDetails] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── AI auto-fill state ──────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [extractMsg, setExtractMsg] = useState<{
    filled: number;
    warnings: string[];
    lowConf: string[];
  } | null>(null);

  const category: InsuranceCategory = CATEGORY_BY_TYPE[form.policyType] ?? "general";
  const isLife = category === "life";
  const isHealth = category === "health";
  const isMotor = category === "motor";
  const showMaturity = isLife;
  const showPPT = isLife;
  const showNominee = !isMotor;
  const sumLabel = isMotor ? "IDV (₹)" : isLife ? "Sum assured (₹)" : "Sum insured (₹)";

  const toYmd = (d: any) => (d ? String(d).substring(0, 10) : "");

  useEffect(() => {
    if (!editId) return;
    let active = true;
    async function load() {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/insurance/${editId}`);
        if (!res.ok) throw new Error(`Failed to load policy (${res.status})`);
        const data = await res.json();
        if (!active) return;
        setInvestor({ id: data.investorId, name: data.investorName || "Unknown Client" });
        setForm({
          policyNumber: data.policyNumber || "",
          insurer: data.insurer || "",
          planName: data.planName || "",
          policyType: data.policyType || "term",
          livesCovered: data.livesCovered || 1,
          sumAssured: data.sumAssured != null ? String(data.sumAssured) : "",
          annualPremium: data.annualPremium != null ? String(data.annualPremium) : "",
          commission: data.commissionPaisa != null ? String(data.commissionPaisa) : "",
          premiumFrequency: data.premiumFrequency || "annual",
          premiumPayingTermYears:
            data.premiumPayingTermYears != null ? String(data.premiumPayingTermYears) : "",
          policyTermYears: data.policyTermYears != null ? String(data.policyTermYears) : "",
          policyStartDate: toYmd(data.policyStartDate),
          maturityDate: toYmd(data.maturityDate),
          nextPremiumDueDate: toYmd(data.nextPremiumDueDate),
          nomineeName: data.nomineeName || "",
          nomineeRelation: data.nomineeRelation || "",
          nomineeShare: data.nomineeShare != null ? data.nomineeShare : 100,
          status: data.status || "active",
          remarks: data.remarks || "",
        });
        setDetails(data.details && typeof data.details === "object" ? data.details : {});
      } catch (e: any) {
        if (active) setErr(e.message || "An error occurred loading the policy.");
      } finally {
        if (active) setBusy(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [editId]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }
  function setD(k: string, v: any) {
    setDetails((s) => ({ ...s, [k]: v }));
  }
  const d = (k: string) => (details[k] != null ? String(details[k]) : "");
  /** Rows of a table stored under details[key] (always an array). */
  const rowsOf = (k: string): Record<string, any>[] =>
    Array.isArray(details[k]) ? (details[k] as Record<string, any>[]) : [];

  // Country defaults to India unless the document / user says otherwise.
  useEffect(() => {
    setDetails((s) => (s.country ? s : { ...s, country: "India" }));
  }, []);

  // "Proposer address same as policyholder" — mirror the policyholder address
  // into the proposer address fields whenever the toggle is on or the source
  // address changes, so the proposer block stays in sync without re-typing.
  useEffect(() => {
    if (!details.proposerSameAddress) return;
    setDetails((s) => ({
      ...s,
      proposerAddressLine1: s.addressLine1 ?? "",
      proposerCity: s.city ?? "",
      proposerState: s.state ?? "",
      proposerPostalCode: s.postalCode ?? "",
      proposerCountry: s.country ?? "India",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.proposerSameAddress, details.addressLine1, details.city, details.state, details.postalCode, details.country]);

  /** Map an AI extraction onto the form — only overwrites fields the model
   *  actually found, so a partial scan never blanks what the RM already typed. */
  function applyDraft(x: InsuranceExtraction) {
    setForm((s) => ({
      ...s,
      policyNumber: x.policyNumber ?? s.policyNumber,
      insurer: x.insurer ?? s.insurer,
      planName: x.planName ?? s.planName,
      policyType: x.policyType ?? s.policyType,
      livesCovered: x.livesCovered ?? s.livesCovered,
      sumAssured: x.sumAssured != null ? String(x.sumAssured) : s.sumAssured,
      annualPremium: x.annualPremium != null ? String(x.annualPremium) : s.annualPremium,
      premiumFrequency: x.premiumFrequency ?? s.premiumFrequency,
      premiumPayingTermYears:
        x.premiumPayingTermYears != null ? String(x.premiumPayingTermYears) : s.premiumPayingTermYears,
      policyTermYears: x.policyTermYears != null ? String(x.policyTermYears) : s.policyTermYears,
      policyStartDate: x.policyStartDate ?? s.policyStartDate,
      maturityDate: x.maturityDate ?? s.maturityDate,
      nextPremiumDueDate: x.nextPremiumDueDate ?? s.nextPremiumDueDate,
      nomineeName: x.nomineeName ?? s.nomineeName,
      nomineeRelation: x.nomineeRelation ?? s.nomineeRelation,
    }));
    setDetails((prev) => ({
      ...prev,
      ...(x.details && typeof x.details === "object" ? x.details : {}),
      ...(x.businessType ? { businessType: x.businessType } : {}),
      ...(x.proposerName ? { proposerName: x.proposerName } : {}),
      ...(x.proposerPan ? { proposerPan: x.proposerPan } : {}),
      // Seed the nominees table from the extracted primary nominee (if the doc
      // didn't already yield a nominees array).
      ...(x.nomineeName && !(x.details as any)?.nominees && !(prev as any).nominees
        ? { nominees: [{ name: x.nomineeName, relation: x.nomineeRelation ?? "", share: "100", dob: "", email: "" }] }
        : {}),
    }));
  }

  async function onFile(file: File) {
    setErr(null);
    setExtractMsg(null);
    const okType = ["application/pdf", "image/jpeg", "image/jpg", "image/png"].includes(file.type);
    if (!okType) {
      setErr("Upload a PDF, JPG, or PNG.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setErr("File too large — maximum is 25MB.");
      return;
    }
    setExtracting(true);
    setProgress(5);
    // Staged progress — the extract is one opaque request, so ease toward 90%
    // while it runs and snap to 100% on response. Stage label derives from %.
    const timer = setInterval(() => {
      setProgress((p) => (p >= 90 ? 90 : p + Math.max(1, Math.round((93 - p) * 0.06))));
    }, 350);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/insurance/extract", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Extraction failed (${res.status}).`);
        return;
      }
      const x = j.draft as InsuranceExtraction;
      applyDraft(x);
      const topFields: Record<string, unknown> = {
        insurer: x.insurer,
        planName: x.planName,
        policyNumber: x.policyNumber,
        policyType: x.policyType,
        sumAssured: x.sumAssured,
        annualPremium: x.annualPremium,
        premiumFrequency: x.premiumFrequency,
        policyStartDate: x.policyStartDate,
        maturityDate: x.maturityDate,
        nextPremiumDueDate: x.nextPremiumDueDate,
        nomineeName: x.nomineeName,
      };
      const filled = Object.values(topFields).filter((v) => v != null && v !== "").length;
      const lowConf = Object.entries(x.fieldConfidence || {})
        .filter(([, v]) => typeof v === "number" && v < 0.6)
        .map(([k]) => FIELD_LABELS[k] ?? k);
      setExtractMsg({ filled, warnings: x.warnings || [], lowConf });
      if (filled === 0 && (x.warnings?.length ?? 0) === 0) {
        setErr("Couldn't read policy fields from that file — try a clearer scan or enter manually.");
      }
    } catch (e: any) {
      setErr(e.message || "Extraction failed.");
    } finally {
      clearInterval(timer);
      setProgress(100);
      setTimeout(() => { setExtracting(false); setProgress(0); }, 400);
    }
  }

  const installment = useMemo(() => {
    const ann = parseFloat(form.annualPremium) || 0;
    const factor = FREQ_FACTORS[form.premiumFrequency] ?? 1;
    if (!ann || !factor) return null;
    return ann / factor;
  }, [form.annualPremium, form.premiumFrequency]);

  function autoMaturity() {
    if (!form.policyStartDate || !form.policyTermYears) return;
    const start = new Date(form.policyStartDate);
    start.setFullYear(start.getFullYear() + Number(form.policyTermYears));
    set("maturityDate", start.toISOString().slice(0, 10));
  }

  async function save() {
    if (!investor) {
      setErr("Pick a client first.");
      return;
    }
    if (!form.insurer.trim() || !form.planName.trim()) {
      setErr("Insurer and plan name are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Drop empty detail keys so we don't persist a blob of "".
      const cleanDetails: Record<string, any> = {};
      for (const [k, v] of Object.entries(details)) {
        if (v !== "" && v != null) cleanDetails[k] = v;
      }
      const payload: any = {
        investorId: investor.id,
        policyNumber: form.policyNumber || undefined,
        insurer: form.insurer,
        planName: form.planName,
        policyType: form.policyType,
        livesCovered: Number(form.livesCovered) || 1,
        sumAssured: form.sumAssured ? Number(form.sumAssured) : undefined,
        annualPremium: form.annualPremium ? Number(form.annualPremium) : undefined,
        commissionPaisa: form.commission ? Number(form.commission) : undefined,
        premiumFrequency: form.premiumFrequency,
        premiumPayingTermYears: form.premiumPayingTermYears
          ? Number(form.premiumPayingTermYears)
          : undefined,
        policyTermYears: form.policyTermYears ? Number(form.policyTermYears) : undefined,
        policyStartDate: form.policyStartDate || undefined,
        maturityDate: form.maturityDate || undefined,
        nextPremiumDueDate: form.nextPremiumDueDate || undefined,
        // Primary nominee (first table row) → policy columns; full list stays in details.nominees.
        nomineeName: showNominee ? (((details.nominees as any[])?.[0]?.name) || form.nomineeName || undefined) : undefined,
        nomineeRelation: showNominee ? (((details.nominees as any[])?.[0]?.relation) || form.nomineeRelation || undefined) : undefined,
        nomineeShare: Number((details.nominees as any[])?.[0]?.share) || Number(form.nomineeShare) || 100,
        status: form.status,
        remarks: form.remarks || undefined,
        details: Object.keys(cleanDetails).length ? cleanDetails : undefined,
      };

      const res = await fetch(editId ? `/api/insurance/${editId}` : "/api/insurance", {
        method: editId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push(`/dashboard/insurance/${editId || j.id}`);
    } catch (e: any) {
      setErr(e.message || "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href={editId ? `/dashboard/insurance/${editId}` : "/dashboard/insurance"}
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronLeft className="size-4" /> Back to {editId ? "policy details" : "policies"}
      </Link>

      <div>
        <h1 className="page-title">
          <Shield className="size-6 text-brand-cyan" /> {editId ? "Edit insurance policy" : "Add insurance policy"}
        </h1>
      </div>

      {/* 0. Document auto-fill — upload a policy PDF/image → native read + OCR
          fills the fields for review. Available for both new AND edit (it only
          overwrites the fields the document actually contains). */}
      <div
          className={`card-surface p-5 border-2 border-dashed transition-colors ${dragOver ? "border-brand-cyan bg-brand-cyan-light/20" : "border-border"
            }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-col items-center text-center gap-2 py-2">
            {extracting ? (
              <ExtractionTimeline progress={progress} />
            ) : (
              <>
                <UploadCloud className="size-8 text-brand-cyan" />
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-primary mt-1">
                  <Sparkles className="size-4" /> Upload policy → auto-fill
                </button>
                <div className="text-xs text-muted-foreground">
                  Drag &amp; drop a PDF, JPG, or PNG — max 25MB. We read the document and fill the form for you to review.
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
                  <Lock className="size-3" /> Reviewed before saving · the file isn’t stored.
                </div>
              </>
            )}
          </div>

          {extractMsg && (
            <div className="mt-3 rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/20 px-3 py-2 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-brand-cyan-deep">
                <Sparkles className="size-3.5" />
                Auto-filled {extractMsg.filled} field{extractMsg.filled === 1 ? "" : "s"} — please review before saving.
              </div>
              {extractMsg.lowConf.length > 0 && (
                <div className="text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle className="size-3.5 mt-px shrink-0" />
                  <span>Double-check: {extractMsg.lowConf.join(", ")}.</span>
                </div>
              )}
              {extractMsg.warnings.map((w, i) => (
                <div key={i} className="text-muted-foreground">• {w}</div>
              ))}
            </div>
          )}
      </div>

      {/* 1. Policyholder */}
      <Section title="1. Policyholder">
        <InvestorLookup
          value={investor?.id ?? null}
          displayName={investor?.name ?? null}
          onSelect={(id, name) => setInvestor({ id, name })}
          onClear={() => setInvestor(null)}
          placeholder="Search client by name, PAN, mobile…"
          required
        />
      </Section>

      {/* 2. Plan details */}
      <Section title="2. Plan details">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Insurer *" placeholder="HDFC Life" value={form.insurer} setValue={(v) => set("insurer", v)} />
          <div className="col-span-2">
            <Field
              label="Plan name *"
              placeholder="Click 2 Protect Super"
              value={form.planName}
              setValue={(v) => set("planName", v)}
            />
          </div>
          <Field
            label="Policy number"
            placeholder="HD123456789"
            value={form.policyNumber}
            setValue={(v) => set("policyNumber", v)}
          />
          <Select label="Policy type *" value={form.policyType} setValue={(v) => set("policyType", v)}>
            {POLICY_TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Select label="Business type" value={d("businessType")} setValue={(v) => setD("businessType", v)}>
            <option value="">Select…</option>
            <option value="new">New</option>
            <option value="renewal">Renewal</option>
            <option value="portability">Portability</option>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label={sumLabel}
            type="number"
            placeholder="1000000"
            value={form.sumAssured}
            setValue={(v) => set("sumAssured", v)}
          />
          <Field
            label="Annual premium (₹)"
            type="number"
            placeholder="18000"
            value={form.annualPremium}
            setValue={(v) => set("annualPremium", v)}
          />
          <Select
            label="Premium frequency"
            value={form.premiumFrequency}
            setValue={(v) => set("premiumFrequency", v)}
          >
            <option value="single">Single-pay</option>
            <option value="annual">Annual</option>
            <option value="semi_annual">Semi-annual</option>
            <option value="quarterly">Quarterly</option>
            <option value="monthly">Monthly</option>
          </Select>
          <Field
            label="Commission (₹)"
            type="number"
            placeholder="e.g. 5400"
            value={form.commission}
            setValue={(v) => set("commission", v)}
          />
        </div>
        {installment != null && (
          <div className="rounded-lg bg-brand-cyan-light/30 border border-brand-cyan/20 px-3 py-2 text-xs flex items-center gap-2">
            <IndianRupee className="size-3.5 text-brand-cyan-deep" />
            <span>
              Each installment ≈ <strong className="tabular-nums">{formatINR(Math.round(installment))}</strong> ·{" "}
              {form.premiumFrequency.replace(/_/g, " ")}
            </span>
          </div>
        )}
      </Section>

      {/* 3. Schedule */}
      <Section title="3. Schedule">
        <div className="grid grid-cols-4 gap-3">
          <DateField
            label="Policy start"
            value={form.policyStartDate}
            setValue={(v) => set("policyStartDate", v)}
          />
          <Field
            label="Policy term (years)"
            type="number"
            placeholder={isLife ? "30" : "1"}
            value={form.policyTermYears}
            setValue={(v) => set("policyTermYears", v)}
          />
          {showPPT && (
            <Field
              label="Premium paying term"
              type="number"
              placeholder="20"
              value={form.premiumPayingTermYears}
              setValue={(v) => set("premiumPayingTermYears", v)}
            />
          )}
          <DateField label="Policy issue date" value={d("policyIssueDate")} setValue={(v) => setD("policyIssueDate", v)} />
          <div className="flex flex-col">
            <DateField label="Expiry date" value={form.maturityDate} setValue={(v) => set("maturityDate", v)} />
            <button
              type="button"
              onClick={autoMaturity}
              className="text-[10px] text-brand-cyan-deep hover:underline mt-1 text-left"
            >
              ⤷ Auto from start + term
            </button>
          </div>
          <DateField
            label="Next premium / renewal due"
            value={form.nextPremiumDueDate}
            setValue={(v) => set("nextPremiumDueDate", v)}
          />
        </div>
      </Section>

      {/* 4. Type-specific details */}
      {isMotor && (
        <Section title="4. Vehicle & motor cover">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Vehicle reg. no." placeholder="GJ01AB1234" value={d("vehicleRegNo")} setValue={(v) => setD("vehicleRegNo", v)} />
            <Field label="Make / model" placeholder="Maruti Swift VXi" value={d("makeModel")} setValue={(v) => setD("makeModel", v)} />
            <Field label="NCB %" type="number" placeholder="20" value={d("ncbPercent")} setValue={(v) => setD("ncbPercent", v)} />
            <Select label="Cover type" value={d("coverType")} setValue={(v) => setD("coverType", v)}>
              <option value="">Select…</option>
              <option value="comprehensive">Comprehensive</option>
              <option value="third_party">Third-party</option>
              <option value="od_only">Own-damage only</option>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            For motor, the IDV is captured in the “{sumLabel}” field above.
          </p>
        </Section>
      )}

      {isHealth && (
        <Section title="4. Health cover details">
          <div className="grid grid-cols-3 gap-3">
            <Field
              label="Lives covered"
              type="number"
              placeholder="1"
              value={String(form.livesCovered)}
              setValue={(v) => set("livesCovered", Number(v) || 1)}
            />
            <Field label="Room-rent cap (₹)" type="number" placeholder="5000" value={d("roomRentCapInr")} setValue={(v) => setD("roomRentCapInr", v)} />
            <Field label="Co-pay %" type="number" placeholder="10" value={d("coPayPercent")} setValue={(v) => setD("coPayPercent", v)} />
            <Field
              label="Pre-existing waiting (months)"
              type="number"
              placeholder="36"
              value={d("preExistingWaitingMonths")}
              setValue={(v) => setD("preExistingWaitingMonths", v)}
            />
            <label className="flex items-center gap-2 mt-6 text-sm">
              <input
                type="checkbox"
                checked={!!details.familyFloater}
                onChange={(e) => setD("familyFloater", e.target.checked)}
              />
              Family floater
            </label>
          </div>
        </Section>
      )}

      {category === "general" && (
        <Section title="4. Coverage details">
          <label className="block">
            <div className="text-xs font-medium mb-1">Coverage notes</div>
            <textarea
              value={d("coverageNotes")}
              onChange={(e) => setD("coverageNotes", e.target.value)}
              placeholder="What's covered, exclusions, add-ons…"
              rows={3}
              className="input-base"
            />
          </label>
        </Section>
      )}

      {/* 5. Nominees — multiple, hidden for motor. First row is the primary
          nominee (written to the policy's nominee columns); all rows are kept
          in details.nominees. Share % across nominees should total 100. */}
      {showNominee && (
        <Section title="5. Nominees">
          <TableEditor
            columns={[
              { key: "name", label: "Nominee name" },
              { key: "relation", label: "Relation", width: "w-28" },
              { key: "share", label: "Share %", width: "w-20" },
              { key: "dob", label: "DOB", width: "w-32" },
              { key: "email", label: "Email" },
            ]}
            rows={rowsOf("nominees")}
            onChange={(r) => setD("nominees", r)}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Add one row per nominee. The first row is the primary nominee; shares should total 100%.
          </p>
        </Section>
      )}

      {/* Policyholder details & address */}
      <Section title="Policyholder details & address">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Policyholder name" placeholder="As on policy" value={d("holderName")} setValue={(v) => setD("holderName", v)} />
          <Field label="Customer ID" placeholder="" value={d("customerId")} setValue={(v) => setD("customerId", v)} />
          <Field label="UIN" placeholder="" value={d("uin")} setValue={(v) => setD("uin", v)} />
          <Field label="Email ID" type="email" placeholder="" value={d("email")} setValue={(v) => setD("email", v)} />
          <Field label="Mobile no" placeholder="" value={d("mobile")} setValue={(v) => setD("mobile", v)} />
        </div>
        <Field label="Address — street / line 1" placeholder="" value={d("addressLine1")} setValue={(v) => setD("addressLine1", v)} />
        <div className="grid grid-cols-4 gap-3">
          <Field label="City" placeholder="" value={d("city")} setValue={(v) => setD("city", v)} />
          <Field label="State" placeholder="" value={d("state")} setValue={(v) => setD("state", v)} />
          <Field label="Postal code" placeholder="" value={d("postalCode")} setValue={(v) => setD("postalCode", v)} />
          <Field label="Country" placeholder="India" value={d("country") || "India"} setValue={(v) => setD("country", v)} />
        </div>
      </Section>

      {/* Insured member details (table) */}
      <Section title="Insured member details">
        <TableEditor
          columns={[
            { key: "name", label: "Member name" },
            { key: "customerId", label: "Customer ID", width: "w-28" },
            { key: "planOpted", label: "Plan opted", width: "w-28" },
            { key: "subPlanOpted", label: "Sub plan opted", width: "w-28" },
            { key: "gender", label: "Gender", width: "w-20" },
            { key: "dob", label: "DOB", width: "w-28" },
            { key: "age", label: "Age", width: "w-16" },
            { key: "relation", label: "Relation", width: "w-24" },
            { key: "firstInceptionDate", label: "First policy inception", width: "w-32" },
            { key: "insuredAddress", label: "Insured address", width: "w-44", type: "textarea" },
            { key: "nominee", label: "Nominee & relation" },
          ]}
          rows={rowsOf("insuredMembers")}
          onChange={(r) => setD("insuredMembers", r)}
        />
      </Section>

      {/* Sum insured & cover details (table) */}
      <Section title="Sum insured & cover details">
        <TableEditor
          columns={[
            { key: "memberName", label: "Member name" },
            { key: "cover", label: "Cover" },
            { key: "sumInsured", label: "Sum insured", width: "w-32" },
            { key: "cb", label: "CB", width: "w-20" },
            { key: "cbAmount", label: "CB amount", width: "w-28" },
            { key: "limit", label: "Limit / notes" },
          ]}
          rows={rowsOf("sumInsuredCovers")}
          onChange={(r) => setD("sumInsuredCovers", r)}
          headerRight={
            <button
              type="button"
              onClick={() => {
                const members = (rowsOf("insuredMembers") as any[]).map((m) => (m?.name ?? "").trim()).filter(Boolean);
                if (members.length === 0) return;
                const existing = rowsOf("sumInsuredCovers") as any[];
                const have = new Set(existing.map((r) => (r?.memberName ?? "").trim()));
                const add = members.filter((n) => !have.has(n)).map((n) => ({ memberName: n }));
                if (add.length) setD("sumInsuredCovers", [...existing, ...add]);
              }}
              className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1"
            >
              <Plus className="size-3.5" /> Add a row per insured member
            </button>
          }
        />
      </Section>

      {/* Optional covers — member rows × dynamic cover columns (matches the
          insurer's printed matrix). */}
      <Section title="Optional covers">
        <OptionalCoversMatrix rows={rowsOf("optionalCovers")} onChange={(r) => setD("optionalCovers", r)} />
      </Section>

      {/* Premium details (table) */}
      <Section title="Premium details">
        <TableEditor
          columns={[
            { key: "description", label: "Description" },
            { key: "amount", label: "Amount (₹)", width: "w-32" },
          ]}
          rows={rowsOf("premiumBreakdown")}
          onChange={(r) => setD("premiumBreakdown", r)}
        />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Gross premium (₹)" type="number" placeholder="" value={d("grossPremium")} setValue={(v) => setD("grossPremium", v)} />
          <Field label="Financial year" placeholder="YYYY-YYYY" value={d("financialYear")} setValue={(v) => setD("financialYear", v)} />
          <Field label="80-D amount (₹)" type="number" placeholder="" value={d("eightyDAmount")} setValue={(v) => setD("eightyDAmount", v)} />
        </div>
      </Section>

      {/* Exclusions (table) */}
      <Section title="Exclusions">
        <TableEditor
          columns={[
            { key: "memberName", label: "Member name" },
            { key: "exclusion", label: "Exclusion" },
          ]}
          rows={rowsOf("exclusions")}
          onChange={(r) => setD("exclusions", r)}
        />
      </Section>

      {/* Agency & sourcing */}
      <Section title="Agency & sourcing">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Agency code" placeholder="" value={d("agencyCode")} setValue={(v) => setD("agencyCode", v)} />
          <Field label="Agency name" placeholder="Agent name" value={d("agencyName")} setValue={(v) => setD("agencyName", v)} />
          <Field label="Contact no" placeholder="" value={d("agencyContact")} setValue={(v) => setD("agencyContact", v)} />
          <Field label="Email ID" type="email" placeholder="" value={d("agencyEmail")} setValue={(v) => setD("agencyEmail", v)} />
        </div>
      </Section>

      {/* Receipt, payment & tax */}
      <Section title="Receipt, payment & tax">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Receipt no" placeholder="" value={d("receiptNo")} setValue={(v) => setD("receiptNo", v)} />
          <DateField label="Receipt date" value={d("receiptDate")} setValue={(v) => setD("receiptDate", v)} />
          <Field label="Business channel" placeholder="Agent / Broker / Direct" value={d("businessChannel")} setValue={(v) => setD("businessChannel", v)} />
          <Field label="Tax invoice no" placeholder="" value={d("taxInvoiceNo")} setValue={(v) => setD("taxInvoiceNo", v)} />
          <DateField label="Tax invoice date" value={d("taxInvoiceDate")} setValue={(v) => setD("taxInvoiceDate", v)} />
          <Field label="GSTIN / PAN" placeholder="" value={d("gstin")} setValue={(v) => setD("gstin", v)} />
        </div>
        <Field
          label="Payment details"
          placeholder=""
          value={d("paymentDetails")}
          setValue={(v) => setD("paymentDetails", v)}
        />
      </Section>

      {/* 6. Proposer (if different) + Status + remarks */}
      <Section title="6. Proposer, status & remarks">
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Proposer name"
            placeholder="If different from policyholder"
            value={d("proposerName")}
            setValue={(v) => setD("proposerName", v)}
          />
          <Select label="Status" value={form.status} setValue={(v) => set("status", v)}>
            <option value="proposed">Proposed</option>
            <option value="in_underwriting">In underwriting</option>
            <option value="active">Active</option>
            <option value="lapsed">Lapsed</option>
            <option value="matured">Matured</option>
            <option value="surrendered">Surrendered</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Field label="Proposer customer ID" placeholder="If different" value={d("proposerCustomerId")} setValue={(v) => setD("proposerCustomerId", v)} />
          <Field label="Proposer phone" placeholder="" value={d("proposerPhone")} setValue={(v) => setD("proposerPhone", v)} />
          <Field label="Proposer email" type="email" placeholder="" value={d("proposerEmail")} setValue={(v) => setD("proposerEmail", v)} />
        </div>

        {/* Same-address toggle */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!details.proposerSameAddress}
            onChange={(e) => setD("proposerSameAddress", e.target.checked)}
          />
          Proposer address same as policyholder
        </label>
        {!details.proposerSameAddress && (
          <>
            <Field label="Proposer address — line 1" value={d("proposerAddressLine1")} setValue={(v) => setD("proposerAddressLine1", v)} />
            <div className="grid grid-cols-4 gap-3">
              <Field label="City" value={d("proposerCity")} setValue={(v) => setD("proposerCity", v)} />
              <Field label="State" value={d("proposerState")} setValue={(v) => setD("proposerState", v)} />
              <Field label="Postal code" value={d("proposerPostalCode")} setValue={(v) => setD("proposerPostalCode", v)} />
              <Field label="Country" value={d("proposerCountry") || "India"} setValue={(v) => setD("proposerCountry", v)} />
            </div>
          </>
        )}

        <Field
          label="Remarks"
          placeholder="Notes — surrender value, rider details, claim history…"
          value={form.remarks}
          setValue={(v) => set("remarks", v)}
        />

        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Link href={editId ? `/dashboard/insurance/${editId}` : "/dashboard/insurance"} className="btn-secondary">
            Cancel
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={busy || extracting || !investor || !form.insurer || !form.planName}
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : editId ? "Update policy" : "Save policy"}
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full brand-bar" />
        <h2 className="section-title">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  setValue,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="input-base"
      />
    </label>
  );
}

function Select({
  label,
  value,
  setValue,
  children,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <SelectField value={value} onChange={(e) => setValue(e.target.value)} className="w-full" aria-label={label}>
        {children}
      </SelectField>
    </label>
  );
}

function DateField({ label, value, setValue }: { label: string; value: string; setValue: (v: string) => void }) {
  return (
    <div className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <DatePicker value={value} onChange={setValue} className="w-full" ariaLabel={label} />
    </div>
  );
}

/** Generic editable table bound to a details[] array — add / edit / remove rows.
 *  Auto-fill populates the same array, so a scanned PDF lands straight here. */
function TableEditor({
  columns,
  rows,
  onChange,
  headerRight,
}: {
  columns: { key: string; label: string; width?: string; type?: "text" | "textarea" }[];
  rows: Record<string, any>[];
  onChange: (rows: Record<string, any>[]) => void;
  headerRight?: React.ReactNode;
}) {
  const update = (i: number, key: string, val: string) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  // Cells can hold a plain string or (defensively) an extracted {value} object.
  const cell = (v: any): string => (v == null ? "" : typeof v === "object" ? String(v.value ?? "") : String(v));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-1.5 font-medium">{c.label}</th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-2 py-3 text-xs text-muted-foreground">
                  No rows yet — add one, or upload a policy PDF to auto-fill.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0 align-top">
                {columns.map((c) => (
                  <td key={c.key} className={`px-1 py-1 ${c.width ?? ""}`}>
                    {c.type === "textarea" ? (
                      <textarea
                        value={cell(r[c.key])}
                        onChange={(e) => update(i, c.key, e.target.value)}
                        rows={1}
                        className="input-base text-xs py-1 resize-none overflow-y-auto scrollbar-none leading-snug min-h-[2rem] max-h-16"
                      />
                    ) : (
                      <input
                        value={cell(r[c.key])}
                        onChange={(e) => update(i, c.key, e.target.value)}
                        className="input-base text-xs py-1"
                      />
                    )}
                  </td>
                ))}
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground hover:text-rose-600 p-1"
                    aria-label="Remove row"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onChange([...rows, {}])} className="btn-ghost text-xs inline-flex items-center gap-1">
          <Plus className="size-3.5" /> Add row
        </button>
        {headerRight}
      </div>
    </div>
  );
}
