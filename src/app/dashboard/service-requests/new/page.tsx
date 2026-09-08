"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";

const TYPES = [
  { key: "nominee_update", label: "Nominee update" },
  { key: "bank_update", label: "Bank update" },
  { key: "mobile_update", label: "Mobile update" },
  { key: "email_update", label: "Email update" },
  { key: "kyc_update", label: "KYC update" },
  { key: "minor_to_major", label: "Minor → Major" },
  { key: "capital_gain_report", label: "Capital gain report" },
  { key: "statement_request", label: "Statement request" },
  { key: "redemption_request", label: "Redemption request" },
  { key: "switch_request", label: "Switch request" },
  { key: "transmission_case", label: "Transmission case" },
  { key: "folio_correction", label: "Folio correction" },
  { key: "complaint", label: "Complaint" },
  { key: "other", label: "Other" },
];

// Mirrors SEBI_COMPLAINT_CATEGORIES / COMPLAINT_SOURCES in db/schema (can't
// import server schema into a client component).
const SEBI_CATEGORIES = [
  { value: "service", label: "Service / TAT" },
  { value: "mis_selling", label: "Mis-selling" },
  { value: "transaction", label: "Transaction / order" },
  { value: "fee", label: "Fee / commission" },
  { value: "kyc", label: "KYC / documents" },
  { value: "communication", label: "Communication / statements" },
  { value: "other", label: "Other" },
];
const COMPLAINT_SOURCES = [
  { value: "direct", label: "Direct (client)" },
  { value: "scores", label: "SCORES (SEBI)" },
  { value: "amfi", label: "AMFI" },
  { value: "amc", label: "AMC" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
  { value: "other", label: "Other" },
];

export default function NewServiceRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") === "complaint" ? "complaint" : "kyc_update";
  const [investors, setInvestors] = useState<any[]>([]);
  const [form, setForm] = useState({
    investorId: "",
    type: initialType,
    subject: "",
    description: "",
    priority: "normal",
    channel: "phone",
    sebiCategory: "service",
    sebiSubCategory: "",
    complaintSource: "direct",
    scoresRefNo: "",
    assignedToUserId: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/investors?limit=200")
      .then((r) => r.json())
      .then((j) => setInvestors(j.rows ?? []))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId: form.investorId || undefined,
          type: form.type,
          subject: form.subject,
          description: form.description,
          priority: form.priority,
          channel: form.channel,
          sebiCategory: form.type === "complaint" ? form.sebiCategory || undefined : undefined,
          sebiSubCategory: form.type === "complaint" ? form.sebiSubCategory || undefined : undefined,
          complaintSource: form.type === "complaint" ? form.complaintSource || undefined : undefined,
          scoresRefNo:
            form.type === "complaint" && form.complaintSource === "scores"
              ? form.scoresRefNo || undefined
              : undefined,
          assignedToUserId: form.assignedToUserId || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push(form.type === "complaint" ? "/dashboard/complaints" : "/dashboard/service-requests");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/dashboard/service-requests" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New service request</h1>

      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">Investor</div>
          <SelectField value={form.investorId} onChange={(e) => setForm({ ...form, investorId: e.target.value })} className="w-full" searchable>
            <option value="">Select investor (or leave blank for general)…</option>
            {investors.map((i: any) => (
              <option key={i.id} value={i.id}>{i.name} · {i.pan}</option>
            ))}
          </SelectField>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Type<span className="text-rose-600">*</span></div>
            <SelectField value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full">
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Priority</div>
            <SelectField value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectField>
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Subject<span className="text-rose-600">*</span></div>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Description</div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Channel</div>
            <SelectField value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-full">
              <option value="phone">Phone</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="in_person">In person</option>
              <option value="form">Web form</option>
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">
              Assign to
              <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                · defaults to you
              </span>
            </div>
            <RmSelector
              role="back_office"
              value={form.assignedToUserId || null}
              onChange={(id) => setForm({ ...form, assignedToUserId: id ?? "" })}
              placeholder="— Assign to myself —"
            />
          </label>
        </div>
        {form.type === "complaint" && (
          <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-3">
            <div className="text-xs font-semibold text-amber-800">SEBI complaint register</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <div className="text-xs font-medium mb-1">SEBI category<span className="text-rose-600">*</span></div>
                <SelectField value={form.sebiCategory} onChange={(e) => setForm({ ...form, sebiCategory: e.target.value })} className="w-full">
                  {SEBI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </SelectField>
              </label>
              <label className="block">
                <div className="text-xs font-medium mb-1">Sub-category</div>
                <input value={form.sebiSubCategory} onChange={(e) => setForm({ ...form, sebiSubCategory: e.target.value })} placeholder="e.g. Scheme switch, NAV dispute" className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
              </label>
              <label className="block">
                <div className="text-xs font-medium mb-1">Source</div>
                <SelectField value={form.complaintSource} onChange={(e) => setForm({ ...form, complaintSource: e.target.value })} className="w-full">
                  {COMPLAINT_SOURCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </SelectField>
              </label>
              {form.complaintSource === "scores" && (
                <label className="block">
                  <div className="text-xs font-medium mb-1">SCORES ref no</div>
                  <input value={form.scoresRefNo} onChange={(e) => setForm({ ...form, scoresRefNo: e.target.value })} placeholder="e.g. 2026/0001234" className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
                </label>
              )}
            </div>
            <p className="text-[11px] text-amber-700">Complaints carry a 21-day resolution SLA and feed the monthly disclosure statement.</p>
          </div>
        )}
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/service-requests" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || !form.subject} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
