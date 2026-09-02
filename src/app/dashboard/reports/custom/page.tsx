"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, Plus, Star, Search, Trash2, Pencil, Loader2, Table2, Grid3x3, Rows3, ChevronLeft, Copy, Folder, FolderOpen, Inbox } from "lucide-react";

type Report = {
  id: string;
  name: string;
  description: string | null;
  subject: string;
  reportType: "detailed" | "summary" | "matrix";
  sharedScope: string;
  folder: string | null;
  starred: boolean;
  isMine: boolean;
  updatedAt: string;
};

const SUBJECT_LABEL: Record<string, string> = {
  investor: "Clients",
  lead: "Leads",
  task: "Tasks",
  user: "Users",
  transaction: "MF Transactions",
  sip: "SIPs",
  insurance: "Insurance",
  goal: "Goals",
  service_request: "Service Requests",
  claim: "Insurance Claims",
};
const TYPE_META: Record<string, { label: string; icon: typeof Table2 }> = {
  detailed: { label: "Detailed", icon: Table2 },
  summary: { label: "Summary", icon: Rows3 },
  matrix: { label: "Matrix", icon: Grid3x3 },
};
const ALL = "__all__";
const FAV = "__fav__";

export default function CustomReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [activeFolder, setActiveFolder] = useState<string>(ALL);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/reports/saved");
      const j = await r.json();
      setReports(j.reports ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleStar(id: string, starred: boolean) {
    setReports((rs) => rs.map((r) => (r.id === id ? { ...r, starred: !starred } : r)));
    await fetch(`/api/reports/saved/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ star: !starred }),
    });
  }
  async function del(id: string) {
    if (!confirm("Delete this report? This can't be undone.")) return;
    await fetch(`/api/reports/saved/${id}`, { method: "DELETE" });
    load();
  }
  async function clone(id: string) {
    const r = await fetch(`/api/reports/saved/${id}/clone`, { method: "POST" });
    const j = await r.json();
    if (r.ok && j.id) router.push(`/dashboard/reports/custom/new?edit=${j.id}`);
    else alert(j.error ?? "Clone failed");
  }

  // Folder list (custom folders, sorted) + counts.
  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reports) if (r.folder) m.set(r.folder, (m.get(r.folder) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [reports]);

  const filtered = reports
    .filter((r) => (activeFolder === ALL ? true : activeFolder === FAV ? r.starred : r.folder === activeFolder))
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || (r.description ?? "").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));

  const FolderBtn = ({ value, label, count, icon: Icon }: { value: string; label: string; count: number; icon: typeof Folder }) => (
    <button
      onClick={() => setActiveFolder(value)}
      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${activeFolder === value ? "bg-brand-navy text-white" : "hover:bg-secondary/60 text-foreground/80"}`}
    >
      <span className="flex items-center gap-2 truncate"><Icon className="size-3.5 shrink-0" /> {label}</span>
      <span className={`text-xs ${activeFolder === value ? "text-white/70" : "text-muted-foreground"}`}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <Link href="/dashboard/reports" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to reports
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <BarChart3 className="size-6 text-brand-cyan" /> Custom Reports
          </h1>
        </div>
        <Link href="/dashboard/reports/custom/new" className="btn-primary">
          <Plus className="size-4" /> New report
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
        {/* Folder rail */}
        <aside className="card-surface p-2 h-fit space-y-0.5">
          <FolderBtn value={ALL} label="All Reports" count={reports.length} icon={Inbox} />
          <FolderBtn value={FAV} label="Favourites" count={reports.filter((r) => r.starred).length} icon={Star} />
          {folders.length > 0 && <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Folders</div>}
          {folders.map(([name, count]) => (
            <FolderBtn key={name} value={name} label={name} count={count} icon={activeFolder === name ? FolderOpen : Folder} />
          ))}
        </aside>

        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports…" className="input-base pl-9" />
          </div>

          <div className="card-surface overflow-hidden">
            {loading ? (
              <div className="p-12 grid place-items-center text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                <BarChart3 className="size-8 mx-auto text-muted-foreground/40" />
                <div className="mt-2 font-medium">{reports.length === 0 ? "No custom reports yet." : "No reports here."}</div>
                <Link href="/dashboard/reports/custom/new" className="text-brand-cyan-deep hover:underline text-xs mt-1 inline-block">
                  + Build your first report
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="w-8 px-3 py-2"></th>
                    <th className="text-left px-2 py-2 font-medium">Name</th>
                    <th className="text-left py-2 font-medium">Module</th>
                    <th className="text-left py-2 font-medium">Type</th>
                    <th className="text-left py-2 font-medium">Folder</th>
                    <th className="text-left py-2 font-medium">Sharing</th>
                    <th className="text-right py-2 px-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const tm = TYPE_META[r.reportType] ?? TYPE_META.detailed;
                    const TIcon = tm.icon;
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
                        <td className="px-3 py-2.5">
                          <button onClick={() => toggleStar(r.id, r.starred)} aria-label="Star" className="text-muted-foreground hover:text-amber-500">
                            <Star className={`size-4 ${r.starred ? "fill-amber-400 text-amber-400" : ""}`} />
                          </button>
                        </td>
                        <td className="px-2 py-2.5">
                          <Link href={`/dashboard/reports/custom/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                          {r.description && <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>}
                        </td>
                        <td className="py-2.5 text-xs">{SUBJECT_LABEL[r.subject] ?? r.subject}</td>
                        <td className="py-2.5">
                          <span className="chip bg-secondary/70 text-foreground/80 inline-flex items-center gap-1">
                            <TIcon className="size-3" /> {tm.label}
                          </span>
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">{r.folder ?? "—"}</td>
                        <td className="py-2.5 text-xs capitalize text-muted-foreground">{r.sharedScope}</td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button onClick={() => clone(r.id)} className="btn-icon inline-grid" aria-label="Clone"><Copy className="size-3.5" /></button>
                          {r.isMine && (
                            <Link href={`/dashboard/reports/custom/new?edit=${r.id}`} className="btn-icon inline-grid" aria-label="Edit"><Pencil className="size-3.5" /></Link>
                          )}
                          {r.isMine && (
                            <button onClick={() => del(r.id)} className="btn-icon inline-grid hover:text-rose-600" aria-label="Delete"><Trash2 className="size-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
