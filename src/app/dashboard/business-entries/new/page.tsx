import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { BusinessEntryForm } from "@/components/business/BusinessEntryForm";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];

export default async function NewBusinessEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");

  const sp = await searchParams;
  const subjectId = (sp.investorId ?? "").trim();

  const { members, prefillClient } = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`);
    const members = (r.rows as { id: string; name: string | null }[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));

    // Prefill the client when arriving from a blueprint action (the id may be the
    // investor's id, or a lead id whose converted investor is this client).
    let prefillClient: { id: string; name: string } | undefined;
    if (/^[0-9a-f-]{36}$/i.test(subjectId)) {
      const inv = (
        await tx.execute(sql`
          SELECT id, name FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid
            AND (id = ${subjectId}::uuid
                 OR id = (SELECT converted_investor_id FROM leads WHERE id = ${subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid))
          LIMIT 1
        `)
      ).rows[0] as { id: string; name: string | null } | undefined;
      if (inv) prefillClient = { id: String(inv.id), name: inv.name ?? "Client" };
    }
    return { members, prefillClient };
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/business-entries" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to entries
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New business closing entry</h1>
      <BusinessEntryForm members={members} currentUserId={session.userId} prefillClient={prefillClient} />
    </div>
  );
}
