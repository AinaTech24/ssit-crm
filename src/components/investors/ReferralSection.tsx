"use client";

/**
 * Dedicated, editable Referrals section for the Client 360 page.
 *
 * Read view: one card per referral (name, relation, mobile, email, note). Edit
 * opens a right drawer with the shared multi-referral editor (ReferralsField)
 * and saves via PATCH /api/investors/[id] { referrals } — same endpoint the
 * master-record editor uses, so RBAC + audit are enforced server-side. Mirrors
 * NomineeSection.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Share2, Pencil, X, Loader2, Save, UserPlus, UserCheck, Users } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { ReferralsField } from "./ReferralsField";
import type { Referral } from "@/lib/investors/referral";
import { useToast } from "@/components/ui/Toast";

type ReferredPerson = { id: string; name: string; status: string; kind: "client" | "lead" };

export function ReferralSection({
  investorId,
  referrals,
  referredBy = [],
  referredList = [],
  canEdit = true,
}: {
  investorId: string;
  referrals: Referral[];
  /** The existing clients who referred THIS client (migrations 0261 / 0264). */
  referredBy?: Array<{ id: string; name: string }>;
  /** Clients and still-open leads that came in through this client - shown automatically. */
  referredList?: ReferredPerson[];
  canEdit?: boolean;
}) {
  const seed: Referral[] = referrals && referrals.length ? referrals : [];

  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Referral[]>(seed);
  // "Referred by" is its own list: add a referring client, or remove any - each change saves at once.
  const [pickingReferrer, setPickingReferrer] = useState(false);
  const [refBusy, setRefBusy] = useState(false);

  async function saveReferrers(ids: string[], message: string) {
    setRefBusy(true);
    try {
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referredByInvestorIds: ids }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Referred by");
        return;
      }
      toast.success(message);
      setPickingReferrer(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Referred by");
    } finally {
      setRefBusy(false);
    }
  }

  function startEdit() {
    setDraft(seed.length ? seed : [{ name: "" }]);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const cleaned = draft
        .map((n) => ({
          ...n,
          name: (n.name || "").trim(),
          relation: (n.relation || "").trim() || undefined,
          mobile: (n.mobile || "").trim() || undefined,
          email: (n.email || "").trim() || undefined,
          note: (n.note || "").trim() || undefined,
        }))
        .filter((n) => n.name);
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referrals: cleaned }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Referrals");
        return;
      }
      toast.success("Referrals updated");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Referrals");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4 border-b pb-3">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <Share2 className="size-4 text-brand-cyan" /> Referrals
          {seed.length > 0 && <span className="text-xs font-normal text-muted-foreground">({seed.length})</span>}
        </h2>
        {canEdit && (
          <button
            onClick={startEdit}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
          >
            <Pencil className="size-3.5" /> {seed.length ? "Edit" : "Add referral"}
          </button>
        )}
      </div>

      {/* Who this client has referred - filled in automatically from "Referred by" on the other record */}
      {referredList.length > 0 && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/20 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            <Users className="size-3.5" /> Referred by this client ({referredList.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {referredList.map((p) => (
              <Link
                key={`${p.kind}-${p.id}`}
                href={p.kind === "client" ? `/dashboard/investors/${p.id}` : `/dashboard/leads/${p.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-secondary"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {p.kind === "client" ? "client" : `lead · ${String(p.status).replace(/_/g, " ")}`}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {seed.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          <UserPlus className="size-7 mx-auto text-muted-foreground/40 mb-2" />
          No referrals recorded for this client yet.
          {canEdit && (
            <div className="mt-2">
              <button onClick={startEdit} className="text-brand-cyan hover:underline text-xs font-medium">
                Add a referral
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
                  Referral {i + 1}
                </span>
              </div>
              <div className="text-sm font-semibold">{n.name || "—"}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <RefKV label="Relation" value={n.relation} cap />
                <RefKV label="Mobile" value={n.mobile} mono />
                <RefKV label="Email" value={n.email} />
              </div>
              {n.note && <div className="mt-2.5 text-[11px] text-muted-foreground whitespace-pre-wrap">{n.note}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Who referred this client - its own section, like Referrals: add several, remove any */}
      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <UserCheck className="size-4 text-brand-cyan" /> Referred by
            {referredBy.length > 0 && <span className="text-xs font-normal text-muted-foreground">({referredBy.length})</span>}
          </h3>
          {canEdit && !pickingReferrer && (
            <button
              type="button"
              onClick={() => setPickingReferrer(true)}
              className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
            >
              <UserPlus className="size-3.5" /> Add referred by
            </button>
          )}
        </div>

        {pickingReferrer && (
          <div className="mb-3 space-y-2">
            <InvestorLookup
              value={null}
              displayName={null}
              onSelect={(id) => {
                if (id === investorId) {
                  toast.error("A client cannot be referred by themselves", "Referred by");
                  return;
                }
                if (referredBy.some((r) => r.id === id)) {
                  toast.error("Already in the list", "Referred by");
                  return;
                }
                saveReferrers([...referredBy.map((r) => r.id), id], "Referred by added");
              }}
              placeholder="Type the referring client's name, PAN or mobile…"
            />
            <div className="flex justify-end">
              <button type="button" disabled={refBusy} onClick={() => setPickingReferrer(false)} className="text-xs text-muted-foreground hover:underline">
                {refBusy ? "Saving…" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {referredBy.length === 0 ? (
          !pickingReferrer && <div className="text-xs text-muted-foreground">Nobody recorded - add the client who referred this one.</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {referredBy.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-3.5 py-2.5">
                <Link href={`/dashboard/investors/${r.id}`} className="text-sm font-semibold hover:underline truncate">
                  {r.name}
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    disabled={refBusy}
                    onClick={() => saveReferrers(referredBy.filter((x) => x.id !== r.id).map((x) => x.id), "Referred by removed")}
                    className="btn-icon h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="Remove"
                    aria-label={`Remove ${r.name}`}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => !busy && setOpen(false)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-card shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Share2 className="size-4 text-brand-cyan" /> Edit referrals
              </h3>
              <button onClick={() => !busy && setOpen(false)} className="btn-icon h-7 w-7">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
              <ReferralsField value={draft} onChange={setDraft} />
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
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save referrals
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function RefKV({ label, value, cap, mono }: { label: string; value?: string | null; cap?: boolean; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`${mono ? "font-mono" : ""} ${cap ? "capitalize" : ""} break-words`}>{value || "—"}</div>
    </div>
  );
}
