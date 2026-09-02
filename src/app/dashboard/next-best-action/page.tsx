import Link from "next/link";
import {
  Sparkles, Target, IndianRupee, AlertTriangle, TrendingDown, XOctagon,
  ShieldAlert, CalendarClock, Moon, ShieldCheck, TrendingUp, Cake, MessageCircle, FileText,
  ListChecks, LayoutList, Rows3,
} from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { buildNextBestActions, NBA_META, type NbaType, type NbaAction } from "@/lib/nba/engine";
import { Avatar } from "@/components/ui/Avatar";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import { LogActivityButton } from "@/components/activities/ActivityLogger";
import { NbaDateFilter } from "@/components/nba/NbaDateFilter";
import { NbaUserFilter } from "@/components/nba/NbaUserFilter";
import { NbaRowActions } from "@/components/nba/NbaRowActions";
import { NbaFocusMode, type FocusAction } from "@/components/nba/NbaFocusMode";
import { HelpTip } from "@/components/common/HelpTip";
import { MyDayNav } from "@/components/layout/MyDayNav";

export const dynamic = "force-dynamic";

const ICONS: Record<string, any> = { TrendingDown, XOctagon, ShieldAlert, Sparkles, CalendarClock, Moon, ShieldCheck, TrendingUp, Cake, MessageCircle, FileText };
const TONE: Record<string, string> = {
  rose: "border-l-rose-500", amber: "border-l-amber-500", sky: "border-l-sky-500", violet: "border-l-violet-500", emerald: "border-l-emerald-500",
};
const CHIP_TONE: Record<string, string> = {
  rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700", sky: "bg-sky-50 text-sky-700", violet: "bg-violet-50 text-violet-700", emerald: "bg-emerald-50 text-emerald-700",
};
const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : n > 0 ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—");

export default async function NextBestActionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const canFirm = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const typeFilter = (sp.type ?? "") as NbaType | "";
  const sevFilter = (sp.sev ?? "") as "now" | "today" | "soon" | "";
  const dateFrom = (sp.date_from ?? "").slice(0, 10);
  const dateTo = (sp.date_to ?? "").slice(0, 10);
  // Owners can scope the worklist to a specific team member; "All users" (empty)
  // = firm-wide. Non-owners only ever see their own book.
  const userParam = canFirm ? (sp.user ?? "").trim() : "";
  const scopedUserId = userParam || session.userId;
  const firmWide = canFirm && !userParam;
  const scopeLabel = firmWide ? "across the firm" : userParam ? "in this member's book" : "in your book";
  const focusMode = (sp.focus ?? "") === "1";

  const { actions, userOptions, handledThisWeek } = await withTenant(
    session.tenantId,
    async (tx) => {
      const actions = await buildNextBestActions(tx as any, { userId: scopedUserId, firmWide, limit: 150 });
      let userOptions: { value: string; label: string }[] = [];
      if (canFirm) {
        const r = await tx.execute(sql`
          SELECT id, name FROM users
          WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
          ORDER BY name ASC
        `);
        userOptions = (r.rows as { id: string; name: string }[]).map((u) => ({ value: String(u.id), label: u.name ?? "—" }));
      }
      // Outcome KPI — NBA actions the viewer snoozed/done/dismissed in 7 days.
      let handledThisWeek = 0;
      try {
        const h = await tx.execute(sql`
          SELECT count(*)::int AS n FROM command_center_snoozes
          WHERE user_id = ${session.userId}::uuid AND item_key LIKE 'nba:%'
            AND updated_at > now() - interval '7 days'
        `);
        handledThisWeek = Number((h.rows[0] as any)?.n ?? 0);
      } catch { /* pre-migration */ }
      return { actions, userOptions, handledThisWeek };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const totalImpact = actions.reduce((a, x) => a + x.impactInr, 0);
  const nowCount = actions.filter((a) => a.severity === "now").length;
  const signalsTotal = actions.reduce((n, a) => n + 1 + (a.others?.length ?? 0), 0);
  const byType = actions.reduce((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {} as Record<string, number>);
  // Date-range filter over each action's relevant date. Once a range is set,
  // undated actions (e.g. cross-sell) drop out.
  const inRange = (d: string | null) => {
    if (!dateFrom && !dateTo) return true;
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };
  const shown = actions.filter(
    (a) =>
      (!typeFilter || a.type === typeFilter) &&
      (!sevFilter || a.severity === sevFilter) &&
      inRange(a.date)
  );

  const hrefWith = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/dashboard/next-best-action?${s}` : "/dashboard/next-best-action";
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="size-6 text-brand-cyan" /> Next Best Action
            <HelpTip title="Next Best Action">
              A prioritised, one-at-a-time worklist of the highest-value action for each client
              right now — so nothing slips and your team always knows what to do next.
            </HelpTip>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 gap-0.5">
            <Link href={hrefWith({ focus: undefined })} className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 ${!focusMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Rows3 className="size-3" /> List
            </Link>
            <Link href={hrefWith({ focus: "1" })} className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 ${focusMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutList className="size-3" /> Focus
            </Link>
          </div>
          {canFirm && <NbaUserFilter value={userParam} options={userOptions} />}
        </div>
      </div>

      <MyDayNav />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Target} label="Clients to act on" value={String(actions.length)} />
        <Kpi icon={AlertTriangle} label="Act now" value={String(nowCount)} tone="rose" />
        <Kpi icon={IndianRupee} label="₹ value at stake" value={inr(totalImpact)} tone="emerald" />
        <Kpi icon={ListChecks} label="Handled this week" value={String(handledThisWeek)} tone="sky" />
      </div>
      <p className="text-[11px] text-muted-foreground -mt-3">{signalsTotal} signals across {actions.length} clients (one headline each; the rest shown as “+N more”).</p>

      {/* Date-range filter — over each action's relevant date */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mr-1">When</span>
        <NbaDateFilter from={dateFrom} to={dateTo} />
        {(dateFrom || dateTo) && (
          <span className="text-[11px] text-muted-foreground">
            Showing {shown.length} of {actions.length} — undated actions hidden while a range is set.
          </span>
        )}
      </div>

      {/* Urgency + type filter chips — one wrapping row, all labels together. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mr-1">Urgency</span>
        <Link href={hrefWith({ sev: undefined })} className={`chip ${!sevFilter ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>All</Link>
        {(["now", "today", "soon"] as const).map((k) => {
          const label = k === "now" ? "Act now" : k === "today" ? "Today" : "This week";
          const cnt = actions.filter((a) => a.severity === k).length;
          return (
            <Link key={k} href={hrefWith({ sev: k })} className={`chip ${sevFilter === k ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
              {label} <strong className="ml-1">{cnt}</strong>
            </Link>
          );
        })}

        <span className="mx-1 h-4 w-px bg-border shrink-0" aria-hidden />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mr-1">Type</span>
        <Link href={hrefWith({ type: undefined })} className={`chip ${!typeFilter ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>All <strong className="ml-1">{actions.length}</strong></Link>
        {(Object.keys(byType) as NbaType[]).sort((a, b) => NBA_META[b].weight - NBA_META[a].weight).map((t) => (
          <Link key={t} href={hrefWith({ type: t })} className={`chip ${typeFilter === t ? "bg-primary text-primary-foreground" : CHIP_TONE[NBA_META[t].tone]}`}>
            {NBA_META[t].label} <strong className="ml-1">{byType[t]}</strong>
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <ShieldCheck className="size-10 mx-auto text-emerald-500" />
          <div className="mt-3 font-medium">You&apos;re all caught up. ✓</div>
          <p className="text-sm text-muted-foreground mt-1">No high-priority actions {scopeLabel} right now.</p>
        </div>
      ) : focusMode ? (
        <NbaFocusMode actions={shown.map(toFocusAction)} />
      ) : (
        // Fixed-height worklist — scrolls inside the page, scrollbar hidden.
        <div className="max-h-[calc(100vh-20rem)] min-h-[18rem] overflow-y-auto scrollbar-none pr-0.5">
          <ol className="space-y-2">
            {shown.map((a, i) => <Row key={a.key} a={a} rank={i + 1} />)}
          </ol>
        </div>
      )}
    </div>
  );
}

function Row({ a, rank }: { a: NbaAction; rank: number }) {
  const meta = NBA_META[a.type];
  const Icon = ICONS[meta.icon] ?? Sparkles;
  // Suggested channel first, then the rest.
  const show: Array<"whatsapp" | "call" | "email"> =
    a.suggestedChannel === "whatsapp" ? ["whatsapp", "call"] : ["call", "whatsapp"];
  return (
    <li className={`card-surface border-l-4 ${TONE[meta.tone]} p-3 flex items-center gap-3`}>
      <div className="text-sm font-bold text-muted-foreground tabular-nums w-6 text-center shrink-0">{rank}</div>
      <div className={`size-9 rounded-lg grid place-items-center shrink-0 ${CHIP_TONE[meta.tone]}`}><Icon className="size-4" /></div>
      <Avatar
        src={a.avatarUrl ? `/api/${a.subjectType === "lead" ? "leads" : "investors"}/${a.subjectId}/avatar` : null}
        name={a.subjectName}
        size={32}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={a.href} className="font-semibold text-sm hover:underline truncate">{a.subjectName}</Link>
          <span className={`chip text-[10px] ${CHIP_TONE[meta.tone]}`}>{meta.label}</span>
          {a.subjectType === "lead" && <span className="chip text-[10px] bg-amber-50 text-amber-700">Lead</span>}
          {a.others && a.others.length > 0 && (
            <span
              className="chip text-[10px] bg-secondary text-muted-foreground"
              title={a.others.map((o) => `${o.label}: ${o.reason}`).join("\n")}
            >
              +{a.others.length} more
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">{a.reason}{a.rmName ? <span className="opacity-60"> · RM {a.rmName}</span> : ""}</div>
      </div>
      {a.impactInr > 0 && (
        <div className="text-right shrink-0 hidden sm:block">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Impact</div>
          <div className="text-sm font-bold tabular-nums text-emerald-700">{inr(a.impactInr)}</div>
        </div>
      )}
      <div className="flex items-center gap-1.5 shrink-0">
        <ContactQuickActions phone={a.phone} email={a.email} message={a.message} show={show} size={15} />
        <LogActivityButton subject={{ type: a.subjectType, id: a.subjectId, name: a.subjectName, phone: a.phone }} label="Log" variant="secondary" />
        <NbaRowActions snoozeKey={a.snoozeKey} name={a.subjectName} label={meta.label} reason={a.reason} phone={a.phone} email={a.email} />
      </div>
    </li>
  );
}

/** Map a ranked action to the serialisable shape the focus stepper renders. */
function toFocusAction(a: NbaAction): FocusAction {
  const meta = NBA_META[a.type];
  return {
    key: a.key,
    type: a.type,
    label: meta.label,
    toneChip: CHIP_TONE[meta.tone],
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    subjectName: a.subjectName,
    phone: a.phone,
    email: a.email,
    reason: a.reason,
    rmName: a.rmName,
    impactLabel: a.impactInr > 0 ? inr(a.impactInr) : null,
    message: a.message,
    snoozeKey: a.snoozeKey,
    href: a.href,
    othersCount: a.others?.length ?? 0,
  };
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "rose" | "emerald" | "sky" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : tone === "sky" ? "text-sky-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
