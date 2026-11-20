"use client";

/**
 * "Referred by" - its own card on the Client page, under Referrals.
 *
 * This is where the referring clients are RECORDED: add one (or several) with the
 * client search, remove any with the X. Each change saves at once through
 * PATCH /api/investors/[id] { referredByInvestorIds }, so RBAC and audit are enforced
 * on the server. The Referrals card above lists the clients this client has referred.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserCheck, UserPlus, X } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { useToast } from "@/components/ui/Toast";

export function ReferredBySection({
  investorId,
  referredBy,
  canEdit = true,
}: {
  investorId: string;
  referredBy: Array<{ id: string; name: string }>;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(ids: string[], message: string) {
    setBusy(true);
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
      setPicking(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error", "Referred by");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4 border-b pb-3">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <UserCheck className="size-4 text-brand-cyan" /> Referred by
          {referredBy.length > 0 && <span className="text-xs font-normal text-muted-foreground">({referredBy.length})</span>}
        </h2>
        {canEdit && !picking && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
          >
            <UserPlus className="size-3.5" /> Add referred by
          </button>
        )}
      </div>

      {picking && (
        <div className="mb-4 space-y-2">
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
              save([...referredBy.map((r) => r.id), id], "Referred by added");
            }}
            placeholder="Type the referring client's name, PAN or mobile…"
          />
          <div className="flex justify-end">
            <button type="button" disabled={busy} onClick={() => setPicking(false)} className="text-xs text-muted-foreground hover:underline">
              {busy ? "Saving…" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      {referredBy.length === 0 ? (
        !picking && (
          <div className="text-center text-sm text-muted-foreground py-6">
            <UserPlus className="size-7 mx-auto text-muted-foreground/40 mb-2" />
            Nobody recorded as having referred this client.
            {canEdit && (
              <div className="mt-2">
                <button type="button" onClick={() => setPicking(true)} className="text-brand-cyan hover:underline text-xs font-medium">
                  Add referred by
                </button>
              </div>
            )}
          </div>
        )
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
                  disabled={busy}
                  onClick={() => save(referredBy.filter((x) => x.id !== r.id).map((x) => x.id), "Referred by removed")}
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
  );
}
