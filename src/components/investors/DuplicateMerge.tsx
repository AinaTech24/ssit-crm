"use client";

/**
 * DuplicateGroup — one cluster of suspected-duplicate clients. The user picks
 * the survivor (radio); every other member is merged into it via
 * POST /api/investors/merge. All child records move to the survivor.
 * The user can also dismiss the group by clicking "Not duplicates".
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, GitMerge, ShieldAlert } from "lucide-react";

type Member = { id: string; name: string; pan: string | null; phone: string | null; email: string | null; aum: number; rm_name: string | null };

const fmtINR = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);

export function DuplicateGroup({ kind, gkey, members }: { kind: string; gkey: string; members: Member[] }) {
  const router = useRouter();
  // Default survivor = the record with the most AUM (likely the "real" one).
  const [survivor, setSurvivor] = useState<string>(() => [...members].sort((a, b) => b.aum - a.aum)[0]?.id ?? members[0]?.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function dismiss() {
    if (!confirm("Are you sure these records are NOT duplicates? This will dismiss this warning pair.")) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/duplicates/ignore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType: "client", memberIds: members.map((m) => m.id) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Dismiss failed (${res.status})`);
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    const losers = members.filter((m) => m.id !== survivor);
    if (!losers.length) return;
    if (!confirm(`Merge ${losers.length} duplicate record(s) into "${members.find((m) => m.id === survivor)?.name}"? Child records (folios, transactions, activities, policies…) will move to the survivor and the duplicates will be retired.`)) return;
    setBusy(true); setErr(null);
    try {
      for (const l of losers) {
        const res = await fetch("/api/investors/merge", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ survivorId: survivor, loserId: l.id }),
        });
        if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Merge failed (${res.status})`); return; }
      }
      setDone(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (done) return null;

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs">
          <span className="chip bg-amber-50 text-amber-700">{kind} match</span>
          <span className="ml-2 font-mono text-muted-foreground">{gkey}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={dismiss} disabled={busy} className="btn-secondary text-xs">
            Not duplicates
          </button>
          <button onClick={merge} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />} Merge {members.length - 1} into survivor
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {members.map((m) => (
          <label key={m.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${survivor === m.id ? "border-emerald-300 bg-emerald-50/50" : "border-border hover:bg-secondary/40"}`}>
            <input type="radio" name={`survivor-${kind}-${gkey}`} checked={survivor === m.id} onChange={() => setSurvivor(m.id)} className="size-4" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{m.name} {survivor === m.id && <span className="text-[10px] text-emerald-700 font-semibold">· keep</span>}</div>
              <div className="text-[11px] text-muted-foreground">
                {m.pan ? <span className="font-mono">{m.pan}</span> : "no PAN"} · {m.phone ?? "no phone"} · {m.email ?? "no email"}{m.rm_name ? ` · RM ${m.rm_name}` : ""}
              </div>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground shrink-0">{m.aum > 0 ? fmtINR(m.aum) : "₹0"}</div>
          </label>
        ))}
      </div>
      {err && <div className="text-sm text-rose-600 mt-2 flex items-center gap-1"><ShieldAlert className="size-4" /> {err}</div>}
    </div>
  );
}

type FamMember = { id: string; name: string; member_count: number; family_aum: number };

/** Same UX as DuplicateGroup, for duplicate family groupings → /api/families/merge. */
export function FamilyDuplicateGroup({ gkey, members }: { gkey: string; members: FamMember[] }) {
  const router = useRouter();
  const [survivor, setSurvivor] = useState<string>(() => [...members].sort((a, b) => b.family_aum - a.family_aum || b.member_count - a.member_count)[0]?.id ?? members[0]?.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function dismiss() {
    if (!confirm("Are you sure these families are NOT duplicates? This will dismiss this warning pair.")) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/duplicates/ignore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType: "family", memberIds: members.map((m) => m.id) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Dismiss failed (${res.status})`);
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    const losers = members.filter((m) => m.id !== survivor);
    if (!losers.length) return;
    if (!confirm(`Merge ${losers.length} duplicate family grouping(s) into "${members.find((m) => m.id === survivor)?.name}"? Members and meetings move to the survivor; the empty duplicates are removed.`)) return;
    setBusy(true); setErr(null);
    try {
      for (const l of losers) {
        const res = await fetch("/api/families/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ survivorId: survivor, loserId: l.id }) });
        if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Merge failed (${res.status})`); return; }
      }
      setDone(true); router.refresh();
    } finally { setBusy(false); }
  }

  if (done) return null;
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs"><span className="chip bg-amber-50 text-amber-700">Name match</span><span className="ml-2 font-mono text-muted-foreground">{gkey}</span></div>
        <div className="flex items-center gap-2">
          <button onClick={dismiss} disabled={busy} className="btn-secondary text-xs">Not duplicates</button>
          <button onClick={merge} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />} Merge {members.length - 1} into survivor</button>
        </div>
      </div>
      <div className="space-y-1.5">
        {members.map((m) => (
          <label key={m.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${survivor === m.id ? "border-emerald-300 bg-emerald-50/50" : "border-border hover:bg-secondary/40"}`}>
            <input type="radio" name={`famsurvivor-${gkey}`} checked={survivor === m.id} onChange={() => setSurvivor(m.id)} className="size-4" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{m.name} {survivor === m.id && <span className="text-[10px] text-emerald-700 font-semibold">· keep</span>}</div>
              <div className="text-[11px] text-muted-foreground">{m.member_count} member{m.member_count === 1 ? "" : "s"}</div>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground shrink-0">{m.family_aum > 0 ? fmtINR(m.family_aum) : "₹0"}</div>
          </label>
        ))}
      </div>
      {err && <div className="text-sm text-rose-600 mt-2 flex items-center gap-1"><ShieldAlert className="size-4" /> {err}</div>}
    </div>
  );
}
