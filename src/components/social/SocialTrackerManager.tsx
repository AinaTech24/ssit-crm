"use client";

/**
 * The Social Media Tracker table plus its add / edit form.
 *
 * Everyone who can open the tracker sees the table; only people with
 * social_tracker.manage get the Add button and the per-row Edit / Delete.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import {
  PLATFORMS,
  POST_STATUSES,
  POST_TYPES,
  platformLabel,
  statusLabel,
  typeLabel,
} from "@/lib/social/tracker";

export type TrackerRow = {
  id: string;
  postDate: string;
  contentTitle: string;
  contentType: string;
  platform: string;
  status: string;
  postLink: string | null;
  views: number;
  reach: number;
  likes: number;
  followersIncrease: number;
  leads: number;
};

type Form = {
  postDate: string;
  contentTitle: string;
  contentType: string;
  platform: string;
  status: string;
  postLink: string;
  views: string;
  reach: string;
  likes: string;
  followersIncrease: string;
  leads: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const blank = (): Form => ({
  postDate: today(),
  contentTitle: "",
  contentType: "post",
  platform: "instagram",
  status: "posted",
  postLink: "",
  views: "",
  reach: "",
  likes: "",
  followersIncrease: "",
  leads: "",
});

const fromRow = (r: TrackerRow): Form => ({
  postDate: r.postDate,
  contentTitle: r.contentTitle,
  contentType: r.contentType,
  platform: r.platform,
  status: r.status,
  postLink: r.postLink ?? "",
  views: String(r.views),
  reach: String(r.reach),
  likes: String(r.likes),
  followersIncrease: String(r.followersIncrease),
  leads: String(r.leads),
});

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const num = (n: number) => n.toLocaleString("en-IN");

const STATUS_TONE: Record<string, string> = {
  posted: "bg-emerald-50 text-emerald-700",
  scheduled: "bg-sky-50 text-sky-700",
  planned: "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export function SocialTrackerManager({ rows, canManage }: { rows: TrackerRow[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  // null = form closed; "new" = adding; an id = editing that row.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setForm(blank());
    setErr(null);
    setEditing("new");
  }
  function openEdit(r: TrackerRow) {
    setForm(fromRow(r));
    setErr(null);
    setEditing(r.id);
  }

  async function save() {
    if (!form.contentTitle.trim()) {
      setErr("Enter the content title.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(editing === "new" ? "/api/social-posts" : `/api/social-posts/${editing}`, {
        method: editing === "new" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postDate: form.postDate,
          contentTitle: form.contentTitle,
          contentType: form.contentType,
          platform: form.platform,
          status: form.status,
          postLink: form.postLink,
          views: form.views === "" ? 0 : Number(form.views),
          reach: form.reach === "" ? 0 : Number(form.reach),
          likes: form.likes === "" ? 0 : Number(form.likes),
          followersIncrease: form.followersIncrease === "" ? 0 : Number(form.followersIncrease),
          leads: form.leads === "" ? 0 : Number(form.leads),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      toast.success(editing === "new" ? "Entry added." : "Entry updated.", "Social Media Tracker");
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: TrackerRow) {
    if (!window.confirm(`Delete “${r.contentTitle}” from the tracker?`)) return;
    const res = await fetch(`/api/social-posts/${r.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Entry deleted.", "Social Media Tracker");
      router.refresh();
    } else {
      toast.error("Could not delete that entry.");
    }
  }

  return (
    <div className="space-y-4">
      {canManage && editing === null && (
        <button
          onClick={openNew}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
        >
          <Plus className="size-4" /> Add entry
        </button>
      )}

      {canManage && editing !== null && (
        <div className="border rounded-lg bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">{editing === "new" ? "Add an entry" : "Edit entry"}</h2>
            <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Date</div>
              <input type="date" value={form.postDate} onChange={(e) => set("postDate", e.target.value)} className={inputCls} />
            </label>
            <label className="block sm:col-span-2">
              <div className="text-xs font-medium mb-1">Content title</div>
              <input
                value={form.contentTitle}
                onChange={(e) => set("contentTitle", e.target.value)}
                maxLength={300}
                className={inputCls}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Type</div>
              <SelectField value={form.contentType} onChange={(e) => set("contentType", e.target.value)} className="w-full">
                {POST_TYPES.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </SelectField>
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Platform</div>
              <SelectField value={form.platform} onChange={(e) => set("platform", e.target.value)} className="w-full">
                {PLATFORMS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </SelectField>
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Status</div>
              <SelectField value={form.status} onChange={(e) => set("status", e.target.value)} className="w-full">
                {POST_STATUSES.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </SelectField>
            </label>
          </div>

          <label className="block">
            <div className="text-xs font-medium mb-1">Post link</div>
            <input
              value={form.postLink}
              onChange={(e) => set("postLink", e.target.value)}
              placeholder="https://…"
              inputMode="url"
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {(
              [
                ["views", "Views"],
                ["reach", "Reach"],
                ["likes", "Likes"],
                ["followersIncrease", "Followers increase"],
                ["leads", "Leads"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block">
                <div className="text-xs font-medium mb-1">{label}</div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={k === "followersIncrease" ? undefined : 0}
                  value={form[k]}
                  onChange={(e) => set(k, e.target.value)}
                  placeholder="0"
                  className={inputCls}
                />
              </label>
            ))}
          </div>

          {err && <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-xs">{err}</div>}

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />} {editing === "new" ? "Add entry" : "Save changes"}
            </button>
            <button onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="border rounded-lg bg-card overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No entries for this view yet.{canManage ? " Use “Add entry” to log your first post." : ""}
          </div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead className="text-xs text-muted-foreground border-b bg-secondary/40">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left py-2 font-medium">Content title</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Platform</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Views</th>
                <th className="text-right py-2 font-medium">Reach</th>
                <th className="text-right py-2 font-medium">Likes</th>
                <th className="text-right py-2 font-medium">Followers +</th>
                <th className="text-right py-2 font-medium">Leads</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.postDate)}</td>
                  <td className="py-2 max-w-[20rem]">
                    <div className="font-medium break-words">{r.contentTitle}</div>
                    {r.postLink && (
                      <a
                        href={r.postLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-cyan hover:underline inline-flex items-center gap-1"
                      >
                        Open post <ExternalLink className="size-3" />
                      </a>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap">{typeLabel(r.contentType)}</td>
                  <td className="py-2 whitespace-nowrap">{platformLabel(r.platform)}</td>
                  <td className="py-2 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_TONE[r.status] ?? "bg-secondary"}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{num(r.views)}</td>
                  <td className="py-2 text-right tabular-nums">{num(r.reach)}</td>
                  <td className="py-2 text-right tabular-nums">{num(r.likes)}</td>
                  <td className="py-2 text-right tabular-nums">{r.followersIncrease > 0 ? `+${num(r.followersIncrease)}` : num(r.followersIncrease)}</td>
                  <td className="py-2 text-right tabular-nums">{num(r.leads)}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button
                          onClick={() => openEdit(r)}
                          title="Edit"
                          className="p-1 text-muted-foreground hover:text-foreground"
                          aria-label={`Edit ${r.contentTitle}`}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => remove(r)}
                          title="Delete"
                          className="p-1 text-muted-foreground hover:text-rose-600"
                          aria-label={`Delete ${r.contentTitle}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
