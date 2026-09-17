"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, FileText, Loader2, Save } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { RmSelector } from "@/components/common/RmSelector";
import { CLIENT_OWNING_ROLES as OWNING_ROLES } from "@/lib/auth/rbac";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

const CLAIM_STATUSES: [string, string][] = [
  ["empty", "Empty"], ["claim_intimated", "Claim Intimated"], ["file_awaited", "File Awaited"], ["file_received", "File Received"],
  ["add_info_awaited", "Add Info Awaited"], ["query", "Query"], ["query_replied", "Query Replied"], ["under_process", "Under Process"],
  ["settled_fully", "Settled Fully"], ["settled_partially", "Settled Partially"], ["rejected", "Rejected"], ["withdrawn", "Withdrawn"],
];
const CLAIM_TYPES: [string, string][] = [["", "Select"], ["main_claim", "Main Claim"], ["supplementary", "Supplementary"], ["pre_authorization", "Pre-authorization"], ["rider", "Rider"], ["other", "Other"]];
const CLAIM_MODES: [string, string][] = [["", "Select"], ["cashless", "Cashless"], ["reimbursement", "Reimbursement"], ["grievance", "Grievance"]];
const INTIMATION_MODES: [string, string][] = [["", "Select"], ["phone", "Phone"], ["email", "Email"], ["portal", "Portal"], ["branch", "Branch"], ["agent", "Agent"], ["letter", "Letter"], ["other", "Other"]];
const SUBMITTED_MODES: [string, string][] = [["", "Select"], ["online", "Online"], ["physical", "Physical"], ["courier", "Courier"], ["email", "Email"], ["agent", "Agent"], ["other", "Other"]];

export default function NewClaimPage() {
  return (
    <Suspense fallback={<div className="grid place-items-center min-h-[300px]"><Loader2 className="size-6 animate-spin text-brand-cyan" /></div>}>
      <ClaimForm />
    </Suspense>
  );
}

function ClaimForm() {
  const router = useRouter();
  const editId = useSearchParams().get("edit");
  const [investor, setInvestor] = useState<{ id: string; name: string } | null>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [rmId, setRmId] = useState<string | null>(null);
  const [form, setForm] = useState({
    policyId: "", policyNumber: "", insurer: "", proposerName: "", contactPerson: "", email: "", phone: "",
    claimStatus: "claim_intimated", policyDetails: "",
    claimType: "", claimMode: "", intimationMode: "", submittedMode: "",
    admissionDate: "", intimationDate: "", submissionDate: "", settlementDate: "",
    claimedAmount: "", settledAmount: "", comments: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    fetch("/api/insurance").then((r) => r.json()).then((j) => setPolicies(j.policies ?? [])).catch(() => { });
  }, []);

  useEffect(() => {
    if (!editId) return;
    fetch(`/api/insurance-claims/${editId}`).then((r) => r.json()).then((d) => {
      if (!d || d.error) return;
      setForm({
        policyId: d.policyId ?? "", policyNumber: d.policyNumber ?? "", insurer: d.insurer ?? "", proposerName: d.proposerName ?? "",
        contactPerson: d.contactPerson ?? "", email: d.email ?? "", phone: d.phone ?? "",
        claimStatus: d.claimStatus ?? "claim_intimated", policyDetails: d.policyDetails ?? "",
        claimType: d.claimType ?? "", claimMode: d.claimMode ?? "", intimationMode: d.intimationMode ?? "", submittedMode: d.submittedMode ?? "",
        admissionDate: (d.admissionDate ?? "").slice(0, 10), intimationDate: (d.intimationDate ?? "").slice(0, 10),
        submissionDate: (d.submissionDate ?? "").slice(0, 10), settlementDate: (d.settlementDate ?? "").slice(0, 10),
        claimedAmount: d.claimedAmount != null ? String(Number(d.claimedAmount)) : "", settledAmount: d.settledAmount != null ? String(Number(d.settledAmount)) : "",
        comments: d.comments ?? "",
      });
      if (d.investorId) setInvestor({ id: d.investorId, name: d.investorName ?? "Client" });
      if (d.rmId) setRmId(d.rmId);
    });
  }, [editId]);

  function pickPolicy(policyId: string) {
    const p = policies.find((x) => x.id === policyId);
    setForm((s) => ({ ...s, policyId, policyNumber: p?.policyNumber ?? s.policyNumber, insurer: p?.insurer ?? s.insurer }));
  }

  async function save() {
    setErr(null);
    if (!form.proposerName.trim()) return setErr("Proposer name is required.");
    setBusy(true);
    try {
      const payload: any = {
        policyId: form.policyId || undefined,
        policyNumber: form.policyNumber || undefined,
        insurer: form.insurer || undefined,
        investorId: investor?.id || undefined,
        proposerName: form.proposerName,
        contactPerson: form.contactPerson || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        claimStatus: form.claimStatus,
        policyDetails: form.policyDetails || undefined,
        claimType: form.claimType || undefined,
        claimMode: form.claimMode || undefined,
        intimationMode: form.intimationMode || undefined,
        submittedMode: form.submittedMode || undefined,
        admissionDate: form.admissionDate || undefined,
        intimationDate: form.intimationDate || undefined,
        submissionDate: form.submissionDate || undefined,
        settlementDate: form.settlementDate || undefined,
        claimedAmount: form.claimedAmount ? Number(form.claimedAmount) : undefined,
        settledAmount: form.settledAmount ? Number(form.settledAmount) : undefined,
        rmId: rmId || undefined,
        comments: form.comments || undefined,
      };
      const res = await fetch(editId ? `/api/insurance-claims/${editId}` : "/api/insurance-claims", {
        method: editId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Save failed"); return; }
      router.push("/dashboard/insurance-claims");
    } catch (e: any) {
      setErr(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <Link href="/dashboard/insurance-claims" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"><ChevronLeft className="size-4" /> Back to claims</Link>
      <div>
        <h1 className="page-title"><FileText className="size-6 text-brand-cyan" /> {editId ? "Edit claim" : "New claim"}</h1>
      </div>

      <Section title="Overview">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Claimant (client)">
            <InvestorLookup value={investor?.id ?? null} displayName={investor?.name ?? null}
              onSelect={(id, name) => { setInvestor({ id, name }); if (!form.proposerName) set("proposerName", name); }}
              onClear={() => setInvestor(null)} placeholder="Search client…" />
          </Field>
          <Field label="Proposer name *"><input value={form.proposerName} onChange={(e) => set("proposerName", e.target.value)} placeholder="Name on the policy" className="input-base" /></Field>
          <Field label="Insurance policy">
            <SelectField value={form.policyId} onChange={(e) => pickPolicy(e.target.value)}>
              <option value="">pick a policy</option>
              {policies.map((p) => <option key={p.id} value={p.id}>{[p.planName, p.policyNumber, p.insurer].filter(Boolean).join(" · ")}</option>)}
            </SelectField>
          </Field>
          <Field label="Policy number"><input value={form.policyNumber} onChange={(e) => set("policyNumber", e.target.value)} className="input-base" /></Field>
          <Field label="Insurance company"><input value={form.insurer} onChange={(e) => set("insurer", e.target.value)} placeholder="HDFC Ergo, Star Health…" className="input-base" /></Field>
          <Field label="Claim status">
            <SelectField value={form.claimStatus} onChange={(e) => set("claimStatus", e.target.value)}>
              {CLAIM_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          </Field>
          <Field label="Contact person"><input value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} className="input-base" /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="input-base" /></Field>
          <Field label="Phone"><input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="input-base" /></Field>
        </div>
        <Field label="Policy details">
          <textarea value={form.policyDetails} onChange={(e) => set("policyDetails", e.target.value)} rows={2} placeholder="Cover, sum insured, notes…" className="input-base" />
        </Field>
      </Section>

      <Section title="Claim details">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Sel label="Claim type" value={form.claimType} onChange={(v) => set("claimType", v)} opts={CLAIM_TYPES} />
          <Sel label="Claim mode" value={form.claimMode} onChange={(v) => set("claimMode", v)} opts={CLAIM_MODES} />
          <Field label="Admission date"><DateField value={form.admissionDate} onChange={(e) => set("admissionDate", e.target.value)} /></Field>
          <Sel label="Intimation mode" value={form.intimationMode} onChange={(v) => set("intimationMode", v)} opts={INTIMATION_MODES} />
          <Field label="Intimation date"><DateField value={form.intimationDate} onChange={(e) => set("intimationDate", e.target.value)} /></Field>
          <Sel label="Submitted mode" value={form.submittedMode} onChange={(v) => set("submittedMode", v)} opts={SUBMITTED_MODES} />
          <Field label="Submission date"><DateField value={form.submissionDate} onChange={(e) => set("submissionDate", e.target.value)} /></Field>
          <Field label="Claimed amount (₹)"><input type="number" value={form.claimedAmount} onChange={(e) => set("claimedAmount", e.target.value)} className="input-base" /></Field>
          <Field label="Settled amount (₹)"><input type="number" value={form.settledAmount} onChange={(e) => set("settledAmount", e.target.value)} className="input-base" /></Field>
          <Field label="Settlement date"><DateField value={form.settlementDate} onChange={(e) => set("settlementDate", e.target.value)} /></Field>
          <Field label="Relationship manager"><RmSelector value={rmId} onChange={(id) => setRmId(id ?? null)} role={OWNING_ROLES} placeholder="Assign RM…" /></Field>
        </div>
        <Field label="Comments">
          <textarea value={form.comments} onChange={(e) => set("comments", e.target.value)} rows={2} placeholder="Status notes, follow-up, settlement remarks…" className="input-base" />
        </Field>

        {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/insurance-claims" className="btn-secondary">Cancel</Link>
          <button type="button" onClick={save} disabled={busy || !form.proposerName} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{busy ? "Saving…" : editId ? "Update claim" : "Save claim"}
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-5 space-y-3">
      <div className="flex items-center gap-2"><div className="h-4 w-1 rounded-full brand-bar" /><h2 className="section-title">{title}</h2></div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs font-medium mb-1">{label}</div>{children}</label>;
}
function Sel({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <Field label={label}>
      <SelectField value={value} onChange={(e) => onChange(e.target.value)}>
        {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </SelectField>
    </Field>
  );
}
