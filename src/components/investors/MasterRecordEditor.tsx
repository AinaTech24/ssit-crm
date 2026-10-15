"use client";

/**
 * Client-details editor — the single editable surface for the Client 360 master
 * record. Renders an "Edit" button in the master-record header; clicking opens a
 * right drawer with the full editable field set as a MULTI-STEP wizard
 * (Identity → Contact → Profile → Compliance status → Nominee → Bank account →
 * Financials → Review & lifecycle). Every field is preserved; a single form
 * state spans all steps and saves once at the end.
 *
 * Saves via PATCH /api/investors/[id], then refreshes. Computed fields (AUM,
 * lifetime flows, review dates) stay read-only. PAN is the identity key → read-only.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, X, Loader2, Save, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { NomineesField } from "@/components/investors/NomineesField";
import { UccCodesField } from "@/components/investors/UccCodesField";
import { ClientTagsField } from "@/components/investors/ClientTagsField";
import { CLIENT_CODE_FIELDS } from "@/lib/investors/client-tags";
import { cleanUccCodes } from "@/lib/investors/ucc";
import { formatINR } from "@/lib/utils";
import type { Nominee } from "@/lib/investors/nominee";

type Investor = Record<string, any>;

export type MasterEditFlags = {
  showDob: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showAddress: boolean;
  showSegment: boolean;
  showKyc: boolean;
  showRisk: boolean;
  showNominee: boolean;
  showBank: boolean;
  showStatus: boolean;
  showRm: boolean;
  /** Financials step read-only figures — respect the same license gating as
   *  the read view. Optional so older callers still compile. */
  showAum?: boolean;
  showSip?: boolean;
  showInflow?: boolean;
};

export function MasterRecordEditor({ investor, flags }: { investor: Investor; flags: MasterEditFlags }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addr = (investor.address as any) ?? {};
  const seedNominees: Nominee[] =
    (investor as any).nominees?.length
      ? (investor as any).nominees
      : investor.nomineeName
        ? [{ name: investor.nomineeName, relation: investor.nomineeRelation ?? "" }]
        : [];
  const seedBanks: { bankName: string; accountMasked?: string; ifsc?: string }[] =
    (investor as any).bankAccounts?.length
      ? (investor as any).bankAccounts
      : investor.bankName
        ? [{ bankName: investor.bankName, accountMasked: investor.bankAccountNumberMasked ?? "", ifsc: investor.bankIfsc ?? "" }]
        : [];

  const [f, setF] = useState({
    name: investor.name ?? "",
    nameAsPerPan: investor.nameAsPerPan ?? "",
    maritalStatus: investor.maritalStatus ?? "",
    motherName: investor.motherName ?? "",
    birthPlace: investor.birthPlace ?? "",
    aadhaarLast4: investor.aadhaarLast4 ?? "",
    dob: investor.dob ? String(investor.dob).slice(0, 10) : "",
    gender: investor.gender ?? "",
    phone: investor.phone ?? "",
    alternatePhone: investor.alternatePhone ?? "",
    whatsappPhone: investor.whatsappPhone ?? "",
    email: investor.email ?? "",
    mobileRelation: investor.mobileRelation ?? "",
    emailRelation: investor.emailRelation ?? "",
    line1: addr.line1 ?? "",
    city: addr.city ?? "",
    state: addr.state ?? "",
    pincode: addr.pincode ?? "",
    country: addr.country ?? "",
    occupation: investor.occupation ?? "",
    incomeRange: investor.incomeRange ?? "",
    employerName: investor.employerName ?? "",
    modeOfHolding: investor.modeOfHolding ?? "",
    householdType: investor.householdType ?? "",
    investorCategory: investor.investorCategory ?? "individual",
    segmentTag: investor.segmentTag ?? "",
    clientCategory: investor.clientCategory ?? "",
    serviceTier: investor.serviceTier ?? "",
    // A custom day cadence (reviewFrequencyDays) is shown as "days_<n>" so the
    // one dropdown covers both presets and "every N days".
    reviewFrequency: (investor as any).reviewFrequencyDays
      ? `days_${(investor as any).reviewFrequencyDays}`
      : investor.reviewFrequency ?? "",
    rmId: investor.rmId ?? "",
    serviceRmId: (investor as any).serviceRmId ?? "",
    kycStatus: investor.kycStatus ?? "pending",
    riskProfile: investor.riskProfile ?? "",
    residencyStatus: investor.residencyStatus ?? "",
    taxStatus: investor.taxStatus ?? "",
    panAadhaarLinkStatus: investor.panAadhaarLinkStatus ?? "",
    ckycNumber: investor.ckycNumber ?? "",
    ckycExpiryAt: investor.ckycExpiryAt ? String(investor.ckycExpiryAt).slice(0, 10) : "",
    kycValidatedAt: investor.kycValidatedAt ? String(investor.kycValidatedAt).slice(0, 10) : "",
    kraName: investor.kraName ?? "",
    fatcaStatus: investor.fatcaStatus ?? "",
    fatcaExpiryAt: investor.fatcaExpiryAt ? String(investor.fatcaExpiryAt).slice(0, 10) : "",
    nominees: seedNominees,
    bankAccounts: seedBanks,
    bseUccCode: investor.bseUccCode ?? "",
    tags: ((investor as any).tags as string[] | null) ?? [],
    mfCode: (investor as any).mfCode ?? "",
    moCode: (investor as any).moCode ?? "",
    bajajCode: (investor as any).bajajCode ?? "",
    lasCode: (investor as any).lasCode ?? "",
    nseCanCode: investor.nseCanCode ?? "",
    uccCodes: ((investor as any).uccCodes as string[] | undefined) ?? [],
    mandateStatus: investor.mandateStatus ?? "none",
    mandateRefNo: investor.mandateRefNo ?? "",
    onboardedAt: investor.onboardedAt ? String(investor.onboardedAt).slice(0, 10) : "",
    lastReviewAt: investor.lastReviewAt ? String(investor.lastReviewAt).slice(0, 10) : "",
    nextReviewAt: investor.nextReviewAt ? String(investor.nextReviewAt).slice(0, 10) : "",
    anniversaryDate: investor.anniversaryDate ? String(investor.anniversaryDate).slice(0, 10) : "",
    status: investor.status ?? "active",
    notes: investor.notes ?? "",
  });

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  // Steps are built from the license flags so hidden groups don't leave an
  // empty wizard page. A single `f` spans all of them; Save is on the last step.
  const hasContact = flags.showPhone || flags.showEmail || flags.showAddress;
  const steps: { key: string; title: string }[] = [
    { key: "identity", title: "Identity" },
    ...(hasContact ? [{ key: "contact", title: "Contact" }] : []),
    { key: "profile", title: "Profile" },
    { key: "compliance", title: "Compliance status" },
    ...(flags.showNominee ? [{ key: "nominee", title: "Nominee" }] : []),
    ...(flags.showBank ? [{ key: "bank", title: "Bank account" }] : []),
    { key: "financials", title: "Financials" },
    { key: "review", title: "Review & lifecycle" },
  ];
  const stepKey = steps[Math.min(step, steps.length - 1)]?.key ?? "identity";
  const isLast = step >= steps.length - 1;

  function openEditor() {
    setStep(0);
    setErr(null);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const inSet = (v: string | null | undefined, allowed: string[]) =>
        v && allowed.includes(v) ? v : undefined;
      const emailOk = (v: string) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
      const payload: any = {
        name: f.name,
        nameAsPerPan: f.nameAsPerPan || null,
        maritalStatus: f.maritalStatus || null,
        motherName: f.motherName || null,
        birthPlace: f.birthPlace || null,
        // 4 digits or nothing — a half-typed value is dropped rather than
        // failing the whole save with a schema error.
        aadhaarLast4: f.aadhaarLast4 ? (/^\d{4}$/.test(f.aadhaarLast4) ? f.aadhaarLast4 : undefined) : null,
        dob: f.dob || null,
        gender: inSet(f.gender, ["M", "F", "O"]) ?? null,
        phone: f.phone || null,
        alternatePhone: f.alternatePhone || null,
        whatsappPhone: f.whatsappPhone || null,
        email: emailOk(f.email) ? f.email || "" : undefined,
        address: {
          line1: f.line1 || undefined,
          city: f.city || undefined,
          state: f.state || undefined,
          pincode: f.pincode || undefined,
          country: f.country || undefined,
        },
        occupation: f.occupation || null,
        incomeRange: f.incomeRange || null,
        employerName: f.employerName || null,
        mobileRelation: f.mobileRelation || null,
        emailRelation: f.emailRelation || null,
        modeOfHolding: f.modeOfHolding || null,
        householdType: f.householdType || null,
        residencyStatus: inSet(f.residencyStatus, ["indian_resident", "nri", "oci", "pio", "foreign_national"]) ?? null,
        taxStatus: f.taxStatus || null,
        panAadhaarLinkStatus: inSet(f.panAadhaarLinkStatus, ["linked", "not_linked", "pending", "not_applicable"]) ?? null,
        ckycNumber: f.ckycNumber || null,
        ckycExpiryAt: f.ckycExpiryAt || null,
        kycValidatedAt: f.kycValidatedAt || null,
        kraName: f.kraName || null,
        fatcaStatus: inSet(f.fatcaStatus, ["pending", "verified", "expired"]) ?? null,
        fatcaExpiryAt: f.fatcaExpiryAt || null,
        // Treat the "—" placeholder (and "") as empty so the API's enum
        // validation never rejects the literal dash ("invalid body").
        investorCategory: inSet(f.investorCategory, ["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"]),
        segmentTag: inSet(f.segmentTag, ["HNI", "Affluent", "Retail", "NRI", "Corporate"]),
        clientCategory: inSet(f.clientCategory, ["A", "B", "C", "D"]) ?? null,
        serviceTier: inSet(f.serviceTier, ["A", "B", "C"]) ?? null,
        // "days_<n>" → custom cadence; anything else → a preset. Exactly one of
        // the two is set, so the API's computeNextReview picks the right basis.
        reviewFrequency: /^days_\d+$/.test(f.reviewFrequency)
          ? null
          : inSet(f.reviewFrequency, ["monthly", "quarterly", "half_yearly", "annual"]) ?? null,
        reviewFrequencyDays: /^days_\d+$/.test(f.reviewFrequency)
          ? Number(f.reviewFrequency.slice(5))
          : null,
        rmId: f.rmId || undefined,
        // Only sent when changed, so an editor opened without the field can
        // never wipe the client's service RM by saving.
        serviceRmId:
          f.serviceRmId !== ((investor as any).serviceRmId ?? "") ? f.serviceRmId || null : undefined,
        kycStatus: inSet(f.kycStatus, ["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"]),
        riskProfile: inSet(f.riskProfile, ["conservative", "moderate", "aggressive", "very_aggressive"]),
        nominees: f.nominees
          .map((n) => ({ ...n, name: (n.name || "").trim(), relation: (n.relation || "").trim() || undefined }))
          .filter((n) => n.name),
        bankAccounts: f.bankAccounts
          .map((b) => ({
            bankName: (b.bankName || "").trim(),
            accountMasked: (b.accountMasked || "").trim() || undefined,
            ifsc: (b.ifsc || "").trim().toUpperCase() || undefined,
          }))
          .filter((b) => b.bankName),
        bseUccCode: f.bseUccCode || null,
        tags: f.tags,
        mfCode: f.mfCode || null,
        moCode: f.moCode || null,
        bajajCode: f.bajajCode || null,
        lasCode: f.lasCode || null,
        nseCanCode: f.nseCanCode || null,
        uccCodes: cleanUccCodes(f.uccCodes),
        mandateStatus: inSet(f.mandateStatus, ["none", "pending", "active", "expired", "rejected", "cancelled"]),
        mandateRefNo: f.mandateRefNo || null,
        onboardedAt: f.onboardedAt || undefined,
        // null clears the date; the API recomputes nextReviewAt from a NEW
        // lastReviewAt unless an explicit nextReviewAt is also supplied.
        lastReviewAt: f.lastReviewAt || null,
        nextReviewAt: f.nextReviewAt || null,
        anniversaryDate: f.anniversaryDate || null,
        status: inSet(f.status, ["active", "dormant", "inactive", "redemption_risk", "closed", "exited"]),
        notes: f.notes,
        // Optimistic-concurrency token: the version we loaded. The API rejects
        // (409) if someone else saved in the meantime, surfaced via setErr below.
        expectedUpdatedAt: (investor as any).updatedAt ?? undefined,
      };
      const res = await fetch(`/api/investors/${investor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const fields = Array.isArray(j.issues)
          ? j.issues.map((i: any) => (Array.isArray(i.path) ? i.path.join(".") : "")).filter(Boolean).join(", ")
          : "";
        setErr((j.error ?? `Save failed (${res.status})`) + (fields ? ` — check: ${fields}` : ""));
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={openEditor}
        className="rounded-md border border-border bg-secondary/40 p-1.5 hover:bg-secondary inline-flex items-center justify-center"
        title="Edit client details"
        aria-label="Edit client details"
      >
        <Pencil className="size-4" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start sm:items-center justify-center p-0 sm:p-6" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full sm:h-[82vh] sm:max-h-[720px] sm:max-w-lg bg-card border border-border shadow-2xl flex flex-col sm:rounded-xl overflow-hidden animate-scale-in"
          >
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2"><Pencil className="size-4 text-brand-cyan" /> Edit client details</div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent" aria-label="Close"><X className="size-4" /></button>
            </div>

            {/* Step rail — jump to any step; current highlighted, done ones tinted. */}
            <div className="px-4 py-2.5 border-b overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-1 min-w-max">
                {steps.map((s, i) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStep(i)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                      i === step
                        ? "bg-brand-cyan text-white"
                        : i < step
                          ? "text-brand-cyan-deep hover:bg-secondary"
                          : "text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    <span className={`grid place-items-center size-4 rounded-full text-[9px] font-bold ${i === step ? "bg-white/25" : "bg-secondary"}`}>{i + 1}</span>
                    {s.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-none p-4 space-y-5 text-sm">
              {stepKey === "identity" && (
                <Grp title="Identity">
                  <F label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className="input-base" /></F>
                  <F label="Name as per PAN"><input value={f.nameAsPerPan} onChange={(e) => set("nameAsPerPan", e.target.value)} className="input-base" /></F>
                  {flags.showDob && <F label="Date of birth"><DateField value={f.dob} onChange={(e) => set("dob", e.target.value)} className="w-full" /></F>}
                  <F label="Gender">
                    <SelectField value={f.gender} onChange={(e) => set("gender", e.target.value)} className="w-full" placeholder="Select">
                      <option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
                    </SelectField>
                  </F>
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Marital status"><input value={f.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)} placeholder="e.g. Married" className="input-base" /></F>
                    <F label="Mother’s name"><input value={f.motherName} onChange={(e) => set("motherName", e.target.value)} className="input-base" /></F>
                    <F label="Place of birth"><input value={f.birthPlace} onChange={(e) => set("birthPlace", e.target.value)} className="input-base" /></F>
                    <F label="Aadhaar (last 4)"><input value={f.aadhaarLast4} onChange={(e) => set("aadhaarLast4", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" inputMode="numeric" className="input-base font-mono" /></F>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Client since"><DateField value={f.onboardedAt} onChange={(e) => set("onboardedAt", e.target.value)} className="w-full" /></F>
                    <F label="Anniversary"><DateField value={f.anniversaryDate} onChange={(e) => set("anniversaryDate", e.target.value)} className="w-full" /></F>
                  </div>
                </Grp>
              )}

              {stepKey === "contact" && (
                <Grp title="Contact">
                  {flags.showPhone && <F label="Mobile"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} className="input-base" /></F>}
                  {flags.showPhone && <F label="Alternate mobile"><input value={f.alternatePhone} onChange={(e) => set("alternatePhone", e.target.value)} className="input-base" /></F>}
                  {flags.showPhone && <F label="WhatsApp"><input value={f.whatsappPhone} onChange={(e) => set("whatsappPhone", e.target.value)} className="input-base" /></F>}
                  {flags.showEmail && <F label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} className="input-base" /></F>}
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Mobile belongs to"><input value={f.mobileRelation} onChange={(e) => set("mobileRelation", e.target.value)} placeholder="self / spouse / …" className="input-base" /></F>
                    <F label="Email belongs to"><input value={f.emailRelation} onChange={(e) => set("emailRelation", e.target.value)} placeholder="self / spouse / …" className="input-base" /></F>
                  </div>
                  {flags.showAddress && (
                    <>
                      <F label="Address line"><input value={f.line1} onChange={(e) => set("line1", e.target.value)} className="input-base" /></F>
                      <div className="grid grid-cols-2 gap-2">
                        <F label="City"><input value={f.city} onChange={(e) => set("city", e.target.value)} className="input-base" /></F>
                        <F label="State"><input value={f.state} onChange={(e) => set("state", e.target.value)} className="input-base" /></F>
                        <F label="Pincode"><input value={f.pincode} onChange={(e) => set("pincode", e.target.value)} className="input-base" /></F>
                        <F label="Country"><input value={f.country} onChange={(e) => set("country", e.target.value)} className="input-base" /></F>
                      </div>
                    </>
                  )}
                </Grp>
              )}

              {stepKey === "profile" && (
                <Grp title="Profile">
                  <F label="Occupation"><input value={f.occupation} onChange={(e) => set("occupation", e.target.value)} className="input-base" /></F>
                  <F label="Income range"><input value={f.incomeRange} onChange={(e) => set("incomeRange", e.target.value)} className="input-base" /></F>
                  <F label="Employer"><input value={f.employerName} onChange={(e) => set("employerName", e.target.value)} className="input-base" /></F>
                  <F label="Entity type">
                    <SelectField value={f.investorCategory} onChange={(e) => set("investorCategory", e.target.value)} className="w-full">
                      {[["individual", "Individual"], ["huf", "HUF"], ["nri", "NRI"], ["company", "Company"], ["corporate", "Corporate (legacy)"], ["trust", "Trust"], ["minor", "Minor"], ["other", "Other"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </SelectField>
                  </F>
                  <F label="Client category (A–D)">
                    <SelectField value={f.clientCategory} onChange={(e) => set("clientCategory", e.target.value)} className="w-full" placeholder="Select">
                      <option value="">Not categorised</option>{["A", "B", "C", "D"].map((c) => <option key={c} value={c}>{`Category ${c}`}</option>)}
                    </SelectField>
                  </F>
                  {flags.showSegment && (
                    <F label="Segment">
                      <SelectField value={f.segmentTag} onChange={(e) => set("segmentTag", e.target.value)} className="w-full" placeholder="Select">
                        <option value="">Select</option>{["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((c) => <option key={c} value={c}>{c}</option>)}
                      </SelectField>
                    </F>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Mode of holding"><input value={f.modeOfHolding} onChange={(e) => set("modeOfHolding", e.target.value)} placeholder="single / joint / …" className="input-base" /></F>
                    <F label="Household type"><input value={f.householdType} onChange={(e) => set("householdType", e.target.value)} placeholder="Family / Individual" className="input-base" /></F>
                  </div>
                  {flags.showRm && (
                    <F label="Assigned RM"><RmSelector value={f.rmId || null} onChange={(id) => set("rmId", id ?? "")} placeholder="— Unassigned —" /></F>
                  )}
                  {flags.showRm && (
                    <F label="Service RM (handles all servicing — requests are assigned to them)">
                      <RmSelector value={f.serviceRmId || null} onChange={(id) => set("serviceRmId", id ?? "")} placeholder="— Same as assigned RM —" />
                    </F>
                  )}
                </Grp>
              )}

              {stepKey === "compliance" && (
                <Grp title="Compliance status">
                  {flags.showKyc && (
                    <F label="KYC status">
                      <SelectField value={f.kycStatus} onChange={(e) => set("kycStatus", e.target.value)} className="w-full">
                        {["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"].map((c) => <option key={c} value={c}>{c}</option>)}
                      </SelectField>
                    </F>
                  )}
                  {flags.showRisk && (
                    <F label="Risk profile">
                      <SelectField value={f.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} className="w-full" placeholder="Select">
                        <option value="">Select</option>{["conservative", "moderate", "aggressive", "very_aggressive"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                      </SelectField>
                    </F>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Residential status">
                      <SelectField value={f.residencyStatus} onChange={(e) => set("residencyStatus", e.target.value)} className="w-full" placeholder="Select">
                        <option value="">Select</option>{[["indian_resident", "Indian resident"], ["nri", "NRI"], ["oci", "OCI"], ["pio", "PIO"], ["foreign_national", "Foreign national"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </SelectField>
                    </F>
                    <F label="Tax status"><input value={f.taxStatus} onChange={(e) => set("taxStatus", e.target.value)} className="input-base" /></F>
                    <F label="PAN–Aadhaar link">
                      <SelectField value={f.panAadhaarLinkStatus} onChange={(e) => set("panAadhaarLinkStatus", e.target.value)} className="w-full" placeholder="Select">
                        <option value="">Select</option>{[["linked", "Linked"], ["not_linked", "Not linked"], ["pending", "Pending"], ["not_applicable", "Not applicable"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </SelectField>
                    </F>
                    <F label="KRA"><input value={f.kraName} onChange={(e) => set("kraName", e.target.value)} className="input-base" /></F>
                    <F label="CKYC number"><input value={f.ckycNumber} onChange={(e) => set("ckycNumber", e.target.value)} className="input-base font-mono" /></F>
                    <F label="CKYC expiry"><DateField value={f.ckycExpiryAt} onChange={(e) => set("ckycExpiryAt", e.target.value)} className="w-full" /></F>
                    <F label="KYC validated on"><DateField value={f.kycValidatedAt} onChange={(e) => set("kycValidatedAt", e.target.value)} className="w-full" /></F>
                    <F label="FATCA status">
                      <SelectField value={f.fatcaStatus} onChange={(e) => set("fatcaStatus", e.target.value)} className="w-full" placeholder="Select">
                        <option value="">Select</option>{["pending", "verified", "expired"].map((c) => <option key={c} value={c}>{c}</option>)}
                      </SelectField>
                    </F>
                    <F label="FATCA expiry"><DateField value={f.fatcaExpiryAt} onChange={(e) => set("fatcaExpiryAt", e.target.value)} className="w-full" /></F>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <F label="UCC (BSE)"><input value={f.bseUccCode} onChange={(e) => set("bseUccCode", e.target.value)} className="input-base" /></F>
                    <F label="CAN (NSE)"><input value={f.nseCanCode} onChange={(e) => set("nseCanCode", e.target.value)} className="input-base" /></F>
                  </div>
                  <UccCodesField value={f.uccCodes} onChange={(v) => set("uccCodes", v)} label="Other UCC codes" />
                  <ClientTagsField value={f.tags} onChange={(v) => set("tags", v)} />
                  <div className="grid grid-cols-2 gap-2">
                    {CLIENT_CODE_FIELDS.map((c) => (
                      <F key={c.key} label={c.label}>
                        <input
                          value={(f as any)[c.key]}
                          onChange={(e) => set(c.key as any, e.target.value)}
                          placeholder={c.placeholder}
                          className="input-base"
                        />
                      </F>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Mandate status">
                      <SelectField value={f.mandateStatus} onChange={(e) => set("mandateStatus", e.target.value)} className="w-full">
                        {["none", "pending", "active", "expired", "rejected", "cancelled"].map((c) => <option key={c} value={c}>{c}</option>)}
                      </SelectField>
                    </F>
                    <F label="Mandate ref"><input value={f.mandateRefNo} onChange={(e) => set("mandateRefNo", e.target.value)} className="input-base" /></F>
                  </div>
                </Grp>
              )}

              {stepKey === "nominee" && (
                <Grp title="Nominee">
                  <NomineesField value={f.nominees} onChange={(n) => set("nominees", n)} />
                </Grp>
              )}

              {stepKey === "bank" && (
                <Grp title="Bank account">
                  <div className="space-y-2">
                    {f.bankAccounts.length === 0 && <div className="text-xs text-muted-foreground">No bank accounts added.</div>}
                    {f.bankAccounts.map((b, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input value={b.bankName} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, bankName: e.target.value } : x))} placeholder="Bank name" className="input-base flex-1" />
                        <input value={b.accountMasked ?? ""} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, accountMasked: e.target.value } : x))} placeholder="A/c (masked)" className="input-base w-32 font-mono" />
                        <input value={b.ifsc ?? ""} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, ifsc: e.target.value } : x))} placeholder="IFSC" className="input-base w-28 font-mono" />
                        <button type="button" onClick={() => set("bankAccounts", f.bankAccounts.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-rose-600 shrink-0 p-1" aria-label="Remove bank account"><Trash2 className="size-4" /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => set("bankAccounts", [...f.bankAccounts, { bankName: "", accountMasked: "", ifsc: "" }])} className="btn-ghost text-xs"><Plus className="size-3.5" /> Add bank account</button>
                  </div>
                </Grp>
              )}

              {stepKey === "financials" && (
                <Grp title="Financials">
                  <F label="Service tier">
                    <SelectField value={f.serviceTier} onChange={(e) => set("serviceTier", e.target.value)} className="w-full" placeholder="Select">
                      <option value="">Select</option><option value="A">A — Quarterly</option><option value="B">B — Half-yearly</option><option value="C">C — Annual</option>
                    </SelectField>
                  </F>
                  <div className="grid grid-cols-2 gap-2">
                    {flags.showAum && <RO label="Current AUM" value={formatINR(Number(investor.aum ?? 0))} />}
                    {flags.showSip && <RO label="Monthly SIP" value={formatINR(Number(investor.activeSipAmount ?? 0))} />}
                    {flags.showInflow && <RO label="Lifetime inflow" value={formatINR(Number(investor.lifetimeInflow ?? 0))} />}
                    {flags.showInflow && <RO label="Lifetime outflow" value={formatINR(Number(investor.lifetimeOutflow ?? 0))} />}
                  </div>
                  <p className="text-[11px] text-muted-foreground">AUM & lifetime flows are computed from holdings and transactions — read-only.</p>
                </Grp>
              )}

              {stepKey === "review" && (
                <Grp title="Review & lifecycle">
                  <F label="Review frequency">
                    <SelectField value={f.reviewFrequency} onChange={(e) => set("reviewFrequency", e.target.value)} className="w-full" placeholder="Auto (by service tier)">
                      <option value="">Auto (by service tier)</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="days_100">Every 100 days</option><option value="half_yearly">Half-yearly</option><option value="annual">Yearly</option>
                    </SelectField>
                  </F>
                  {flags.showStatus && (
                    <F label="Client status">
                      <SelectField value={f.status} onChange={(e) => set("status", e.target.value)} className="w-full">
                        {["active", "dormant", "inactive", "redemption_risk", "closed", "exited"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                      </SelectField>
                    </F>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Last review">
                      <DateField value={f.lastReviewAt} onChange={(e) => set("lastReviewAt", e.target.value)} className="w-full" />
                    </F>
                    <F label="Next review">
                      <DateField value={f.nextReviewAt} onChange={(e) => set("nextReviewAt", e.target.value)} className="w-full" />
                    </F>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Setting a last-review date re-derives the next one from the cadence above. Set
                    &ldquo;Next review&rdquo; explicitly to override that.
                  </p>
                  <F label="Notes"><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="input-base w-full" /></F>
                </Grp>
              )}
            </div>

            <div className="px-5 py-3 border-t flex items-center gap-2 bg-muted/30">
              {err && <span className="text-xs text-rose-600 flex-1 truncate">{err}</span>}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[11px] text-muted-foreground mr-1">Step {step + 1} of {steps.length}</span>
                <button onClick={() => setOpen(false)} className="btn-secondary text-xs">Cancel</button>
                {step > 0 && (
                  <button onClick={() => setStep((s) => Math.max(0, s - 1))} className="btn-secondary text-xs inline-flex items-center gap-1">
                    <ChevronLeft className="size-3.5" /> Back
                  </button>
                )}
                {!isLast ? (
                  <button onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))} className="btn-primary text-xs inline-flex items-center gap-1">
                    Next <ChevronRight className="size-3.5" />
                  </button>
                ) : (
                  <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Grp({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
      {children}
    </label>
  );
}

function RO({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-secondary/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
