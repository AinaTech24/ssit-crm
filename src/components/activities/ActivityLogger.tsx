"use client";

/**
 * Activity logging UI — the write side of the unified interaction log.
 *
 *   <LogActivityButton />                       — list-page button w/ subject search
 *   <LogActivityButton subject={{...}} />       — detail-page button, subject pre-bound
 *   <CheckInButton subject={{...}} />           — geo field-visit "Check In"
 *
 * All post to POST /api/activities and router.refresh() on success.
 */

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, X, Plus, MapPin, Phone, Save } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

type Subject = { type: "investor" | "lead" | "family"; id: string; name: string; phone?: string | null };

const KINDS = [
  ["call", "Call"], ["visit", "Visit"], ["note", "Note"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["sms", "SMS"],
] as const;
const STATUSES = [
  ["", "Select…"], ["completed", "Completed"], ["no_answer", "No answer"],
  ["busy", "Busy"],
] as const;

export function LogActivityButton({ subject, label = "Log activity", variant = "primary" }: { subject?: Subject; label?: string; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={`${variant === "primary" ? "btn-primary" : "btn-secondary"} text-sm inline-flex items-center gap-1`}>
        <Plus className="size-4" /> {label}
      </button>
      {open && <LogActivityDrawer subject={subject} onClose={() => setOpen(false)} />}
    </>
  );
}

function LogActivityDrawer({ subject: fixed, onClose }: { subject?: Subject; onClose: () => void }) {
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | null>(fixed ?? null);
  const [kind, setKind] = useState<string>("call");
  const [direction, setDirection] = useState<string>("outbound");
  const [status, setStatus] = useState<string>("");
  const [subjectLine, setSubjectLine] = useState("");
  const [notes, setNotes] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!subject) { setErr("Pick a client or lead first."); return; }
    setBusy(true); setErr(null);
    try {
      const body: any = {
        subjectType: subject.type, subjectId: subject.id, kind,
        subject: subjectLine || undefined, notes: notes || undefined,
      };
      if (kind === "call") {
        body.direction = direction || undefined;
        if (status) body.status = status;
        if (durationMin) body.durationSec = Math.round(Number(durationMin) * 60);
      } else if (status) body.status = status;
      const res = await fetch("/api/activities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Failed (${res.status})`); return; }
      onClose(); router.refresh();
    } finally { setBusy(false); }
  }

  // Portaled to <body>: this drawer is opened from inside the header's More
  // menu, and rendering it in that subtree meant the menu's own styles and
  // lifecycle governed a full-screen overlay.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full bg-card border-l border-border shadow-2xl flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Log activity</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {fixed ? (
            <div className="rounded-lg border bg-secondary/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground text-xs">For </span><span className="font-medium">{fixed.name}</span>
              <span className="text-[11px] text-muted-foreground ml-1">({fixed.type})</span>
            </div>
          ) : (
            <SubjectPicker value={subject} onChange={setSubject} />
          )}

          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Type</div>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map(([k, l]) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border ${kind === k ? "bg-brand-cyan text-white border-brand-cyan" : "border-border text-muted-foreground hover:bg-secondary"}`}>{l}</button>
              ))}
            </div>
          </div>

          {kind === "call" && (
            <div className="grid grid-cols-3 gap-2">
              <Field label="Direction">
                <SelectField value={direction} onChange={(e) => setDirection(e.target.value)}>
                  <option value="outbound">Outbound</option><option value="inbound">Inbound</option>
                </SelectField>
              </Field>
              <Field label="Outcome">
                <SelectField value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </SelectField>
              </Field>
              <Field label="Duration (min)"><input type="number" min="0" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} className="input-base text-sm" /></Field>
            </div>
          )}

          <Field label="Subject"><input value={subjectLine} onChange={(e) => setSubjectLine(e.target.value)} placeholder="e.g. SIP top-up discussion" className="input-base" /></Field>
          <Field label="Notes / outcome"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="input-base" placeholder="What was discussed / agreed?" /></Field>

          {err && <div className="text-sm text-rose-600">{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SubjectPicker({ value, onChange }: { value: Subject | null; onChange: (s: Subject) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<any>(null);

  function onType(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(v.trim())}`);
        const j = await res.json().catch(() => ({}));
        const inv: Subject[] = (j.investors ?? []).map((r: any) => ({ type: "investor", id: r.id, name: r.name, phone: r.phone }));
        const lead: Subject[] = (j.leads ?? []).map((r: any) => ({ type: "lead", id: r.id, name: r.name, phone: r.phone }));
        setResults([...inv, ...lead].slice(0, 8));
      } finally { setLoading(false); }
    }, 250);
  }

  if (value) {
    return (
      <div className="rounded-lg border bg-secondary/30 px-3 py-2 text-sm flex items-center justify-between">
        <span><span className="font-medium">{value.name}</span><span className="text-[11px] text-muted-foreground ml-1">({value.type})</span></span>
        <button onClick={() => { onChange(null as any); setQ(""); }} className="text-xs text-muted-foreground hover:underline">change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="text-[11px] text-muted-foreground mb-1">Client / Lead</div>
      <input value={q} onChange={(e) => onType(e.target.value)} placeholder="Search by name or phone…" className="input-base" autoFocus />
      {loading && <Loader2 className="size-4 animate-spin absolute right-3 top-7 text-muted-foreground" />}
      {results.length > 0 && (
        <div className="mt-1 rounded-lg border bg-card shadow-sm divide-y max-h-56 overflow-y-auto">
          {results.map((r) => (
            <button key={`${r.type}-${r.id}`} onClick={() => onChange(r)} className="w-full text-left px-3 py-2 hover:bg-secondary/50 flex items-center justify-between">
              <span className="text-sm">{r.name}</span>
              <span className={`chip text-[10px] ${r.type === "investor" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{r.type === "investor" ? "Client" : "Lead"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Geo field-visit "Check In" — one tap captures location + timestamp. */
export function CheckInButton({ subject }: { subject: Subject }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function post(geo?: { lat: number; lng: number }) {
    const body: any = { subjectType: subject.type, subjectId: subject.id, kind: "visit", status: "completed", subject: "Field visit (check-in)" };
    if (geo) { body.geoLat = geo.lat; body.geoLng = geo.lng; body.locationLabel = `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`; }
    const res = await fetch("/api/activities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { setDone(true); router.refresh(); setTimeout(() => setDone(false), 2500); }
  }

  function checkIn() {
    setBusy(true);
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { post({ lat: pos.coords.latitude, lng: pos.coords.longitude }).finally(() => setBusy(false)); },
        () => { post().finally(() => setBusy(false)); }, // permission denied → log without geo
        { timeout: 8000, maximumAge: 60000 }
      );
    } else {
      post().finally(() => setBusy(false));
    }
  }

  return (
    <button onClick={checkIn} disabled={busy} className="btn-secondary text-xs inline-flex items-center gap-1" title="Log an in-person field visit with your location">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />} {done ? "Checked in ✓" : "Check In"}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>{children}</label>;
}
