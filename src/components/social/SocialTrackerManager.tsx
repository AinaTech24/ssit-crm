"use client";

/**
 * The Social Media Tracker: the entry list, the entry sheet and the entry card.
 *
 * An ENTRY is one day's content. Its date, title and type are entered once; under it
 * sits one line per platform it went out on (status, post link, numbers). The list
 * shows each entry once with all of its platforms, clicking it opens a card with
 * everything about it, and Edit opens the sheet. Everyone who can open the tracker
 * can read; only people with social_tracker.manage get Add / Edit / Delete.
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
  entryKey,
  groupEntries,
  platformLabel,
  statusLabel,
  totalsOf,
  typeLabel,
  type EntryGroup,
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
const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n));

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

const StatusChip = ({ status }: { status: string }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_TONE[status] ?? "bg-secondary"}`}>{statusLabel(status)}</span>
);

export function SocialTrackerManager({ rows, canManage }: { rows: TrackerRow[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  // null = sheet closed; "new" = adding an entry; "edit" = changing an entry.
  const [mode, setMode] = useState<"new" | "edit" | null>(null);
  const [head, setHead] = useState<Head>(blankHead());
  const [lines, setLines] = useState<Line[]>([blankLine("instagram")]);
  const [originalDate, setOriginalDate] = useState<string | null>(null);
  // The card that is open (an entry key), and the entry's FULL set of platforms -
  // the list can be filtered to one platform, the card never is.
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [full, setFull] = useState<{ key: string; rows: TrackerRow[] } | null>(null);
  // Where Cancel / Save of an edit lands: back on the entry's card.
  const [returnKey, setReturnKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const entries = groupEntries(rows);

  const setH = <K extends keyof Head>(k: K, v: Head[K]) => setHead((h) => ({ ...h, [k]: v }));
  const setL = <K extends keyof Line>(i: number, k: K, v: Line[K]) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  /** Every platform line saved for a day, newest data from the server. */
  async function loadDay(date: string): Promise<TrackerRow[] | null> {
    try {
      const res = await fetch(`/api/social-posts/day?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      return res.ok && Array.isArray(j.rows) ? (j.rows as TrackerRow[]) : null;
    } catch {
      return null;
    }
  }

  /** Open an entry's card, with all of its platforms. */
  async function openCard(key: string, date: string) {
    setViewKey(key);
    const all = await loadDay(date);
    if (all) setFull({ key, rows: all.filter((r) => entryKey(r) === key) });
  }

  function openNew() {
    setHead(blankHead());
    setLines([blankLine("instagram")]);
    setOriginalDate(null);
    setReturnKey(null);
    setErr(null);
    setMode("new");
  }

  /** Open an entry in the sheet, with every platform line it has. */
  async function openEdit(g: { key: string; postDate: string; lines: TrackerRow[] }) {
    setViewKey(null);
    setErr(null);
    setBusy(true);
    try {
      const all = (await loadDay(g.postDate)) ?? g.lines;
      const mine = all.filter((r) => entryKey(r) === g.key);
      const use = mine.length ? mine : g.lines;
      const first = use[0];
      setHead({ postDate: first.postDate, contentTitle: first.contentTitle, contentType: first.contentType });
      setLines(use.map(lineFromRow));
      setOriginalDate(first.postDate);
      setReturnKey(g.key);
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

  // A day already shown in the list (the list can be filtered, so the server has the
  // final say) - warn before the person has typed everything for nothing.
  const dayRows = mode === "new" ? rows.filter((r) => r.postDate === head.postDate) : [];
  const dayTaken = dayRows[0];
  const dayConflict =
    !!dayTaken &&
    !!head.contentTitle.trim() &&
    !(sameText(dayTaken.contentTitle, head.contentTitle) && dayTaken.contentType === head.contentType);

  async function save() {
    if (!head.contentTitle.trim()) {
      setErr("Enter the content title.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const adding = mode === "new";
      const entriesBody = toEntries(head, lines);
      const res = await fetch(adding ? "/api/social-posts" : "/api/social-posts/day", {
        method: adding ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(adding ? { entries: entriesBody } : { originalDate, entries: entriesBody }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      toast.success(adding ? "Entry added." : "Entry updated.", "Social Media Tracker");
      setMode(null);
      router.refresh();
      // After changing an entry, land back on its card showing what was saved.
      if (!adding) void openCard(entryKey(head), head.postDate);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setMode(null);
    const back = returnKey;
    if (back) {
      const g = entries.find((e) => e.key === back);
      void openCard(back, g?.postDate ?? head.postDate);
    }
  }

  /** Delete one platform line, or (with `all`) the whole entry. */
  async function removeLines(g: { contentTitle: string; lines: TrackerRow[] }, only?: TrackerRow) {
    const targets = only ? [only] : g.lines;
    const what = only ? `the ${platformLabel(only.platform)} line of "${g.contentTitle}"` : `"${g.contentTitle}" and all of its platforms`;
    if (!window.confirm(`Delete ${what} from the tracker?`)) return;
    const results = await Promise.all(targets.map((r) => fetch(`/api/social-posts/${r.id}`, { method: "DELETE" })));
    if (results.every((r) => r.ok)) {
      toast.success(only ? "Platform line deleted." : "Entry deleted.", "Social Media Tracker");
      setFull(null);
      if (!only || targets.length >= g.lines.length) setViewKey(null);
      else if (viewKey) void openCard(viewKey, g.lines[0].postDate);
      router.refresh();
    } else {
      toast.error("Could not delete everything - refresh and try again.");
    }
  }

  const isNew = mode === "new";

  // The open card: the entry's full lines when loaded, otherwise what the list has.
  const listGroup: EntryGroup<TrackerRow> | undefined = viewKey ? entries.find((e) => e.key === viewKey) : undefined;
  const cardLines: TrackerRow[] | null = viewKey
    ? full && full.key === viewKey
      ? full.rows
      : (listGroup?.lines ?? null)
    : null;
  const card = cardLines && cardLines.length
    ? { key: viewKey as string, postDate: cardLines[0].postDate, contentTitle: cardLines[0].contentTitle, contentType: cardLines[0].contentType, lines: cardLines }
    : null;

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
            <button onClick={cancel} className="text-muted-foreground hover:text-foreground" aria-label="Close">
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
            <button onClick={cancel} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* The list: one block per entry, listing every platform it went out on. */}
      <div className="border rounded-lg bg-card overflow-x-auto">
        {entries.length === 0 ? (
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
            {entries.map((g) => {
              const total = totalsOf(g.lines);
              const multi = g.lines.length > 1;
              const span = g.lines.length + (multi ? 1 : 0);
              const open = () => void openCard(g.key, g.postDate);
              return (
                <tbody key={g.key} className="border-b last:border-0">
                  {g.lines.map((r, i) => (
                    <tr
                      key={r.id}
                      onClick={open}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) open();
                      }}
                      tabIndex={0}
                      aria-label={`Open ${g.contentTitle} on ${platformLabel(r.platform)}`}
                      className="align-top cursor-pointer hover:bg-accent/40 focus:bg-accent/40 outline-none"
                    >
                      {i === 0 && (
                        <>
                          <td rowSpan={span} className="px-4 py-2 whitespace-nowrap text-muted-foreground align-top">{fmtDate(g.postDate)}</td>
                          <td rowSpan={span} className="py-2 pr-3 max-w-[20rem] align-top">
                            <div className="font-medium break-words">{g.contentTitle}</div>
                            {multi && <div className="text-xs text-muted-foreground">{g.lines.length} platforms</div>}
                          </td>
                          <td rowSpan={span} className="py-2 pr-3 whitespace-nowrap align-top">{typeLabel(g.contentType)}</td>
                        </>
                      )}
                      <td className="py-2 whitespace-nowrap">
                        <div>{platformLabel(r.platform)}</div>
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
                      <td className="py-2 whitespace-nowrap"><StatusChip status={r.status} /></td>
                      <td className="py-2 text-right tabular-nums">{num(r.views)}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.reach)}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.likes)}</td>
                      <td className="py-2 text-right tabular-nums">{signed(r.followersIncrease)}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.leads)}</td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {canManage && (
                          <>
                            <button
                              onClick={() => void openEdit(g)}
                              title="Edit this entry"
                              className="p-1 text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${g.contentTitle}`}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => void removeLines(g, r)}
                              title="Delete this platform line"
                              className="p-1 text-muted-foreground hover:text-rose-600"
                              aria-label={`Delete ${g.contentTitle} on ${platformLabel(r.platform)}`}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {multi && (
                    <tr onClick={open} className="cursor-pointer bg-secondary/30 text-xs font-medium">
                      <td className="py-1.5" colSpan={2}>All platforms</td>
                      <td className="py-1.5 text-right tabular-nums">{num(total.views)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(total.reach)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(total.likes)}</td>
                      <td className="py-1.5 text-right tabular-nums">{signed(total.followersIncrease)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(total.leads)}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        )}
      </div>

      {/* The entry as a card: every platform it went out on, with all the numbers. */}
      <Dialog
        open={viewKey !== null && card !== null}
        onOpenChange={(o) => {
          if (!o) {
            setViewKey(null);
            setFull(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          {card && (
            <>
              <DialogHeader>
                <DialogTitle className="break-words">{card.contentTitle}</DialogTitle>
                <DialogDescription>
                  {fmtDate(card.postDate)} · {typeLabel(card.contentType)}
                  {card.lines.length > 1 ? ` · ${card.lines.length} platforms` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-3">
                {card.lines.map((r) => (
                  <div key={r.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{platformLabel(r.platform)}</span>
                      <StatusChip status={r.status} />
                      {r.postLink ? (
                        <a
                          href={r.postLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-brand-cyan hover:underline inline-flex items-center gap-1"
                        >
                          Open post <ExternalLink className="size-3.5" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">No post link</span>
                      )}
                      {canManage && card.lines.length > 1 && (
                        <button
                          onClick={() => void removeLines(card, r)}
                          title="Delete this platform line"
                          aria-label={`Delete ${platformLabel(r.platform)}`}
                          className="ml-auto p-1 text-muted-foreground hover:text-rose-600"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {(
                        [
                          ["Views", num(r.views)],
                          ["Reach", num(r.reach)],
                          ["Likes", num(r.likes)],
                          ["Followers +", signed(r.followersIncrease)],
                          ["Leads", num(r.leads)],
                        ] as const
                      ).map(([label, v]) => (
                        <div key={label} className="rounded-md border bg-secondary/30 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                          <div className="text-base font-semibold tabular-nums">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {card.lines.length > 1 && (
                  <div className="rounded-lg border bg-secondary/40 p-3">
                    <div className="text-xs font-semibold mb-2">All platforms together</div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
                      {(() => {
                        const t = totalsOf(card.lines);
                        return (
                          [
                            ["Views", num(t.views)],
                            ["Reach", num(t.reach)],
                            ["Likes", num(t.likes)],
                            ["Followers +", signed(t.followersIncrease)],
                            ["Leads", num(t.leads)],
                          ] as const
                        ).map(([label, v]) => (
                          <div key={label}>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                            <div className="font-semibold tabular-nums">{v}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {canManage && (
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={() => void removeLines(card)}
                    className="rounded-md border px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="size-3.5" /> Delete entry
                  </button>
                  <button
                    onClick={() => void openEdit(card)}
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
