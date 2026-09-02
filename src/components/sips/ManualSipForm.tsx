"use client";

/**
 * ManualSipForm — register a SIP by hand (when it isn't yet in the CAMS/KFintech
 * feed). Client must be an existing investor; the scheme picker auto-fills the
 * AMC from the MF catalog. Posts to /api/sips.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Search } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";
import { useToast } from "@/components/ui/Toast";

const FREQ_OPTS: [string, string][] = [
  ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["weekly", "Weekly"], ["fortnightly", "Fortnightly"], ["yearly", "Yearly"],
];
const STATUS_OPTS: [string, string][] = [
  ["active", "Active"], ["pending", "Pending"], ["paused", "Paused"], ["stopped", "Stopped"],
];

export function ManualSipForm({ members, currentUserId }: { members: { id: string; name: string }[]; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();

  const [investorId, setInvestorId] = useState("");
  const [clientName, setClientName] = useState("");
  const [schemeName, setSchemeName] = useState("");
  const [schemeCode, setSchemeCode] = useState("");
  const [amcName, setAmcName] = useState("");
  const [folioNumber, setFolioNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [sipDate, setSipDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [status, setStatus] = useState("active");
  const [rmId, setRmId] = useState(currentUserId);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!investorId) { toast.error("Pick an existing client", "Missing client"); return; }
    if (!(Number(amount) > 0)) { toast.error("Enter a SIP amount", "Missing amount"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/sips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId,
          schemeName: schemeName.trim() || undefined,
          schemeCode: schemeCode || undefined,
          amcName: amcName.trim() || undefined,
          folioNumber: folioNumber.trim() || undefined,
          amount: Number(amount),
          frequency,
          sipDate: sipDate || undefined,
          startDate: startDate || undefined,
          status,
          rmId: rmId || undefined,
          remarks: remarks.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error ?? "Could not save SIP", "Save failed"); return; }
      toast.success("SIP registered");
      router.push("/dashboard/sips");
      router.refresh();
    } catch {
      toast.error("Network error — please try again", "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Label>Client *</Label>
          <ClientField
            value={clientName}
            onPick={(c) => { setInvestorId(c.id); setClientName(c.name); }}
            onText={(v) => { setClientName(v); setInvestorId(""); }}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Scheme</Label>
          <SchemeAutocomplete
            defaultValue={schemeName}
            onQueryChange={(v) => { setSchemeName(v); setSchemeCode(""); }}
            onSelect={(s) => { setSchemeName(s.schemeName); setSchemeCode(s.schemeCode); setAmcName(s.amc ?? ""); }}
            placeholder="Search catalog or type a scheme name…"
          />
          {amcName && <div className="text-[10px] text-muted-foreground mt-1 truncate"><span className="font-medium text-foreground/70">AMC:</span> {amcName}</div>}
        </div>
        <div>
          <Label>SIP amount (₹) *</Label>
          <input type="number" min={0} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm tabular-nums focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15" />
        </div>
        <div>
          <Label>Frequency</Label>
          <SelectField value={frequency} onChange={(e) => setFrequency(e.target.value)} className="w-full">
            {FREQ_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
        </div>
        <div>
          <Label>SIP date (day of month)</Label>
          <input inputMode="numeric" value={sipDate} onChange={(e) => setSipDate(e.target.value)} placeholder="e.g. 5 (1–28)"
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15" />
        </div>
        <div>
          <Label>Start date</Label>
          <DateField value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full" />
        </div>
        <div>
          <Label>Status</Label>
          <SelectField value={status} onChange={(e) => setStatus(e.target.value)} className="w-full">
            {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
        </div>
        <div>
          <Label>Relationship manager</Label>
          <SelectField value={rmId} onChange={(e) => setRmId(e.target.value)} className="w-full">
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </SelectField>
        </div>
        <div>
          <Label>Folio no. (optional)</Label>
          <input value={folioNumber} onChange={(e) => setFolioNumber(e.target.value)} placeholder="Folio / account no."
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Label>Remarks (optional)</Label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={() => router.back()} className="btn-secondary text-sm">Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save SIP
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="block font-medium text-muted-foreground text-xs mb-1">{children}</span>;
}

/** Inline client search over /api/investors — a SIP must attach to a real client. */
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
          placeholder="Search existing clients…"
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
