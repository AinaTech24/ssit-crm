import Link from "next/link";
import { and, eq, ne } from "drizzle-orm";
import { ChevronLeft, ShieldCheck, AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Days until a date (negative = past). null when no date. */
function daysLeft(d: string | Date | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (isNaN(t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86400000);
}

function ExpiryCell({ value, holder }: { value: string | Date | null; holder?: string | null }) {
  const dl = daysLeft(value);
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = dl == null ? "" : dl < 0 ? "text-rose-600 font-semibold" : dl < 30 ? "text-rose-600" : dl < 90 ? "text-amber-600" : "text-foreground";
  return (
    <span className={`text-xs inline-flex items-center gap-1 ${tone}`}>
      {dl != null && dl < 30 && <AlertTriangle className="size-3" />}
      {formatDate(value)}
      {dl != null && <span className="text-[10px] text-muted-foreground">({dl < 0 ? `${-dl}d ago` : `${dl}d`})</span>}
    </span>
  );
}

const FIELDS = ["nism_expiry_at", "arn_expiry_at", "euin_expiry_at", "dsc_expiry_at"] as const;

export default async function TeamLicensingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  // Team management is firm-admin only — same gate as the Employees list.
  if (!can(session.roles, "settings.users", session.permissions)) redirect("/dashboard");
  const sp = await searchParams;
  const filter = sp.filter ?? "all"; // all | expiring | expired

  const rows = await withTenant(session.tenantId, async (tx) =>
    tx
      .select({
        id: users.id,
        name: users.name,
        department: users.department,
        euin: users.euin,
        personalArn: users.personalArn,
        nismExpiryAt: users.nismExpiryAt,
        arnExpiryAt: users.arnExpiryAt,
        euinExpiryAt: users.euinExpiryAt,
        dscExpiryAt: users.dscExpiryAt,
        dscSubmitted: users.dscSubmitted,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.tenantId, session.tenantId), ne(users.status, "offboarded")))
      .orderBy(users.name)
  );

  // Compute each employee's worst licensing state.
  const enriched = rows.map((r) => {
    const dls = FIELDS.map((f) => daysLeft((r as any)[camel(f)] as any)).filter((d): d is number => d != null);
    const minDl = dls.length ? Math.min(...dls) : null;
    const expired = dls.some((d) => d < 0);
    const expiring = dls.some((d) => d >= 0 && d < 90);
    return { ...r, minDl, expired, expiring };
  });

  const visible = enriched.filter((e) => (filter === "expired" ? e.expired : filter === "expiring" ? e.expiring || e.expired : true));
  const counts = {
    expired: enriched.filter((e) => e.expired).length,
    expiring: enriched.filter((e) => e.expiring && !e.expired).length,
  };

  const tabs = [
    { key: "all", label: "All" },
    { key: "expiring", label: `Expiring / expired (${counts.expired + counts.expiring})` },
    { key: "expired", label: `Expired (${counts.expired})` },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <Link href="/dashboard/employees" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft className="size-3" /> Back to employees
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="size-6 text-brand-cyan" /> Team licensing &amp; compliance
        </h1>
        <p className="text-muted-foreground text-sm">NISM · ARN · EUIN · DSC expiry across the team. Renew certificates from each employee&apos;s profile.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="kpi-card"><div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Team members</div><div className="text-2xl font-bold mt-1">{enriched.length}</div></div>
        <div className="kpi-card"><div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Expiring (90d)</div><div className={`text-2xl font-bold mt-1 ${counts.expiring > 0 ? "text-amber-600" : ""}`}>{counts.expiring}</div></div>
        <div className="kpi-card"><div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Expired</div><div className={`text-2xl font-bold mt-1 ${counts.expired > 0 ? "text-rose-600" : ""}`}>{counts.expired}</div></div>
      </div>

      <div className="flex gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/employees/compliance?filter=${t.key}`}
            className={`text-xs px-3 py-1.5 rounded-md border ${filter === t.key ? "bg-brand-cyan text-white border-brand-cyan" : "hover:bg-secondary"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="card-surface overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <ShieldCheck className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No employees match this filter.</div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Employee</th>
                  <th className="text-left py-2 font-medium">NISM</th>
                  <th className="text-left py-2 font-medium">ARN</th>
                  <th className="text-left py-2 font-medium">EUIN</th>
                  <th className="text-left py-2 font-medium pr-4">DSC</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/employees/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
                      <div className="text-[11px] text-muted-foreground capitalize">{e.department?.replace(/_/g, " ") ?? "—"}</div>
                    </td>
                    <td className="py-3"><ExpiryCell value={e.nismExpiryAt} /></td>
                    <td className="py-3"><ExpiryCell value={e.arnExpiryAt} /></td>
                    <td className="py-3"><ExpiryCell value={e.euinExpiryAt} /></td>
                    <td className="py-3 pr-4">
                      {e.dscSubmitted ? <ExpiryCell value={e.dscExpiryAt} /> : <span className="text-[11px] text-muted-foreground">not submitted</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** snake_case column → the camelCase select alias used above. */
function camel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
