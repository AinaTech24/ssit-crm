"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, HeartHandshake } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField as UiSelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { NomineesField } from "@/components/investors/NomineesField";
import type { Nominee } from "@/lib/investors/nominee";
import { ReferralsField } from "@/components/investors/ReferralsField";
import type { Referral } from "@/lib/investors/referral";
import { UccCodesField } from "@/components/investors/UccCodesField";
import { cleanUccCodes } from "@/lib/investors/ucc";
import { ClientTagsField } from "@/components/investors/ClientTagsField";
import { CLIENT_CODE_FIELDS } from "@/lib/investors/client-tags";
import { CustomFieldsSection, missingRequired, type CustomFieldDef } from "@/components/common/CustomFieldInputs";

function NewInvestorPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const familyId = sp.get("familyId");
  const familyRole = sp.get("familyRole") ?? "";
  const [form, setForm] = useState({
    // Identity & personal
    name: "",
    pan: "",
    dob: "",
    gender: "",
    birthPlace: "",
    motherName: "",
    maritalStatus: "",
    occupation: "", // Profession
    employerName: "", // Company Name
    aadhaarLast4: "",
    // Contact
    email: "",
    emailRelation: "",
    phone: "", // Mobile
    mobileRelation: "",
    whatsappPhone: "",
    // Mailing address
    street: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    // Classification
    investorCategory: "individual",
    segmentTag: "Retail",
    clientCategory: "",
    riskProfile: "",
    householdType: "", // Family or Individual
    familyOwnerName: "",
    referralClientName: "",
    modeOfHolding: "",
    bseUccCode: "", // UCC No
    uccCodes: [] as string[],
    // Which book the client sits in, and their code on each platform.
    tags: [] as string[],
    mfCode: "",
    moCode: "",
    bajajCode: "",
    lasCode: "",
    taxStatus: "",
    residencyStatus: "",
    kycStatus: "pending",
    // Second / joint holder
    secondHolderFirstName: "",
    secondHolderLastName: "",
    secondHolderOccupation: "",
    secondHolderCompanyName: "",
    secondHolderBirthPlace: "",
    secondHolderMotherName: "",
    secondHolderMaritalStatus: "",
    // Relationship & review
    rmId: "" as string | null | "",
    serviceRmId: "" as string | null | "",
    onboardedAt: "",
    anniversaryDate: "",
    lastReviewAt: "", // Last Meeting Date
    nextReviewAt: "", // Next Meeting Date
    reviewFrequency: "",
    // Notes
    notes: "",
  });
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [cfDefs, setCfDefs] = useState<CustomFieldDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(k: string, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }
  const u = (v: string) => v.trim() || undefined;

  // Next meeting date = last meeting date + review frequency (auto-derived).
  useEffect(() => {
    const months: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };
    const m = months[form.reviewFrequency];
    if (form.lastReviewAt && m) {
      const d = new Date(form.lastReviewAt);
      if (!isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + m);
        const next = d.toISOString().slice(0, 10);
        setForm((s) => (s.nextReviewAt === next ? s : { ...s, nextReviewAt: next }));
      }
    }
  }, [form.lastReviewAt, form.reviewFrequency]);

  // Age is derived from DOB — shown read-only, never stored.
  const age = form.dob ? Math.floor((Date.now() - new Date(form.dob).getTime()) / (365.25 * 864e5)) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const missCf = missingRequired(cfDefs, customFields);
      if (missCf) { setErr(`${missCf.label} is required.`); return; }
      const res = await fetch("/api/investors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          pan: form.pan.toUpperCase().trim(),
          dob: u(form.dob),
          gender: form.gender || undefined,
          birthPlace: u(form.birthPlace),
          motherName: u(form.motherName),
          maritalStatus: u(form.maritalStatus),
          occupation: u(form.occupation),
          employerName: u(form.employerName),
          aadhaarLast4: u(form.aadhaarLast4),
          email: u(form.email),
          emailRelation: u(form.emailRelation),
          phone: u(form.phone),
          mobileRelation: u(form.mobileRelation),
          whatsappPhone: form.whatsappPhone || form.phone || undefined,
          address: {
            line1: u(form.street),
            city: u(form.city),
            state: u(form.state),
            pincode: u(form.pincode),
            country: u(form.country),
          },
          investorCategory: form.investorCategory,
          segmentTag: form.segmentTag,
          clientCategory: form.clientCategory || undefined,
          riskProfile: form.riskProfile || undefined,
          householdType: u(form.householdType),
          familyOwnerName: u(form.familyOwnerName),
          referralClientName: u(form.referralClientName),
          modeOfHolding: u(form.modeOfHolding),
          bseUccCode: u(form.bseUccCode),
          tags: form.tags.length ? form.tags : undefined,
          mfCode: u(form.mfCode),
          moCode: u(form.moCode),
          bajajCode: u(form.bajajCode),
          lasCode: u(form.lasCode),
          uccCodes: cleanUccCodes(form.uccCodes),
          taxStatus: u(form.taxStatus),
          residencyStatus: form.residencyStatus || undefined,
          kycStatus: form.kycStatus || undefined,
          secondHolderFirstName: u(form.secondHolderFirstName),
          secondHolderLastName: u(form.secondHolderLastName),
          secondHolderOccupation: u(form.secondHolderOccupation),
          secondHolderCompanyName: u(form.secondHolderCompanyName),
          secondHolderBirthPlace: u(form.secondHolderBirthPlace),
          secondHolderMotherName: u(form.secondHolderMotherName),
          secondHolderMaritalStatus: u(form.secondHolderMaritalStatus),
          rmId: form.rmId || undefined,
          serviceRmId: form.serviceRmId || undefined,
          nominees: (() => {
            const list = nominees.filter((n) => (n.name ?? "").trim());
            return list.length ? list : undefined;
          })(),
          referrals: (() => {
            const list = referrals
              .map((r) => ({
                ...r,
                name: (r.name ?? "").trim(),
                relation: (r.relation ?? "").trim() || undefined,
                mobile: (r.mobile ?? "").trim() || undefined,
                email: (r.email ?? "").trim() || undefined,
                note: (r.note ?? "").trim() || undefined,
              }))
              .filter((r) => r.name);
            return list.length ? list : undefined;
          })(),
          onboardedAt: u(form.onboardedAt),
          anniversaryDate: u(form.anniversaryDate),
          lastReviewAt: u(form.lastReviewAt),
          nextReviewAt: u(form.nextReviewAt),
          reviewFrequency: form.reviewFrequency || undefined,
          notes: u(form.notes),
          customFields: Object.keys(customFields).length ? customFields : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Create failed");
        return;
      }
      const j = await res.json();
      if (familyId) {
        await fetch(`/api/families/${familyId}/members`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ investorId: j.id, familyRole: familyRole || undefined }),
        });
        router.push(`/dashboard/families/${familyId}`);
      } else {
        router.push(`/dashboard/investors/${j.id}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto w-full">
      <Link
        href="/dashboard/investors"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to investors
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Add client</h1>

      {familyId && (
        <div className="rounded-md border border-blue-300 bg-blue-50 text-blue-900 px-4 py-3 text-sm flex items-center gap-2">
          <HeartHandshake className="size-4" />
          <span>
            This client will be added to the selected family
            {familyRole && (
              <>
                {" "}as <strong>{familyRole}</strong>
              </>
            )}
            .
          </span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {/* Identity & personal */}
        <Section title="Identity & personal">
          <Field label="Full name" value={form.name} onChange={(v) => set("name", v)} required />
          <Field label="PAN card no" value={form.pan} onChange={(v) => set("pan", v.toUpperCase())} required placeholder="ABCDE1234F" />
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <Field label="Date of birth" type="date" value={form.dob} onChange={(v) => set("dob", v)} />
            <div className="text-xs text-muted-foreground pb-2.5 sm:w-20">
              Age: <span className="font-medium text-foreground">{age ?? "—"}</span>
            </div>
          </div>
          <SelectField label="Gender" value={form.gender} onChange={(v) => set("gender", v)} options={[{ value: "", label: "Select" }, { value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" }]} />
          <Field label="Birth place" value={form.birthPlace} onChange={(v) => set("birthPlace", v)} />
          <Field label="Mother's name" value={form.motherName} onChange={(v) => set("motherName", v)} />
          <SelectField label="Marital status" value={form.maritalStatus} onChange={(v) => set("maritalStatus", v)} options={["", "Single", "Married", "Divorced", "Widowed"]} />
          <Field label="Profession" value={form.occupation} onChange={(v) => set("occupation", v)} />
          <Field label="Company name" value={form.employerName} onChange={(v) => set("employerName", v)} />
          <Field label="Aadhaar card (last 4)" value={form.aadhaarLast4} onChange={(v) => set("aadhaarLast4", v.replace(/\D/g, "").slice(0, 4))} placeholder="last 4 digits only" />
        </Section>

        {/* Contact */}
        <Section title="Contact">
          <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
          <Field label="Email relation" value={form.emailRelation} onChange={(v) => set("emailRelation", v)} placeholder="self / spouse / …" />
          <Field label="Mobile" value={form.phone} onChange={(v) => set("phone", v)} placeholder="+919XXXXXXXXX" />
          <Field label="Mobile relation" value={form.mobileRelation} onChange={(v) => set("mobileRelation", v)} placeholder="self / spouse / …" />
          <Field label="WhatsApp" value={form.whatsappPhone} onChange={(v) => set("whatsappPhone", v)} placeholder="Same as mobile if blank" />
        </Section>

        {/* Mailing address */}
        <Section title="Mailing address" cols={1}>
          <Field label="Mailing street" value={form.street} onChange={(v) => set("street", v)} placeholder="House / building, street, area" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
            <Field label="State" value={form.state} onChange={(v) => set("state", v)} />
            <Field label="Zip" value={form.pincode} onChange={(v) => set("pincode", v)} />
            <Field label="Country" value={form.country} onChange={(v) => set("country", v)} />
          </div>
        </Section>

        {/* Classification */}
        <Section title="Classification & compliance">
          <SelectField label="Family or individual" value={form.householdType} onChange={(v) => set("householdType", v)} options={["", "Individual", "Family", "Family head", "Family member"]} />
          <Field label="Family owner" value={form.familyOwnerName} onChange={(v) => set("familyOwnerName", v)} placeholder="head of family (if part of one)" />
          <SelectField label="Category" value={form.investorCategory} onChange={(v) => set("investorCategory", v)} options={["individual", "huf", "corporate", "trust", "nri", "minor", "other"]} />
          <SelectField label="Segment" value={form.segmentTag} onChange={(v) => set("segmentTag", v)} options={["HNI", "Affluent", "Retail", "NRI", "Corporate"]} />
          <SelectField label="Client category" value={form.clientCategory} onChange={(v) => set("clientCategory", v)} options={[{ value: "", label: "Select" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }, { value: "D", label: "D" }]} />
          <Field label="Referral client name" value={form.referralClientName} onChange={(v) => set("referralClientName", v)} />
          <SelectField label="Mode of holding" value={form.modeOfHolding} onChange={(v) => set("modeOfHolding", v)} options={["", "Single", "Joint", "Anyone or Survivor"]} />
          <Field label="UCC no" value={form.bseUccCode} onChange={(v) => set("bseUccCode", v)} />
          <div className="sm:col-span-2">
            <UccCodesField value={form.uccCodes} onChange={(v) => setForm((p) => ({ ...p, uccCodes: v }))} label="Other UCC codes" />
          </div>
          <div className="sm:col-span-2">
            <ClientTagsField
              value={form.tags}
              onChange={(v) => setForm((p) => ({ ...p, tags: v }))}
            />
          </div>
          {CLIENT_CODE_FIELDS.map((c) => (
            <Field
              key={c.key}
              label={c.label}
              value={(form as any)[c.key]}
              onChange={(v) => set(c.key as any, v)}
              placeholder={c.placeholder}
            />
          ))}
          <Field label="Tax status" value={form.taxStatus} onChange={(v) => set("taxStatus", v)} placeholder="e.g. Resident Individual" />
          <SelectField label="Residential status" value={form.residencyStatus} onChange={(v) => set("residencyStatus", v)} options={[{ value: "", label: "Select" }, { value: "indian_resident", label: "Indian resident" }, { value: "nri", label: "NRI" }, { value: "oci", label: "OCI" }, { value: "pio", label: "PIO" }, { value: "foreign_national", label: "Foreign national" }]} />
          <SelectField label="KYC status" value={form.kycStatus} onChange={(v) => set("kycStatus", v)} options={[{ value: "pending", label: "Pending" }, { value: "registered", label: "Registered" }, { value: "verified", label: "Verified" }, { value: "hold", label: "Hold" }, { value: "rejected", label: "Rejected" }, { value: "expired", label: "Expired" }, { value: "re_kyc_required", label: "Re-KYC required" }]} />
          <SelectField label="Risk profile" value={form.riskProfile} onChange={(v) => set("riskProfile", v)} options={[{ value: "", label: "Select" }, { value: "conservative", label: "Conservative" }, { value: "moderate", label: "Moderate" }, { value: "aggressive", label: "Aggressive" }, { value: "very_aggressive", label: "Very aggressive" }]} />
        </Section>

        {/* Second / joint holder */}
        <Section title="Second / joint holder (optional)">
          <Field label="First name" value={form.secondHolderFirstName} onChange={(v) => set("secondHolderFirstName", v)} />
          <Field label="Last name" value={form.secondHolderLastName} onChange={(v) => set("secondHolderLastName", v)} />
          <Field label="Occupation" value={form.secondHolderOccupation} onChange={(v) => set("secondHolderOccupation", v)} />
          <Field label="Company name" value={form.secondHolderCompanyName} onChange={(v) => set("secondHolderCompanyName", v)} />
          <Field label="Birth place" value={form.secondHolderBirthPlace} onChange={(v) => set("secondHolderBirthPlace", v)} />
          <Field label="Mother's name" value={form.secondHolderMotherName} onChange={(v) => set("secondHolderMotherName", v)} />
          <SelectField label="Marital status" value={form.secondHolderMaritalStatus} onChange={(v) => set("secondHolderMaritalStatus", v)} options={["", "Single", "Married", "Divorced", "Widowed"]} />
        </Section>

        {/* Nominees */}
        <Section title="Nominees" cols={1}>
          <NomineesField value={nominees} onChange={setNominees} />
        </Section>

        {/* Referrals */}
        <Section title="Referrals" cols={1}>
          <ReferralsField value={referrals} onChange={setReferrals} />
        </Section>

        {/* Relationship & review */}
        <Section title="Relationship & review">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium block mb-1">
              Assigned RM
              <span className="ml-1 text-[10px] text-muted-foreground font-normal">· optional — defaults to the firm owner</span>
            </label>
            <RmSelector value={form.rmId || null} onChange={(id) => setForm((s) => ({ ...s, rmId: id ?? "" }))} role="rm" placeholder="— Use firm default (owner) —" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium block mb-1">
              Service RM
              <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                · who handles day-to-day servicing, if different from the owner
              </span>
            </label>
            <RmSelector
              value={form.serviceRmId || null}
              onChange={(id) => setForm((s) => ({ ...s, serviceRmId: id ?? "" }))}
              role="rm"
              placeholder="— Same as assigned RM —"
            />
          </div>
          <Field label="Date of onboarding" type="date" value={form.onboardedAt} onChange={(v) => set("onboardedAt", v)} />
          <Field label="Anniversary date" type="date" value={form.anniversaryDate} onChange={(v) => set("anniversaryDate", v)} />
          <Field label="Last meeting date" type="date" value={form.lastReviewAt} onChange={(v) => set("lastReviewAt", v)} />
          <Field label="Next meeting date" type="date" value={form.nextReviewAt} onChange={(v) => set("nextReviewAt", v)} />
          <SelectField label="Review frequency" value={form.reviewFrequency} onChange={(v) => set("reviewFrequency", v)} options={[{ value: "", label: "Select" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "half_yearly", label: "Half-yearly" }, { value: "annual", label: "Annual" }]} />
        </Section>

        {/* Notes */}
        <Section title="Notes" cols={1}>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </Section>

        {/* Firm-defined custom fields (Settings → Custom fields) */}
        <CustomFieldsSection entity="investor" values={customFields} onChange={setCustomFields} onDefsLoaded={setCfDefs} />

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/dashboard/investors" className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </Link>
          <button
            disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create client"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children, cols = 2 }: { title: string; children: React.ReactNode; cols?: 1 | 2 }) {
  return (
    <div className="border rounded-lg bg-card p-4 sm:p-6 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className={cols === 1 ? "space-y-3" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </div>
      {type === "date" ? (
        <DateField value={value} onChange={(e) => onChange(e.target.value)} max={today} required={required} className="w-full" />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        />
      )}
    </label>
  );
}

// Themed dropdown — same look as the Assigned-RM picker (shared ui SelectField).
// `options` accepts plain strings or { value, label } pairs.
function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <UiSelectField value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
        {options.map((o) => {
          const opt = typeof o === "string" ? { value: o, label: o || "Select" } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </UiSelectField>
    </label>
  );
}

export default function NewInvestorPage() {
  return (
    <Suspense fallback={null}>
      <NewInvestorPageInner />
    </Suspense>
  );
}
