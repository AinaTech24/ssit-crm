"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { Avatar } from "@/components/ui/Avatar";
import { formatRelative } from "@/lib/utils";
import { RecoverTenantButton } from "@/components/super-admin/RecoverTenantButton";
import { PermanentDeleteButton } from "@/components/super-admin/PermanentDeleteButton";

export type TenantRow = {
  id: string;
  legal_name: string;
  arn: string | null;
  email: string | null;
  logo_url: string | null;
  sub_status: string | null;
  created_at: string | null;
  deleted_at: string | null;
  user_count: number;
  investor_count: number;
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  trial: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  inactive: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

function effectiveStatus(r: TenantRow): "active" | "inactive" | null {
  return r.sub_status === "active" || !r.sub_status ? "active" : "inactive";
}

function RetentionCell({ deletedAt, retentionDays }: { deletedAt: string | null; retentionDays: number }) {
  if (!deletedAt) return <span>—</span>;
  const purgeAt = new Date(deletedAt).getTime() + retentionDays * 86_400_000;
  const left = Math.ceil((purgeAt - Date.now()) / 86_400_000);
  return (
    <div>
      <div>deleted {formatRelative(deletedAt)}</div>
      {left > 0 ? <div className="text-amber-600">purges in {left}d</div> : <div className="text-rose-600 font-medium">eligible for purge</div>}
    </div>
  );
}

export function TenantsTable({
  rows,
  tab,
  retentionDays,
}: {
  rows: TenantRow[];
  tab: "current" | "recent" | "deactivated" | "deleted";
  retentionDays: number;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [status, setStatus] = useState("");

  const packages = useMemo(
    () => [] as string[],
    [rows]
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (needle) {
        const hay = `${r.legal_name} ${r.arn ?? ""} ${r.email ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (status && effectiveStatus(r) !== status) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "name_asc": return a.legal_name.localeCompare(b.legal_name);
        case "name_desc": return b.legal_name.localeCompare(a.legal_name);
        case "created_asc": return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
        default: return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      }
    });
    return out;
  }, [rows, q, sort, status]);

  return (
    <div className="space-y-3">
      {/* Toolbar — live search + sort + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, ARN or email…"
            className="w-full border border-border rounded-md pl-8 pr-3 py-1.5 text-sm bg-card"
          />
        </div>
        <SelectField value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto" aria-label="Sort">
          <option value="created_desc">Newest first</option>
          <option value="created_asc">Oldest first</option>
          <option value="name_asc">Name A–Z</option>
          <option value="name_desc">Name Z–A</option>
        </SelectField>
        {tab !== "deleted" && (
          <SelectField value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status filter">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </SelectField>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground">Showing {shown.length} of {rows.length}</div>

      <div className="card-surface table-scroll min-h-[28rem]" style={{ ["--table-scroll-h" as any]: "calc(100vh - 22rem)" }}>
        {shown.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No tenants match your filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left font-medium">MFD</th>
                <th className="text-left font-medium">ARN</th>
                <th className="text-left font-medium">Status</th>
                <th className="text-right font-medium">Users</th>
                <th className="text-right font-medium">Investors</th>
                <th className="text-left font-medium">{tab === "deleted" ? "Retention" : ""}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const eff = effectiveStatus(t);
                return (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={t.logo_url} name={t.legal_name} size={30} className="shrink-0" />
                        <div className="min-w-0">
                          {tab === "deleted" ? (
                            <span className="font-medium">{t.legal_name}</span>
                          ) : (
                            <Link href={`/super-admin/tenants/${t.id}`} className="font-medium hover:underline">{t.legal_name}</Link>
                          )}
                          {t.email && <div className="text-xs text-muted-foreground truncate">{t.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">{t.arn ?? "—"}</td>
                    <td>
                      {eff ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_BADGE[eff] ?? ""}`}>{eff}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{t.user_count}</td>
                    <td className="text-right tabular-nums">{t.investor_count}</td>
                    <td className="text-xs">
                      {tab === "deleted" ? <RetentionCell deletedAt={t.deleted_at} retentionDays={retentionDays} /> : null}
                    </td>
                    <td className="text-right">
                      {tab === "deleted" ? (
                        <div className="flex items-center justify-end gap-2">
                          <RecoverTenantButton tenantId={t.id} tenantName={t.legal_name} />
                          <PermanentDeleteButton tenantId={t.id} tenantName={t.legal_name} />
                        </div>
                      ) : (
                        <Link href={`/super-admin/tenants/${t.id}`} className="text-xs text-primary hover:underline font-medium">Manage →</Link>
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
  );
}
