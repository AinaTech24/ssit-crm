"use client";

/**
 * Per-tenant data-visibility switch (platform admin).
 *
 * Off (the default, and how every firm has always behaved): everyone who can
 * see clients at all sees the whole firm's book. On: each user is limited to
 * the clients their role entitles them to — an RM to their own book, a branch
 * head to their branch, while owner / compliance / back-office / ops keep the
 * full view. Applies to the client list, the Excel export and the JSON API the
 * mobile app reads, so the three can't disagree.
 *
 * Saved through PATCH /api/super-admin/tenants/[id] (platform.tenant.edit).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";

export function TenantDataScope({
  tenantId,
  initialRestricted,
}: {
  tenantId: string;
  initialRestricted: boolean;
}) {
  const router = useRouter();
  const [restricted, setRestricted] = useState(!!initialRestricted);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setErr(null);
    // Optimistic — reverted below if the PATCH is rejected.
    setRestricted(next);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restrictUserDataScope: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${res.status})`);
        setRestricted(!next);
        return;
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
      setRestricted(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold flex items-center gap-2">
            {restricted ? (
              <ShieldCheck className="size-4 text-emerald-600" />
            ) : (
              <ShieldOff className="size-4 text-muted-foreground" />
            )}
            Data visibility
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Restrict each user to the clients their role entitles them to.
          </p>
        </div>
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />}
      </div>

      <div className="mt-4 flex gap-1 text-xs font-medium">
        {([["Off — firm-wide", false], ["On — restrict by role", true]] as const).map(([label, val]) => (
          <button
            key={String(val)}
            type="button"
            disabled={busy}
            onClick={() => val !== restricted && save(val)}
            className={`px-3 py-1.5 rounded border transition-colors disabled:opacity-50 ${
              val === restricted
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <dl className="mt-4 text-[11px] border rounded-md divide-y bg-secondary/10">
        {[
          ["Owner, Compliance, Back office, Ops", "Whole firm's book"],
          ["Branch head", "Their branch only"],
          ["RM", "Only clients assigned to them"],
        ].map(([who, sees]) => (
          <div key={who} className="flex items-center gap-3 p-2">
            <dt className="flex-1 font-medium">{who}</dt>
            <dd className="text-muted-foreground">{restricted ? sees : "Whole firm's book"}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[11px] text-muted-foreground mt-3">
        Applies to the client list, the Excel export and the mobile/JSON API.
        Lead visibility is always scoped and is not affected by this switch.
      </p>

      {err && <p className="text-xs text-rose-600 mt-3">{err}</p>}
    </div>
  );
}
