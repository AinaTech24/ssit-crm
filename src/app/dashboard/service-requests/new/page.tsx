"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { PartnerSelect } from "@/components/service-requests/PartnerSelect";

const DEPARTMENTS = [
  { value: "motilal_oswal", label: "Motilal Oswal" },
  { value: "mf", label: "MF" },
  { value: "demat", label: "Demat" },
  { value: "insurance", label: "Insurance" },
];

type ClientHit = {
  id: string;
  name: string;
  pan?: string | null;
  mfCode?: string | null;
  moCode?: string | null;
  bajajCode?: string | null;
  lasCode?: string | null;
};

/** The client's code for the chosen department; falls back to whichever they have. */
function pickCode(c: ClientHit, department: string): string {
  const byDept: Record<string, string | null | undefined> = {
    motilal_oswal: c.moCode,
    mf: c.mfCode,
  };
  return byDept[department] || c.mfCode || c.moCode || c.bajajCode || c.lasCode || "";
}

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
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [picked, setPicked] = useState<ClientHit | null>(null);
  const [showHits, setShowHits] = useState(false);
  const [form, setForm] = useState({
    investorId: "",
    clientName: "",
    clientCode: "",
    department: "",
    partnerName: "",
    partnerUpdate: "",
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

  // Client typeahead: search the whole book by name as the user types. The
  // old dropdown only ever held the first 200 clients, so most could not be found.
  useEffect(() => {
    const q = form.clientName.trim();
    if (q.length < 2 || (picked && picked.name === form.clientName)) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/investors?q=${encodeURIComponent(q)}&limit=8`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j) => {
          const rows: ClientHit[] = j.rows ?? [];
          // One clear match for exactly what was typed: select it for them.
          if (rows.length === 1 && rows[0].name.trim().toLowerCase() === q.toLowerCase()) {
            choose(rows[0]);
            return;
          }
          setHits(rows);
        })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.clientName]);

  function choose(c: ClientHit) {
    setPicked(c);
    setHits([]);
    setShowHits(false);
    setForm((f) => ({ ...f, investorId: c.id, clientName: c.name, clientCode: pickCode(c, f.department) }));
  }

  function changeDepartment(department: string) {
    setForm((f) => ({
      ...f,
      department,
      // Re-pick the code for the new department, unless the user typed their own.
      clientCode: picked && (!f.clientCode || f.clientCode === pickCode(picked, f.department)) ? pickCode(picked, department) : f.clientCode,
    }));
  }

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
          clientName: form.clientName.trim() || undefined,
          clientCode: form.clientCode.trim() || undefined,
          department: form.department || undefined,
          partnerName: form.partnerName || undefined,
          partnerUpdate: form.partnerUpdate.trim() || undefined,
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <div className="text-xs font-medium mb-1">Client name</div>
            <input
              value={form.clientName}
              onChange={(e) => {
                const v = e.target.value;
                // Typing over a chosen client un-links it until one is picked again.
                if (picked && picked.name !== v) {
                  setPicked(null);
                  setForm((f) => ({ ...f, clientName: v, investorId: "", clientCode: "" }));
                } else {
                  setForm((f) => ({ ...f, clientName: v }));
                }
                setShowHits(true);
              }}
              onFocus={() => setShowHits(true)}
              onBlur={() => setTimeout(() => setShowHits(false), 150)}
              placeholder="Start typing the client's name…"
              autoComplete="off"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
            {showHits && hits.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-lg max-h-64 overflow-y-auto py-1">
                {hits.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(c)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-secondary/50"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground font-mono">{pickCode(c, form.department) || c.pan || ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 text-[10px] text-muted-foreground">
              {picked ? "Client linked — code filled in automatically." : "Pick a match to link the client, or leave as typed for a general query."}
            </div>
          </div>
          <label className="block">
            <div className="text-xs font-medium mb-1">Client code</div>
            <input
              value={form.clientCode}
              onChange={(e) => setForm({ ...form, clientCode: e.target.value })}
              placeholder="Filled in when the client is picked"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono"
            />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Department</div>
            <SelectField value={form.department} onChange={(e) => changeDepartment(e.target.value)} className="w-full">
              <option value="">Select department…</option>
              {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </SelectField>
          </label>
          <div className="block">
            <div className="text-xs font-medium mb-1">Partner name</div>
            <PartnerSelect value={form.partnerName} onChange={(name) => setForm({ ...form, partnerName: name })} />
          </div>
        </div>
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
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Mail &amp; call updation with partner
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">· the query raised and what the partner said</span>
          </div>
          <textarea
            value={form.partnerUpdate}
            onChange={(e) => setForm({ ...form, partnerUpdate: e.target.value })}
            rows={3}
            placeholder="e.g. Mailed RTA on 16 Oct about the nominee change; they asked for the signed form. Called on 17 Oct — in process."
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
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
                · back office
              </span>
            </div>
            <RmSelector
              role="back_office"
              value={form.assignedToUserId || null}
              onChange={(id) => setForm({ ...form, assignedToUserId: id ?? "" })}
              placeholder="— Unassigned —"
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
