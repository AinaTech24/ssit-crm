/**
 * Command Center — the single screen an owner or RM opens every morning.
 *
 * One prioritised worklist across every module: SLA breaches, SIP bounces,
 * redemption risk, overdue reviews, KYC expiries, overdue tasks & lead
 * follow-ups, stale risk profiles, birthdays. Firm-wide for owners/branch
 * heads/compliance; "your book only" for RMs and ops.
 *
 * Pure read over current state (src/lib/command-center/queue.ts) — every row
 * deep-links to where you act.
 */

import Link from "next/link";
import {
  LifeBuoy, XOctagon, TrendingDown, CalendarClock, Calendar, CalendarOff, CalendarCheck, ShieldAlert, ListChecks,
  Sparkles, ShieldCheck, Cake, CheckCircle2, ArrowRight, Inbox, MessageCircle, FileText, Users, LayoutList,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { ScopeFilterBar } from "@/components/common/ScopeFilterBar";
import { parseScope, loadScopeUnits, loadScopeMembers, canPickScope } from "@/lib/scope/view-filter";
import { buildCommandQueue, type ActionGroup, type ActionItem, type Severity } from "@/lib/command-center/queue";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { CommandClientPicker } from "@/components/command-center/CommandClientPicker";
import { CommandItemActions } from "@/components/command-center/CommandItemActions";
import { HelpTip } from "@/components/common/HelpTip";
import { sql } from "drizzle-orm";
import { MyDayNav } from "@/components/layout/MyDayNav";

export const dynamic = "force-dynamic";

const ICONS: Record<string, any> = {
  LifeBuoy, XOctagon, TrendingDown, CalendarClock, Calendar, CalendarOff, CalendarCheck, ShieldAlert,
  ListChecks, Sparkles, ShieldCheck, Cake, MessageCircle, FileText,
};

/** WhatsApp wish text for the inline "send wish" action. */
function wishText(actionType: ActionItem["actionType"], name: string): string {
  if (actionType === "anniversary") return `Dear ${name}, wishing you a very happy wedding anniversary! 💐`;
  return `Dear ${name}, wishing you a very happy birthday! 🎂 May the year ahead bring you health, happiness and prosperity.`;
}

const TONE: Record<string, { badge: string; bar: string; ring: string }> = {
  rose: { badge: "bg-rose-100 text-rose-700", bar: "bg-rose-500", ring: "border-rose-200" },
  amber: { badge: "bg-amber-100 text-amber-700", bar: "bg-amber-500", ring: "border-amber-200" },
  sky: { badge: "bg-sky-100 text-sky-700", bar: "bg-sky-500", ring: "border-sky-200" },
  violet: { badge: "bg-violet-100 text-violet-700", bar: "bg-violet-500", ring: "border-violet-200" },
  emerald: { badge: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500", ring: "border-emerald-200" },
};


export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const firmWide = can(session.roles, "dashboard.view.owner", session.permissions);
  const sevFilter = (sp.severity ?? "").split(",").filter(Boolean);
  const catFilter = (sp.category ?? "").split(",").filter(Boolean);
  // Owners can scope the whole queue to one user; everyone else only sees their
  // own book, so the user filter is owner-only.
  // ?rm= is the shared scope param used by Clients / Leads / Tasks / SRs, so a
  // person picked in one module is still picked here. ?user= is kept as the
  // older param this page shipped with.
  const userParam = firmWide ? ((sp.rm ?? sp.user ?? "").trim()) : "";
  const scopeSel = parseScope(sp as Record<string, string | undefined>);
  const showScopePicker = canPickScope(session);
  // Scope the whole board to a single client (search-as-you-type picker).
  const clientId = (sp.client ?? "").trim();

  const { allGroups, userOptions, clientName, scopeUnits, scopeMembers } = await withTenant(
    session.tenantId,
    async (tx) => {
      const groups = await buildCommandQueue(
        tx as any,
        {
          ...(userParam ? { userId: userParam, firmWide: false } : { userId: session.userId, firmWide }),
          clientId,
        }
      );
      // Resolve the selected client's name for the picker chip.
      let clientName = "";
      if (clientId) {
        const cr = await tx.execute(sql`SELECT name FROM investors WHERE id = ${clientId} LIMIT 1`);
        clientName = ((cr.rows[0] as any)?.name as string) ?? "";
      }
      // Roster for the User filter — active users, so any newly-added user shows
      // up automatically.
      let users: { value: string; label: string }[] = [];
      if (firmWide) {
        const r = await tx.execute(sql`
          SELECT id, name FROM users
          WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
          ORDER BY name ASC
        `);
        users = (r.rows as { id: string; name: string }[]).map((u) => ({ value: String(u.id), label: u.name ?? "—" }));
      }
      const { units: scopeUnits } = showScopePicker ? await loadScopeUnits(tx, session) : { units: [] };
      const scopeMembers = showScopePicker ? await loadScopeMembers(tx, session, scopeSel) : [];
      return { allGroups: groups, userOptions: users, clientName, scopeUnits, scopeMembers };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // Category options come from whatever the queue produced — so the filter only
  // ever offers categories that actually have open items.
  const categoryOptions = Array.from(
    new Map(allGroups.map((g) => [g.key, g.label] as const)).entries()
  ).map(([value, label]) => ({ value, label }));

  const dateFrom = (sp.date_from ?? "").slice(0, 10);
  const dateTo = (sp.date_to ?? "").slice(0, 10);
  const inRange = (d?: string | null) => {
    if (!dateFrom && !dateTo) return true;
    if (!d) return true; // undated = always-current (e.g. SLA breach) — never hide
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  let groups = allGroups;
  if (sevFilter.length) groups = groups.filter((g) => sevFilter.includes(g.severity));
  if (catFilter.length) groups = groups.filter((g) => catFilter.includes(g.key));
  // Date-range filter — narrows dated items (reviews, meetings, KYC, tasks,
  // follow-ups…) to the window; undated "act now" items always stay. Count
  // reflects what's shown.
  if (dateFrom || dateTo) {
    groups = groups
      .map((g) => {
        const items = g.items.filter((it) => inRange(it.date));
        return { ...g, items, count: items.length };
      })
      .filter((g) => g.items.length > 0);
  }

  const totalItems = groups.reduce((n, g) => n + g.count, 0);
  const bandCount = (s: Severity) => groups.filter((g) => g.severity === s).reduce((n, g) => n + g.count, 0);
  const nowCount = bandCount("now");
  const todayCount = bandCount("today");
  const soonCount = bandCount("soon");

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Triage queue is "act now" — keep it fresh as work completes elsewhere. */}
      <AutoRefresh intervalMs={30000} />
      {showScopePicker && (
        <ScopeFilterBar
          basePath="/dashboard/command-center"
          units={scopeUnits}
          members={scopeMembers}
          selectedUnit={scopeSel.unit}
          selectedMember={scopeSel.rm}
        />
      )}
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Inbox className="size-6 text-brand-cyan" /> My Day
            <HelpTip title="My Day">
              Your single &ldquo;what needs me today&rdquo; screen — overdue tasks, today&apos;s
              meetings, SIP bounces, birthdays and follow-ups, ranked by urgency. Start your day here.
            </HelpTip>
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-3 py-1.5">
            <Stat label="Act now" value={nowCount} tone={nowCount ? "rose" : "emerald"} />
            <Stat label="Today" value={todayCount} tone={todayCount ? "amber" : "muted"} />
            <Stat label="This week" value={soonCount} tone="sky" />
            <Stat label="Total" value={totalItems} tone="muted" />
          </div>
        </div>
      </div>

      <MyDayNav />

      <CompactFilterBar
        totalCount={totalItems}
        rightSlot={<CustomViews viewsKey="views:command-center" />}
        leftSlot={<CommandClientPicker selectedId={clientId} selectedName={clientName} />}
        filters={[
          ...(firmWide && userOptions.length
            ? [{ type: "select" as const, key: "user", label: "User", allLabel: "All users", options: userOptions }]
            : []),
          { type: "date_range" as const, key: "date", label: "Date" },
          {
            type: "multi",
            key: "severity",
            label: "Urgency",
            options: [
              { value: "now", label: "Act now" },
              { value: "today", label: "Today" },
              { value: "soon", label: "This week" },
            ],
          },
          ...(categoryOptions.length
            ? [{ type: "multi" as const, key: "category", label: "Category", options: categoryOptions }]
            : []),
        ]}
      />

      {(dateFrom || dateTo) && (
        <p className="text-[11px] text-muted-foreground -mt-3">
          Date filter narrows dated items (reviews, meetings, follow-ups…). Always-current items like SLA breaches stay visible.
        </p>
      )}

      {groups.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <CheckCircle2 className="size-10 text-emerald-500 mx-auto mb-3" />
          <div className="font-semibold text-lg">All clear 🎉</div>
          <p className="text-sm text-muted-foreground mt-1">
            No overdue reviews, SIP bounces, SLA breaches or follow-ups in {firmWide ? "the firm" : "your book"} right now.
          </p>
        </div>
      ) : (
        (() => {
          // One full-width masonry of ALL cards, severity-sorted (Act now →
          // Today → This week, then biggest count first). Packs variable-height
          // cards tightly so a sparse band never leaves half the screen empty.
          const sevOrder: Record<Severity, number> = { now: 0, today: 1, soon: 2 };
          const sorted = [...groups].sort(
            (a, b) => sevOrder[a.severity] - sevOrder[b.severity] || b.count - a.count
          );
          return (
            <div className="columns-1 sm:columns-2 xl:columns-3 2xl:columns-4 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {sorted.map((g) => (
                <GroupCard key={g.key} group={g} />
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}

/* Severity budget: ONE chip per card ("Act now · 4"), tinted only when the
   card actually needs attention (rose = act now, soft amber = today). Card
   chrome stays neutral — the module colour lives in the small leading icon. */
const SEV_CHIP: Record<Severity, { label: string; cls: string; icon: string }> = {
  now: { label: "Act now", cls: "bg-rose-50 text-rose-700 border border-rose-200", icon: "text-rose-600" },
  today: { label: "Today", cls: "bg-amber-50 text-amber-700 border border-amber-200", icon: "text-amber-600" },
  soon: { label: "This week", cls: "bg-secondary text-muted-foreground border border-transparent", icon: "text-muted-foreground" },
};

function GroupCard({ group }: { group: ActionGroup }) {
  const Icon = ICONS[group.icon] ?? Inbox;
  const sev = SEV_CHIP[group.severity] ?? SEV_CHIP.soon;
  return (
    <div className="card-surface overflow-hidden border border-border">
      {group.severity === "now" && <div className="h-0.5 bg-rose-500" />}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/30">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`size-4 shrink-0 ${sev.icon}`} />
          <span className="font-semibold text-sm truncate">{group.label}</span>
        </div>
        <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full tabular-nums ${sev.cls}`}>
          {sev.label} · {group.count}
        </span>
      </div>
      <ul className="divide-y">
        {group.items.map((it) => (
          <li key={it.id} className="flex items-center gap-1 px-4 py-2.5 hover:bg-accent/40 transition-colors">
            <Link href={it.href} className="flex items-center gap-2 min-w-0 flex-1">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.title}</div>
                {it.detail && (
                  <div className="text-[11px] text-muted-foreground truncate">{it.detail}</div>
                )}
              </div>
              {typeof it.ageDays === "number" && it.ageDays > 0 && (
                <span
                  className={`text-[10px] tabular-nums shrink-0 ${
                    it.ageDays > 30
                      ? "font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200"
                      : it.ageDays > 7
                        ? "font-medium text-amber-700"
                        : "text-muted-foreground"
                  }`}
                  title={`${it.ageDays} day(s) overdue / waiting`}
                >
                  {it.ageDays}d
                </span>
              )}
            </Link>
            <CommandItemActions
              itemKey={it.itemKey ?? `${group.key}:${it.id}`}
              actionType={it.actionType}
              taskId={it.actionType === "task" ? it.id : undefined}
              phone={it.phone}
              wishText={wishText(it.actionType, it.title)}
            />
          </li>
        ))}
      </ul>
      {group.count > group.items.length && (
        <Link
          href={group.href}
          className="block px-4 py-2 text-xs font-medium text-brand-cyan-deep hover:underline border-t bg-card"
        >
          View all {group.count} →
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "rose" | "sky" | "emerald" | "amber" | "muted" }) {
  const cls =
    tone === "rose" ? "text-rose-600"
    : tone === "emerald" ? "text-emerald-600"
    : tone === "amber" ? "text-amber-600"
    : tone === "sky" ? "text-sky-600"
    : "text-foreground";
  return (
    <div className="text-center">
      <div className={`text-xl font-bold tabular-nums leading-none ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
