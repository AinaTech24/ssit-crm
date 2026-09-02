import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { businessEntries, businessEntryLines } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { BusinessEntryForm } from "@/components/business/BusinessEntryForm";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];

export default async function EditBusinessEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [entry] = await tx
      .select()
      .from(businessEntries)
      .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
      .limit(1);
    if (!entry) return null;
    const lines = await tx
      .select()
      .from(businessEntryLines)
      .where(eq(businessEntryLines.entryId, id))
      .orderBy(asc(businessEntryLines.sortOrder));
    const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`);
    return { entry, lines, members: (r.rows as any[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" })) };
  });
  if (!data) notFound();

  const e = data.entry;
  return (
    <div className="space-y-5 max-w-5xl">
      <Link href={`/dashboard/business-entries/${id}`} className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to entry
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Edit business entry</h1>
      <BusinessEntryForm
        initial={{
          id: e.id,
          investorId: e.investorId,
          clientName: e.clientName,
          productType: e.productType,
          businessDate: String(e.businessDate),
          status: e.status,
          rmId: e.rmId,
          amcName: e.amcName,
          folioNo: e.folioNo,
          notes: e.notes,
        }}
        initialLines={data.lines}
        members={data.members}
        currentUserId={session.userId}
      />
    </div>
  );
}
