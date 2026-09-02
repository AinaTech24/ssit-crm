"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  FolderArchive,
  AlertTriangle,
  Download,
  DownloadCloud,
  Trash2,
  Loader2,
  Search,
  Filter,
  Building2,
  ChevronRight,
  Eye,
  ExternalLink,
  FileText,
  RefreshCw,
} from "lucide-react";
import { formatDate, formatRelative } from "@/lib/utils";
import { DocumentViewerModal, type ViewerDoc } from "@/components/documents/DocumentViewerModal";
import { Avatar } from "@/components/ui/Avatar";
import { SelectField } from "@/components/ui/SelectField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

type DocRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: string | null;
  issuedOn: string | Date | null;
  expiresOn: string | Date | null;
  createdAt: string | Date | null;
  clientId?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  clientAvatar?: string | null;
};

type Group = {
  key: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  clientAvatar: string | null;
  docs: DocRow[];
  expiring: number;
  expired: number;
};

const CATEGORY_COLORS: Record<string, string> = {
  arn: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/50",
  euin: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/50",
  nism: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/50",
  kyd: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/50",
  amc_empanelment: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/50",
  ddq: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50",
  sop: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50",
  marketing_approval: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/20 dark:text-pink-400 dark:border-pink-900/50",
  complaint: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50",
  audit_report: "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/30 dark:bg-brand-cyan/10 dark:text-brand-cyan dark:border-brand-cyan/30",
  ria_compliance: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/50",
  other: "bg-gray-50 text-gray-700 border-gray-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800",
};

export function DocumentsFeed({
  initialRows,
  stats,
}: {
  initialRows: DocRow[];
  stats: { total: number; expiringSoon: number; expired: number };
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DocRow[]>(initialRows);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [viewer, setViewer] = useState<ViewerDoc | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceDocRef = useRef<DocRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "single"; id: string; name: string } | { kind: "group"; group: Group } | null
  >(null);

  function startReplace(doc: DocRow) {
    replaceDocRef.current = doc;
    replaceRef.current?.click();
  }

  async function onReplaceFile(file: File | null) {
    const doc = replaceDocRef.current;
    if (!file || !doc) return;
    setReplacingId(doc.id);
    try {
      // 1. Upload the new file, 2. supersede the old row with it.
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "compliance");
      fd.append("docType", doc.category || "compliance");
      const up = await fetch("/api/compliance/upload", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({}));
      if (!up?.key) {
        alert(up?.error ?? "Upload failed");
        return;
      }
      const res = await fetch(`/api/compliance/documents/${doc.id}/supersede`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, storageKey: up.key, mimeType: up.contentType ?? file.type, sizeBytes: up.sizeBytes ?? file.size }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.error ?? "Replace failed");
        return;
      }
      // Swap the old (now-superseded) row for the new version in-place so the
      // change is visible immediately; refresh reconciles with the server.
      setRows((prev) =>
        prev.map((r) =>
          r.id === doc.id
            ? { ...r, id: j.id ?? r.id, name: file.name, mimeType: up.contentType ?? file.type, sizeBytes: String(up.sizeBytes ?? file.size), createdAt: new Date().toISOString(), expiresOn: null }
            : r
        )
      );
      router.refresh();
    } finally {
      setReplacingId(null);
      replaceDocRef.current = null;
      if (replaceRef.current) replaceRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/compliance/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        router.refresh();
      } else {
        alert("Failed to delete document.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting document.");
    } finally {
      setDeletingId(null);
    }
  }

  function downloadAll(g: Group) {
    const ids = g.docs.map((d) => d.id).join(",");
    const a = document.createElement("a");
    a.href = `/api/compliance/documents/download-all?ids=${encodeURIComponent(ids)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function deleteAll(g: Group) {
    setDeletingGroup(g.key);
    try {
      const ids = g.docs.map((d) => d.id);
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/compliance/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" }))
      );
      const okIds = new Set<string>();
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.ok) okIds.add(ids[i]);
      });
      setRows((prev) => prev.filter((r) => !okIds.has(r.id)));
      router.refresh();
      if (okIds.size < ids.length) alert(`Deleted ${okIds.size} of ${ids.length}. Some could not be removed.`);
    } catch (err) {
      console.error(err);
      alert("Error deleting documents.");
    } finally {
      setDeletingGroup(null);
    }
  }

  // Docs that pass the category filter + search (search also matches client).
  const visibleDocs = useMemo(() => {
    const ql = searchQuery.trim().toLowerCase();
    return rows.filter((d) => {
      if (categoryFilter !== "all" && d.category !== categoryFilter) return false;
      if (!ql) return true;
      return (
        d.name.toLowerCase().includes(ql) ||
        (d.description?.toLowerCase().includes(ql) ?? false) ||
        (d.clientName?.toLowerCase().includes(ql) ?? false) ||
        (d.clientEmail?.toLowerCase().includes(ql) ?? false)
      );
    });
  }, [rows, searchQuery, categoryFilter]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const d of visibleDocs) {
      const key = d.clientId ?? "__firm__";
      if (!map.has(key)) {
        map.set(key, {
          key,
          clientId: d.clientId ?? null,
          clientName: d.clientId ? d.clientName ?? "Client" : "Firm & unassigned documents",
          clientEmail: d.clientEmail ?? null,
          clientPhone: d.clientPhone ?? null,
          clientAvatar: d.clientAvatar ?? null,
          docs: [],
          expiring: 0,
          expired: 0,
        });
      }
      const g = map.get(key)!;
      g.docs.push(d);
      const exp = d.expiresOn ? new Date(d.expiresOn) : null;
      if (exp) {
        if (exp.getTime() < Date.now()) g.expired++;
        else if (exp.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000) g.expiring++;
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.clientId === null) return 1; // firm group last
      if (b.clientId === null) return -1;
      return a.clientName.localeCompare(b.clientName);
    });
  }, [visibleDocs]);

  return (
    <div className="space-y-6">
      {/* Hidden input for the per-row "Replace" action */}
      <input ref={replaceRef} type="file" className="hidden" onChange={(e) => onReplaceFile(e.target.files?.[0] ?? null)} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv" />

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Total documents</div>
          <div className="text-2xl font-bold mt-1">{rows.length}</div>
        </div>
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Expiring (30d)</div>
          <div className={`text-2xl font-bold mt-1 ${stats.expiringSoon > 0 ? "text-amber-600" : "text-foreground"}`}>{stats.expiringSoon}</div>
        </div>
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Expired</div>
          <div className={`text-2xl font-bold mt-1 ${stats.expired > 0 ? "text-rose-600" : "text-foreground"}`}>{stats.expired}</div>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-secondary/10 p-3 rounded-lg border border-border/40 print:hidden">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by document name, description or client…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Filter className="size-3.5" /> Category:
          </div>
          <SelectField
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs font-semibold min-w-[160px]"
          >
            <option value="all">All Categories</option>
            <option value="arn">ARN</option>
            <option value="euin">EUIN</option>
            <option value="nism">NISM Certificate</option>
            <option value="kyd">KYC Document</option>
            <option value="amc_empanelment">AMC Empanelment</option>
            <option value="ddq">DDQ Document</option>
            <option value="sop">SOP</option>
            <option value="marketing_approval">Marketing Approval</option>
            <option value="complaint">Complaint Document</option>
            <option value="audit_report">Audit Report</option>
            <option value="ria_compliance">RIA Compliance</option>
            <option value="other">Other</option>
          </SelectField>
        </div>
      </div>

      {/* Client-grouped accordion */}
      {groups.length === 0 ? (
        <div className="border rounded-lg bg-card p-12 text-center text-sm text-muted-foreground">
          <FolderArchive className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2">No documents found.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const isOpen = !!open[g.key];
            const isFirm = g.clientId === null;
            return (
              <div key={g.key} className="border rounded-lg bg-card overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-3 px-3 sm:px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    aria-expanded={isOpen}
                  >
                    <ChevronRight className={`size-4 text-muted-foreground shrink-0 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`} />
                    {isFirm ? (
                      <div className="size-9 rounded-lg grid place-items-center shrink-0 bg-slate-100 dark:bg-slate-800">
                        <Building2 className="size-4 text-slate-500" />
                      </div>
                    ) : (
                      <Avatar src={g.clientAvatar} name={g.clientName} size={36} />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{g.clientName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {isFirm ? "Firm-level & unassigned documents" : [g.clientEmail, g.clientPhone].filter(Boolean).join(" · ") || "Client"}
                      </div>
                    </div>
                  </button>

                  {/* Counts + alerts */}
                  <div className="hidden sm:flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{g.docs.length} doc{g.docs.length !== 1 ? "s" : ""}</span>
                    {g.expired > 0 && (
                      <span className="inline-flex items-center gap-1 text-rose-600 font-semibold"><AlertTriangle className="size-3" />{g.expired}</span>
                    )}
                    {g.expiring > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-semibold"><AlertTriangle className="size-3" />{g.expiring}</span>
                    )}
                  </div>

                  {/* Bulk actions */}
                  <div className="flex items-center gap-1.5 print:hidden">
                    <button
                      type="button"
                      onClick={() => downloadAll(g)}
                      title="Download all as ZIP"
                      className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
                    >
                      <DownloadCloud className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete({ kind: "group", group: g })}
                      disabled={deletingGroup === g.key}
                      title="Delete all documents in this group"
                      className="size-8 rounded-lg hover:bg-rose-50 border border-border/40 grid place-items-center text-muted-foreground hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50"
                    >
                      {deletingGroup === g.key ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </button>
                    {!isFirm && g.clientId && (
                      <a
                        href={`/dashboard/investors/${g.clientId}#documents`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this client's Documents & attachments"
                        className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Expandable body — smooth height via grid-rows */}
                <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="overflow-hidden">
                    <div className="border-t divide-y divide-border/60">
                      {g.docs.map((d) => {
                        const exp = d.expiresOn ? new Date(d.expiresOn) : null;
                        const expired = exp && exp.getTime() < Date.now();
                        const expiringSoon = exp && !expired && exp.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
                        return (
                          <div key={d.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-accent/30">
                            <FileText className="size-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{d.name}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[10px] font-bold border px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other}`}>
                                  {d.category === "kyd" ? "KYC" : d.category.toUpperCase().replace(/_/g, " ")}
                                </span>
                                {exp && (
                                  <span className={`text-[10px] inline-flex items-center gap-0.5 ${expired ? "text-rose-600 font-semibold" : expiringSoon ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                                    {(expired || expiringSoon) && <AlertTriangle className="size-3" />}
                                    {expired ? "Expired " : "Expires "}{formatDate(exp)}
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground">Uploaded {formatRelative(d.createdAt)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 print:hidden">
                              {deletingId === d.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                              <button
                                type="button"
                                onClick={() =>
                                  setViewer({
                                    name: d.name,
                                    mimeType: d.mimeType,
                                    src: `/api/compliance/documents/download?id=${encodeURIComponent(d.id)}&inline=1`,
                                    downloadHref: `/api/compliance/documents/download?id=${encodeURIComponent(d.id)}`,
                                  })
                                }
                                title="View"
                                className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
                              >
                                <Eye className="size-4" />
                              </button>
                              <DownloadButton
                                url={`/api/compliance/documents/download?id=${encodeURIComponent(d.id)}`}
                                title="Download"
                                className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
                              >
                                <Download className="size-4" />
                              </DownloadButton>
                              <button
                                type="button"
                                onClick={() => startReplace(d)}
                                disabled={replacingId === d.id}
                                title="Replace with a newer version"
                                className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors disabled:opacity-50"
                              >
                                {replacingId === d.id ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete({ kind: "single", id: d.id, name: d.name })}
                                disabled={deletingId != null}
                                title="Delete"
                                className="size-8 rounded-lg hover:bg-rose-50 border border-border/40 grid place-items-center text-muted-foreground hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DocumentViewerModal doc={viewer} onClose={() => setViewer(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.kind === "group" ? "Delete all documents?" : "Delete document?"}
        message={
          pendingDelete?.kind === "group"
            ? `Permanently delete all ${pendingDelete.group.docs.length} document(s) for "${pendingDelete.group.clientName}"? This can't be undone.`
            : pendingDelete?.kind === "single"
              ? `Permanently delete "${pendingDelete.name}" from storage and the database? This can't be undone.`
              : ""
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === "group") deleteAll(pendingDelete.group);
          else handleDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
