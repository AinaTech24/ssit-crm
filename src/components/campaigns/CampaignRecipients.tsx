"use client";

/**
 * CampaignRecipients — per-recipient drill-down for a campaign send.
 * Click a status tab (All / Sent / Delivered / Read / Failed / Bounced /
 * Skipped) to list who's in that bucket, with the time and any skip/fail reason.
 * Fetches /api/campaigns/[id]/recipients?status=…
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Users, RefreshCw } from "lucide-react";

type Recipient = {
  id: string;
  name: string;
  status: string;
  reason: string | null;
  channel: string;
  when: string | null;
};

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
  { key: "replied", label: "Replied" },
  { key: "failed", label: "Failed" },
  { key: "bounced", label: "Bounced" },
  { key: "skipped", label: "Skipped" },
];

function chip(status: string): string {
  const ok = "bg-emerald-50 text-emerald-700 border-emerald-200";
  const blue = "bg-blue-50 text-blue-700 border-blue-200";
  const bad = "bg-rose-50 text-rose-700 border-rose-200";
  const muted = "bg-slate-100 text-slate-600 border-slate-200";
  if (["delivered", "sent", "replied"].includes(status)) return ok;
  if (status === "read") return blue;
  if (["failed", "bounced"].includes(status)) return bad;
  return muted;
}

function fmt(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}

export function CampaignRecipients({ campaignId }: { campaignId: string }) {
  const [tab, setTab] = useState("all");
  const [rows, setRows] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/recipients?status=${status}`);
      const j = await res.json();
      setRows(j.recipients ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <h2 className="font-semibold flex items-center gap-2">
          <Users className="size-4 text-brand-cyan" /> Recipients
        </h2>
        <button type="button" onClick={() => load(tab)} className="btn-icon" title="Refresh" aria-label="Refresh recipients">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b bg-secondary/20">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              tab === t.key ? "bg-brand-cyan text-white" : "border border-border hover:bg-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading recipients…
        </div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No recipients in this bucket.</div>
      ) : (
        <div className="max-h-96 overflow-y-auto scrollbar-thin divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${chip(r.status)}`}>
                {r.status.startsWith("skipped") ? "Skipped" : r.status}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                {r.reason && <div className="text-[11px] text-muted-foreground truncate">{r.reason}</div>}
              </div>
              <div className="text-[11px] text-muted-foreground shrink-0">{fmt(r.when)}</div>
            </div>
          ))}
        </div>
      )}
      {rows.length >= 500 && (
        <div className="px-4 py-2 text-[11px] text-muted-foreground border-t">Showing the first 500 recipients.</div>
      )}
    </div>
  );
}
