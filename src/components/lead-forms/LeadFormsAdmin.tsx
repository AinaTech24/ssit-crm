"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Plus, ExternalLink, Loader2 } from "lucide-react";

type ExistingForm = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  createdAt: string | null;
};

export function LeadFormsAdmin({
  existingForms,
}: {
  existingForms: ExistingForm[];
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/lead-forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug, leadSource: "website" }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Create failed (${res.status})`);
        return;
      }
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  function copyUrl(slug: string) {
    const url = `${window.location.origin}/lf/${slug}`;
    navigator.clipboard?.writeText(url);
  }

  return (
    <div className="space-y-4">
      {!creating && (
        <button
          onClick={() => setCreating(true)}
          className="btn-primary text-sm"
        >
          <Plus className="size-4" /> New form
        </button>
      )}

      {creating && (
        <form
          onSubmit={submit}
          className="card-surface p-5 space-y-3 max-w-xl"
        >
          <h2 className="font-semibold">New lead-capture form</h2>
          <label className="block">
            <span className="text-xs font-medium block mb-1">
              Display name
            </span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug)
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-+|-+$/g, "")
                      .slice(0, 60)
                  );
              }}
              required
              maxLength={120}
              placeholder="e.g. Wealth quickstart enquiry"
              className="input-base"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium block mb-1">
              URL slug
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">/lf/</span>
              <input
                value={slug}
                onChange={(e) =>
                  setSlug(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                  )
                }
                required
                maxLength={60}
                placeholder="wealth-enquiry"
                className="input-base flex-1"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Lowercase letters, digits and hyphens. Must be globally unique.
            </p>
          </label>
          {err && (
            <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary text-sm">
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setErr(null);
              }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {existingForms.length === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-muted-foreground">
          No public forms yet. Create one to start capturing leads from your
          website.
        </div>
      ) : (
        <div className="card-surface divide-y">
          {existingForms.map((f) => (
            <div
              key={f.id}
              className="px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  /lf/{f.slug}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`chip text-[10px] ${
                    f.enabled
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {f.enabled ? "Live" : "Disabled"}
                </span>
                <button
                  onClick={() => copyUrl(f.slug)}
                  title="Copy public URL"
                  className="btn-ghost text-xs"
                >
                  <Copy className="size-3.5" /> Copy URL
                </button>
                <Link
                  href={`/lf/${f.slug}`}
                  target="_blank"
                  className="btn-ghost text-xs"
                >
                  <ExternalLink className="size-3.5" /> Preview
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
