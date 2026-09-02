/**
 * AMC Empanelments list — every AMC the firm distributes for.
 *
 * The list is contact-rich on purpose: the most common reason an MFD
 * opens this page is "transaction stuck, who do I call?" Surfacing RM +
 * Ops + Escalation in the row beats a click-through.
 */

import Link from "next/link";
import { Plus, Phone, Mail, ExternalLink } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { amcEmpanelments } from "@/db/schema";

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
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  // Viewing the empanelment list is operational data — owner + compliance +
  // ops/back-office (settings.masters) can read it. Creating/editing stays
  // gated on compliance.edit at the action + API level.
  requireAny(session.roles, ["compliance.view", "compliance.edit", "settings.masters"], session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);
  const sp = await searchParams;
  const statusFilter = sp.status ?? "empanelled";

  const rows = await withTenant(session.tenantId, async (tx) => {
    const where = [eq(amcEmpanelments.tenantId, session.tenantId)];
    if (statusFilter !== "all") {
      where.push(eq(amcEmpanelments.status, statusFilter as any));
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
        <Link href="/dashboard/amc-empanelments/new" className="btn-primary text-sm">
          <Plus className="size-4" /> Add empanelment
        </Link>
      </div>

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
            href={`/dashboard/amc-empanelments?status=${s.value}`}
            className={`chip text-xs ${statusFilter === s.value
                ? "bg-brand-cyan-deep text-white"
                : "bg-secondary text-foreground hover:bg-secondary/70"
              }`}
          >
            {s.label}
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
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left">AMC</th>
                <th className="px-3 py-2 text-left">Distributor code</th>
                <th className="px-3 py-2 text-left">Empanelled since</th>
                <th className="px-3 py-2 text-left">RM contact</th>
                <th className="px-3 py-2 text-left">Ops contact</th>
                <th className="px-3 py-2 text-left">Escalation</th>
                <th className="px-3 py-2 text-left">Trail %</th>
                <th className="px-3 py-2 text-left">Portal</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/amc-empanelments/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.amcName}
                    </Link>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {r.amcCode}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.distributorCode ?? "—"}
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
                  <ContactCell
                    name={r.rmName}
                    email={r.rmEmail}
                    phone={r.rmPhone}
                  />
                  <ContactCell
                    name={r.opsName}
                    email={r.opsEmail}
                    phone={r.opsPhone}
                  />
                  <ContactCell
                    name={r.escalationName}
                    email={r.escalationEmail}
                    phone={r.escalationPhone}
                  />
                  <td className="px-3 py-2">
                    {r.trailRateOverridePct ? (
                      <span className="chip bg-violet-50 text-violet-700 text-[10px]">
                        {Number(r.trailRateOverridePct).toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">default</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.portalUrl ? (
                      <a
                        href={r.portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-600 hover:underline inline-flex items-center gap-1 text-[11px]"
                      >
                        Login <ExternalLink className="size-2.5" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
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
