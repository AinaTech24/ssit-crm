"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Send, Pause, Play, XCircle, Loader2, RotateCcw, RefreshCw } from "lucide-react";

/**
 * Lifecycle controls for a campaign — the missing affordances for the approval
 * gate + pause/resume/cancel. Driven by current status + approval state.
 */
export function CampaignActions({
  id,
  status,
  approvalStatus,
  isBroadcast,
}: {
  id: string;
  status: string;
  approvalStatus: string;
  isBroadcast: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(label: string, url: string, body?: unknown) {
    setBusy(label);
    setErr(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    setErr(null);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalStatus: "approved" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function runMsg(label: string, url: string, body: unknown, okMsg: (j: any) => string) {
    setBusy(label);
    setErr(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setErr(okMsg(j));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const approved = approvalStatus === "approved" || approvalStatus === "not_required";
  const Spin = () => <Loader2 className="size-3.5 animate-spin" />;
  const startable = isBroadcast && (status === "draft" || status === "scheduled");
  const cancellable = ["draft", "scheduled", "sending", "paused"].includes(status);
  const retryable = isBroadcast && (status === "sent" || status === "paused");
  const roiable = isBroadcast && ["sending", "paused", "sent"].includes(status);

  if (!startable && status !== "sending" && status !== "paused" && !cancellable && !retryable && !roiable) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {startable && !approved && (
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" disabled={!!busy} onClick={approve}>
          {busy === "approve" ? <Spin /> : <CheckCircle2 className="size-3.5" />} Approve
        </button>
      )}
      {startable && approved && (
        <button type="button" className="btn-primary text-xs inline-flex items-center gap-1" disabled={!!busy} onClick={() => run("launch", `/api/campaigns/${id}/launch`)}>
          {busy === "launch" ? <Spin /> : <Send className="size-3.5" />} Launch now
        </button>
      )}
      {status === "sending" && (
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" disabled={!!busy} onClick={() => run("pause", `/api/campaigns/${id}/control`, { action: "pause" })}>
          {busy === "pause" ? <Spin /> : <Pause className="size-3.5" />} Pause
        </button>
      )}
      {status === "paused" && (
        <button type="button" className="btn-primary text-xs inline-flex items-center gap-1" disabled={!!busy} onClick={() => run("resume", `/api/campaigns/${id}/control`, { action: "resume" })}>
          {busy === "resume" ? <Spin /> : <Play className="size-3.5" />} Resume
        </button>
      )}
      {retryable && (
        <button
          type="button"
          className="btn-secondary text-xs inline-flex items-center gap-1"
          disabled={!!busy}
          onClick={() => runMsg("retry", `/api/campaigns/${id}/control`, { action: "retry_failed" }, (j) => `Retrying ${j.retried ?? 0} failed recipient(s)…`)}
        >
          {busy === "retry" ? <Spin /> : <RotateCcw className="size-3.5" />} Retry failed
        </button>
      )}
      {roiable && (
        <button
          type="button"
          className="btn-secondary text-xs inline-flex items-center gap-1"
          disabled={!!busy}
          onClick={() => runMsg("roi", `/api/campaigns/${id}/recompute-roi`, {}, (j) => `ROI updated — ${j.meetingsBooked ?? 0} meeting(s), ${j.clientsConverted ?? 0} conversion(s).`)}
        >
          {busy === "roi" ? <Spin /> : <RefreshCw className="size-3.5" />} Recompute ROI
        </button>
      )}
      {cancellable && (
        <button
          type="button"
          className="btn-secondary text-xs inline-flex items-center gap-1 !text-rose-700 !border-rose-300 hover:!bg-rose-50"
          disabled={!!busy}
          onClick={() => run("cancel", `/api/campaigns/${id}/control`, { action: "cancel" })}
        >
          {busy === "cancel" ? <Spin /> : <XCircle className="size-3.5" />} Cancel
        </button>
      )}
      {err && <span className="text-xs text-muted-foreground">{err}</span>}
    </div>
  );
}
