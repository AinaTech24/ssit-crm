"use client";

/**
 * Dedicated, editable Nominees section for the Client 360 page.
 *
 * Read view: one card per nominee (name, relation, DOB, PAN, mobile, share %,
 * PAN-doc badge). Edit opens a right drawer with the shared multi-nominee editor
 * (NomineesField) and saves via PATCH /api/investors/[id] { nominees } — the same
 * endpoint the master-record editor uses, so RBAC + audit are enforced server-side.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Users2, Pencil, X, Loader2, Save, FileText, UserPlus } from "lucide-react";
import { NomineesField } from "./NomineesField";
import type { Nominee } from "@/lib/investors/nominee";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/utils";

export function NomineeSection({
  investorId,
  nominees,
  legacy,
  canEdit = true,
}: {
  investorId: string;
  nominees: Nominee[];
  legacy?: { name?: string | null; relation?: string | null; dob?: string | null };
  canEdit?: boolean;
}) {
  // Prefer the structured nominees[]; fall back to the legacy single-nominee
  // columns so older records still show something.
  const seed: Nominee[] =
    nominees && nominees.length
      ? nominees
      : legacy?.name
        ? [{ name: legacy.name, relation: legacy.relation ?? undefined, dob: legacy.dob ?? undefined }]
        : [];

  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Nominee[]>(seed);

  function startEdit() {
    setDraft(seed.length ? seed : [{ name: "" }]);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const cleaned = draft
        .map((n) => ({ ...n, name: (n.name || "").trim(), relation: (n.relation || "").trim() || undefined }))
        .filter((n) => n.name);
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nominees: cleaned }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Nominees");
        return;
      }
      toast.success("Nominees updated");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Nominees");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4 border-b pb-3">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <Users2 className="size-4 text-brand-cyan" /> Nominees
          {seed.length > 0 && <span className="text-xs font-normal text-muted-foreground">({seed.length})</span>}
        </h2>
        {canEdit && (
          <button
            onClick={startEdit}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
          >
            <Pencil className="size-3.5" /> {seed.length ? "Edit" : "Add nominee"}
          </button>
        )}
      </div>

      {seed.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          <UserPlus className="size-7 mx-auto text-muted-foreground/40 mb-2" />
          No nominees recorded for this client yet.
          {canEdit && (
            <div className="mt-2">
              <button onClick={startEdit} className="text-brand-cyan hover:underline text-xs font-medium">
                Add a nominee
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {seed.map((n, i) => (
            <div key={i} className="rounded-lg border border-border bg-secondary/20 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Nominee {i + 1}
                </span>
                {n.sharePct != null && (
                  <span className="text-[10px] font-semibold text-brand-cyan-deep bg-brand-cyan-light/40 rounded px-1.5 py-0.5">
                    {n.sharePct}%
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold">{n.name || "—"}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <NomKV label="Relation" value={n.relation} cap />
                <NomKV label="Date of birth" value={n.dob ? formatDate(n.dob) : undefined} />
                <NomKV label="PAN" value={n.pan} mono />
                <NomKV label="Mobile" value={n.mobile} mono />
              </div>
              {n.panDocKey && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-emerald-700">
                  <FileText className="size-3.5" /> PAN document on file
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => !busy && setOpen(false)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-card shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Users2 className="size-4 text-brand-cyan" /> Edit nominees
              </h3>
              <button onClick={() => !busy && setOpen(false)} className="btn-icon h-7 w-7">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
              <NomineesField value={draft} onChange={setDraft} />
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button onClick={save} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save nominees
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function NomKV({ label, value, cap, mono }: { label: string; value?: string | null; cap?: boolean; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`${mono ? "font-mono" : ""} ${cap ? "capitalize" : ""}`}>{value || "—"}</div>
    </div>
  );
}
