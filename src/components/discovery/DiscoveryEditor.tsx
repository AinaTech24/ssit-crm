"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Check, Copy, Loader2 } from "lucide-react";
import { DiscoveryForm } from "./DiscoveryForm";
import type { DiscoveryData } from "@/lib/discovery/calc";

/**
 * In-meeting editor wrapper — autosave-on-demand, mint a client share link, and
 * mark the discovery reviewed. The form itself recalculates live.
 */
export function DiscoveryEditor({
  id,
  initialData,
  status,
}: {
  id: string;
  initialData: DiscoveryData;
  status: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(data: DiscoveryData, extra?: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/discovery/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data, ...extra }),
      });
      if (res.ok) {
        setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function makeLink() {
    setSharing(true);
    setShareUrl(null);
    try {
      const res = await fetch(`/api/discovery/${id}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInDays: 14 }),
      });
      if (res.ok) {
        const { url } = await res.json();
        setShareUrl(url);
        router.refresh();
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap card-surface p-3">
        <button onClick={makeLink} disabled={sharing} className="btn-secondary text-sm">
          {sharing ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Share client link
        </button>
        {savedAt && <span className="text-xs text-muted-foreground">Saved {savedAt}</span>}
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground capitalize ml-auto">{status}</span>
      </div>

      {shareUrl && (
        <div className="card-surface p-3 flex items-center gap-2 text-sm border-brand-cyan/30">
          <Link2 className="size-4 text-brand-cyan flex-shrink-0" />
          <input readOnly value={shareUrl} className="input-base text-xs flex-1 font-mono" onFocus={(e) => e.currentTarget.select()} />
          <button
            onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="btn-secondary text-xs"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      <DiscoveryForm
        initialData={initialData}
        onSave={(d) => { (window as any).__discoveryData = d; save(d); }}
        onSubmit={(d) => save(d, { markReviewed: true })}
        submitLabel="Mark reviewed"
        saving={saving}
      />
    </div>
  );
}
