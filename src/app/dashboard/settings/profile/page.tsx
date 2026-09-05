import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { ChevronLeft, UserCircle, ArrowRight, ShieldCheck, ShieldAlert, History } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { primaryRoleLabel } from "@/lib/auth/rbac";
import { getEntitlement, currentFyStart, LEAVE_TYPE_LABELS } from "@/lib/leave/policy";
import { formatRelative } from "@/lib/utils";
import ProfileForm from "./ProfileForm";

export const dynamic = "force-dynamic";

const LEAVE_TYPES_SHOWN = ["casual", "sick", "earned", "comp_off"] as const;

export default async function ProfilePage() {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const [u] = await tx
      .select({
        name: users.name,
        email: users.email,
        phone: users.phone,
        emailVerifiedAt: users.emailVerifiedAt,
        avatarUrl: users.avatarUrl,
        department: users.department,
        joiningDate: users.joiningDate,
        annualTarget: users.annualTarget,
        sipMonthlyTarget: users.sipMonthlyTarget,
        twoFaEnabled: users.twoFaEnabled,
        customLeaveEntitlements: users.customLeaveEntitlements,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    // Actual leave used this FY (approved), for a real balance.
    const leaveUsed = await tx.execute(sql`
      SELECT leave_type, COALESCE(SUM(no_of_days), 0)::numeric AS used
      FROM leave_applications
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${session.userId}::uuid
        AND status = 'approved' AND from_date >= ${currentFyStart()}
      GROUP BY leave_type
    `);

    // Recent activity by this user (own audit trail — DPDP self-visibility).
    const activity = await tx.execute(sql`
      SELECT action, at, entity_type
      FROM audit_log
      WHERE tenant_id = ${session.tenantId}::uuid AND actor_user_id = ${session.userId}::uuid
      ORDER BY at DESC LIMIT 12
    `);

    return { u: u ?? null, leaveUsed: leaveUsed.rows as Array<{ leave_type: string; used: string }>, activity: activity.rows as Array<{ action: string; at: string; entity_type: string }> };
  });
  const me = data.u;

  const inr = (v: unknown) =>
    v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const usedByType: Record<string, number> = {};
  for (const r of data.leaveUsed) usedByType[r.leave_type] = Number(r.used ?? 0);
  const custom = (me?.customLeaveEntitlements as Record<string, number> | null) ?? null;
  const leaveRows = LEAVE_TYPES_SHOWN.map((t) => {
    const ent = getEntitlement(t, custom);
    const used = usedByType[t] ?? 0;
    return { type: t, entitlement: ent, used, remaining: ent == null ? null : Math.max(0, ent - used) };
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <UserCircle className="size-5" /> My profile
      </h1>

      {/* Identity (read-only) — email + verification live in "Your details" below. */}
      <div className="border rounded-lg bg-card p-5 grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Role</div>
          <div className="font-medium">{primaryRoleLabel(session.roles)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Department</div>
          <div className="font-medium capitalize">{me?.department ?? "—"}</div>
        </div>
      </div>

      {/* Two-factor status — the security nudge the app shows everywhere, here. */}
      <div className="border rounded-lg bg-card p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {me?.twoFaEnabled ? <ShieldCheck className="size-5 text-emerald-600" /> : <ShieldAlert className="size-5 text-amber-600" />}
          <div>
            <div className="font-semibold text-sm">Two-factor authentication</div>
            <div className="text-xs text-muted-foreground">
              {me?.twoFaEnabled ? "Enabled — your account is protected with a second factor." : "Not enabled. Your role can access client PAN / KYC — turn this on."}
            </div>
          </div>
        </div>
        <Link href="/dashboard/settings/security" className={`text-sm px-3 py-1.5 rounded-md ${me?.twoFaEnabled ? "border hover:bg-accent" : "bg-primary text-primary-foreground"}`}>
          {me?.twoFaEnabled ? "Manage" : "Enable 2FA"}
        </Link>
      </div>

      {/* Editable details + password */}
      <ProfileForm
        initialName={me?.name ?? ""}
        email={me?.email ?? ""}
        emailVerified={!!me?.emailVerifiedAt}
        initialPhone={me?.phone ?? ""}
        initialAvatarUrl={me?.avatarUrl ?? ""}
      />

      {/* Targets */}
      <div className="border rounded-lg bg-card p-5">
        <h3 className="font-semibold text-sm mb-3">My targets</h3>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Annual business target</div>
            <div className="text-lg font-bold">{inr(me?.annualTarget)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Monthly SIP target</div>
            <div className="text-lg font-bold">{inr(me?.sipMonthlyTarget)}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Targets are set by your firm owner.</p>
      </div>

      {/* Leave entitlements */}
      <div className="border rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">My leave (annual entitlement)</h3>
          <Link href="/dashboard/leave-applications" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Apply / view <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {leaveRows.map((l) => (
            <div key={l.type} className="rounded-md border bg-background px-3 py-2">
              <div className="text-xs text-muted-foreground">{LEAVE_TYPE_LABELS[l.type] ?? l.type}</div>
              {l.entitlement == null ? (
                <div className="text-lg font-bold">Unpaid</div>
              ) : (
                <>
                  <div className="text-lg font-bold">{l.remaining}<span className="text-xs font-normal text-muted-foreground"> / {l.entitlement} left</span></div>
                  <div className="text-[10px] text-muted-foreground">{l.used} used this FY</div>
                </>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">Balances are for the current financial year (Apr–Mar){custom ? " · includes your custom allowance" : ""}.</p>
      </div>

      {/* Recent activity — your own audit trail */}
      <div className="border rounded-lg bg-card p-5">
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><History className="size-4" /> Recent activity</h3>
        {data.activity.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent activity recorded.</p>
        ) : (
          <ul className="divide-y divide-border text-sm max-h-64 overflow-y-auto scrollbar-none">
            {data.activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="capitalize">{a.action.replace(/[._]/g, " ")}<span className="text-muted-foreground text-xs"> · {a.entity_type}</span></span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatRelative(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
