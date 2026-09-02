"use client";

/**
 * Manager-only "Publish new version" control on the SOP detail page. Opens an
 * inline editor pre-filled with the current markdown; submitting POSTs a new
 * version (which resets sign-off — everyone must re-acknowledge the update).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";

export function PublishVersionForm({ sopId, currentMarkdown }: { sopId: string; currentMarkdown: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(currentMarkdown);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/sops/${encodeURIComponent(sopId)}/version`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Failed to publish.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <FilePlus2 className="size-4" /> Publish new version
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Publishing bumps the version and <strong>resets sign-off</strong> — required staff must
        re-acknowledge. The previous version and its acknowledgements are kept as history.
      </p>
      <textarea
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono"
      />
      {err && <div className="text-sm text-rose-600">{err}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          disabled={busy || body.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
          {busy ? "Publishing…" : "Publish version"}
        </button>
      </div>
    </form>
  );
}
