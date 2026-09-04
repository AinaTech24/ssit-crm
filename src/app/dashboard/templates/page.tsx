import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import {
  Plus,
  MessageSquare,
  Mail,
  MessageCircle,
  LayoutGrid,
  Search,
  FileText,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { EmptyState } from "@/components/common/EmptyState";
import { FetchWhatsappTemplatesButton } from "@/components/templates/FetchWhatsappTemplatesButton";

export const dynamic = "force-dynamic";

const channelMeta: Record<string, { label: string; icon: any; tint: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, tint: "bg-emerald-50 text-emerald-600" },
  email: { label: "Email", icon: Mail, tint: "bg-blue-50 text-blue-600" },
  sms: { label: "SMS", icon: MessageSquare, tint: "bg-violet-50 text-violet-600" },
  inapp: { label: "In-app", icon: MessageSquare, tint: "bg-slate-100 text-slate-600" },
};

const statusColors: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending_approval: "bg-amber-50 text-amber-700 border-amber-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  draft: "bg-slate-50 text-slate-600 border-slate-200",
  paused: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-zinc-50 text-zinc-600 border-zinc-200",
};

const CHANNEL_TABS = [
  { key: "", label: "All", icon: LayoutGrid },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "email", label: "Email", icon: Mail },
  { key: "sms", label: "SMS", icon: MessageSquare },
];

const STATUS_TABS = [
  { key: "", label: "All status" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const activeChannel = sp.channel ?? "";
  const activeStatus = sp.status ?? "";
  const q = (sp.q ?? "").trim();
  const session = await requireSession();
  // Firm admins only — mirrors the server check on POST /api/templates so we
  // never render a button that comes back 403.
  const canCreate = can(session.roles, "template.create", session.permissions);

  const all = await withTenant(session.tenantId, async (tx) =>
    tx
      .select({ tpl: templates, score: templateVersions.complianceScore })
      .from(templates)
      .leftJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .orderBy(desc(templates.updatedAt))
  );

  // KPIs over the whole library (stable regardless of the active filter).
  const kpi = {
    total: all.length,
    approved: all.filter((r) => r.tpl.status === "approved").length,
    pending: all.filter((r) => r.tpl.status === "pending_approval").length,
    draft: all.filter((r) => r.tpl.status === "draft").length,
  };
  const channelCount = (key: string) =>
    key ? all.filter((r) => r.tpl.channel === key).length : all.length;

  // Apply the active channel / status / search filters in memory (templates are
  // low-cardinality per tenant — no need for extra SQL round-trips).
  const ql = q.toLowerCase();
  const rows = all.filter((r) => {
    if (activeChannel && r.tpl.channel !== activeChannel) return false;
    if (activeStatus && r.tpl.status !== activeStatus) return false;
    if (ql && !(`${r.tpl.name} ${r.tpl.key}`.toLowerCase().includes(ql))) return false;
    return true;
  });

  const hrefFor = (next: { channel?: string; status?: string; q?: string }) => {
    const p = new URLSearchParams();
    const channel = next.channel ?? activeChannel;
    const status = next.status ?? activeStatus;
    const query = next.q ?? q;
    if (channel) p.set("channel", channel);
    if (status) p.set("status", status);
    if (query) p.set("q", query);
    const s = p.toString();
    return `/dashboard/templates${s ? `?${s}` : ""}`;
  };

  const channelLabel = activeChannel ? channelMeta[activeChannel]?.label ?? activeChannel : null;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="size-6 text-brand-cyan" /> Message templates
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <FetchWhatsappTemplatesButton />
          {canCreate && (
            <Link href="/dashboard/templates/new" className="btn-primary">
              <Plus className="size-4" /> New template
            </Link>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="All templates" value={kpi.total} />
        <Kpi label="Approved" value={kpi.approved} tone="emerald" />
        <Kpi label="Pending approval" value={kpi.pending} tone={kpi.pending > 0 ? "amber" : "muted"} />
        <Kpi label="Drafts" value={kpi.draft} tone={kpi.draft > 0 ? "slate" : "muted"} />
      </div>

      <div className="card-surface overflow-hidden">
        {/* Toolbar: channel tabs + search + status */}
        <div className="border-b border-border px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
            {CHANNEL_TABS.map((c) => {
              const active = activeChannel === c.key;
              const Icon = c.icon;
              return (
                <Link
                  key={c.key || "all"}
                  href={hrefFor({ channel: c.key })}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${active
                      ? "bg-card shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  <Icon className="size-3.5" />
                  {c.label}
                  <span
                    className={`tabular-nums text-[10px] font-semibold rounded-full px-1.5 ${active ? "bg-brand-cyan-light text-brand-cyan-deep" : "bg-secondary text-muted-foreground"
                      }`}
                  >
                    {channelCount(c.key)}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search (server-rendered GET form; preserves channel + status) */}
            <form action="/dashboard/templates" method="GET" className="relative">
              {activeChannel && <input type="hidden" name="channel" value={activeChannel} />}
              {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Search name or key…"
                className="h-8 w-52 rounded-lg border border-border bg-card pl-8 pr-2 text-xs"
              />
            </form>

            {/* Status chips */}
            <div className="inline-flex items-center gap-1">
              {STATUS_TABS.map((s) => {
                const active = activeStatus === s.key;
                return (
                  <Link
                    key={s.key || "all"}
                    href={hrefFor({ status: s.key })}
                    className={`text-xs rounded-md px-2 py-1 font-medium border transition-colors ${active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:bg-accent"
                      }`}
                  >
                    {s.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          kpi.total === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileText}
                title="No templates yet — let's create the first"
                description="Templates are reusable WhatsApp, Email and SMS messages with merge fields like {{investor.name}}. Build once, send everywhere — each one is compliance-checked before approval."
                tip="Email templates use a block designer (header, text, button, footer). WhatsApp templates sync to Meta for approval automatically."
                primary={canCreate ? { href: "/dashboard/templates/new", label: "+ New template" } : undefined}
              />
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No templates match{q ? ` “${q}”` : ""}
              {channelLabel ? ` in ${channelLabel}` : ""}.{" "}
              <Link href="/dashboard/templates" className="text-brand-cyan-deep hover:underline">
                Clear filters
              </Link>
              .
            </div>
          )
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left py-2 font-medium">Channel</th>
                  <th className="text-left py-2 font-medium">Category</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-left py-2 font-medium">Compliance</th>
                  <th className="text-left py-2 font-medium">Updated</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ tpl, score }) => {
                  const cm = channelMeta[tpl.channel] ?? channelMeta.inapp;
                  const Icon = cm.icon;
                  return (
                    <tr key={tpl.id} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`size-8 shrink-0 rounded-lg grid place-items-center ${cm.tint}`}>
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <Link
                              href={`/dashboard/templates/${tpl.id}`}
                              className="font-medium hover:underline truncate block"
                            >
                              {tpl.name}
                            </Link>
                            <div className="text-xs text-muted-foreground font-mono truncate">{tpl.key}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className="capitalize text-xs text-muted-foreground">{cm.label}</span>
                      </td>
                      <td className="py-3">
                        <span className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground bg-secondary/60 border border-border/60 rounded px-1.5 py-0.5">
                          {tpl.category}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${statusColors[tpl.status] ?? ""}`}>
                          {tpl.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3">
                        <ScoreBar score={Number(score ?? 0)} />
                      </td>
                      <td className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {tpl.updatedAt ? formatRelative(tpl.updatedAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions
                          editHref={`/dashboard/templates/${tpl.id}`}
                          deleteUrl={`/api/templates/${tpl.id}`}
                          itemLabel="template"
                          itemName={tpl.name}
                          verb="Archive"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "slate" | "muted";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "slate"
          ? "text-slate-700"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  if (!score) return <span className="text-xs text-muted-foreground">—</span>;
  const color = score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2 max-w-[120px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{score}</span>
    </div>
  );
}
