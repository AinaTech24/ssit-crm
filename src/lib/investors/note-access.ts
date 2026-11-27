import { and, eq } from "drizzle-orm";
import { investors } from "@/db/schema";
import { requireAny } from "@/lib/auth/rbac";
import { assertCanViewClient } from "@/lib/investors/access";
import type { SessionUser } from "@/lib/auth/session";

/** The client's servicing RM may always work on its notes, whatever capabilities they hold. */
export async function isClientsServiceRm(tx: any, session: SessionUser, investorId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: investors.id })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId), eq(investors.serviceRmId, session.userId)))
    .limit(1);
  return !!row;
}

/** Load the client and throw unless this session may open it (its notes and their files follow the same rule). */
export async function assertClientNotesVisible(tx: any, session: SessionUser, investorId: string) {
  if (await isClientsServiceRm(tx, session, investorId)) {
    const [inv] = await tx
      .select({ id: investors.id, name: investors.name, phone: investors.phone })
      .from(investors)
      .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId)))
      .limit(1);
    return inv;
  }
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
  const [inv] = await tx
    .select({ id: investors.id, name: investors.name, phone: investors.phone, rmId: investors.rmId, serviceRmId: investors.serviceRmId, branchId: investors.branchId })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId)))
    .limit(1);
  if (!inv) throw Object.assign(new Error("client not found"), { status: 404 });
  await assertCanViewClient(tx, session, inv);
  return inv;
}
