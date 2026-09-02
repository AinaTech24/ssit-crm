"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Link2Off, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type AccessStatus = { active: boolean; access?: { expiresAt: string; lastAccessedAt: string | null } | null };

export function PortalAccessButton({ investorId }: { investorId: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<AccessStatus>({ active: false });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const response = await fetch(`/api/investors/${investorId}/portal-access`, { cache: "no-store" });
    if (response.ok) setStatus(await response.json());
  }

  useEffect(() => { void refresh(); }, [investorId]);

  async function createAndCopy() {
    setBusy(true);
    try {
      const response = await fetch(`/api/investors/${investorId}/portal-access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInDays: 30 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not create portal link");
      await navigator.clipboard.writeText(body.accessUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success("Portal link copied", "The secure link expires in 30 days and replaces any older link.");
      await refresh();
    } catch (error) {
      toast.error("Portal link failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const response = await fetch(`/api/investors/${investorId}/portal-access`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke portal access");
      setStatus({ active: false });
      toast.success("Portal access revoked");
    } catch (error) {
      toast.error("Revoke failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const expiry = status.access?.expiresAt
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(status.access.expiresAt))
    : null;

  return (
    <details className="relative">
      <summary className="btn-secondary cursor-pointer list-none text-xs">
        <KeyRound className="size-3.5" /> Portal link
      </summary>
      <div className="absolute left-0 top-full z-40 mt-2 w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
        <div className="text-sm font-semibold">Investor portal</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {status.active ? `Active until ${expiry}. Creating a new link revokes the old one.` : "Create an expiring link for portfolio, goals and service requests."}
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={createAndCopy} disabled={busy} className="btn-primary flex-1 justify-center text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : status.active ? "Replace & copy" : "Create & copy"}
          </button>
          {status.active && (
            <button type="button" onClick={revoke} disabled={busy} className="btn-secondary px-2.5" title="Revoke portal link" aria-label="Revoke portal link">
              <Link2Off className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

