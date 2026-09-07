"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Edit2, Send, Check, X, Plus } from "lucide-react";

interface TemplateActionsProps {
  templateId: string;
  templateStatus: string;
  versionId: string;
  versionStatus: string;
  versionNumber: number;
  hasApproveRole: boolean;
  /** Firm-admin authoring rights (template.create). Approval is separate. */
  canAuthor: boolean;
}

export function TemplateActions({
  templateId,
  templateStatus,
  versionId,
  versionStatus,
  versionNumber,
  hasApproveRole,
  canAuthor,
}: TemplateActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleAction(url: string, method: string = "POST", body?: any) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Action failed (HTTP ${res.status})`);
      }
      if (url.endsWith("/version")) {
        router.push(`/dashboard/templates/${templateId}/edit`);
      } else {
        if (data?.submittedToMeta) {
          setNotice("Submitted to Meta for WhatsApp approval — usually 1–24 hours. It becomes sendable the moment Meta approves it.");
        }
        router.refresh();
      }
    } catch (err: any) {
      setError(err?.message ?? "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
          {notice}
        </div>
      )}

      <div className="flex gap-2 items-center flex-wrap">
        {versionStatus === "draft" && canAuthor && (
          <>
            <Link
              href={`/dashboard/templates/${templateId}/edit`}
              className="rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 border"
            >
              <Edit2 className="size-3.5" /> Edit draft content
            </Link>
            <button
              onClick={() => handleAction(`/api/templates/${templateId}/submit`)}
              disabled={loading}
              className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
            >
              <Send className="size-3.5" /> Submit for approval
            </button>
          </>
        )}

        {canAuthor &&
          (templateStatus === "approved" ||
            versionStatus === "approved_internal" ||
            versionStatus === "approved_external") && (
          <button
            onClick={() => handleAction(`/api/templates/${templateId}/version`)}
            disabled={loading}
            className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
          >
            <Plus className="size-3.5" /> Create new version draft
          </button>
        )}
      </div>

      {versionStatus === "submitted" && hasApproveRole && (
        <div className="border border-amber-200 bg-amber-50/30 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-xs text-amber-900 uppercase tracking-wider">
            Compliance Review Panel (Version {versionNumber})
          </h3>
          <p className="text-xs text-slate-600">
            This marketing template has been submitted for compliance approval. Review the body and compliance findings before deciding.
          </p>

          {showRejectInput ? (
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-slate-500 block">Rejection notes</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this template is being rejected (e.g. missing disclaimer, guaranteed returns language, etc.)"
                rows={3}
                className="input-base text-xs w-full bg-white"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowRejectInput(false)}
                  disabled={loading}
                  className="px-2.5 py-1 rounded text-xs border bg-white hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!rejectReason.trim()) {
                      setError("Rejection reason is required");
                      return;
                    }
                    handleAction(`/api/templates/${templateId}/reject`, "POST", { reason: rejectReason });
                  }}
                  disabled={loading}
                  className="px-2.5 py-1 rounded text-xs bg-rose-600 hover:bg-rose-700 text-white font-medium flex items-center gap-1"
                >
                  <X className="size-3" /> Confirm rejection
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => handleAction(`/api/templates/${templateId}/approve`)}
                disabled={loading}
                className="rounded-md bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              >
                <Check className="size-3.5" /> Approve internally
              </button>
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={loading}
                className="rounded-md bg-rose-50 text-rose-700 hover:bg-rose-100 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 border border-rose-200"
              >
                <X className="size-3.5" /> Reject template
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
