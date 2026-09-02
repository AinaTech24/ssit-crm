/**
 * Firm profile — consolidated view of every regulator-facing data point
 * about the firm. Network FP "1.6 Firm Details" template parity.
 *
 * Pulls from FIVE sources and renders one printable page:
 *   - tenants (basic + tax + bank + signatory)
 *   - firm_directors (board / partner list)
 *   - branches (registered office + branch offices)
 *   - users (employee count + active count)
 *   - legal_registrations (all SEBI / AMFI / IRDAI / etc. licenses)
 *
 * Designed to be print-friendly — owners often print this for SEBI
 * inspection or DDQ submission.
 */

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { eq, count, and, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import {
  tenants,
  firmDirectors,
  branches,
  users,
  legalRegistrations,
} from "@/db/schema";
import { FirmProfileEditor } from "@/components/settings/FirmProfileEditor";
import { DomainSettings } from "@/components/settings/DomainSettings";
import { PrintButton } from "@/components/settings/PrintButton";
import { computeFirmReadiness, expiryStatus } from "@/lib/firm/readiness";

export const dynamic = "force-dynamic";

export default async function FirmProfilePage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.users", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);

  const data = await withTenant(session.tenantId, async (tx) => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);

    const directors = await tx
      .select()
      .from(firmDirectors)
      .where(eq(firmDirectors.tenantId, session.tenantId))
      .orderBy(firmDirectors.name);

    const branchRows = await tx
      .select()
      .from(branches)
      .where(eq(branches.tenantId, session.tenantId))
      .orderBy(branches.name);

    const [{ total }] = await tx
      .select({ total: count() })
      .from(users)
      .where(eq(users.tenantId, session.tenantId));
    const [{ active }] = await tx
      .select({ active: count() })
      .from(users)
      .where(
        and(eq(users.tenantId, session.tenantId), eq(users.status, "active"))
      );

    const registrations = await tx
      .select({
        id: legalRegistrations.id,
        authority: legalRegistrations.authority,
        authorityOther: legalRegistrations.authorityOther,
        registrationFor: legalRegistrations.registrationFor,
        registrationNumber: legalRegistrations.registrationNumber,
        expiryAt: legalRegistrations.expiryAt,
        status: legalRegistrations.status,
      })
      .from(legalRegistrations)
      .where(
        and(
          eq(legalRegistrations.tenantId, session.tenantId),
          sql`status IN ('active', 'pending_renewal')`
        )
      )
      .orderBy(legalRegistrations.authority);

    return {
      tenant,
      directors,
      branches: branchRows,
      employeeCounts: { total: Number(total), active: Number(active) },
      registrations,
    };
  });

  const readiness = computeFirmReadiness({
    tenant: data.tenant as any,
    directorCount: data.directors.length,
    activeRegistrationCount: data.registrations.length,
  });

  // Expiry alerts — ARN + every active registration.
  const arnExp = expiryStatus((data.tenant as any).arnExpiryAt);
  const expiryAlerts = [
    ...(arnExp.state === "expired" || arnExp.state === "soon"
      ? [{ label: `ARN ${data.tenant.arn}`, state: arnExp.state, days: arnExp.days }]
      : []),
    ...data.registrations
      .map((r) => {
        const e = expiryStatus(r.expiryAt as any);
        const auth = r.authority === "Other" ? r.authorityOther : r.authority?.replace("_", " ");
        return e.state === "expired" || e.state === "soon"
          ? { label: `${auth} — ${r.registrationFor}`, state: e.state, days: e.days }
          : null;
      })
      .filter(Boolean) as { label: string; state: string; days: number | null }[],
  ];

  // Shareholding sanity — should total 100% when directors carry shares.
  const shareTotal = data.directors.reduce((s, d) => s + (d.shareholdingPct ? Number(d.shareholdingPct) : 0), 0);
  const shareSet = data.directors.some((d) => d.shareholdingPct != null);
  const shareOff = shareSet && Math.abs(shareTotal - 100) > 0.5;

  const ringColor = readiness.pct >= 90 ? "text-emerald-600" : readiness.pct >= 60 ? "text-amber-500" : "text-rose-500";

  return (
    <div className="space-y-6 max-w-5xl print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Firm profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every regulator-facing data point about the firm in one place.
            Print this for SEBI inspection or DDQ submission.
          </p>
        </div>
        <PrintButton />
      </div>

      {/* Print-only title */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold text-center">
          {data.tenant.displayName} — Firm Profile
        </h1>
        <p className="text-center text-xs text-slate-500">
          Generated on {new Date().toLocaleDateString("en-GB")}
        </p>
        <hr className="my-3" />
      </div>

      {/* DDQ / SEBI readiness */}
      <section className="card-surface p-5 print:hidden">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="relative size-20 flex-shrink-0">
            <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" className="text-secondary" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" className={ringColor}
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${readiness.pct} ${100 - readiness.pct}`}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center leading-none">
                <div className={`text-lg font-bold ${ringColor}`}>{readiness.pct}%</div>
                <div className="text-[9px] text-muted-foreground">ready</div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-[16rem]">
            <h2 className="font-semibold text-base flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-brand-cyan" /> DDQ / SEBI readiness
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {readiness.filled} of {readiness.total} regulator-facing fields complete
              {readiness.criticalMissing.length > 0 && (
                <span className="text-rose-600 font-medium"> · {readiness.criticalMissing.length} critical missing</span>
              )}
              {readiness.missing.length === 0 && <span className="text-emerald-600 font-medium"> · inspection-ready</span>}
            </p>
            {readiness.missing.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {readiness.missing.map((m) => (
                  <li key={m.key}>
                    <Link
                      href={m.href}
                      title={m.hint}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                        m.critical ? "border-rose-200 bg-rose-50 text-rose-700" : "border-border bg-secondary text-muted-foreground"
                      } hover:underline`}
                    >
                      <AlertTriangle className="size-2.5" /> {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Expiry alerts */}
      {expiryAlerts.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 print:hidden">
          <div className="font-semibold text-sm text-amber-800 flex items-center gap-1.5 mb-2">
            <AlertTriangle className="size-4" /> Licenses needing attention
          </div>
          <ul className="space-y-1 text-xs">
            {expiryAlerts.map((a, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="font-medium">{a.label}</span>
                <span className={a.state === "expired" ? "text-rose-700 font-semibold" : "text-amber-700"}>
                  {a.state === "expired" ? `expired ${Math.abs(a.days ?? 0)} days ago` : `expires in ${a.days} days`}
                  {" · "}
                  <Link href="/dashboard/legal-registrations" className="underline">renew</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Inline editor + view — the editor handles the tenant scalar
          fields. Directors + branches + registrations have their own
          dedicated pages, surfaced here as read-only summaries. */}
      <FirmProfileEditor tenant={data.tenant as any} />

      {/* White-label URL — vanity subdomain + custom domain */}
      <div className="print:hidden">
        <DomainSettings />
      </div>

      {/* Directors */}
      <SectionCard
        title="Directors / Founders / Partners"
        subtitle={`${data.directors.length} on record`}
        actionHref="/dashboard/settings/firm-profile#directors"
      >
        {data.directors.length === 0 ? (
          <Empty msg="No directors / founders added yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">DIN</th>
                  <th className="px-3 py-2 text-left">PAN</th>
                  <th className="px-3 py-2 text-right">Share %</th>
                  <th className="px-3 py-2 text-left">Appointed</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.directors.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="px-3 py-2 font-medium">
                      {d.name}
                      {d.email && (
                        <div className="text-[10px] text-muted-foreground">
                          {d.email}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 capitalize">
                      {d.role.replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2 font-mono">{d.din ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">
                      {d.panNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {d.shareholdingPct
                        ? `${Number(d.shareholdingPct).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {d.dateOfAppointment ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`chip text-[10px] ${
                          d.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {shareSet && (
                <tfoot>
                  <tr className="border-t bg-slate-50">
                    <td className="px-3 py-2 font-semibold" colSpan={4}>
                      Total shareholding
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${shareOff ? "text-rose-600" : "text-emerald-700"}`}>
                      {shareTotal.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2" colSpan={2}>
                      {shareOff && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-rose-600">
                          <AlertTriangle className="size-3" /> should total 100%
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </SectionCard>

      {/* Branches */}
      <SectionCard
        title="Offices"
        subtitle={`${data.branches.length} on record · registered office is HQ`}
        actionHref="/dashboard/branches"
      >
        {data.branches.length === 0 ? (
          <Empty msg="No branches yet. The HQ is auto-created on signup." />
        ) : (
          <ul className="space-y-2">
            {data.branches.map((b) => (
              <li
                key={b.id}
                className="border border-slate-200 rounded-md p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{b.name}</div>
                  {(b as any).isHq === "true" && (
                    <span className="chip bg-violet-50 text-violet-700 text-[10px]">
                      Registered HQ
                    </span>
                  )}
                </div>
                {(b as any).code && (
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {(b as any).code}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Registrations summary */}
      <SectionCard
        title="Licenses &amp; Registrations"
        subtitle={`${data.registrations.length} active / pending`}
        actionHref="/dashboard/legal-registrations"
      >
        {data.registrations.length === 0 ? (
          <Empty msg="No licenses on record. Add them in Legal Registrations." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Authority</th>
                  <th className="px-3 py-2 text-left">For</th>
                  <th className="px-3 py-2 text-left">Number</th>
                  <th className="px-3 py-2 text-left">Expiry</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.registrations.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 font-medium">
                      {r.authority === "Other"
                        ? r.authorityOther
                        : r.authority.replace("_", " ")}
                    </td>
                    <td className="px-3 py-2">{r.registrationFor}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.registrationNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2">{r.expiryAt ?? "Perpetual"}</td>
                    <td className="px-3 py-2 capitalize">
                      {r.status.replace("_", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* HR Summary */}
      <SectionCard
        title="Employees"
        subtitle="HR summary"
        actionHref="/dashboard/employees"
      >
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Total on record" value={data.employeeCounts.total} />
          <Stat label="Active" value={data.employeeCounts.active} />
        </div>
      </SectionCard>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  actionHref,
  children,
}: {
  title: string;
  subtitle?: string;
  actionHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-base">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {actionHref && (
          <a
            href={actionHref}
            className="text-xs text-violet-600 hover:underline print:hidden"
          >
            Manage →
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <p className="text-xs text-muted-foreground text-center py-6">{msg}</p>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
