"use client";

/**
 * Edit / remove one of the firm's OWN library uploads. Shown only to people
 * holding "Content Library — edit"; the API enforces the same rule and refuses
 * the shared Equitywala assets.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

export function AssetEditPanel({
  assetId,
  title: initialTitle,
  description: initialDescription,
  category: initialCategory,
  categories,
}: {
  assetId: string;
  title: string;
  description: string | null;
  category: string;
  categories: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [category, setCategory] = useState(initialCategory);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/content-library/${assetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), category }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not save");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove this creative from your library? It will no longer be listed or sendable.")) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/content-library/${assetId}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not remove");
      router.push("/dashboard/ssit-library");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs inline-flex items-center gap-1">
        <Pencil className="size-3.5" /> Edit details
      </button>
    );
  }

  return (
    <div className="card-surface p-4 space-y-3 w-full">
      <div className="text-sm font-medium">Edit details</div>
      <label className="block text-xs space-y-1">
        <span className="text-muted-foreground">Title</span>
        <input className="input w-full" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-xs space-y-1">
        <span className="text-muted-foreground">Description</span>
        <textarea className="input w-full" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="block text-xs space-y-1">
        <span className="text-muted-foreground">Category</span>
        <select className="input w-full capitalize" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
      </label>
      {err && <div className="text-xs text-rose-600">{err}</div>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || title.trim().length < 2} onClick={save} className="btn-primary text-xs">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="btn-secondary text-xs">
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={remove} className="ml-auto text-xs text-rose-600 hover:underline inline-flex items-center gap-1">
          <Trash2 className="size-3.5" /> Remove from library
        </button>
      </div>
    </div>
  );
}
