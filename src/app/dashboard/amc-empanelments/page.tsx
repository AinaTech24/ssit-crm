/**
 * AMC Empanelments list — every AMC the firm distributes for.
 *
 * The list is contact-rich on purpose: the most common reason an MFD
 * opens this page is "transaction stuck, who do I call?" Surfacing RM +
 * Ops + Escalation in the row beats a click-through.
 */

import Link from "next/link";
import { Plus, Phone, Mail, FileUp } from "lucide-react";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { AddAmcMeetingButton } from "@/components/amc-empanelments/AddAmcMeetingButton";
import { amcEmpanelments, EMPANELMENT_CATEGORIES, EMPANELMENT_CATEGORY_LABEL } from "@/db/schema";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  empanelled: "bg-emerald-50 text-emerald-700",
  under_review: "bg-amber-50 text-amber-700",
  suspended: "bg-rose-50 text-rose-700",
  terminated: "bg-gray-100 text-gray-600",
};

export default async function AmcEmpanelmentsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; view?: string }>;
}) {
  const session = await requireSession();
  // Branch heads only. Empanelment terms — distributor codes, trail rates, the
  // AMC escalation tree — are commercial relationship data, not something every
  // desk needs. `owner` still passes via the short-circuit in can(), and an
  // owner can delegate to a specific person with the capability tick.
  // A missing capability is an expected state, not a crash: say so instead of
  // dropping the user on the generic error page.
  // Two audiences: people who see the AMC's commercial details, and people who
  // only see its meetings (RIA / research). The second group gets the list of
  // AMCs and a way into the meetings tab — never the contacts or the controls.
  const canDetails = can(session.roles, "amc_empanelment.view", session.permissions);
  const canMeetings = can(session.roles, "amc_meeting.view", session.permissions);
  if (!canDetails && !canMeetings) {
    return (
      <div className="card-surface p-8 text-center max-w-xl mx-auto mt-10">
        <h1 className="text-lg font-semibold">AMC empanelments</h1>
        <p className="text-sm text-muted-foreground mt-2">
          You do not have access to this page. Ask your firm admin to enable “AMC empanelments” on your employee record.
        </p>
      </div>
    );
  }
  await assertActiveLicense(session.tenantId, session.roles);
  const sp = await searchParams;
  // The AMC dashboard has two parts: the AMC details (this list) and the AMC
  // meetings (what has happened with them, across every AMC).
  const view: "details" | "meetings" =
    sp.view === "meetings" && canMeetings ? "meetings" : canDetails ? "details" : "meetings";
  const tabs = (
    <div className="flex gap-1 border-b">
      {canDetails && (
        <Link
          href="/dashboard/amc-empanelments"
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${view === "details" ? "border-brand-cyan-deep text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          AMC details
        </Link>
      )}
      {canMeetings && (
        <Link
          href="/dashboard/amc-empanelments?view=meetings"
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${view === "meetings" ? "border-brand-cyan-deep text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          AMC meetings
        </Link>
      )}
    </div>
  );

  if (view === "meetings") {
    const amcOptions = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, amc_name AS name FROM amc_empanelments
         WHERE tenant_id = ${session.tenantId}::uuid
         ORDER BY amc_name ASC LIMIT 400
      `);
      return r.rows as Array<{ id: string; name: string }>;
    });
    const meetings = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT m.id, m.meeting_date, m.subject, m.attendees, m.notes, m.follow_up,
               e.id AS amc_id, e.amc_name, u.name AS author_name
          FROM amc_meetings m
          JOIN amc_empanelments e ON e.id = m.amc_empanelment_id
          LEFT JOIN users u ON u.id = m.created_by_user_id
         WHERE m.tenant_id = ${session.tenantId}::uuid
         ORDER BY m.meeting_date DESC, m.created_at DESC
         LIMIT 300
      `);
      return r.rows as Array<{
        id: string; meeting_date: string; subject: string; attendees: string | null;
        notes: string | null; follow_up: string | null; amc_id: string; amc_name: string; author_name: string | null;
      }>;
    });
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">AMC empanelments</h1>
          <AddAmcMeetingButton amcs={amcOptions} />
        </div>
        {tabs}
        {meetings.length === 0 ? (
          <div className="card-surface p-12 text-center text-sm text-muted-foreground">
            No AMC meetings recorded yet. Use “Create meeting” to add the first one.
          </div>
        ) : (
          <div className="card-surface table-scroll">
            <table className="w-full text-xs min-w-[900px]">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">AMC</th>
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-left">Attendees</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                  <th className="px-3 py-2 text-left">Follow-up</th>
                  <th className="px-3 py-2 text-left">Added by</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id} className="border-t hover:bg-slate-50/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(m.meeting_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/amc-empanelments/${m.amc_id}?tab=meetings`} className="font-medium hover:underline">
                        {m.amc_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{m.subject}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.attendees || "—"}</td>
                    <td className="px-3 py-2 max-w-xs whitespace-pre-wrap">{m.notes || "—"}</td>
                    <td className="px-3 py-2 max-w-xs whitespace-pre-wrap">{m.follow_up || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.author_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
  const statusFilter = sp.status ?? "empanelled";
  const categoryFilter = sp.category ?? "all";
  // Preserve the other axis when one filter is clicked, so the two compose
  // instead of resetting each other.
  const hrefFor = (patch: { status?: string; category?: string }) => {
    const q = new URLSearchParams();
    const st = patch.status ?? statusFilter;
    const ct = patch.category ?? categoryFilter;
    if (st) q.set("status", st);
    if (ct && ct !== "all") q.set("category", ct);
    return `/dashboard/amc-empanelments?${q.toString()}`;
  };

  const rows = await withTenant(session.tenantId, async (tx) => {
    const where = [eq(amcEmpanelments.tenantId, session.tenantId)];
    if (statusFilter !== "all") {
      where.push(eq(amcEmpanelments.status, statusFilter as any));
    }
    if (categoryFilter !== "all") {
      // "uncategorised" is a real bucket: every row predating migration 0207
      // has no category, and they need to be findable to be fixed.
      where.push(
        categoryFilter === "uncategorised"
          ? isNull(amcEmpanelments.category)
          : eq(amcEmpanelments.category, categoryFilter)
      );
    }
    return tx
      .select()
      .from(amcEmpanelments)
      .where(and(...where))
      .orderBy(amcEmpanelments.amcName);
  });

  const counts = await withTenant(session.tenantId, async (tx) => {
    const all = await tx
      .select()
      .from(amcEmpanelments)
      .where(eq(amcEmpanelments.tenantId, session.tenantId));
    return {
      total: all.length,
      byCategory: Object.fromEntries(
        EMPANELMENT_CATEGORIES.map((c) => [c.value, all.filter((r) => r.category === c.value).length])
      ) as Record<string, number>,
      uncategorised: all.filter((r) => !r.category).length,
      empanelled: all.filter((r) => r.status === "empanelled").length,
      underReview: all.filter((r) => r.status === "under_review").length,
      suspended: all.filter((r) => r.status === "suspended").length,
      terminated: all.filter((r) => r.status === "terminated").length,
    };
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AMC empanelments</h1>
        </div>
        {canDetails && (
        <div className="flex items-center gap-2">
          <Link href="/dashboard/amc-empanelments/catalog-import" className="btn-secondary text-sm">
            <FileUp className="size-4" /> Import AMC list
          </Link>
          <Link href="/dashboard/amc-empanelments/import" className="btn-secondary text-sm">
            <FileUp className="size-4" /> Bulk upload
          </Link>
          <Link href="/dashboard/amc-empanelments/new" className="btn-primary text-sm">
            <Plus className="size-4" /> Add empanelment
          </Link>
        </div>
        )}
      </div>

      {tabs}

      <div className="flex items-center gap-2 flex-wrap">
        {[
          { value: "empanelled", label: `Empanelled · ${counts.empanelled}` },
          { value: "under_review", label: `Under review · ${counts.underReview}` },
          { value: "suspended", label: `Suspended · ${counts.suspended}` },
          { value: "terminated", label: `Terminated · ${counts.terminated}` },
          { value: "all", label: `All · ${counts.total}` },
        ].map((s) => (
          <Link
            key={s.value}
            href={hrefFor({ status: s.value })}
            aria-current={statusFilter === s.value ? "page" : undefined}
            className={`chip text-xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40 ${
              statusFilter === s.value
                ? "bg-brand-cyan-deep text-white"
                : "bg-secondary text-foreground hover:bg-secondary/70 hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {/* Product line — the second filter axis, composed with status above. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">Product line</span>
        {[
          { value: "all", label: `All · ${counts.total}` },
          ...EMPANELMENT_CATEGORIES.map((c) => ({
            value: c.value,
            label: `${c.label} · ${counts.byCategory[c.value] ?? 0}`,
          })),
          ...(counts.uncategorised > 0
            ? [{ value: "uncategorised", label: `Uncategorised · ${counts.uncategorised}` }]
            : []),
        ].map((c) => (
          <Link
            key={c.value}
            href={hrefFor({ category: c.value })}
            aria-current={categoryFilter === c.value ? "page" : undefined}
            className={`chip text-xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40 ${
              categoryFilter === c.value
                ? "bg-brand-cyan-deep text-white"
                : "bg-secondary text-foreground hover:bg-secondary/70 hover:text-foreground"
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No empanelments with this filter yet.
          </p>
          <Link
            href="/dashboard/amc-empanelments/new"
            className="btn-primary text-sm mt-4"
          >
            <Plus className="size-4" /> Add the first empanelment
          </Link>
        </div>
      ) : (
        <div className="card-surface table-scroll">
          <table className="w-full text-xs min-w-[1000px]">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left">AMC</th>
                <th className="px-3 py-2 text-left">Product line</th>
                <th className="px-3 py-2 text-left">Empanelled since</th>
                {canDetails && (
                  <>
                    <th className="px-3 py-2 text-left">RM contact</th>
                    <th className="px-3 py-2 text-left">Ops contact</th>
                    <th className="px-3 py-2 text-left">Escalation</th>
                    <th className="px-3 py-2 text-left">Billing</th>
                  </>
                )}
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/amc-empanelments/${r.id}${canDetails ? "" : "?tab=meetings"}`}
                      className="font-medium hover:underline"
                    >
                      {r.amcName}
                    </Link>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {r.amcCode}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.category ? (
                      <span className="chip bg-sky-50 text-sky-700 text-[10px]">
                        {EMPANELMENT_CATEGORY_LABEL[r.category] ?? r.category}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.empanelmentDate
                      ? new Date(r.empanelmentDate).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                      : "—"}
                  </td>
                  {canDetails && (
                    <>
                      <ContactCell name={r.rmName} email={r.rmEmail} phone={r.rmPhone} />
                      <ContactCell name={r.opsName} email={r.opsEmail} phone={r.opsPhone} />
                      <ContactCell name={r.escalationName} email={r.escalationEmail} phone={r.escalationPhone} />
                      <ContactCell name={r.billingName} email={r.billingEmail} phone={r.billingPhone} />
                    </>
                  )}
                  <td className="px-3 py-2">
                    <span
                      className={`chip text-[10px] ${STATUS_TONE[r.status] ?? "bg-slate-100"
                        }`}
                    >
                      {r.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ContactCell({
  name,
  email,
  phone,
}: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  if (!name && !email && !phone) {
    return (
      <td className="px-3 py-2 text-muted-foreground">—</td>
    );
  }
  return (
    <td className="px-3 py-2">
      {name && <div className="text-[11px] font-medium">{name}</div>}
      {email && (
        <a
          href={`mailto:${email}`}
          className="inline-flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-900"
        >
          <Mail className="size-2.5" />
          {email}
        </a>
      )}
      {phone && (
        <div>
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-900"
          >
            <Phone className="size-2.5" />
            {phone}
          </a>
        </div>
      )}
    </td>
  );
}
