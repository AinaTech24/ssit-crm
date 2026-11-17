"use client";

/**
 * The Social Media Tracker table plus its add / edit sheet and entry card.
 *
 * Everyone who can open the tracker sees the table and can click an entry to open
 * it as a card; only people with social_tracker.manage get the Add button and the
 * Edit / Delete controls.
 *
 * Adding uses an entry sheet: one line per entry, scrolling sideways, with an
 * "Add another row" button underneath so several posts (another platform, another
 * type…) go in with one Save.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import {
  MAX_ENTRIES_PER_SAVE,
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

/** Column widths of the one-line entry sheet (px), in field order, plus the remove button. */
const COLS = [140, 260, 120, 130, 120, 230, 90, 90, 90, 110, 80, 36];
const GRID = { gridTemplateColumns: COLS.map((w) => `${w}px`).join(" ") };
const SHEET_HEAD = ["Date", "Content title", "Type", "Platform", "Status", "Post link", "Views", "Reach", "Likes", "Followers +", "Leads", ""];
const cell = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

const toBody = (f: Form) => ({
  postDate: f.postDate,
  contentTitle: f.contentTitle,
  contentType: f.contentType,
  platform: f.platform,
  status: f.status,
  postLink: f.postLink,
  views: f.views === "" ? 0 : Number(f.views),
  reach: f.reach === "" ? 0 : Number(f.reach),
  likes: f.likes === "" ? 0 : Number(f.likes),
  followersIncrease: f.followersIncrease === "" ? 0 : Number(f.followersIncrease),
  leads: f.leads === "" ? 0 : Number(f.leads),
});

export function SocialTrackerManager({ rows, canManage }: { rows: TrackerRow[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  // null = sheet closed; "new" = adding; an id = editing that entry.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [sheet, setSheet] = useState<Form[]>([blank()]);
  const [viewing, setViewing] = useState<TrackerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setCell = <K extends keyof Form>(i: number, k: K, v: Form[K]) =>
    setSheet((rs) => rs.map((r, n) => (n === i ? { ...r, [k]: v } : r)));

  function openNew() {
    setSheet([blank()]);
    setErr(null);
    setEditing("new");
  }
  function openEdit(r: TrackerRow) {
    setViewing(null);
    setSheet([fromRow(r)]);
    setErr(null);
    setEditing(r.id);
  }
  /** A new row starts like the one above it — the same day, platform and type usually repeat. */
  function addRow() {
    setSheet((rs) => {
      const last = rs[rs.length - 1] ?? blank();
      return [...rs, { ...blank(), postDate: last.postDate, contentType: last.contentType, platform: last.platform, status: last.status }];
    });
  }
  const removeRow = (i: number) => setSheet((rs) => (rs.length > 1 ? rs.filter((_, n) => n !== i) : rs));

  async function save() {
    const bad = sheet.findIndex((r) => !r.contentTitle.trim());
    if (bad >= 0) {
      setErr(sheet.length > 1 ? `Row ${bad + 1}: enter the content title.` : "Enter the content title.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const adding = editing === "new";
      const res = await fetch(adding ? "/api/social-posts" : `/api/social-posts/${editing}`, {
        method: adding ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(adding ? { entries: sheet.map(toBody) } : toBody(sheet[0])),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      toast.success(
        adding ? (sheet.length > 1 ? `${sheet.length} entries added.` : "Entry added.") : "Entry updated.",
        "Social Media Tracker"
      );
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
      setViewing(null);
      router.refresh();
    } else {
      toast.error("Could not delete that entry.");
    }
  }

  const isNew = editing === "new";

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
        <div className="border rounded-lg bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">
              {isNew ? "Add entries" : "Edit entry"}
              {isNew && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  one line per post — scroll sideways for all fields
                </span>
              )}
            </h2>
            <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>

          {/* The slider: every entry is one line, the strip scrolls sideways. */}
          <div className="overflow-x-auto pb-2">
            <div className="min-w-max space-y-2">
              <div className="grid gap-2 text-xs font-medium text-muted-foreground" style={GRID}>
                {SHEET_HEAD.map((h, n) => (
                  <div key={n}>{h}</div>
                ))}
              </div>
              {sheet.map((r, i) => (
                <div key={i} className="grid gap-2 items-center" style={GRID}>
                  <input
                    type="date"
                    aria-label="Date"
                    value={r.postDate}
                    onChange={(e) => setCell(i, "postDate", e.target.value)}
                    className={cell}
                  />
                  <input
                    aria-label="Content title"
                    value={r.contentTitle}
                    onChange={(e) => setCell(i, "contentTitle", e.target.value)}
                    maxLength={300}
                    placeholder="Content title"
                    className={cell}
                  />
                  <SelectField aria-label="Type" value={r.contentType} onChange={(e) => setCell(i, "contentType", e.target.value)} className="w-full">
                    {POST_TYPES.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </SelectField>
                  <SelectField aria-label="Platform" value={r.platform} onChange={(e) => setCell(i, "platform", e.target.value)} className="w-full">
                    {PLATFORMS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </SelectField>
                  <SelectField aria-label="Status" value={r.status} onChange={(e) => setCell(i, "status", e.target.value)} className="w-full">
                    {POST_STATUSES.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </SelectField>
                  <input
                    aria-label="Post link"
                    value={r.postLink}
                    onChange={(e) => setCell(i, "postLink", e.target.value)}
                    placeholder="https://…"
                    inputMode="url"
                    className={cell}
                  />
                  {(["views", "reach", "likes", "followersIncrease", "leads"] as const).map((k) => (
                    <input
                      key={k}
                      type="number"
                      inputMode="numeric"
                      aria-label={k}
                      min={k === "followersIncrease" ? undefined : 0}
                      value={r[k]}
                      onChange={(e) => setCell(i, k, e.target.value)}
                      placeholder="0"
                      className={`${cell} tabular-nums`}
                    />
                  ))}
                  {isNew && sheet.length > 1 ? (
                    <button
                      onClick={() => removeRow(i)}
                      title="Remove this row"
                      aria-label={`Remove row ${i + 1}`}
                      className="p-1 text-muted-foreground hover:text-rose-600"
                    >
                      <X className="size-4" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          </div>

          {isNew && (
            <button
              onClick={addRow}
              disabled={sheet.length >= MAX_ENTRIES_PER_SAVE}
              className="rounded-md border border-dashed px-3 py-1.5 text-sm hover:bg-accent inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="size-4" /> Add another row
            </button>
          )}

          {err && <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-xs">{err}</div>}

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}{" "}
              {isNew ? (sheet.length > 1 ? `Save ${sheet.length} entries` : "Save entry") : "Save changes"}
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
                <tr
                  key={r.id}
                  onClick={() => setViewing(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) setViewing(r);
                  }}
                  tabIndex={0}
                  aria-label={`Open ${r.contentTitle}`}
                  className="border-b last:border-0 align-top cursor-pointer hover:bg-accent/40 focus:bg-accent/40 outline-none"
                >
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.postDate)}</td>
                  <td className="py-2 max-w-[20rem]">
                    <div className="font-medium break-words">{r.contentTitle}</div>
                    {r.postLink && (
                      <a
                        href={r.postLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
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
                  <td className="py-2 pr-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
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

      {/* The entry as a card — everything about it without having to open Edit. */}
      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-xl">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle className="break-words">{viewing.contentTitle}</DialogTitle>
                <DialogDescription>
                  {fmtDate(viewing.postDate)} · {typeLabel(viewing.contentType)} on {platformLabel(viewing.platform)}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_TONE[viewing.status] ?? "bg-secondary"}`}>
                  {statusLabel(viewing.status)}
                </span>
                {viewing.postLink ? (
                  <a
                    href={viewing.postLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-cyan hover:underline inline-flex items-center gap-1"
                  >
                    Open post <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">No post link</span>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(
                  [
                    ["Views", viewing.views],
                    ["Reach", viewing.reach],
                    ["Likes", viewing.likes],
                    ["Followers +", viewing.followersIncrease],
                    ["Leads", viewing.leads],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="rounded-lg border bg-secondary/30 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {label === "Followers +" && v > 0 ? `+${num(v)}` : num(v)}
                    </div>
                  </div>
                ))}
              </div>

              {canManage && (
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={() => remove(viewing)}
                    className="rounded-md border px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                  <button
                    onClick={() => openEdit(viewing)}
                    className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
                  >
                    <Pencil className="size-3.5" /> Edit
                  </button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
