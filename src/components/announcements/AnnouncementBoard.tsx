"use client";

/**
 * AnnouncementBoard — renders the notice list + (for managers) a composer and
 * per-card manage actions (pin / edit / publish / delete). Posts to /api/announcements.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Plus, Pin, PinOff, Trash2, Megaphone, Save, Edit2, Eye, EyeOff, Check, CheckCheck, ShieldAlert } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Row = Record<string, any>;

const CATEGORIES = [
  ["general", "General"],
  ["policy", "Policy"],
  ["event", "Event"],
  ["system", "System"],
  ["urgent", "Urgent"],
] as const;

const CAT_TONE: Record<string, string> = {
  general: "bg-slate-50 text-slate-600",
  policy: "bg-blue-50 text-blue-700",
  event: "bg-violet-50 text-violet-700",
  system: "bg-amber-50 text-amber-700",
  urgent: "bg-rose-50 text-rose-700",
};

const ROLE_OPTS = [
  "owner", "branch_head", "rm", "ops", "back_office", "compliance", "marketing",
  "sub_broker", "ra_research", "ra_sales", "ria", "insurance",
];

export function AnnouncementBoard({
  rows,
  branches = [],
  isManager,
}: {
  rows: Row[];
  branches?: Row[];
  isManager: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [compose, setCompose] = useState(false);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function markRead(r: Row, acknowledge: boolean) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/announcements/${r.id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(acknowledge ? { acknowledge: true } : {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Failed (${res.status})`, "Could not update");
        return;
      }
      toast.success(acknowledge ? "Acknowledged" : "Marked as read");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function togglePin(r: Row) {
    setBusyId(r.id);
    try {
      await fetch(`/api/announcements/${r.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPinned: !r.is_pinned }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function togglePublish(r: Row) {
    setBusyId(r.id);
    const publishNow = !r.published_at;
    try {
      await fetch(`/api/announcements/${r.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publishNow ? { publishNow: true } : { unpublish: true }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r: Row) {
    if (!confirm(`Delete announcement "${r.title}"?`)) return;
    setBusyId(r.id);
    try {
      await fetch(`/api/announcements/${r.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {isManager && (
        <div className="flex justify-end">
          <button
            onClick={() => setCompose(true)}
            className="btn-primary text-sm inline-flex items-center gap-1"
          >
            <Plus className="size-4" /> Post announcement
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <Megaphone className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No announcements.</div>
          {isManager && <p className="mt-1 text-xs">Use “Post announcement” to share a notice with your team.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const expired = r.expires_at && new Date(r.expires_at).getTime() < Date.now();
            const draft = !r.published_at;
            const branchName = r.branch_id ? branches.find((b) => b.id === r.branch_id)?.name : null;

            return (
              <div key={r.id} className={`card-surface p-4 ${r.is_pinned ? "ring-1 ring-amber-200" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.is_pinned && <Pin className="size-3.5 text-amber-500" />}
                      <span className={`chip text-[10px] capitalize ${CAT_TONE[r.category] ?? ""}`}>
                        {r.category}
                      </span>
                      <h3 className="font-semibold">{r.title}</h3>
                      {draft && <span className="chip text-[10px] bg-slate-100 text-slate-500">draft</span>}
                      {expired && <span className="chip text-[10px] bg-slate-100 text-slate-500">expired</span>}
                      {r.requires_ack && (
                        <span className="chip text-[10px] bg-amber-50 text-amber-700 inline-flex items-center gap-0.5">
                          <ShieldAlert className="size-3" /> Requires ack
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{r.body}</p>
                    <div className="text-[11px] text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5">
                      {r.created_by_name ? <span>{r.created_by_name}</span> : null}
                      {r.created_by_name ? <span>·</span> : null}
                      <span>
                        {r.published_at
                          ? new Date(r.published_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                          : "unpublished (draft)"}
                      </span>
                      {Array.isArray(r.audience_roles) && r.audience_roles.length ? (
                        <>
                          <span>·</span>
                          <span className="capitalize">for {r.audience_roles.join(", ")}</span>
                        </>
                      ) : null}
                      {branchName ? (
                        <>
                          <span>·</span>
                          <span className="text-brand-cyan font-medium">Branch: {branchName}</span>
                        </>
                      ) : null}
                    </div>

                    {!isManager && (
                      <div className="mt-3">
                        {r.requires_ack ? (
                          r.is_acknowledged ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                              <CheckCheck className="size-3.5" /> Acknowledged
                            </span>
                          ) : (
                            <button
                              onClick={() => markRead(r, true)}
                              disabled={busyId === r.id}
                              className="btn-primary text-xs inline-flex items-center gap-1"
                            >
                              {busyId === r.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <CheckCheck className="size-3.5" />
                              )}
                              I acknowledge
                            </button>
                          )
                        ) : r.is_read ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Check className="size-3.5" /> Read
                          </span>
                        ) : (
                          <button
                            onClick={() => markRead(r, false)}
                            disabled={busyId === r.id}
                            className="btn-secondary text-xs inline-flex items-center gap-1"
                          >
                            {busyId === r.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Mark as read
                          </button>
                        )}
                      </div>
                    )}

                    {isManager && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="chip text-[10px] bg-slate-50 text-slate-600 inline-flex items-center gap-0.5">
                          <Eye className="size-3" /> {r.read_count ?? 0} read
                        </span>
                        {r.requires_ack && (
                          <span
                            className={`chip text-[10px] inline-flex items-center gap-0.5 ${
                              (r.read_count ?? 0) > 0 && (r.ack_count ?? 0) >= (r.read_count ?? 0)
                                ? "bg-emerald-50 text-emerald-700"
                                : (r.ack_count ?? 0) === 0
                                ? "bg-rose-50 text-rose-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            <CheckCheck className="size-3" /> {r.ack_count ?? 0} acknowledged
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {isManager && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => togglePublish(r)}
                        disabled={busyId === r.id}
                        className={`rounded p-1.5 hover:bg-secondary text-muted-foreground`}
                        title={draft ? "Publish Now" : "Unpublish (Move to Draft)"}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : draft ? (
                          <Eye className="size-4 text-emerald-600" />
                        ) : (
                          <EyeOff className="size-4 text-slate-400" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingRow(r)}
                        disabled={busyId === r.id}
                        className="rounded p-1.5 hover:bg-secondary text-muted-foreground"
                        title="Edit"
                      >
                        <Edit2 className="size-4" />
                      </button>
                      <button
                        onClick={() => togglePin(r)}
                        disabled={busyId === r.id}
                        className="rounded p-1.5 hover:bg-secondary text-muted-foreground"
                        title={r.is_pinned ? "Unpin" : "Pin"}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : r.is_pinned ? (
                          <PinOff className="size-4" />
                        ) : (
                          <Pin className="size-4" />
                        )}
                      </button>
                      <button
                        onClick={() => remove(r)}
                        disabled={busyId === r.id}
                        className="rounded p-1.5 hover:bg-rose-50 text-rose-500"
                        title="Delete"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(compose || editingRow) && (
        <Composer
          row={editingRow}
          branches={branches}
          onClose={() => {
            setCompose(false);
            setEditingRow(null);
          }}
          onSaved={() => {
            setCompose(false);
            setEditingRow(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Composer({
  row,
  branches = [],
  onClose,
  onSaved,
}: {
  row?: Row | null;
  branches?: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(row?.title ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [category, setCategory] = useState(row?.category ?? "general");
  const [pinned, setPinned] = useState(row?.is_pinned ?? false);
  const [requiresAck, setRequiresAck] = useState(row?.requires_ack ?? false);
  const [roles, setRoles] = useState<string[]>(row?.audience_roles ?? []);
  const [branchId, setBranchId] = useState(row?.branch_id ?? "");
  const [expiresAt, setExpiresAt] = useState(
    row?.expires_at ? new Date(row.expires_at).toISOString().slice(0, 16) : ""
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleRole(r: string) {
    setRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  }

  async function save(publishNow: boolean) {
    if (title.trim().length < 2 || !body.trim()) {
      setErr("Title and body are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const url = row ? `/api/announcements/${row.id}` : "/api/announcements";
      const method = row ? "PATCH" : "POST";

      const payload: Record<string, any> = {
        title,
        body,
        category,
        isPinned: pinned,
        requiresAck,
        audienceRoles: roles,
        branchId: branchId ? branchId : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };

      if (!row) {
        payload.publishNow = publishNow;
      } else {
        if (!row.published_at && publishNow) {
          payload.publishNow = true;
        } else if (row.published_at && !publishNow) {
          payload.unpublish = true;
        }
      }

      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg h-full bg-card border-l shadow-2xl flex flex-col"
      >
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">{row ? "Edit announcement" : "Post announcement"}</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-base"
              placeholder="e.g. Office closed on Friday"
            />
          </Field>
          <Field label="Message">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="input-base"
              placeholder="Write the notice…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-base">
                {CATEGORIES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expires (optional)">
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="input-base"
              />
            </Field>
          </div>
          <Field label="Target Branch (optional)">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input-base">
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Audience (none = everyone)</div>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_OPTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRole(r)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border capitalize ${
                    roles.includes(r)
                      ? "bg-brand-cyan text-white border-brand-cyan"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {r.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="size-4 rounded"
            />{" "}
            Pin to top
          </label>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresAck}
                onChange={(e) => setRequiresAck(e.target.checked)}
                className="size-4 rounded"
              />{" "}
              Requires acknowledgement
            </label>
            <p className="text-[11px] text-muted-foreground mt-0.5 ml-6">
              Staff must click “I acknowledge” — for policy/urgent notices.
            </p>
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          {row ? (
            row.published_at ? (
              <>
                <button
                  onClick={() => save(false)}
                  disabled={busy}
                  className="btn-secondary text-xs"
                >
                  Move to Draft
                </button>
                <button
                  onClick={() => save(true)}
                  disabled={busy}
                  className="btn-primary text-xs inline-flex items-center gap-1"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save Changes
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => save(false)}
                  disabled={busy}
                  className="btn-secondary text-xs"
                >
                  Save Draft
                </button>
                <button
                  onClick={() => save(true)}
                  disabled={busy}
                  className="btn-primary text-xs inline-flex items-center gap-1"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Publish Now
                </button>
              </>
            )
          ) : (
            <>
              <button
                onClick={() => save(false)}
                disabled={busy}
                className="btn-secondary text-xs"
              >
                Save as Draft
              </button>
              <button
                onClick={() => save(true)}
                disabled={busy}
                className="btn-primary text-xs inline-flex items-center gap-1"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Publish
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
      {children}
    </label>
  );
}
