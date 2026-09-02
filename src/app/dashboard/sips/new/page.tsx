import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ManualSipForm } from "@/components/sips/ManualSipForm";

export const dynamic = "force-dynamic";

export default async function NewSipPage() {
  const session = await requireSession();
  // Same gate as the create API (transactions.execute) — back-office / ops / RM / owner.
  if (!can(session.roles, "transactions.execute", session.permissions)) redirect("/dashboard/sips");

  const members = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(
      sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`
    );
    return (r.rows as { id: string; name: string | null }[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/dashboard/sips" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to SIP Tracker
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Register a SIP</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manually add a SIP that isn&apos;t in the CAMS/KFintech feed yet. It joins the SIP book immediately.
        </p>
      </div>
      <ManualSipForm members={members} currentUserId={session.userId} />
    </div>
  );
}
