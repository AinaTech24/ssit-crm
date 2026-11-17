"use client";

/**
 * The Social Media Tracker table plus its entry sheet and entry card.
 *
 * Everyone who can open the tracker sees the table and can click a line to open it
 * as a card; only people with social_tracker.manage get Add / Edit / Delete.
 *
 * An ENTRY is one day's content. Its date, title and type are entered once at the
 * top; below it is one line per platform it went out on (Instagram, Facebook,
 * LinkedIn...) with that platform's status, post link and numbers, sliding sideways.
 * "Add platform" adds another line. A day holds only one entry.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
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

/** The three things fixed for the whole entry. */
type Head = { postDate: string; contentTitle: string; contentType: string };

/** One platform line of an entry. `id` is set for a line that is already saved. */
type Line = {
  id?: string;
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

const blankHead = (): Head => ({ postDate: today(), contentTitle: "", contentType: "post" });

const blankLine = (platform: string, status = "posted"): Line => ({
  platform,
  status,
  postLink: "",
  views: "",
  reach: "",
  likes: "",
  followersIncrease: "",
  leads: "",
});

const lineFromRow = (r: TrackerRow): Line => ({
  id: r.id,
  platform: r.platform,
  status: r.status,
  postLink: r.postLink ?? "",
  views: String(r.views),
  reach: String(r.reach),
  likes: String(r.likes),
  followersIncrease: String(r.followersIncrease),
  leads: String(r.leads),
});

/** The first platform not already used by the entry. */
const nextPlatform = (used: string[]) => PLATFORMS.find((p) => !used.includes(p.key))?.key ?? PLATFORMS[0].key;

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const num = (n: number) => n.toLocaleString("en-IN");

const STATUS_TONE: Record<string, string> = {
  posted: "bg-emerald-50 text-emerald-700",
  scheduled: "bg-sky-50 text-sky-700",
  planned: "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-50 text-rose-700",
};

/** Column widths (px) of the sliding platform lines, plus the remove button. */
const COLS = [150, 130, 280, 100, 100, 100, 120, 90, 36];
const GRID = { gridTemplateColumns: COLS.map((w) => `${w}px`).join(" ") };
const LINE_HEAD = ["Platform", "Status", "Post link", "Views", "Reach", "Likes", "Followers +", "Leads", ""];
const cell = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";
const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const toEntries = (head: Head, lines: Line[]) =>
  lines.map((l) => ({
    ...(l.id ? { id: l.id } : {}),
    postDate: head.postDate,
    contentTitle: head.contentTitle,
    contentType: head.contentType,
    platform: l.platform,
    status: l.status,
    postLink: l.postLink,
    views: l.views === "" ? 0 : Number(l.views),
    reach: l.reach === "" ? 0 : Number(l.reach),
    likes: l.likes === "" ? 0 : Number(l.likes),
    followersIncrease: l.followersIncrease === "" ? 0 : Number(l.followersIncrease),
    leads: l.leads === "" ? 0 : Number(l.leads),
  }));

export function SocialTrackerManager({ rows, canManage }: { rows: TrackerRow[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  // null = sheet closed; "new" = adding an entry; "edit" = changing a day's entry.
  const [mode, setMode] = useState<"new" | "edit" | null>(null);
  const [head, setHead] = useState<Head>(blankHead());
  const [lines, setLines] = useState<Line[]>([blankLine("instagram")]);
  const [originalDate, setOriginalDate] = useState<string | null>(null);
  const [viewing, setViewing] = useState<TrackerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setH = <K extends keyof Head>(k: K, v: Head[K]) => setHead((h) => ({ ...h, [k]: v }));
  const setL = <K extends keyof Line>(i: number, k: K, v: Line[K]) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  function openNew() {
    setHead(blankHead());
    setLines([blankLine("instagram")]);
    setOriginalDate(null);
    setErr(null);
    setMode("new");
  }

  /** Open a day's whole entry (every platform line), whichever line was clicked. */
  async function openEdit(r: TrackerRow) {
    setViewing(null);
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/social-posts/day?date=${encodeURIComponent(r.postDate)}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      const dayRows: TrackerRow[] = res.ok && Array.isArray(j.rows) && j.rows.length ? j.rows : [r];
      const first = dayRows[0];
      setHead({ postDate: first.postDate, contentTitle: first.contentTitle, contentType: first.contentType });
      setLines(dayRows.map(lineFromRow));
      setOriginalDate(first.postDate);
      setMode("edit");
    } finally {
      setBusy(false);
    }
  }

  function addLine() {
    setLines((ls) => {
      const prev = ls[ls.length - 1];
      return [...ls, blankLine(nextPlatform(ls.map((l) => l.platform)), prev?.status ?? "posted")];
    });
  }
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls));

  // A day already shown in the table (the table can be filtered, so the server has
  // the final say) - warn before the person has typed everything for nothing.
  const dayRows = mode === "new" ? rows.filter((r) => r.postDate === head.postDate) : [];
  const dayTaken = dayRows[0];
  const dayConflict = !!dayTaken && !!head.contentTitle.trim() && !(sameText(dayTaken.contentTitle, head.contentTitle) && dayTaken.contentType === head.contentType);

  async function save() {
    if (!head.contentTitle.trim()) {
      setErr("Enter the content title.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const adding = mode === "new";
      const entries = toEntries(head, lines);
      const res = await fetch(adding ? "/api/social-posts" : "/api/social-posts/day", {
        method: adding ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(adding ? { entries } : { originalDate, entries }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      toast.success(adding ? "Entry added." : "Entry updated.", "Social Media Tracker");
      setMode(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: TrackerRow) {
    if (!window.confirm(`Delete the ${platformLabel(r.platform)} line of "${r.contentTitle}" from the tracker?`)) return;
    const res = await fetch(`/api/social-posts/${r.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Entry deleted.", "Social Media Tracker");
      setViewing(null);
      router.refresh();
    } else {
      toast.error("Could not delete that entry.");
    }
  }

  const isNew = mode === "new";

  return (
    <div className="space-y-4">
      {canManage && mode === null && (
        <button
          onClick={openNew}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
        >
          <Plus className="size-4" /> Add entry
        </button>
      )}

      {canManage && mode !== null && (
        <div className="border rounded-lg bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">{isNew ? "Add entry" : "Edit entry"}</h2>
            <button onClick={() => setMode(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>

          {/* Fixed for the whole entry. */}
          <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr_12rem] gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Date</div>
              <input type="date" value={head.postDate} onChange={(e) => setH("postDate", e.target.value)} className={field} />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Content title</div>
              <input
                value={head.contentTitle}
                onChange={(e) => setH("contentTitle", e.target.value)}
                maxLength={300}
                placeholder="Content title"
                className={field}
              />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Type</div>
              <SelectField value={head.contentType} onChange={(e) => setH("contentType", e.target.value)} className="w-full">
                {POST_TYPES.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </SelectField>
            </label>
          </div>

          {isNew && dayTaken && (
            <div
              className={`rounded-md border p-2 text-xs ${
                dayConflict ? "border-rose-300 bg-rose-50 text-rose-900" : "border-sky-300 bg-sky-50 text-sky-900"
              }`}
            >
              {dayConflict
                ? `${fmtDate(head.postDate)} already has an entry ("${dayTaken.contentTitle}"). Only one entry can be created per day - open that entry and use Add platform, or pick another date.`
                : `${fmtDate(head.postDate)} already has this entry - the platforms you add here are added to it.`}
            </div>
          )}

          {/* One line per platform; the strip slides sideways. */}
          <div>
            <div className="text-xs font-medium mb-2">
              Platforms <span className="font-normal text-muted-foreground">- one line per platform, slide sideways for all fields</span>
            </div>
            <div className="overflow-x-auto pb-2">
              <div className="min-w-max space-y-2">
                <div className="grid gap-2 text-xs font-medium text-muted-foreground" style={GRID}>
                  {LINE_HEAD.map((h, n) => (
                    <div key={n}>{h}</div>
                  ))}
                </div>
                {lines.map((l, i) => {
                  const usedElsewhere = lines.filter((_, n) => n !== i).map((x) => x.platform);
                  return (
                    <div key={l.id ?? `new-${i}`} className="grid gap-2 items-center" style={GRID}>
                      <SelectField aria-label="Platform" value={l.platform} onChange={(e) => setL(i, "platform", e.target.value)} className="w-full">
                        {PLATFORMS.filter((p) => !usedElsewhere.includes(p.key)).map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </SelectField>
                      <SelectField aria-label="Status" value={l.status} onChange={(e) => setL(i, "status", e.target.value)} className="w-full">
                        {POST_STATUSES.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </SelectField>
                      <input
                        aria-label="Post link"
                        value={l.postLink}
                        onChange={(e) => setL(i, "postLink", e.target.value)}
                        placeholder="https://..."
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
                          value={l[k]}
                          onChange={(e) => setL(i, k, e.target.value)}
                          placeholder="0"
                          className={`${cell} tabular-nums`}
                        />
                      ))}
                      {lines.length > 1 ? (
                        <button
                          onClick={() => removeLine(i)}
                          title="Remove this platform"
                          aria-label={`Remove ${platformLabel(l.platform)}`}
                          className="p-1 text-muted-foreground hover:text-rose-600"
                        >
                          <X className="size-4" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            onClick={addLine}
            disabled={lines.length >= PLATFORMS.length}
            className="rounded-md border border-dashed px-3 py-1.5 text-sm hover:bg-accent inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus className="size-4" /> Add platform
          </button>

          {err && <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-xs">{err}</div>}

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy || dayConflict}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />} {isNew ? "Save entry" : "Save changes"}
            </button>
            <button onClick={() => setMode(null)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="border rounded-lg bg-card overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No entries for this view yet.{canManage ? " Use \"Add entry\" to log your first post." : ""}
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
                          onClick={() => void openEdit(r)}
                          title="Edit this day's entry"
                          className="p-1 text-muted-foreground hover:text-foreground"
                          aria-label={`Edit ${r.contentTitle}`}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => remove(r)}
                          title="Delete this platform line"
                          className="p-1 text-muted-foreground hover:text-rose-600"
                          aria-label={`Delete ${r.contentTitle} on ${platformLabel(r.platform)}`}
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

      {/* The entry as a card - everything about it without having to open Edit. */}
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
                    onClick={() => void openEdit(viewing)}
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
